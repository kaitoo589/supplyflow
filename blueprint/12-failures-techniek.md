# 12 — Failures, exceptions & technische edge cases

Deze sectie dekt de technische faalmodi van de Flowva×BuckyDrop-keten: elke API-call die faalt, gemiste/dubbele/out-of-order webhooks, signature-fouten, een lege wallet midden in een flow, race conditions, partial/inconsistente states, reconciliatie-jobs, BuckyDrop-downtime/rate-limit, en de sandbox→productie-cutover. Per scenario: **Trigger → Flow → Wie betaalt wat → Wat als het faalt (volgende edge-laag) → System action**, met een betrouwbaarheids-tag.

Bron-grounding (gelezen): `supabase/functions/{place-bucky-order,buckydrop-webhook,buckydrop,check-cart-prices,haul-shipping,stripe-webhook}/index.ts`; SQL `{pay-cart,pay-shipping,pay-shipping-exact,auto-refund(refund_order),refund-order(cancel_paid_order),finance-hardening(apply_top_up),buckydrop-webhook,place-bucky-order-trigger,price-guard,flowva-friends-fulfillment}.sql`; API-docs (PNG) order/parcel/notifications.

Legenda tags: **[CONFIRMED]** = direct gezien in code/docs/wet · **[ASSUMED]** = redelijke aanname uit het systeemontwerp · **[TO-VERIFY]** = moet expliciet gecheckt worden (met HOE).

---

## 0. Centrale invarianten (waar elk scenario tegen getoetst wordt)

- **Idempotentie-sleutel inkoop:** `orders.shop_order_no`. `place-bucky-order` returnt vroeg "already placed" zodra die gezet is. **[CONFIRMED]** (`place-bucky-order/index.ts` r.93).
- **Idempotentie-sleutel top-up:** `stripe_events.id` (primary key) + unieke index `transactions_topup_session_uniq`. **[CONFIRMED]** (`finance-hardening.sql`).
- **Forward-only statusmachine:** `RANK{requested..delivered}`; `setOrderStatus` weigert niet-vooruit-overgangen en respecteert `cancelled`. **[CONFIRMED]** (`buckydrop-webhook/index.ts` r.47-59).
- **Server-side prijs:** zowel `pay_cart` als `pay_shipping*` leiden bedragen server-side af; client-prijs wordt nooit vertrouwd. **[CONFIRMED]** (`pay-cart.sql`, `haul-shipping/index.ts`).
- **Geldboeking = altijd `balance`-update + `transactions`-regel in één SQL-transactie** met `FOR UPDATE`-rijlock op `profiles`. Reconciliatie-invariant: `sum(profiles.balance) == sum(transactions.amount)`. **[CONFIRMED]** (`admin_finance_overview`).
- **Refund-bestemming:** `refund_order`/`cancel_paid_order` boeken naar **in-app saldo**, NIET naar Stripe. Dit is een bekende juridische afwijking (EU: terug naar oorspronkelijke betaalmethode). **[CONFIRMED]** (`auto-refund.sql`; MEMORY `flowva-audit`/`eu-withdrawal-returns`).

---

## 1. `place-bucky-order` faalt — netwerk/timeout (geen response)

- **Trigger:** Klant betaalt → order op `quote_accepted` → pg_net-trigger POST't naar `place-bucky-order` → de upstream `buckyPost(...create)` geeft een netwerkfout/timeout, geen JSON.
- **Flow:** `buckyPost` `catch` levert `{success:false, info:text|HTTP n}`. `res.success !== true` → omdat er **geen numerieke `res.code`** is, gaat de code naar de "tijdelijke fout"-tak: `fail(order.id, "Temporary error placing order: ...")` zet `orders.bd_error`, status blijft `quote_accepted`. **[CONFIRMED]** (`place-bucky-order/index.ts` r.150-165).
- **Wie betaalt wat:** Klant is al afgeschreven in saldo (`pay_cart`). BuckyDrop-wallet is **niet** geraakt (CNY blijft staan). Niemand betaalt dubbel; geld staat "vast" tot herplaatsing of refund.
- **Wat als het faalt (volgende laag):**
  - Er is **geen automatische retry-job** die `bd_error`-orders herpakt. Zonder cron blijft de order eeuwig op `quote_accepted` hangen. **[CONFIRMED]** (geen retry-cron in repo gevonden).
  - Worst case: BuckyDrop heeft de order tóch aangemaakt maar het antwoord ging verloren → bij handmatige re-run dreigt **dubbele inkoop** (zie §2).
- **System action / fix:**
  - Bouw een **reconciliatie-cron** (`pg_cron` of Supabase Scheduled Function) die orders `status='quote_accepted' AND bd_error IS NOT NULL AND shop_order_no IS NULL` herpakt; vóór re-POST eerst `order/detail` met `partnerOrderNo` queryen om dubbele inkoop te detecteren. **[TO-VERIFY: bouwen]** (`order/detail` accepteert `partnerOrderNo`, bevestigd in docs).
  - Maak `partnerOrderNo` idempotent aan BuckyDrop-kant: hergebruik dezelfde `order.id` bij elke retry zodat BuckyDrop zelf dedupliceert. **[TO-VERIFY]** — staat NIET gedocumenteerd dat BuckyDrop op `partnerOrderNo` dedupliceert; testen in sandbox door 2× dezelfde `partnerOrderNo` te posten.

---

## 2. `place-bucky-order` dubbel uitgevoerd — dubbele inkoop / race

- **Trigger:** Twee oorzaken: (a) pg_net retry of dubbele trigger-firing; (b) zowel de INSERT- als de UPDATE-trigger vuren (`place_bucky_order_ins_trg` + `place_bucky_order_trg`); (c) handmatige re-run na §1.
- **Flow:** Eerste call zet `shop_order_no`; tweede call leest order opnieuw, ziet `shop_order_no` gezet → "already placed", stopt. **[CONFIRMED]** (r.93). MAAR: als beide calls **gelijktijdig** binnen het venster vóór de UPDATE draaien (read-modify-write race), zien beide `shop_order_no IS NULL` → **twee BuckyDrop-orders**.
- **Wie betaalt wat:** Bij dubbele inkoop koopt BuckyDrop 2× in → 2× CNY uit de wallet. Klant betaalde 1×. Verlies = 1 productprijs + fulfilment.
- **Wat als het faalt (volgende laag):** De `to_jsonb(new)` payload in de trigger bevat een snapshot; bij twee triggers met dezelfde snapshot is er geen DB-niveau lock die de tweede tegenhoudt.
- **System action / fix:**
  - **DB-lock vóór de API-call:** in `place-bucky-order` eerst een conditionele claim doen — `UPDATE orders SET bd_placing_at=now() WHERE id=$1 AND shop_order_no IS NULL AND bd_placing_at IS NULL RETURNING id`; alleen doorgaan als 1 rij terugkomt. Dit serialiseert concurrente calls. **[TO-VERIFY: bouwen]** (kolom `bd_placing_at` bestaat nog niet).
  - Verwijder de dubbele trigger of maak ze wederzijds uitsluitend (de INSERT-flow is de live instant-checkout; de UPDATE-flow is legacy offerte). **[CONFIRMED]** beide triggers bestaan (`place-bucky-order-trigger.sql`).
  - Vertrouw `partnerOrderNo`-dedup aan BuckyDrop-kant pas ná verificatie (§1). **[TO-VERIFY]**

---

## 3. `place-bucky-order` — gestructureerde afwijzing (uitverkocht, ongeldige SKU)

- **Trigger:** BuckyDrop bereikbaar, geeft `{success:false, code:<number>, info:"..."}` (bv. SKU uitverkocht of geweigerd).
- **Flow:** `typeof res.code === "number"` → `refund_order(order.id, "BuckyDrop rejected: ...")` → saldo-refund + order `cancelled`; bij volledig geannuleerde groep ook fee-refund. **[CONFIRMED]** (r.154-162 + `auto-refund.sql`).
- **Wie betaalt wat:** Klant krijgt productprijs (en evt. service fee) terug op **in-app saldo**. Wallet ongemoeid. Flowva draagt enkel de evt. per-call API-fee.
- **Wat als het faalt (volgende laag):**
  - **Refund naar saldo i.p.v. Stripe** = juridisch onjuist bij EU-herroeping; klant kan saldo niet zonder meer uitbetalen. **[CONFIRMED]** (MEMORY). Mitigatie: `/withdraw`-flow + handmatige Stripe-refund.
  - **Pre-check vs. echte voorraad:** `check-cart-prices` is fail-open (BuckyDrop onbereikbaar → laat door). Dus uitverkocht-na-checkout valt hier terug op deze post-pay refund — dat is by design het vangnet. **[CONFIRMED]** (`check-cart-prices/index.ts` r.116-119).
  - `refund_order` zelf faalt (DB-fout) → order blijft `quote_accepted` zonder refund; geen retry. **[ASSUMED]** — geen guard gezien.
- **System action:** `refund_order` RPC (service-role). Log via `bucky_notifications` niet van toepassing (dit is de plaatsings-call, geen webhook).

---

## 4. Webhook GEMIST (BuckyDrop POST komt nooit aan)

- **Trigger:** Statusupdate bij BuckyDrop (ordered/shipped/stock-in/delivered) maar de POST naar `buckydrop-webhook` gaat verloren (downtime van onze function, DNS, deploy-moment).
- **Flow (happy path):** Webhook → `verifySign` → `findPO`/`PO_STATUS_MAP` of `PKG_STATUS_MAP` → `setOrderStatus` (forward-only) → push-melding via order-update. **[CONFIRMED]**.
- **Wie betaalt wat:** Geen directe geldimpact; de order "loopt achter" qua status. WEL indirect: de klant ziet `qc_pending` nooit verschijnen → kan geen verzending betalen (§9), dus tweede geldmoment blokkeert.
- **Wat als het faalt (volgende laag):**
  - Geen retry van BuckyDrop-kant gedocumenteerd → eenmalig gemist = permanent gemist zonder polling. **[TO-VERIFY]** of BuckyDrop notificaties herhaalt bij niet-2xx (testen: laat webhook 500 geven en kijk of dezelfde melding terugkomt).
  - Statussprongen: forward-only `setOrderStatus` accepteert een latere status ook als een tussenstap nooit binnenkwam (bv. direct `delivered` zonder `qc_pending`) → dat is correct, maar de QC-poort voor verzending wordt dan overgeslagen. **[CONFIRMED]** (RANK is monotoon).
- **System action / fix:**
  - **Polling-reconciliatie-cron:** voor alle niet-terminale orders met `shop_order_no` periodiek `order/detail` (action `order-detail` in de `buckydrop`-gateway, of direct) opvragen en `setOrderStatus` toepassen. **[CONFIRMED]** endpoint bestaat (`buckydrop/index.ts` ACTIONS `order-detail`; docs `order/detail`). Cron zelf **[TO-VERIFY: bouwen]**.
  - Idem voor parcel via parcel-query. **[TO-VERIFY]** parcel-detail endpoint bestaat in docs (`parcel`-map) maar is nog niet als ACTION gewhitelist.

---

## 5. Webhook DUBBEL (zelfde melding 2×)

- **Trigger:** BuckyDrop hijst dezelfde notificatie nog eens (retry, of dubbele dispatch).
- **Flow:** `setOrderStatus` is **idempotent** voor status: tweede keer `RANK(new) <= RANK(current)` → "no forward", geen tweede update, geen tweede push. **[CONFIRMED]**.
  - Defect/QC-foto's: `qc_images` wordt **overschreven** met dezelfde lijst (idempotent qua eindstand). **[CONFIRMED]** (r.108-114).
  - **`orderStatus===8` (cancelled) → `refund_order` wordt elke keer aangeroepen**, maar `refund_order` is intern idempotent: `if status='cancelled' → already=true`, geen tweede saldo-boeking. **[CONFIRMED]** (`auto-refund.sql` r.28).
- **Wie betaalt wat:** Geen dubbele refund, geen dubbele boeking. Veilig.
- **Wat als het faalt (volgende laag):**
  - Elke melding (ook dubbel/ongeldig) doet een `bucky_notifications`-insert → tabel groeit; puur logging, geen geldrisico. **[CONFIRMED]**.
  - Theoretische race: twee identieke cancel-webhooks **gelijktijdig** → beide lezen status nog niet-cancelled vóór de eerste commit. `refund_order` doet `SELECT ... FOR UPDATE` op de orderrij, wat de tweede serialiseert → tweede ziet `cancelled`. **[CONFIRMED]** (`for update` r.26).
- **System action:** `setOrderStatus` (no-op) / `refund_order` (already-guard). Geen extra werk nodig; dit pad is robuust.

---

## 6. Webhook OUT-OF-ORDER (latere status komt vóór eerdere)

- **Trigger:** `delivered` (RANK 6) arriveert vóór `shipped_international` (RANK 5), of parcel-status vóór PO-status.
- **Flow:** Forward-only: de hogere status wordt gezet; de daarna binnenkomende lagere status wordt geweigerd ("no forward"). Eindstand klopt. **[CONFIRMED]**.
- **Wie betaalt wat:** Geen geldimpact direct. RISICO: als `delivered` binnenkomt vóórdat de klant verzending betaalde (tweede geldmoment), is het pakket "bezorgd" terwijl Flowva de verzendkost nog niet inde. **[ASSUMED]** — afhankelijk van of BuckyDrop kan leveren vóór onze haul-betaling; in het model betaalt de klant verzending vóór internationale verzending, dus dit zou niet mogen. **[TO-VERIFY]** of BuckyDrop ooit `11/12` stuurt zonder dat wij `pay_shipping*` draaiden.
- **Wat als het faalt (volgende laag):**
  - `so`-niveau vs `po`-niveau status-verwarring: `findPO` matcht het EERSTE object met `orderCode`+`orderStatus`. De Notify-Po-Status-body bevat zowel `soOrderInfo.orderStatus` (0-3: NOPAYMENTED/PAYMENTED/CANCEL/COMPLETE) als `poOrderInfo.orderStatus` (1-12). Als de body-volgorde `soOrderInfo` eerst zet en die `orderCode` heeft, kan `findPO` de **verkeerde** status (0-3-schaal) oppikken en door `PO_STATUS_MAP` (1-12) jagen → meestal `undefined` → "no map" (onschadelijk), maar `8` op SO-schaal ≠ `8` op PO-schaal. **[CONFIRMED uit docs]** dat beide schalen bestaan; **[TO-VERIFY]** welk object `orderCode` draagt en in welke volgorde — testen met een echte Notify-Po-Status-payload uit `bucky_notifications`.
- **System action / fix:** Maak `findPO` strikt: match alleen het object dat óók `partnerOrderNo`/PO-typische velden heeft, of lees expliciet `poOrderInfo.orderStatus`. **[TO-VERIFY: hardenen]**.

---

## 7. Signature-fail op inkomende webhook

- **Trigger:** `notifyHeader.sign` ontbreekt of klopt niet (verkeerde `appSecret`, gewijzigde header-params, of een spoof-poging).
- **Flow:** `verifySign` = false → de body wordt **niet** verwerkt, maar **wel rauw gelogd** in `bucky_notifications` met `sign_ok=false`; response = **HTTP 401** `{success:false,error:"invalid sign"}`. **[CONFIRMED]** (r.86, 128-134).
- **Wie betaalt wat:** Geen boeking, geen statuswijziging. Veilig tegen spoof.
- **Wat als het faalt (volgende laag):**
  - **Echte melding ten onrechte 401** (bv. omdat onze sign-reconstructie afwijkt van BuckyDrop's exacte param-set) → permanente status-drift voor die order tot polling (§4) het oplost. De `verifySign` filtert lege/null params en sorteert alfabetisch + `&appSecret=` — "bewezen tegen hun voorbeeld" maar productie-headers kunnen extra velden bevatten. **[CONFIRMED]** (comment r.17-18); **[TO-VERIFY]** met eerste echte productie-payloads in `bucky_notifications`.
  - `appCode`-mismatch wordt óók als sign-fail behandeld (`!header.appCode || appCode===APP_CODE`). **[CONFIRMED]** (r.86).
- **System action:** rauwe log in `bucky_notifications` (forensics) + 401. **Fix-pad:** wekelijks `bucky_notifications WHERE sign_ok=false` reviewen; bij false-negatives de param-reconstructie bijstellen. **[TO-VERIFY]**.

---

## 8. Wallet (BuckyDrop CNY-saldo) leeg midden in een flow

- **Trigger:** `place-bucky-order` (of een latere supplement/verzend-call aan BuckyDrop-kant) faalt omdat de prepaid CNY-wallet onvoldoende saldo heeft.
- **Flow:** BuckyDrop weigert vermoedelijk met een `code`/`info` → valt in de gestructureerde-afwijzings-tak → **klant krijgt refund** (§3), ook al ligt de oorzaak bij ÓNS (lege wallet), niet bij voorraad. **[ASSUMED]** — exacte foutcode bij wallettekort niet gezien; **[TO-VERIFY]** welke `code`/`info` BuckyDrop teruggeeft bij insufficient wallet (sandbox-test of agent Vera vragen).
- **Wie betaalt wat:** Onterechte annulering = gemiste verkoop. Klant kreeg saldo terug, order weg. Flowva mist marge.
- **Wat als het faalt (volgende laag):**
  - Als wallettekort géén numerieke `code` geeft maar een tekst-error → "temporary error"-tak → order blijft hangen op `quote_accepted` zonder refund → klant wacht, geld vast. **[ASSUMED]**.
  - Bij Flowva Friends valt een hele groep-inkoop om als de wallet halverwege de leden leegloopt → partial group fulfilment (sommige leden gekocht, andere niet). **[ASSUMED]**.
- **System action / fix:**
  - **Wallet-drempelmonitor** los van de Wise-buffer: `wise_buffer_state` waarschuwt onder €200 voor de EUR-buffer, maar er is **geen** CNY-wallet-stand in de DB. Voeg toe + alert. **[CONFIRMED]** Wise-buffer bestaat; CNY-wallet-state **[TO-VERIFY: bouwen]**.
  - Onderscheid "afwijzing door voorraad" vs "afwijzing door onze wallet" op de `code`/`info` zodat wallettekort NIET tot klant-refund leidt maar tot retry-na-bijvullen. **[TO-VERIFY]**.

---

## 9. Tweede geldmoment (verzending) — race & faalpaden

- **Trigger:** Order op `qc_pending` met `weight_grams` gevuld → klant kiest kanaal → `haul-shipping` action `pay` → `pay_shipping_exact`.
- **Flow:** `haul-shipping` her-quote't server-side via `channel-carriage-list`, pakt het gekozen `serviceCode`, berekent `shipping(+VAT)`, roept `pay_shipping_exact` (service-role) → rijlock op `profiles`, saldo-check, afschrijven, `hauls`+`haul_items`+`transactions`, orders → `shipped_international`. **[CONFIRMED]** (`haul-shipping/index.ts`, `pay-shipping-exact.sql`).
- **Wie betaalt wat:** Klant betaalt verzending (first-weight-model) + 21% DDP-BTW (tenzij `taxInclusive`-kanaal). Exact tarief, geen buffer in de "exact"-variant. **[CONFIRMED]**.
- **Wat als het faalt (volgende laag):**
  - **Dubbel betalen verzending:** twee gelijktijdige `pay`-calls. `pay_shipping_exact` checkt `status='qc_pending'` en doet `FOR UPDATE` op `profiles`. De eerste call zet orders → `shipped_international`; de tweede vindt `v_count<>array_length` (statussen niet meer `qc_pending`) → "Items not available". Dus **geen dubbele afschrijving** zolang de statusupdate in dezelfde transactie zit. **[CONFIRMED]** (r.44-46, 72).
  - **Gekozen kanaal verdwenen** tussen quote en pay (her-quote levert het `serviceCode` niet meer) → "Chosen shipping option is no longer available", 400, geen boeking. **[CONFIRMED]** (r.127-128).
  - **Sandbox-kanalen zijn nep** → `isSandbox=true`; app valt terug op schatting. Bij cutover moet de currency van `totalPrice` bevestigd worden (CNY aangenomen, /7.7 ×1.03). **[CONFIRMED]** (r.20-23, comment `TODO cutover`).
  - **Geen gewicht:** `needWeight:true` of `Weight missing` → flow blokkeert tot BuckyDrop gewicht vult na inkoop. **[CONFIRMED]**.
  - **FX-koers verkeerd** (`BUCKY_CNY_PER_EUR` hardcoded default 7.7) → klant betaalt te veel/weinig verzending. **[CONFIRMED]** env-var; **[TO-VERIFY]** of een live-koers nodig is.
- **System action:** `pay_shipping_exact` RPC; `hauls`-record met `service_code`/`shipping_eur`/`vat_eur`. Estimate↔actual reconcile (supplement/refund) gebeurt elders (`channel-carriage-list` estimate vs BuckyDrop actual). **[TO-VERIFY]** of het reconcile-pad geïmplementeerd is.

---

## 10. Supplement-betaling (PO orderStatus 4 = "to be confirmed")

- **Trigger:** BuckyDrop zet PO op orderStatus 4 (supplementary payment nodig: zwaarder pakket, overweight, prijsverschil).
- **Flow:** **NIET afgevangen.** `PO_STATUS_MAP` mapt alleen 5/6/9/11/12. Status 4 → geen mapping → "no map", order blijft staan, geen actie, geen klant-charge. **[CONFIRMED]** (`buckydrop-webhook/index.ts` r.32-38; 4 ontbreekt).
- **Wie betaalt wat:** Op dit moment **niemand** — het supplement wordt niet doorberekend aan de klant en niet uit de wallet betaald via de app. Risico: order blijft bij BuckyDrop hangen op "to be confirmed" tot handmatige actie.
- **Wat als het faalt (volgende laag):** Zonder bevestiging/bijbetaling annuleert BuckyDrop de PO mogelijk na verloop van tijd → later `orderStatus=8` → auto-refund. Tot die tijd: stille stilstand. **[ASSUMED]**.
- **System action / fix:** Map status 4 naar een nieuwe app-status `supplement_pending`; haal het supplementbedrag via `order/detail`; reken het tweede deel af (saldo) of toon het aan de klant; bevestig dan de PO bij BuckyDrop. **[TO-VERIFY: bouwen]** — cancel/confirm-PO-endpoints staan in docs (`API-Cancel Purchase Order`), confirm-supplement-endpoint **[TO-VERIFY]**.

---

## 11. Defect-/QC-melding (Notify Po Pending)

- **Trigger:** BuckyDrop QC vindt een defect → Notify-Po-Pending met `confirmType` + `picList[]` (beide Required → foto komt gegarandeerd mee).
- **Flow:** Webhook → `findPics` vindt `picList` → `orders.qc_images=pics`, en bij `confirmType` → `dispute_status='pending'`, `problem_type=<confirmType>`. **[CONFIRMED]** (r.108-114).
- **Wie betaalt wat:** Nog niemand; dit zet de dispuut-vlag. Refund/herbestelling volgt via support of `cancel_paid_order` (vereist `problem_type` gezet — wat hier gebeurt). **[CONFIRMED]** (`refund-order.sql` r.36-38).
- **Wat als het faalt (volgende laag):**
  - `cancel_paid_order` werkt alleen in `quote_accepted`-fase; bij een defect dat pas op `qc_pending` blijkt, is de status al voorbij `quote_accepted` → die RPC weigert ("alleen vóór gekocht"). Defect-refund post-inkoop moet dus via een ander pad (support/BuckyDrop return). **[CONFIRMED]** (r.32-34) — gat.
  - `findPics` pakt de eerste niet-lege `picList` ongeacht welke order; bij multi-order-body kan de foto aan de verkeerde order hangen. **[ASSUMED]**.
- **System action / fix:** dispuut-flag + `qc_images`. **Fix:** koppel defect-pad aan `refund_order` (post-inkoop refund) of BuckyDrop `apply-return`; verbreed de cancel-fase. **[TO-VERIFY: bouwen]**.

---

## 12. Stripe top-up — dubbel event / signature-fail / mismatch

- **Trigger:** Stripe stuurt `checkout.session.completed` (soms 2×), of de webhook-signature klopt niet.
- **Flow:** `constructEventAsync` verifieert de Stripe-signature; faal → **400** (Stripe retry't). Succes + `payment_status='paid'` → `apply_top_up(event.id, session.id, user, amount)`. Idempotent: `stripe_events` PK claimt het event; tweede keer → `duplicate=true`, geen tweede boeking. Bij fout → **500** (Stripe retry't). **[CONFIRMED]** (`stripe-webhook/index.ts`, `finance-hardening.sql`).
- **Wie betaalt wat:** Klant stort EUR → saldo +bedrag, exact één keer. Dubbele Stripe-dispatch ≠ dubbel saldo. **[CONFIRMED]**.
- **Wat als het faalt (volgende laag):**
  - **Race twee identieke events parallel:** `insert ... on conflict (id) do nothing` + `if not found` → exact één wint; de tweede ziet duplicate. **[CONFIRMED]**.
  - **Profiel ontbreekt** → `raise exception` → event-claim rolt mee terug → Stripe retry't later (tegen die tijd bestaat het profiel hopelijk). **[CONFIRMED]** (r.74-79 finance-hardening).
  - **Amount-metadata ontbreekt/0** → 400 "Missing metadata", geen boeking. **[CONFIRMED]** (stripe r.59-64).
  - **`amount` als integer-cents → /100**; bij verkeerde metadata-eenheid factor-100-fout. **[CONFIRMED]** (`euroAmount = amount/100`) — bewaak dit bij wijziging van `create-checkout`.
- **System action:** `apply_top_up` RPC (service-role only). Reconciliatie via `admin_finance_overview` mismatch-veld.

---

## 13. Race: gelijktijdige `pay_cart` / dubbele checkout-submit

- **Trigger:** Klant dubbelklikt "Pay", of twee tabs.
- **Flow:** `pay_cart` doet `SELECT balance ... FOR UPDATE` → de tweede call wacht op de eerste. Beide kunnen wél slagen als er genoeg saldo is → **twee identieke order-groepen** (dubbele inkoop). Saldo wordt 2× afgeschreven (dus klant betaalt 2×), maar er is **geen dedup op cart-inhoud**. **[CONFIRMED]** (`pay-cart.sql` r.84; geen idempotency-key op de mand).
- **Wie betaalt wat:** Klant betaalt 2× en krijgt 2× het product → ongewenst; vereist handmatige refund van de tweede groep.
- **Wat als het faalt (volgende laag):** Beide groepen triggeren `place-bucky-order` → 2× echte inkoop bij BuckyDrop.
- **System action / fix:** Voeg een **client-side idempotency-key** toe aan `pay_cart` (bv. een `cart_token` dat per checkout uniek is) met unieke index, analoog aan `transactions_topup_session_uniq`. **[TO-VERIFY: bouwen]**. Frontend: knop disabling helpt maar is niet waterdicht.

---

## 14. Flowva Friends — group ready-up / placement races

- **Trigger:** Groep gaat naar `placed` (alle leden ready) → `ff_create_orders_on_placement` maakt orders per lid (afleveradres = host), zet holds om.
- **Flow:** Trigger `when (new.status='placed' and old.status is distinct from 'placed')` → vuurt exact één keer per echte overgang. Per lid: order-lines + `group_hold_release` + `service_fee`-correctie, netto 0 t.o.v. de eerder vastgehouden `held_amount`. Guard: lid zonder hold maar mét items → `raise exception` (voorkomt gratis goederen). **[CONFIRMED]** (`flowva-friends-fulfillment.sql`).
- **Wie betaalt wat:** Elk lid betaalt eigen lines + aandeel service fee; verzending later gewicht-gesplitst (`ff_pay_group_shipping`), één gedeeld first-weight-blok.
- **Wat als het faalt (volgende laag):**
  - **Dubbele placement-trigger:** `old.status is distinct from 'placed'` voorkomt re-firing op latere updates; maar als de groep ooit `placed→ander→placed` zou kunnen, vuurt het opnieuw → dubbele orders. **[ASSUMED]** statusmachine staat dat normaal niet toe; **[TO-VERIFY]** dat er geen pad terug naar non-placed bestaat.
  - **Gewicht-split vóór compleet weging:** `ff_pay_group_shipping` blokkeert tot ÉLK item gewogen is (`v_unweighed>0` → error), zodat `sum(aandelen)=één blok`. **[CONFIRMED]** (r.137-140).
  - **Lid annuleert ná verzending betaald:** `ff_cancel_group_order` weigert als `group_shipping_paid` → naar support (anders verschuift het gewichtsaandeel van de rest). **[CONFIRMED]** (r.177-178).
  - **Race host vs lid bij gelijktijdige cancel/place:** geen expliciete groep-rijlock gezien; gelijktijdige `placed`-update + ledenwijziging kan inconsistente ledenset opleveren. **[ASSUMED]** — `SELECT ... FOR UPDATE` op `flowva_groups` toevoegen. **[TO-VERIFY]**.
- **System action:** trigger `ff_create_orders_on_placement`; RPC's `ff_pay_group_shipping`, `ff_cancel_group_order`.

---

## 15. Partial / inconsistente states (algemeen)

- **Trigger:** Een flow breekt halverwege (function-timeout na DB-write maar vóór API-call, of vice versa).
- **Bekende inconsistente paren:**
  - `shop_order_no` gezet maar status nog `quote_accepted` (update split over twee statements? — nee, het is één `update`, dus atomisch). **[CONFIRMED]** (`place-bucky-order` r.169-172 één update).
  - Saldo afgeschreven (`pay_cart`) maar order-insert faalt → **niet** mogelijk: alles in één SQL-functie/transactie. **[CONFIRMED]**.
  - BuckyDrop-order aangemaakt maar onze `update` faalt → `shop_order_no` niet opgeslagen → retry maakt dubbele order (§2). Dit is het echte partial-risk-venster: **tussen de geslaagde API-call en de DB-write**. **[CONFIRMED logisch gat]**.
- **Wie betaalt wat:** Afhankelijk; ergste = dubbele inkoop (§2).
- **System action / fix:** Schrijf eerst een "placing"-intent vóór de call (§2-fix), en laat de reconciliatie-cron (§4) DB↔BuckyDrop bijtrekken via `order/detail`. **[TO-VERIFY: bouwen]**.

---

## 16. BuckyDrop downtime / rate-limit / per-call API-fee

- **Trigger:** BuckyDrop 5xx, traag, of rate-limit op de Solution API; piepkleine per-call fees lopen op bij polling.
- **Flow:** `buckyPost` vangt non-JSON → `{success:false}`; afhandeling per call-site (place=temporary error; check-cart=fail-open; haul=lege kanalen). **[CONFIRMED]**.
- **Wie betaalt wat:** Per-call API-fee bij elke poll → kosten schalen met reconciliatie-frequentie. **[CONFIRMED uit model]**.
- **Wat als het faalt (volgende laag):**
  - Geen **backoff/retry-budget**: een storm aan checkouts tijdens downtime laat veel orders op `quote_accepted` achter → reconciliatie-cron moet ze later in bulk herpakken (en kan dan zelf rate-limit raken). **[ASSUMED]**.
  - Geen circuit-breaker → elke klant-checkout doet alsnog een live `check-cart-prices`-call die fail-open doorgaat (goed voor UX, maar voorraad-/prijscheck mist). **[CONFIRMED]** fail-open.
- **System action / fix:** Exponential backoff + jitter in de reconciliatie-cron; poll-interval afstemmen op per-call-fee; status-events bij voorkeur via webhooks (gratis) i.p.v. polling. **[TO-VERIFY: bouwen]**.

---

## 17. Sandbox → productie cutover-valkuilen

- **Trigger:** Omzetten `BUCKY_DOMAIN` van `dev.buckydrop.com` naar `bdopenapi.buckydrop.com`.
- **Checklist (allemaal [CONFIRMED] als code-aanwezig, [TO-VERIFY] qua actie):**
  - **`BUCKY_DOMAIN`-secret** omzetten; `IS_SANDBOX = domain.includes("dev.")` schakelt automatisch de nep-kanaal-fallback uit in `haul-shipping`. **[CONFIRMED]** (r.20).
  - **Mock-data:** docs tonen mock-waarden (bv. `orderStatus` mock NOPAYMENTED/PAYMENTED) → sandbox geeft fictieve statussen/kanalen; niet als echt behandelen. **[CONFIRMED uit docs]**.
  - **Currency yuan vs fen (×100):** prijzen kunnen in fen (cents) komen. `liveYuanFor` heeft een `priceCent/100`-fallback; `channel-carriage-list` `totalPrice` wordt als CNY behandeld (`/7.7`). **[CONFIRMED]** comment `TODO cutover: bevestig currency`. **[TO-VERIFY]** met eerste echte productie-respons of het ¥ of fen is — een factor-100-fout hier = 100× verkeerde verzendprijs.
  - **IP-whitelist:** productie-API vereist mogelijk vaste uitgaande IP's; Supabase Edge Functions hebben geen statisch IP by default. **[TO-VERIFY]** bij BuckyDrop of IP-allowlisting nodig is.
  - **`partner_callbackurl`** registreren op de productie-webhook-URL; sandbox-callback wijst nog naar dev. **[TO-VERIFY]**.
  - **Signature met productie-`APP_SECRET`** (andere dan sandbox) → anders 401 op alle webhooks (§7). **[CONFIRMED]** logica; **[TO-VERIFY]** secret-waarde.
  - **`bd_category_code` / product-dims**: nu defaults (`"1"`, 20×20×10) → echte Cat-Level-III + afmetingen bij curatie opslaan, anders verkeerd verzendtarief. **[CONFIRMED]** (`haul-shipping` r.61-62, comments).
- **System action:** secrets-rotatie + smoke-test: 1 echte order door de hele keten (`order/detail` poll, webhook-roundtrip, verzendquote) vóór launch.

---

## 18. Security-randen (kort, technisch)

- **`place-bucky-order`** is beschermd met `x-webhook-secret` (`WEBHOOK_SECRET`), niet publiek aanroepbaar. **[CONFIRMED]** (r.86-88). Trigger-SQL bevat letterlijk `PLAK_HIER_JE_WEBHOOK_SECRET` als placeholder → **moet vervangen zijn** anders faalt elke auto-inkoop met 401. **[CONFIRMED]** placeholder aanwezig (`place-bucky-order-trigger.sql` r.18). **[TO-VERIFY]** dat de live trigger de echte secret bevat.
- **`buckydrop`-gateway** eist JWT + `role='admin'`; klant kan geen rauwe ¥/skuCode opvragen. **[CONFIRMED]** (r.70-74).
- **`check-cart-prices`** geeft nooit rauwe ¥/skuCode/spuCode terug, alleen `changed`/`available`. **[CONFIRMED]** (header-comment + return-shape).
- **Refund-RPC's** `refund_order`/`pay_shipping_exact` zijn `revoke`'d van `authenticated`, alleen `service_role`. **[CONFIRMED]**.
- **`pay_cart` price-injection** dichtgezet (server-side prijs). **[CONFIRMED]** — maar MEMORY `flowva-audit` noemt een eerder pay_cart-prijslek als CRITICAL/OPEN; verifiëren dat de live DB de gefixte versie draait. **[TO-VERIFY]**.

---

## 19. Reconciliatie-jobs (samenvattend overzicht)

| Job | Detecteert | Bron-API | Status |
|---|---|---|---|
| Order-status poll | Gemiste/gefaalde PO-webhooks | `order/detail` (`partnerOrderNo`/`shopOrderNo`) | **[TO-VERIFY: bouwen]** (endpoint [CONFIRMED]) |
| Parcel-status poll | Gemiste parcel-webhooks | parcel-detail/query | **[TO-VERIFY: bouwen]** |
| Stuck-placement sweep | `quote_accepted + bd_error` orders | re-POST `shop-order/create` (na dedup-check) | **[TO-VERIFY: bouwen]** |
| Finance-mismatch | `sum(balance) != sum(tx)` | `admin_finance_overview` | **[CONFIRMED]** (handmatig in admin) |
| Wise-buffer alert | EUR-buffer < €200 | `wise_buffer_state` | **[CONFIRMED]** |
| CNY-wallet alert | Wallet bijna leeg | (geen tabel) | **[TO-VERIFY: bouwen]** |
| Supplement sweep | PO orderStatus 4 onbehandeld | `order/detail` | **[TO-VERIFY: bouwen]** |

---

## 20. Prioriteit (technische hardening, hoog→laag)

1. **Dubbele-inkoop guard** (§2/§13/§15): placing-intent + cart idempotency-key. Direct geldverlies.
2. **Reconciliatie-cron** (§4/§19): polling-vangnet voor gemiste webhooks. Voorkomt vastgelopen orders.
3. **Supplement (status 4) afhandelen** (§10): nu een stil gat.
4. **Wallet-tekort vs voorraad-afwijzing scheiden** (§8): voorkomt onterechte annuleringen.
5. **`findPO`/SO-vs-PO-status hardenen** (§6): voorkomt verkeerde statusmapping.
6. **Cutover-currency (¥ vs fen) bevestigen** (§17): factor-100-risico op verzendprijs.
7. **Refund-bestemming naar Stripe** (§0/§3): juridische compliance (EU).
8. **Live trigger-secret verifiëren** (§18): anders werkt auto-inkoop helemaal niet.
