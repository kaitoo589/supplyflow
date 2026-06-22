# 03 — Treasury & Wallet-funding (de geldstroom)

Deze sectie beschrijft UITPUTTEND hoe geld door Flowva stroomt, van het moment dat een klant met iDEAL betaalt tot het moment dat BuckyDrop een CNY-bedrag van onze prepaid-wallet afschrijft — inclusief elke faal- en edge-case. De rode draad: **klant betaalt EUR (prepaid in-app saldo) → wij boeken EUR uit Stripe → wij zetten EUR om naar CNY via Wise/Revolut/Alipay → wij vullen de BuckyDrop-wallet (CNY) → BuckyDrop schrijft per order/parcel/supplement CNY af.**

Drie valuta-/saldolagen die je NOOIT door elkaar mag halen:
1. **Klant-saldo (EUR)** — `profiles.balance`, opgehoogd door `apply_top_up`, afgeschreven door `pay_cart` / `pay_quote` / `pay_shipping`. [CONFIRMED — finance-hardening.sql, pay-cart.sql, pay-shipping.sql]
2. **Wise/Revolut-buffer (EUR)** — ons werkkapitaal in transit. Stand staat in `wise_buffer_state.balance_eur`, **handmatig** door admin gezet via `admin_set_wise_buffer`. [CONFIRMED — finance-hardening.sql]
3. **BuckyDrop-wallet (CNY)** — prepaid, wordt door BuckyDrop afgeschreven. **Stand is NIET via de gewired API leesbaar** (de gateway kent alleen `product-detail` en `order-detail`). [CONFIRMED — supabase/functions/buckydrop/index.ts]

Belangrijk grond-feit dat de hele sectie kleurt: in de code bestaat **nog GEEN** automatische EUR→CNY-funding. Er is wel een ledger-tabel (`wise_transfers`) en een handmatige bufferstand, maar geen edge function die Wise/Revolut/Alipay aanroept. Alle "fund de wallet"-stappen hieronder zijn dus vandaag **handmatige treasury-handelingen** van de oprichter. [CONFIRMED — geen wise/revolut/alipay-call in supabase/functions/*; alleen wise-transfers.sql ledger + admin_set_wise_buffer]

---

## Scenario 1 — Klant laadt saldo op (Stripe iDEAL → EUR-saldo)
**Tag: [CONFIRMED]**

**Trigger:** Klant kiest "Balance opladen" in de app; `create-checkout` maakt een Stripe Checkout-sessie (`payment_method_types: ["ideal"]`, currency `eur`, `mode: payment`, minimum €5 / 500 cent). [CONFIRMED — create-checkout/index.ts]

**Flow (stap voor stap):**
1. App roept `create-checkout` aan met `{ amount (cent), userId, email }`. Min. 500 cent, anders 400 "Minimum storting is €5". [CONFIRMED]
2. Stripe geeft een hosted `session.url` terug; klant rondt iDEAL af bij zijn bank.
3. Stripe stuurt `checkout.session.completed` naar `stripe-webhook`. Handtekening wordt geverifieerd met `STRIPE_WEBHOOK_SECRET`; bij mismatch 400. [CONFIRMED — stripe-webhook/index.ts]
4. Alleen als `session.payment_status === 'paid'` gaan we door. `euroAmount = amount/100`.
5. `apply_top_up(event_id, session_id, user_id, amount)` claimt het event in `stripe_events` (idempotent), verhoogt `profiles.balance` atomair en logt een `transactions`-rij type `top_up` met `stripe_session_id`. [CONFIRMED — finance-hardening.sql]

**Wie betaalt wat:** Klant betaalt het EUR-bedrag + (impliciet) de iDEAL-transactiekosten zitten aan ONZE kant bij Stripe (Stripe rekent een vaste iDEAL-fee per transactie aan ons, geen %). Het opgeladen saldo = bruto EUR dat de klant later aan producten/fee/verzending uitgeeft. **Stripe houdt zijn fee in vóór payout** — het saldo dat de klant ziet is het volle bedrag, maar wat WIJ in transit krijgen is bedrag − Stripe-fee. [ASSUMED — bedrag van iDEAL-fee staat niet in code; TO-VERIFY in Stripe-dashboard]

**Wat als het faalt (volgende edge-laag):**
- *Stripe stuurt event twee keer* (doen ze standaard bij twijfel): tweede keer is `duplicate=true` no-op dankzij `stripe_events` PK + unieke index op `(stripe_session_id) where type='top_up'`. Saldo wordt NIET dubbel opgehoogd. [CONFIRMED]
- *`apply_top_up` faalt of profiel niet gevonden*: webhook geeft 500 → Stripe herprobeert later → storting verdwijnt niet stil. De event-claim rolt mee terug (geen return, maar `raise exception`), zodat de retry alsnog kan boeken. [CONFIRMED]
- *Handtekening-mismatch / payload-knoeien*: 400, geen boeking. [CONFIRMED]
- *Klant betaalt maar webhook komt nooit aan* (Stripe down / endpoint down): saldo blijft achter terwijl geld wel binnen is. Geen reconciliatie-cron in code. **Mitigatie nodig:** periodieke Stripe `checkout.sessions.list` vs. `transactions` vergelijken. [TO-VERIFY — bestaat niet in code]
- *Chargeback/iDEAL-terugboeking ná opladen*: klant kan saldo al hebben uitgegeven aan een CNY-order → wij dragen het verlies. Geen automatische saldo-correctie in code. **Mitigatie:** chargeback-webhook (`charge.dispute.created`) → saldo terugdraaien + order bevriezen. [TO-VERIFY — niet geïmplementeerd]

**System action:** `create-checkout` (Stripe sessie) → Stripe webhook `checkout.session.completed` → RPC `apply_top_up` → `profiles.balance += amount`, `transactions(type='top_up')`. App-status: saldo zichtbaar; geen orderstatus.

---

## Scenario 2 — Klant rekent af → EUR-saldo wordt verlaagd (intern, vóór enige CNY-uitgave)
**Tag: [CONFIRMED]**

**Trigger:** Klant rekent winkelmand af (`pay_cart`), losse offerte (`pay_quote`), groepsofferte (`pay_quote_group`) of verzending (`pay_shipping`).

**Flow:**
1. Server berekent het bedrag **server-side** (nooit client-prijs): productprijs uit `public.products` (match op `source_url`), fee `service_fee_for = greatest(8%, €5)`, verzending via first-weight-model + 1.3× buffer + 21% DDP-BTW. [CONFIRMED — pay-cart.sql, service-fee.sql, pay-shipping.sql]
2. `profiles`-rij wordt gelockt (`for update`); saldo-check; `balance -= charge`; `transactions`-regels (`order`, `service_fee`, `shipping`). [CONFIRMED]
3. Order gaat op `quote_accepted` → triggert `place-bucky-order` (Scenario 3). [CONFIRMED]

**Wie betaalt wat:** Klant betaalt uit zijn EUR-saldo: producten + 1× service fee per mand/groep + (later) verzending + invoer-BTW. Dit is nog **puur intern in EUR** — er gaat nog GEEN CNY naar BuckyDrop. Dit is het moment waarop wij de EUR ontvangen die we straks naar CNY moeten omzetten om de wallet te dekken.

**Wat als het faalt:**
- *Onvoldoende saldo*: `Insufficient balance` + `needed`-bedrag; geen boeking, geen order. [CONFIRMED]
- *Onbekend product / ontbrekende source_url* (prijslek-bescherming): `pay_cart` weigert ("no longer available"). Dit dekt het bekende CRITICAL-prijslek deels af door prijs server-side te halen. [CONFIRMED — pay-cart.sql regels 61-78]
- *Race: twee gelijktijdige afrekeningen*: `for update`-rijlock voorkomt dubbele afschrijving. [CONFIRMED]
- *FX-risico ontstaat hier latent*: het EUR-bedrag is nu vast, maar de CNY-kost (Scenario 3/5) is nog niet bekend → zie Scenario 8 (FX-mismatch). [ASSUMED]

**System action:** RPC `pay_cart` / `pay_quote` / `pay_quote_group` / `pay_shipping` → `profiles.balance` omlaag + `transactions`. Order-status → `quote_accepted`.

---

## Scenario 3 — BuckyDrop-order plaatsen → CNY wordt van onze wallet getrokken
**Tag: [CONFIRMED voor de call; ASSUMED/TO-VERIFY voor de wallet-debet]**

**Trigger:** Order op `quote_accepted` → pg_net-trigger roept `place-bucky-order` aan (met `x-webhook-secret`). [CONFIRMED — place-bucky-order/index.ts]

**Flow:**
1. Function bouwt `orderBody` (adres uit `auth.users` metadata; bij Flowva Friends naar `host_user_id`) en POST naar `/api/rest/v2/adapt/adaptation/order/shop-order/create`, MD5-gesigned. [CONFIRMED]
2. Bij succes (`res.data.shopOrderNo`): order → `purchased`, `shop_order_no` opgeslagen. [CONFIRMED]
3. BuckyDrop trekt de **productkost in CNY van onze prepaid-wallet** (procurement). Dit gebeurt aan BuckyDrop-zijde; de exacte afschrijving zien we pas via `order-detail` (`payAmount` = Actual total amount RMB, `itemTotalAmount`, `freightAmount`, `productSupplementAmount`). [CONFIRMED — order-detail doc velden; ASSUMED dat create direct de wallet debiteert i.p.v. pas bij confirm]

**Wie betaalt wat:** Onze **BuckyDrop-wallet (CNY)** betaalt de fabrieksprijs + BuckyDrop-procurement-handling. Dit is gedekt door de EUR die de klant in Scenario 2 al betaalde — MITS de wallet vooraf gevuld is (prepaid model). Wij dragen het verschil tussen ingecalculeerde CNY (bij quote/checkout) en werkelijke CNY (`payAmount`).

**Wat als het faalt:**
- *Wallet LEEG / onvoldoende CNY-saldo midden in de flow*: BuckyDrop kan de order niet inkopen. **Kritieke edge.** De API-respons valt dan in één van twee takken:
  - **Met numerieke `code`** (gestructureerde afwijzing, bijv. "insufficient balance"): huidige code behandelt élke numerieke code als "definitief afgewezen" → roept `refund_order` aan en annuleert de order. **GEVAARLIJK bij wallet-leeg**: een tijdelijk fundingsprobleem leidt tot een geannuleerde klantorder i.p.v. retry. **Mitigatie nodig:** specifieke balance-/insufficient-funds-codes apart afvangen → NIET refunden maar flaggen voor retry na top-up. [TO-VERIFY — welke `code`/`errKey` BuckyDrop bij wallet-leeg geeft; place-bucky-order regels 151-166]
  - **Zonder `code`** (netwerk/timeout): `bd_error` gezet, order blijft staan voor handmatige retry, geen refund. [CONFIRMED]
- *Wallet net genoeg maar koers verschoven*: order kan deels lukken en supplement vragen → Scenario 5.
- *Refund-lek*: `refund_order` boekt terug naar **in-app saldo**, niet naar Stripe — wettelijk moet refund naar originele betaalmethode. Bij wallet-leeg-annulering krijgt klant dus saldo, geen geld terug. [CONFIRMED als gedrag — auto-refund.sql; bekend lek per memory]

**System action:** Edge `place-bucky-order` → BuckyDrop `shop-order/create`. Bij wallet-/code-fout nu: RPC `refund_order` (saldo + cancel). App-status: `purchased` óf `cancelled`/`bd_error`.

---

## Scenario 4 — Wallet vooraf vullen (EUR-buffer → CNY-wallet) — happy path treasury
**Tag: [ASSUMED — proces; CONFIRMED — ledger-tabellen]**

**Trigger:** Bufferstand/wallet zakt onder veilige drempel (admin-app waarschuwt onder de €200 op `wise_buffer_state`). [CONFIRMED — finance-hardening.sql comment; drempel €200]

**Flow (handmatig, vandaag):**
1. **Stripe → bank**: Stripe betaalt EUR uit naar onze gekoppelde zakelijke bankrekening (payout-schema, standaard rolling/daily of weekly afhankelijk van Stripe-instelling). [TO-VERIFY — payout-frequentie staat niet in code; check Stripe-dashboard]
2. **Bank/EUR → Wise of Revolut Business** (EUR-buffer). Admin zet de nieuwe bufferstand met `admin_set_wise_buffer`. [CONFIRMED — admin_set_wise_buffer]
3. **EUR → CNY omzetten** via:
   - **CNY-bankoverschrijving (~1% all-in)** — voorkeursroute, goedkoopst. [ASSUMED — % is richtbedrag; TO-VERIFY exacte Wise/Revolut FX-marge + of agent Vera CNY-bankstorting in de wallet accepteert]
   - **Alipay (3% kaartfee)** — duurder, alleen als bankoverschrijving niet kan. [ASSUMED — 3% is richtbedrag]
4. **CNY → BuckyDrop-wallet top-up** (prepaid). Eén rij in `wise_transfers` (`amount_eur`, `amount_cny`, `wise_id`, status `pending→sent`). [CONFIRMED — wise-transfers.sql]
5. Admin werkt na bevestiging de wallet-/bufferstand bij.

**Wie betaalt wat:** WIJ (treasury) dragen de **FX-marge + transferfee** (≈1% bank / 3% Alipay) en de Stripe payout/fee. Dit is onze marge-erosie — moet binnen de 8%/min-€5 service fee + verzendbuffer passen. Bij goedkope losse items eet dit de marge op (vandaar: mik op €20-40/bundel). [ASSUMED — economie-aanname uit memory]

**Wat als het faalt:**
- *Stripe payout vertraagt* (eerste payouts 7-14 dagen na live, of bij risk-review): EUR-buffer raakt leeg terwijl orders binnenkomen → wallet kan niet op tijd gevuld → Scenario 3 faalt. **Mitigatie:** werkkapitaal-buffer aanhouden (eigen geld in Wise) zodat je niet afhankelijk bent van same-day payout. [ASSUMED/TO-VERIFY — Stripe payout-timing per account]
- *Weekend/feestdag-FX*: CNY-bankoverschrijving en Alipay verwerken niet in het weekend → wallet-funding kan 1-3 dagen stilliggen. Plan top-ups vóór het weekend. [ASSUMED]
- *Maandelijkse transfer-limieten* (Wise/Revolut Business hebben verificatie-/volumelimieten): grote top-up kan geweigerd/vertraagd worden. **Mitigatie:** limieten vooraf verhogen; spreiden. [TO-VERIFY — actuele limieten per account]
- *Buffer-stand handmatig verkeerd ingevoerd*: `admin_set_wise_buffer` doet geen reconciliatie met echte Wise-saldo → stand kan afwijken van werkelijkheid. **Mitigatie:** Wise API-koppeling om stand automatisch te syncen. [CONFIRMED dat het handmatig is; TO-VERIFY automatisering]

**System action:** Handmatige transfers; ledger via INSERT in `wise_transfers`; bufferstand via RPC `admin_set_wise_buffer`; monitoring via RPC `admin_finance_overview` (`buffer_eur`). Geen API-call naar Wise/BuckyDrop-wallet in code. [CONFIRMED]

---

## Scenario 5 — Supplement / bijbetaling (PO orderStatus 4) → extra CNY uit wallet
**Tag: [CONFIRMED — status & velden; ASSUMED — wallet-debet]**

**Trigger:** BuckyDrop zet PO op `orderStatus = 4` ("to be confirmed including supplementary payment"): seller-prijs hoger dan verwacht, zwaarder pakket (overweight `freightAmount`), of value-added service. [CONFIRMED — order-detail doc: orderStatus 4; velden `productSupplementAmount`, `freightAmount`, `paymentAmount`]

**Flow:**
1. Webhook "Notify Po Status" of `order-detail` toont `productSupplementAmount` / hoger `freightAmount`. [CONFIRMED — notifications + order-detail doc]
2. Supplement moet uit de **CNY-wallet** worden bevestigd/betaald om de order door te zetten.
3. App moet beslissen: het verschil bij de klant (EUR) naheffen (verzend-reconcile) of zelf dragen.

**Wie betaalt wat:** De wallet (CNY) betaalt het supplement direct; **wie het uiteindelijk draagt** hangt af van het type:
- *Overweight/verzend-supplement*: ingecalculeerd via 1.3× buffer in `pay_shipping`; verschil reconcilen (klant bijbetalen of refund). [CONFIRMED — pay-shipping.sql buffer]
- *Prijsstijging seller*: price-guard zet item "on hold" bij checkout-prijscheck; admin reactivate. Anders draagt Flowva het verschil. [CONFIRMED — price-guard genoemd; check-cart-prices function bestaat]

**Wat als het faalt:**
- *Wallet onvoldoende voor supplement*: PO blijft op status 4 hangen, fulfilment stokt → eerst wallet bijvullen (Scenario 4). [ASSUMED]
- *Supplement nooit bevestigd*: order kan door BuckyDrop geannuleerd worden (orderStatus 8). [ASSUMED — status 8 = cancelled]
- *Buffer (1.3×) te laag bij extreem zwaar pakket*: Flowva draagt het tekort. [CONFIRMED — buffer is vast 1.3×]
- *Dubbel supplement* (zowel prijs als gewicht): stapelt; geen idempotentie-check op supplement-bedragen in code. [TO-VERIFY]

**System action:** Webhook → app leest `productSupplementAmount`/`freightAmount` via `order-detail`. Bijbetalen klant: nieuwe `pay_shipping`-achtige RPC of reconcile. **Bevestigen/betalen supplement bij BuckyDrop zelf zit NIET in de gewired gateway** (alleen product-detail/order-detail) → vandaag handmatig in BuckyDrop-dashboard. [CONFIRMED — buckydrop/index.ts ACTIONS]

---

## Scenario 6 — Wallet-top-up faalt of wordt geweigerd
**Tag: [TO-VERIFY — geen funding-API in code]**

**Trigger:** EUR→CNY-transfer of BuckyDrop-wallet-top-up mislukt (bankweigering, AML-review, fout adres/naam, Alipay-limiet, verkeerde wallet-referentie).

**Flow / Wat als het faalt:**
- *Bank/Wise weigert CNY-transfer* (compliance, naam-mismatch begunstigde): geld blijft in EUR-buffer; wallet leeg → Scenario 3 faalt. Status in `wise_transfers` = `failed`. [CONFIRMED — status enum bevat 'failed']
- *Geld vertrokken uit Wise maar niet aangekomen in wallet*: in-transit-gat; `wise_transfers` op `sent` maar wallet niet opgehoogd → reconcile met BuckyDrop-dashboard. [ASSUMED]
- *Alipay 3%-kaart geweigerd / limiet*: terugvallen op bankoverschrijving (~1%). [ASSUMED]
- *Verkeerd CNY-bedrag overgemaakt* (FX verkeerd berekend): wallet onder- of overgefinancierd; corrigeren met extra transfer. [ASSUMED]

**Wie betaalt wat:** Bij mislukte transfer kosten/koersverlies voor onze rekening; klantgeld blijft veilig in EUR-buffer tot transfer slaagt.

**System action:** `wise_transfers.status='failed'`; admin retry. Geen automatische retry/alert in code. **Mitigatie:** alert op `failed`-rijen in admin-Treasury-tab + Wise API-statuspolling. [TO-VERIFY]

---

## Scenario 7 — Werkkapitaal-/buffer-tekort (structureel te lage liquiditeit)
**Tag: [ASSUMED]**

**Trigger:** Ordervolume groeit sneller dan de payout→buffer→wallet-cyclus; buffer zakt onder €200-drempel.

**Flow / Wat als het faalt:**
1. Admin-app waarschuwt onder €200 (`wise_buffer_state`). [CONFIRMED — drempel]
2. Zonder bijstorting: wallet droogt op → nieuwe orders falen in Scenario 3, supplementen blijven hangen in Scenario 5.
3. Cascade: klanten betalen wel (EUR-saldo daalt) maar producten worden niet ingekocht → verplichting zonder fulfilment → reputatie-/wettelijk risico (levertermijn).

**Wie betaalt wat:** Wij moeten **eigen werkkapitaal** voorschieten omdat het model prepaid is: de wallet moet gevuld zijn vóór de order, terwijl klant-EUR pas met Stripe-payout-vertraging binnenkomt. De service fee (8%/min €5) + verzendbuffer moeten de FX-fee + voorfinancieringskost dekken.

**Mitigaties:**
- Aanhouden van een vaste werkkapitaal-buffer (bv. 2-3× weekomzet) in de CNY-wallet. [ASSUMED]
- Stripe payout op snelste schema; eventueel Stripe Instant Payout (tegen fee). [TO-VERIFY]
- Drempel-alert verhogen naarmate volume stijgt (€200 is laag bij schaal). [ASSUMED]

**System action:** RPC `admin_finance_overview` toont `buffer_eur`; admin handmatig bijvullen (Scenario 4).

---

## Scenario 8 — FX-mismatch: ingecalculeerde vs. werkelijk betaalde valuta
**Tag: [ASSUMED — risico; CONFIRMED — geen FX-lock in code]**

**Trigger:** Tussen het moment van klant-checkout (EUR vastgezet, Scenario 2) en wallet-debet (CNY, Scenario 3/5) beweegt de EUR/CNY-koers, of de seller-CNY-prijs wijkt af van de gequote prijs.

**Flow / Wat als het faalt:**
- *Koers verslechtert na checkout*: de CNY die we nodig hebben kost meer EUR dan we incalculeerden → marge-erosie of verlies (vooral bij goedkope losse items). [ASSUMED]
- *`payAmount` (werkelijke CNY) > gequote CNY*: verschil draagt Flowva tenzij via supplement (Scenario 5) doorberekend. [CONFIRMED — payAmount is "actual total amount" in order-detail]
- *Geen FX-koers vastgelegd per order*: er is geen veld dat de gehanteerde EUR/CNY-koers op quote-moment opslaat → reconciliatie achteraf is onmogelijk per order. **Mitigatie:** koers-snapshot opslaan bij `pay_cart`/quote. [TO-VERIFY — geen koersveld in orders/transactions schema gezien]

**Wie betaalt wat:** Het FX-/koersverschil komt voor rekening van Flowva (de service fee is de buffer). Klant betaalt een vaste EUR-prijs; wij dragen het CNY-koersrisico tussen checkout en inkoop.

**Mitigaties:**
- Snapshot EUR/CNY-koers + verwachte CNY-kost per order opslaan. [TO-VERIFY]
- FX-marge (bv. 2-3%) bovenop de fabrieksprijs incalculeren in de gequote EUR-prijs zonder de "transparante fabrieksprijs"-belofte te breken (marge zit in service fee, niet in productprijs). [ASSUMED]
- Wallet in batches vullen bij gunstige koers (CNY voorraad aanleggen). [ASSUMED]

**System action:** Geen automatische FX-hedge in code. Reconciliatie via `admin_finance_overview` (EUR-zijde) + handmatig BuckyDrop-dashboard (CNY-zijde).

---

## Scenario 9 — Fee-reconciliatie (kloppen alle saldo's met de transacties?)
**Tag: [CONFIRMED]**

**Trigger:** Periodieke financiële controle (admin Financiën-tab).

**Flow:**
1. `admin_finance_overview` somt alle `profiles.balance` en alle `transactions.amount`. Kernregel: **som balances == som transacties**; `mismatch = sum_balances − sum_transactions` moet 0 zijn. [CONFIRMED — finance-hardening.sql]
2. `per_type` toont totaal per `top_up` / `order` / `service_fee` / `shipping` / `refund` / `fee_refund`. [CONFIRMED]
3. `buffer_eur` + `buffer_updated_at` tonen de EUR-buffer naast de in-app verplichtingen. [CONFIRMED]

**Wie betaalt wat:** N.v.t. (controle). Maar reconciliatie bewaakt of ergens saldo is aangepast zonder log (fraude/bug) of andersom.

**Wat als het faalt:**
- *`mismatch ≠ 0`*: ergens `balance` veranderd zonder `transactions`-regel (of omgekeerd) → direct onderzoeken. [CONFIRMED — dat is precies waar de functie voor is]
- *EUR-zijde klopt, maar CNY-wallet niet meegerekend*: `admin_finance_overview` kent de CNY-wallet/BuckyDrop-kosten NIET (alleen EUR-buffer handmatig). Volledige P&L vereist de CNY-uitgaven uit BuckyDrop er handmatig naast. [CONFIRMED — geen CNY in de functie]
- *Refund naar saldo i.p.v. Stripe vertekent reconciliatie wettelijk*: boekhoudkundig klopt het (saldo + log), maar wettelijk hoort het naar Stripe → aparte tracking nodig. [CONFIRMED — bekend lek]

**System action:** RPC `admin_finance_overview`. Alleen admin (role-check). [CONFIRMED]

---

## Scenario 10 — Refund / annulering: geld terug naar klant (EUR-saldo vs. Stripe)
**Tag: [CONFIRMED — gedrag; bekend wettelijk lek]**

**Trigger:** BuckyDrop weigert order (Scenario 3), agent meldt probleem (`cancel_paid_order`), of EU-herroeping (`/withdraw`, `/returns`).

**Flow:**
- *Auto-refund bij BuckyDrop-afwijzing*: `refund_order` boekt productprijs terug naar `profiles.balance` + `transactions(type='refund')`, order → `cancelled`; bij hele groep-cancel ook 1× service fee terug (`fee_refund`, idempotent). [CONFIRMED — auto-refund.sql]
- *Annuleren ná betaling vóór inkoop*: `cancel_paid_order` — alleen eigenaar, alleen status `quote_accepted`, alleen als agent een probleem meldde; refund naar saldo. [CONFIRMED — refund-order.sql]

**Wie betaalt wat:** Refund komt uit ONZE positie. Als de CNY al uit de wallet was (order al ingekocht), dragen wij de niet-recoverbare CNY tenzij BuckyDrop-return die terughaalt. Bij annulering vóór inkoop is er nog geen CNY-uitgave.

**Wat als het faalt:**
- *Wettelijk lek*: refund gaat naar **in-app saldo**, niet naar de originele Stripe-betaalmethode. Voor EU-herroeping is dat niet conform. **Mitigatie nodig:** Stripe `refunds.create` op de oorspronkelijke `payment_intent`. [CONFIRMED — bekend lek; niet in code]
- *VAT-buffer-refund-lek*: bij refund van een betaalde verzending zit de 1.3×-buffer + 21% BTW erin; terugbetalen van het volle `shipping`-bedrag kan te veel/te weinig zijn t.o.v. werkelijke kosten. [ASSUMED — bekend aandachtspunt uit memory]
- *Dubbele refund*: `refund_order` checkt `status='cancelled'` → `already=true`, idempotent. [CONFIRMED]

**System action:** RPC `refund_order` (service role) / `cancel_paid_order` (klant). Toekomstig: Stripe-refund-call vereist. App-status → `cancelled`.

---

## Beknopte beslis-/risicotabel (treasury)

| Risico | Nu in code? | Draagt | Mitigatie | Tag |
|---|---|---|---|---|
| Dubbele Stripe top-up | Afgevangen (idempotent) | — | `stripe_events` + unieke index | [CONFIRMED] |
| Webhook gemist (geld binnen, saldo niet) | Niet afgevangen | Klant/wij | reconcile-cron Stripe↔transactions | [TO-VERIFY] |
| Chargeback ná uitgave | Niet afgevangen | Wij | dispute-webhook → saldo terug + freeze | [TO-VERIFY] |
| Wallet leeg bij order | Refund i.p.v. retry (te grof) | Klant (cancel) | balance-code apart → retry na top-up | [TO-VERIFY] |
| Supplement (status 4) | Niet via gateway | Wallet/wij | dashboard handmatig + reconcile | [CONFIRMED/TO-VERIFY] |
| EUR→CNY funding | Geen API; handmatig | Wij (FX-fee) | Wise/Revolut API + auto-ledger | [CONFIRMED] |
| FX-koers tussen checkout en inkoop | Geen lock/snapshot | Wij | koers-snapshot + FX-marge in fee | [TO-VERIFY] |
| Bufferstand handmatig | Ja, handmatig | — | Wise API sync | [CONFIRMED] |
| Reconciliatie EUR | `admin_finance_overview` | — | mismatch=0 bewaken | [CONFIRMED] |
| Reconciliatie CNY | Niet in functie | — | BuckyDrop-uitgaven naast EUR | [CONFIRMED] |
| Refund naar Stripe (wettelijk) | Naar saldo i.p.v. Stripe | Wij/klant | `refunds.create` op payment_intent | [CONFIRMED lek] |

---

## Openstaande verificatiepunten (HOE te checken)
1. **iDEAL/Stripe-fee + payout-frequentie** — Stripe-dashboard → Settings → Payouts + Pricing. [TO-VERIFY]
2. **Welke BuckyDrop `code`/`errKey` betekent "wallet/insufficient balance"** — testorder met lege wallet of vraag agent Vera; nodig om Scenario 3 retry-veilig te maken. [TO-VERIFY]
3. **Of `shop-order/create` direct de wallet debiteert of pas bij confirm (status 4)** — vraag Vera / observeer `payAmount` vs. wallet-stand. [TO-VERIFY]
4. **CNY-bankoverschrijving naar BuckyDrop-wallet (~1%): mogelijk? begunstigde-gegevens?** — openstaande vraag bij agent Vera. [TO-VERIFY]
5. **Wise/Revolut Business FX-marge + maand-/volumelimieten** — accounts-dashboard. [TO-VERIFY]
6. **Bestaat er een BuckyDrop wallet-balance API-endpoint?** — niet in de gewired gateway; check BuckyDrop API-docs (geen 'wallet'-sectie in de gelezen order/parcel/product/logistics/notifications-screenshots). [TO-VERIFY]
