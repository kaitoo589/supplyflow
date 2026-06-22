# 11 — Geld- en fee-ledger (compleet) + unit-economics

Deze sectie is de waterdichte, end-to-end boekhouding van ELKE euro en ELKE yuan in
Flowva: van de Stripe-storting van de klant tot de uitbetaling aan BuckyDrop, en weer
terug bij refunds/supplementen. Per scenario: **Trigger → Flow → Wie betaalt wat →
Wat als het faalt → System action**, met een tag [CONFIRMED]/[ASSUMED]/[TO-VERIFY].

Leidende principes (vastgesteld, niet betwisten):
- **Transparant prijsmodel**: echte fabrieksprijs (1688/Taobao/Tmall) zichtbaar + service
  fee **8 %, minimaal €5** ([CONFIRMED] in `src/fees.js`, `service_fee_for()` in
  `pay-cart.sql`/`service-fee.sql`).
- **Twee-valuta-architectuur**: klant betaalt en wordt geboekt in **EUR** (in-app saldo);
  BuckyDrop-wallet en alle fulfilment-fees lopen in **CNY (¥)**. De FX-sprong zit tussen
  die twee werelden en is een echte kost die iemand draagt.
- **Prepaid wallet**: BuckyDrop trekt fees van een vooraf gevulde CNY-wallet. Loopt die
  leeg, dan stopt fulfilment — dit is een operationeel faalpunt, geen klant-faalpunt.
- **Surcharging-verbod (EU)**: aan de consument mag GÉÉN losse Stripe-/Alipay-/FX-toeslag
  worden doorberekend ([CONFIRMED] EU-recht, art. 6:230k BW / PSD2-surcharging-verbod voor
  consumenten-kaarten + iDEAL). Alle betaal-/FX-kosten zitten daarom IN de 8 % fee en in de
  marge — ze verschijnen nooit als aparte regel op de klantbon.

> **Centrale waarheid die in geen enkel codebestand is afgedekt**: het in-app saldo is
> EUR; de service fee 8 % is de ENIGE bruto-marge waaruit Flowva ALLE eigen kosten betaalt
> (Stripe, FX, BuckyDrop platform-fee, per-call API-fees, QC, churn/refund-lek). De
> shipping- en BTW-regels zijn doorlopende posten (geen marge). Zie unit-economics onderaan.

---

## Fee-overzicht: wie draagt wat (referentietabel)

| Fee | Hoogte | Valuta | Wie betaalt formeel | Waar in de stack |
|---|---|---|---|---|
| Stripe / iDEAL transactiefee | ~1,4 % + €0,25 (kaart); iDEAL ~€0,29 flat | EUR | **Flowva** (uit marge) | bij top-up, NIET doorbelast |
| FX EUR→CNY (Wise/Revolut) | ~0,4–1 % (Wise) of spread | EUR→CNY | **Flowva** (uit marge) | bij wallet-vulling |
| Alipay-kaartfee (alternatief) | ~3 % | CNY | **Flowva** (uit marge) | alleen als wallet via kaart i.p.v. bankoverschrijving |
| Service fee Flowva | 8 %, min €5 (solo); lager bij groep | EUR | **Klant** | `service_fee_for()` / `ff_member_fee()` |
| Productprijs (factory) | echte ¥-prijs | CNY | **Klant** (via EUR-saldo) | `pay_cart` / `pay_quote` |
| BuckyDrop platform service fee | per-order % / vast (`platformServiceAmount`) | CNY | **Flowva** (uit marge) | order details `platformServiceAmount` |
| BuckyDrop fulfilment/parcel | ¥9,9 (1–5 items) + ¥2/item >5 + ¥1,5/kg >2kg | CNY | **Klant** (via shipping-regel) | parcel/freight |
| Value-added / QC | ~¥6/order (¥2 foto's + ¥4 meting) | CNY | **Flowva** (marketing-kost, uit marge) | `serviceAmount` |
| Per-call API-fee | piepklein, per call | CNY | **Flowva** (uit marge) | elke BuckyDrop-call |
| Internationale verzending | channel-carriage-list, EUR-omrekening | CNY→EUR | **Klant** | `pay_shipping` / `pay_shipping_exact` |
| Invoer-BTW (DDP) | 21 % over (goederen + verzending), of 0 bij tax-inclusive lijn | EUR | **Klant** | `pay_shipping` / `haul-shipping` |
| Supplement (zwaarder/duurder) | verschil | CNY→EUR | **Klant** | PO `orderStatus 4` |

Tags: QC ¥6, fulfilment-staffel, en de "wie draagt wat"-toewijzing van platform-fee/QC aan
Flowva = **[ASSUMED]** beleidskeuze (consistent met het transparantie-model); de bestaan
van de velden `platformServiceAmount`, `serviceAmount`, `freightAmount`, `itemTotalAmount`,
`productSupplementAmount`, `otherSupplementAmount`, `actualAmount` = **[CONFIRMED]** in de
order-details-doc (`api buckydrop/order/order details query`).

---

## Scenario 1 — Klant laadt saldo op (Stripe/iDEAL top-up)

**Trigger.** Klant kiest "Add balance" en betaalt via Stripe Checkout.

**Flow.**
1. App → edge function `create-checkout`: maakt een Stripe Checkout-sessie met
   `payment_method_types: ["ideal"]`, `mode: "payment"`, bedrag in centen
   ([CONFIRMED] `create-checkout/index.ts`). **Minimum €5** (`amount < 500` → 400-fout)
   ([CONFIRMED]).
2. `userId` + `amount` gaan mee in `session.metadata` ([CONFIRMED]).
3. Klant betaalt; Stripe POST't `checkout.session.completed` naar `stripe-webhook`.
4. Webhook verifieert de Stripe-signature (`constructEventAsync`), checkt
   `payment_status === "paid"`, en roept `apply_top_up(event_id, session_id, user_id,
   euroAmount)` aan ([CONFIRMED] `stripe-webhook/index.ts`).
5. `apply_top_up` claimt het event in `stripe_events` (idempotent), boekt
   `profiles.balance += amount` met rij-lock in één statement, logt `transactions` type
   `top_up` met `stripe_session_id` ([CONFIRMED] `finance-hardening.sql`).

**Wie betaalt wat.**
- Klant: betaalt nominaal bedrag X. **Krijgt exact €X aan saldo** (geen toeslag — EU
  surcharging-verbod, [CONFIRMED] beleid).
- Flowva: draagt de Stripe/iDEAL-fee (~€0,29 iDEAL, of ~1,4 %+€0,25 kaart) uit de marge.
  Dit is de eerste hap uit de 8 % fee. **[ASSUMED]** dat iDEAL primair is (code zegt
  alleen `ideal`).

**Wat als het faalt.**
- **Dubbel event** (Stripe stuurt bij twijfel standaard 2×): tweede call → `stripe_events`
  conflict → `duplicate:true`, geen dubbele bijschrijving ([CONFIRMED]).
- **`apply_top_up` faalt / profiel ontbreekt**: functie `raise exception`, webhook geeft
  **500** → Stripe retried later → saldo verdwijnt niet ([CONFIRMED]).
- **Ongeldige signature**: webhook 400, geen bijschrijving ([CONFIRMED]).
- **Klant betaalt maar webhook komt nooit** (Stripe down / endpoint down): saldo niet
  bijgeschreven; klant ziet niets. **Mitigatie [TO-VERIFY]**: er is geen reconciliatie-job
  die openstaande `checkout.session.completed` periodiek opvraagt — bouwen of handmatig via
  Stripe-dashboard. Dit is een echt gat.
- **`< €5` ingestuurd**: 400 vóór Stripe ([CONFIRMED]).
- **Chargeback / iDEAL-terugboeking achteraf**: saldo is al uitgegeven aan een order →
  negatief-marge-risico. **[TO-VERIFY]**: geen `charge.refunded`/`charge.dispute`-handler in
  `stripe-webhook` — alleen `checkout.session.completed`. Dispute-flow ontbreekt volledig.

**System action.** `create-checkout` → Stripe; `stripe-webhook` → `apply_top_up` RPC →
`transactions(type=top_up)` + `stripe_events`-claim.

**Tag.** Kernflow [CONFIRMED]; iDEAL-fee-hoogte [ASSUMED]; chargeback/reconcile-gat
[TO-VERIFY].

---

## Scenario 2 — Klant koopt catalogusproduct (instant checkout, `pay_cart`)

**Trigger.** Klant rekent de winkelmand af in de app (bekende catalogusprijs).

**Flow.**
1. App roept `pay_cart(p_items jsonb)` aan ([CONFIRMED] `pay-cart.sql`).
2. **Prijs komt SERVER-SIDE** uit `public.products` via match op `source_url` — NOOIT uit
   de client-JSON ([CONFIRMED], dit is de fix van het pay_cart-prijslek, MEMORY
   Flowva-audit #1). Onbekend product / ontbrekende `source_url` → weigeren
   (`'One or more products are no longer available'`).
3. `v_total = Σ(price × qty)`; `v_fee = greatest(8 %, €5)`; `v_charge = v_total + v_fee`.
4. Rij-lock op `profiles`; saldo-check; `balance -= v_charge`.
5. Per item een `orders`-rij (`status='quote_accepted'`) + `transactions(type='order',
   amount=-line)`; **één** `transactions(type='service_fee', amount=-fee)` over de hele mand
   ([CONFIRMED]).

**Wie betaalt wat.**
- Klant: productprijs (EUR-equivalent van ¥) **+ 8 % fee (min €5)**.
- Flowva: nog niets uitgegeven — de echte ¥-inkoop volgt in scenario 4. De fee is bruto
  binnen; netto pas na alle ¥-kosten.

**Wat als het faalt.**
- **Onvoldoende saldo**: `'Insufficient balance'` + `needed` ([CONFIRMED]); geen afschrijving.
- **Niet ingelogd / lege mand**: nette fout ([CONFIRMED]).
- **Product net van prijs veranderd** tussen tonen en betalen: server pakt de ACTUELE
  `products.price` → klant betaalt de nieuwe prijs, niet de getoonde. **[ASSUMED]** acceptabel;
  edge: als prijs omhoog ging kan saldo nu te laag zijn → faalt netjes. **[TO-VERIFY]**: UX-melding
  "prijs is gewijzigd" ontbreekt in deze RPC (wél in de Friends-flow via `price_alert`).
- **Race / dubbelklik**: rij-lock `for update` serialiseert → geen dubbele afschrijving
  ([CONFIRMED]).
- **`product` bestaat maar `price IS NULL`**: telt als unknown → hele mand geweigerd
  ([CONFIRMED]).

**System action.** `pay_cart` RPC → `orders(status=quote_accepted)` → triggert pg_net →
`place-bucky-order` (scenario 4). `transactions`: N× `order` + 1× `service_fee`.

**Tag.** [CONFIRMED] kern; prijswijzig-UX [TO-VERIFY].

---

## Scenario 3 — Klant koopt via offerte (`pay_quote` / `pay_quote_group`)

**Trigger.** Niet-catalogus-aanvraag: agent stuurt offerte (`status='quote_sent'`,
`quoted_total` gezet), klant accepteert.

**Flow.**
1. `pay_quote(order_id)` of `pay_quote_group(group_id)` ([CONFIRMED] `service-fee.sql`).
2. Losse offerte: fee = `greatest(8 %, €5)` op `quoted_total`. Groep: **één fee over de
   som** van alle `quote_sent`-items in de `request_group_id` ([CONFIRMED]).
3. Groeps-betaling weigert als nog niet alle items een offerte hebben (`v_waiting > 0`)
   ([CONFIRMED]).
4. Saldo-lock, afschrijven, `transactions` (`order` per item + 1× `service_fee`),
   orders → `quote_accepted`.

**Wie betaalt wat.** Identiek aan scenario 2: klant draagt productprijs + 8 % (min €5),
maar over de offerte-som; **één fee per aanvraaggroep** = bewuste klantvriendelijkheid (en
bepaalt de reconciliatie, [CONFIRMED] comment in `service-fee.sql`).

**Wat als het faalt.**
- **Offerte niet meer open** (`status<>'quote_sent'`): geweigerd ([CONFIRMED]).
- **`quoted_total` ontbreekt/≤0**: geweigerd ([CONFIRMED]).
- **Gemengde groep met geannuleerde items**: geannuleerde tellen niet mee in `v_sum`
  ([CONFIRMED]).
- **Min-fee-stapeling bij veel kleine losse aanvragen**: elke losse aanvraag = eigen €5 →
  duur voor de klant. Mitigatie = aanvragen groeperen (één `request_group_id`)
  ([ASSUMED] ontwerpkeuze, matcht MEMORY "mik €20–40/bundel").

**System action.** `pay_quote(_group)` RPC → zelfde downstream als scenario 2.

**Tag.** [CONFIRMED].

---

## Scenario 4 — Flowva plaatst de BuckyDrop-order (echte ¥-uitgave + wallet-debet)

**Trigger.** Order → `quote_accepted` → pg_net-trigger → edge function
`place-bucky-order` (x-webhook-secret-beveiligd) ([CONFIRMED] `place-bucky-order/index.ts`).

**Flow.**
1. Idempotentie: heeft de order al `shop_order_no` → "already placed", stop ([CONFIRMED]).
2. Product koppelen via `source_url`; variant-SKU kiezen (`pickSku`); ¥-prijs = `sku.priceYuan`.
3. POST `…/order/shop-order/create` met `productList[].productPrice` (¥) ([CONFIRMED] doc +
   code). BuckyDrop trekt straks van de **prepaid CNY-wallet**: `itemTotalAmount`
   (productprijs) + `freightAmount` (CN-binnenland) + `serviceAmount` (QC/value-added) +
   `platformServiceAmount` (BuckyDrop-fee) ([CONFIRMED] velden in order-details-doc).
4. Succes → `orders.shop_order_no` + `status='purchased'`.

**Wie betaalt wat (de FX-/wallet-realiteit).**
- De klant betaalde in EUR (scenario 2/3). Flowva betaalt BuckyDrop in **¥ uit de wallet**.
- **Het verschil tussen "EUR die de klant betaalde voor het product" en "¥ die de wallet
  kwijtraakt" is de FX-marge die Flowva loopt.** Hier zit het echte unit-economics-risico:
  als de ¥-prijs hoger blijkt dan de getoonde EUR-prijs (koersbeweging, prijswijziging),
  eet dat de 8 % fee op.
- QC ¥6 + `platformServiceAmount` + per-call API-fee = **Flowva's kosten uit de fee**
  ([ASSUMED] beleid).

**Wat als het faalt.**
- **BuckyDrop weigert met numerieke `code`** (bv. uitverkocht): `place-bucky-order` roept
  `refund_order(order_id, reason)` → **klant krijgt productprijs terug naar saldo** + order
  `cancelled`; als hele groep cancelt, gaat **service fee één keer terug** (`fee_refund`)
  ([CONFIRMED] `auto-refund.sql` + `place-bucky-order`). **LET OP**: refund gaat naar
  IN-APP saldo, niet naar Stripe — zie scenario 9 (wettelijk gat).
- **Tijdelijke/netwerkfout (geen `code`)**: alleen `bd_error` gezet, GEEN refund → handmatig
  herproberen ([CONFIRMED]). **[TO-VERIFY]**: er is geen automatische retry-loop; een blijvend
  hangende order blijft `quote_accepted` met `bd_error`. Bouw een retry/alert.
- **Wallet leeg / onvoldoende ¥-saldo bij BuckyDrop**: de klant heeft al in EUR betaald, maar
  de inkoop kan niet → **operationeel faalpunt**. **[TO-VERIFY]**: BuckyDrop's exacte
  foutcode/`info` bij wallet-tekort is niet in de docs vastgelegd; onbekend of dat een
  numerieke `code` (→ ongewenste auto-refund) of een tekst-fout (→ hangt) geeft. Kritiek om
  te verifiëren + low-balance-alert op de wallet bouwen.
- **Variant niet te matchen** (`kleur` matcht geen SKU): `fail()` zet `bd_error`, geen
  inkoop, geen refund ([CONFIRMED]) → order hangt → handmatig.
- **Geen `priceYuan`/`spu_code`**: `fail()` ([CONFIRMED]).
- **Friends-groepsorder**: pakket gaat naar `host_user_id` i.p.v. het lid ([CONFIRMED]).

**System action.** `place-bucky-order` → `shop-order/create`; bij weigering `refund_order`
RPC; status → `purchased`.

**Tag.** Kern [CONFIRMED]; wallet-tekort-gedrag + retry [TO-VERIFY].

---

## Scenario 5 — Value-added / QC-pakket (¥6 per order)

**Trigger.** Voor ELKE order: Standard Product Photos (¥2/SKU) + Garment Measurement
Service (¥4/SKU) = ~¥6 ([CONFIRMED] kernmodel; bedragen [ASSUMED] uit het brief).

**Flow.**
1. Twee activeringsroutes (BuckyDrop): **My Services → Service Preselection** (auto op ÁLLE
   orders) of **Service Market** (per LOS product) ([ASSUMED] uit kernmodel; niet in de
   gelezen code geconfigureerd).
2. BuckyDrop voert de service uit; kost verschijnt als `serviceAmount` in order-details en
   wordt van de wallet getrokken (¥) ([CONFIRMED] veld bestaat).
3. App: QC-foto's komen binnen (status `qc_pending`, `qc_images`), agent uploadt ≥4 foto's
   ([CONFIRMED] `AgentPanel.jsx` eist `qc_images.length >= 4`).

**Wie betaalt wat.** **Flowva draagt de ¥6** als marketing/transparantie-kost en
retour-bewijs — wordt NIET apart aan de klant doorbelast ([ASSUMED] beleid). Het is een vast
aftrekpost op elke order in de unit-economics.

**Wat als het faalt.**
- **Preselection niet ingesteld** → QC gebeurt niet automatisch → geen foto's → klant kan
  geen parcel bouwen (app eist QC-foto's). **[TO-VERIFY]**: bevestig dat Service Preselection
  daadwerkelijk aanstaat in het BuckyDrop-account.
- **Service kost meer dan ¥6** (meer SKU's per order): schaalt mee (¥2+¥4 per SKU) → bij
  multi-SKU-orders hogere vaste kost → drukt marge op goedkope bundels.
- **Foto's komen niet via webhook**: order blijft hangen vóór `qc_pending`. Defect-foto's
  komen via `Notify Po Pending` (`picList` Required) ([CONFIRMED] webhook-code `findPics`).

**System action.** BuckyDrop service-config (buiten de app); `buckydrop-webhook` zet
`qc_images` + status; `AgentPanel` upload-gate.

**Tag.** Veld + webhook [CONFIRMED]; bedragen/activering [ASSUMED]/[TO-VERIFY].

---

## Scenario 6 — Internationale verzending: schatting (`pay_shipping`)

**Trigger.** Klant bouwt een parcel uit warehouse-items en betaalt verzending, vóór de
exacte BuckyDrop-cutover (sandbox geeft nep-kanalen → fallback op schatting) ([CONFIRMED]
`haul-shipping` `isSandbox`).

**Flow (first-weight-model).**
1. `pay_shipping(order_ids[])` ([CONFIRMED] `pay-shipping.sql`).
2. Constanten (moeten gelijk zijn aan `src/WarehouseAndHaul.jsx`): `first_kg=0,5`,
   `first_eur=€9`, `per_kg=€8,5`, `buffer=1,3`, `vat=0,21` ([CONFIRMED]).
3. `ship = 9 + max(0, kg-0,5) × 8,5`; `ship_buffered = ship × 1,3`;
   `vat = (goods + ship) × 0,21`; `total = ship_buffered + vat` ([CONFIRMED]).
4. Saldo-lock, afschrijven, `transactions(type='shipping')` (verzending+BTW samen), géén
   status-wijziging in deze functie ([CONFIRMED]).

**Wie betaalt wat.**
- Klant: gebufferde verzending (×1,3) **+ 21 % invoer-BTW (DDP)** over goederen + verzending.
- De **buffer (30 %)** is een tijdelijke overcharge; het verschil tussen geschat en werkelijk
  hoort later terug (refund) of bij (supplement) — **[TO-VERIFY]**: ik zie in `pay_shipping`
  GEEN automatische reconcile/refund van de buffer terug naar de klant. Dat is een
  refund-lek (MEMORY audit #4: "VAT-buffer-refund-lek"). Moet expliciet worden afgewikkeld
  (via de exacte flow, scenario 7).

**Wat als het faalt.**
- **Gewicht ontbreekt** (`weight<=0`): `'Weight missing'` ([CONFIRMED]); agent moet eerst
  gewicht invullen (`AgentPanel` eist gewicht bij `qc_pending`, [CONFIRMED]).
- **Onvoldoende saldo**: `needed` terug ([CONFIRMED]).
- **Item van een andere user / niet bestaand**: count-mismatch → geweigerd ([CONFIRMED]).
- **Buffer nooit terugbetaald**: structureel te veel betaald door de klant → wettelijk +
  reputatie-risico. **[TO-VERIFY]/bouwen**.

**System action.** `pay_shipping` RPC → `transactions(type=shipping)`.

**Tag.** Berekening [CONFIRMED]; buffer-reconcile-lek [TO-VERIFY].

---

## Scenario 7 — Internationale verzending: EXACT BuckyDrop-tarief (`haul-shipping` + `pay_shipping_exact`)

**Trigger.** Productie-cutover: klant kiest een ECHT verzendkanaal; bedrag komt
server-side uit `channel-carriage-list` ([CONFIRMED] `haul-shipping/index.ts`).

**Flow.**
1. `action='quote'`: `haul-shipping` POST't `channel-carriage-list` met productList
   (dims default 20×20×10, gewicht in kg, `categoryCode`) → parse naar EUR-kanalen
   ([CONFIRMED]).
2. **CNY→EUR**: `priceEur = (priceCny / CNY_PER_EUR) × FX_MARGIN`, met
   `CNY_PER_EUR=7,7` (env) en `FX_MARGIN=1,03` (3 % buffer tegen koersschommeling)
   ([CONFIRMED]). **Hier draagt de klant de FX via de 3 % marge op verzending.**
3. `action='pay'`: her-quote server-side, pak gekozen `serviceCode`. BTW: **tax-inclusive
   lijn (`isTariffCover==1` of `vatDetail.isVat==1`) → vat=0**; anders `vat = ship × 0,21`
   ([CONFIRMED]). `amount = ship + vat`.
4. `pay_shipping_exact(uid, order_ids, amount, ship, vat, code, name)` — **service-role
   only**, klant kan dit NIET zelf aanroepen ([CONFIRMED] revoke + grant). Saldo-lock,
   afschrijven, `hauls`-rij (`status='confirmed'`), `haul_items`, `transactions(shipping)`,
   orders → `shipped_international` ([CONFIRMED]).

**Wie betaalt wat.**
- Klant: **exacte** verzending + (eventueel) 21 % BTW. Geen buffer, geen na-refund
  ([CONFIRMED]) — dit lost het buffer-lek van scenario 6 op zodra cutover live is.
- Flowva: draagt de FX-koersbeweging boven de 3 % marge + de per-call API-fee uit de marge.

**Wat als het faalt.**
- **Items niet `qc_pending`**: geweigerd ([CONFIRMED] in zowel `haul-shipping` als
  `pay_shipping_exact`).
- **Gewicht ontbreekt**: `needWeight:true` ([CONFIRMED]).
- **Gekozen kanaal verdwenen** tussen quote en pay: `'Chosen shipping option is no longer
  available'` ([CONFIRMED]).
- **Sandbox**: nep-kanalen → `isSandbox:true` → app valt terug op de schatting (scenario 6)
  ([CONFIRMED]).
- **FX-aanname fout**: `totalPrice` currency = [TO-VERIFY] (expliciete TODO in code:
  "bevestig de currency van totalPrice"). Als BuckyDrop al in EUR teruggeeft, deelt de code
  ten onrechte door 7,7 → klant betaalt 7,7× te weinig. **Kritiek te verifiëren bij cutover.**
- **`categoryCode`/dims default**: `bd_category_code` nog leeg → default "1" en standaarddoos
  → tarief kan afwijken ([CONFIRMED] TODO's). Reconcile met werkelijk gewicht/volume.
- **Overweight-staffel** (¥1,5/kg >2kg) en (¥2/item >5): zit impliciet in het BuckyDrop-tarief
  maar wordt niet apart uitgesplitst in onze code ([ASSUMED]).

**System action.** `haul-shipping` (quote/pay) → `pay_shipping_exact` RPC → `hauls` +
`transactions(shipping)` + orders → `shipped_international`.

**Tag.** Kern [CONFIRMED]; FX-currency van `totalPrice` [TO-VERIFY] (echte foutbron).

---

## Scenario 8 — Supplement: pakket zwaarder/duurder dan geschat (PO `orderStatus 4`)

**Trigger.** BuckyDrop zet PO op `orderStatus 4` = "to be confirmed (incl. supplementary
payment)" — bijbetaling nodig (zwaarder pakket, prijscorrectie, extra dienst) ([CONFIRMED]
order-details `orderStatus` enum + kernmodel).

**Flow.**
1. Webhook `Notify Po Status` komt binnen; `buckydrop-webhook` mapt PO-status. **LET OP**:
   `PO_STATUS_MAP` heeft GEEN entry voor 4 → de webhook doet `po 4 (no map)`, geen actie
   ([CONFIRMED] in code — er is geen supplement-afhandeling).
2. De velden `productSupplementAmount` / `otherSupplementAmount` (¥) staan in order-details
   ([CONFIRMED]).

**Wie betaalt wat.** De klant hoort het supplement te dragen (extra gewicht/prijs is hun
goed). In het transparante model: bijbetaling = nieuwe EUR-regel op het saldo.

**Wat als het faalt (groot gat).**
- **Geen geautomatiseerde supplement-flow**: er is in de gelezen code GEEN RPC die een
  supplement van het klant-saldo afschrijft, en `orderStatus 4` wordt genegeerd
  **[TO-VERIFY]/bouwen**. Zonder afhandeling blijft de PO hangen "to be confirmed" → BuckyDrop
  schipt niet → order vast. Dit is de belangrijkste ontbrekende geldstroom.
- **Klant heeft onvoldoende saldo voor supplement**: nog te ontwerpen (push → top-up → pay-
  supplement) [TO-VERIFY].
- **Supplement = refund (lichter dan geschat)**: in het EXACTE model (scenario 7) is er geen
  buffer dus geen refund; in het schattingsmodel (6) hoort het verschil terug maar wordt niet
  afgewikkeld → zie buffer-lek.

**System action.** Vereist: nieuwe `pay_supplement` RPC + webhook-branch op `orderStatus===4`
+ push. **Nu: niet aanwezig** ([TO-VERIFY]).

**Tag.** Velden/status [CONFIRMED]; afhandeling ONTBREEKT [TO-VERIFY].

---

## Scenario 9 — Refund / annulering (in-app saldo) — en het wettelijke gat

**Trigger.** (a) Agent meldt probleem vóór inkoop → klant annuleert (`cancel_paid_order`);
(b) BuckyDrop weigert/cancelt → `refund_order`; (c) EU-herroeping `/withdraw`.

**Flow.**
1. `cancel_paid_order(order_id)`: alleen eigenaar, alleen `status='quote_accepted'`, alleen
   als `problem_type` gezet → refund `price`/`quoted_total` naar saldo +
   `transactions(type='refund')`, order `cancelled` ([CONFIRMED] `refund-order.sql`).
2. `refund_order(order_id, reason)` (service-role): refund productprijs naar saldo; als hele
   `request_group_id` cancelt → **service fee één keer terug** (`fee_refund`), dubbel-refund-
   guard via `not exists … fee_refund` ([CONFIRMED] `auto-refund.sql`).
3. PO `orderStatus 8` (cancelled) via webhook → `refund_order` ([CONFIRMED] `buckydrop-webhook`).
4. Herroeping: `/withdraw` + `withdrawal_requests`-tabel (publieke edge function, admin
   leest) ([CONFIRMED] `withdrawal-requests.sql`).

**Wie betaalt wat.**
- Bij annulering vóór inkoop: klant krijgt alles terug; Flowva is alleen de Stripe-fee op de
  top-up kwijt (niet-recupereerbaar — Stripe houdt zijn fee).
- Bij retour ná levering: BuckyDrop `apply-return` → `returnFlowCode`; **klant draagt de
  retourkosten binnen de wet** ([CONFIRMED] kernmodel/EU).

**Wat als het faalt (HET wettelijke gat).**
- **Refund gaat naar IN-APP saldo, niet naar Stripe** ([CONFIRMED] in alle drie de RPC's).
  Wettelijk moet een herroeping/refund terug naar de **originele betaalmethode (Stripe)**
  binnen 14 dagen. **[TO-VERIFY]/bouwen**: er is GEEN `stripe.refunds.create`-pad. Dit is een
  compliance-blokker vóór launch (MEMORY: EU-withdrawal). Saldo-refund is alleen OK als de
  klant het expliciet kiest of het later opnieuw uitgeeft.
- **Chargeback-misbruik**: klant doet iDEAL-terugboeking ná saldo-refund → dubbel geld kwijt;
  geen dispute-handler (zie scenario 1) [TO-VERIFY].
- **Refund nadat saldo al is uitgegeven**: saldo kan negatief lijken? Nee — refund verhoogt
  saldo, dus altijd ≥0; maar Flowva's marge is dan al weg op de oorspronkelijke ¥-inkoop
  ([ASSUMED]).
- **`cancel_paid_order` zonder `problem_type`**: geweigerd ([CONFIRMED]) — klant kan niet
  zomaar na betaling annuleren; herroeping loopt via `/withdraw`.

**System action.** `cancel_paid_order` / `refund_order` RPC → `transactions(refund` /
`fee_refund)`. **Ontbreekt**: Stripe-refund-pad.

**Tag.** Saldo-refund [CONFIRMED]; Stripe-refund-verplichting [TO-VERIFY] (compliance-gat).

---

## Scenario 10 — Flowva Friends (group buying): fee-staffel + held-amount

**Trigger.** Leden vullen een gedeelde mand; elk lid doet "Confirm & pay" (`ff_set_ready`).

**Flow.**
1. `ff_set_ready(group_id)`: prijs SERVER-SIDE uit `products` (weigert `price_alert`-items),
   `locked_price` per item, fee = `ff_member_fee(size, total)`, `charge = total + fee`,
   saldo-lock, afschrijven, `transactions(type='group_hold')`, `held_amount` op het lid
   ([CONFIRMED] `flowva-friends-money.sql`).
2. **Fee-staffel** (lager naarmate groep groeit): 2→5 %/€4, 3→4 %/€3,5, 4→3,5 %/€3,
   5→3 %/€3, 6→3 %/€2,5, 7+→2,5 %/€2,5; solo blijft 8 %/€5 ([CONFIRMED]).
3. Iedereen ready → groep atomair `placed` (geld definitief).

**Wie betaalt wat.**
- Elk lid: eigen producttotaal + eigen (lagere) groeps-fee.
- **Besparing zit in verzending**: één parcel naar de host i.p.v. N losse first-weight-blokken
  → `groupSavings` schat `(N-1)×€9` verzending + fee-verschil ([CONFIRMED] `ffApi.js`).
- **De lagere fee + de QC ¥6 per order eten harder in de marge bij groepen** → unit-economics
  per lid is dunner; verdienen moet uit de gedeelde verzending en volume ([ASSUMED]).

**Wat als het faalt.**
- **Lid wordt un-ready / leavet / wordt gekickt vóór `placed`**: trigger A/B stort
  `held_amount` automatisch terug (`group_hold_refund`), maar **alleen tijdens
  `status='gathering'`** — na `placed` nooit (dubbele-refund-guard) ([CONFIRMED]).
- **Race**: group-rij `for update` in álle mutators → geen geld kwijt bij gelijktijdige
  ready/leave ([CONFIRMED]).
- **Item-prijs gewijzigd** (`price_alert`): `ff_set_ready` weigert tot review ([CONFIRMED]).
- **Onvoldoende saldo**: `needed` ([CONFIRMED]).
- **Echte inkoop/consolidatie naar host (Fase 5)**: nog NIET gebouwd ([CONFIRMED] comment) →
  na `placed` is het geld vast maar de BuckyDrop-plaatsing/refund-pad voor groepen is
  toekomstig werk [TO-VERIFY].

**System action.** `ff_set_ready`/`ff_unready` + triggers → `transactions(group_hold` /
`group_hold_refund)`; groep → `placed`.

**Tag.** Geld-mechaniek [CONFIRMED]; Fase-5-fulfilment [TO-VERIFY].

---

## Scenario 11 — Wallet-vulling (EUR → CNY) + buffer-bewaking

**Trigger.** Flowva moet de prepaid BuckyDrop-wallet (CNY) bijvullen om inkopen te dekken.

**Flow.**
1. Stripe-saldi → uitbetaling naar Wise/Revolut Business (EUR).
2. EUR → CNY via Wise (~0,4–1 %) of CNY-bankoverschrijving (~1 %) — liefst bankoverschrijving
   boven Alipay-kaart (~3 %) ([CONFIRMED] kernmodel; exacte BuckyDrop-CNY-bankroute = open
   vraag bij agent Vera, [TO-VERIFY]).
3. Wallet (CNY) gevuld; BuckyDrop trekt fulfilment-fees hieruit.
4. **Buffer-bewaking**: `wise_buffer_state` (één rij, handmatig bijgewerkt door admin via
   `admin_set_wise_buffer`), admin-app waarschuwt < €200 ([CONFIRMED] `finance-hardening.sql`).
5. **Reconciliatie**: `admin_finance_overview` toont `sum_balances` vs `sum_transactions`
   (`mismatch` ≠ 0 = ergens saldo gewijzigd zonder logregel), plus `per_type`-totalen en
   buffer-stand ([CONFIRMED]).

**Wie betaalt wat.** Flowva draagt de FX- + transactiekosten van de wallet-vulling uit de
8 % fee. Dit is de tweede grote hap (na Stripe) uit de bruto-marge.

**Wat als het faalt.**
- **Wallet loopt leeg**: inkopen falen (scenario 4) terwijl klanten al betaalden →
  liquiditeits-/vertrouwensrisico. Buffer-alert < €200 is de enige waarschuwing en is
  **handmatig** ([CONFIRMED]) → [TO-VERIFY]: live wallet-saldo uit BuckyDrop ophalen i.p.v.
  handmatige Wise-buffer.
- **Mismatch in reconciliatie**: `admin_finance_overview` legt het bloot, maar lost het niet
  op — handmatig onderzoek ([CONFIRMED]).
- **Koers beweegt tussen klant-betaling (EUR) en wallet-vulling (CNY)**: marge-erosie; geen
  hedge ([ASSUMED]).

**System action.** `admin_set_wise_buffer` / `admin_finance_overview` RPC's (admin-only);
wallet-vulling is een handmatige off-platform handeling.

**Tag.** Reconcile/buffer-tooling [CONFIRMED]; live-wallet-saldo + CNY-bankroute [TO-VERIFY].

---

## Scenario 12 — Per-call API-fees & micro-kosten

**Trigger.** Elke BuckyDrop-API-call (order-create, channel-carriage-list, details-query,
return-apply) heeft een piepkleine fee ([CONFIRMED] kernmodel; exact bedrag niet in de
gelezen docs → [TO-VERIFY] in BuckyDrop-facturatie).

**Wie betaalt wat.** Flowva, uit de marge. Verwaarloosbaar per call maar schaalt met
quote-spamming (klant die 20× een verzendquote opvraagt = 20 calls).

**Wat als het faalt.** Geen functioneel faalpunt; wel een marge-lek bij hoge call-volumes.
Mitigatie [ASSUMED]: quote-resultaten kort cachen (nu niet geïmplementeerd, [TO-VERIFY]).

**Tag.** [ASSUMED]/[TO-VERIFY].

---

## Unit-economics — volledig uitgewerkt rekenvoorbeeld

> Doel: laten zien dat 8 % bij goedkope losse items verliesgevend is en waarom MEMORY
> "mik €20–40/bundel" zegt. Alle Flowva-kosten komen UIT de service fee (de product- en
> verzendregels zijn doorlopende posten, geen marge). Koers [ASSUMED] €1 = ¥7,7.

### Voorbeeld A — duur item (productprijs €100, 1 SKU, 0,6 kg)

**Klant betaalt (EUR-bon):**
- Product: €100,00
- Service fee 8 %: €8,00 (boven het €5-minimum)
- Verzending exact (first-weight: €9 + 0,1 kg×€8,5 = €9,85; of via BuckyDrop-tarief): ~€10
- BTW 21 % (DDP, als niet tax-inclusive): over (100+10) = €23,10
- **Totaal klant ≈ €141,10** (waarvan €8 de enige Flowva-marge is)

**Flowva's kosten UIT die €8 fee:**
| Post | Bedrag (EUR) | Bron |
|---|---|---|
| Stripe/iDEAL top-up-fee | ~€0,29 (iDEAL) of ~€1,65 (kaart op €118 top-up) | [ASSUMED] |
| FX EUR→CNY wallet-vulling (~1 % op ~€100 inkoop) | ~€1,00 | [ASSUMED] |
| BuckyDrop `platformServiceAmount` (~2–3 % [ASSUMED]) | ~€2,50 | veld [CONFIRMED], % [ASSUMED] |
| QC ¥6 (¥2 foto + ¥4 meting) | ~€0,78 | bedrag [ASSUMED] |
| Per-call API-fees | ~€0,05 | [ASSUMED] |
| **Som kosten** | **~€4,62** | |
| **Netto-marge** | **€8,00 − €4,62 ≈ €3,38** | **~3,4 % van productwaarde** |

→ **Bij 8 % is een duur item gezond** (€3,38 netto). Bij **12 %** zou de fee €12 zijn →
netto ≈ €7,38 (≈7,4 %); bij **15 %** fee €15 → netto ≈ €10,38. De extra fee valt vrijwel
volledig in de netto-marge (kosten zijn grotendeels vast/laag-variabel).

### Voorbeeld B — goedkoop los item (productprijs €5, 1 SKU)

**Klant betaalt:** product €5 + fee = `max(8 %×5, €5)` = **€5,00** (minimum bijt) → +
verzending + BTW.

**Flowva's kosten UIT die €5 fee:** Stripe ~€0,29 + FX ~€0,05 + `platformServiceAmount`
~€0,15 + **QC ¥6 ≈ €0,78** + API ~€0,05 = **~€1,32**. Netto ≈ **€3,68**.
→ Lijkt oké, MAAR: het €5-minimum is wat dit redt. Zónder minimum (puur 8 % = €0,40) zou de
QC ¥6 alleen al de fee **opeten en negatief** maken (€0,40 − €0,78 < 0). **Daarom is het
€5-minimum essentieel** en daarom is losse goedkope verkoop structureel onaantrekkelijk
zonder dat minimum.

### Voorbeeld C — Flowva Friends, 4 leden, elk €25

**Per lid:** total €25, fee = `ff_member_fee(4, 25)` = `max(3,5 %×25, €3)` = **€3,00**.
Flowva-kosten per lid: Stripe ~€0,29 + FX ~€0,25 + platform ~€0,60 + **QC ¥6 ≈ €0,78** +
API ~€0,05 = **~€1,97**. **Netto per lid ≈ €1,03**; ×4 = **~€4,12 per groep**.
→ Dunner dan solo, maar het echte verdienmodel is de **gedeelde verzending**: 4× los =
4 first-weight-blokken (~€36) vs één consolidatie naar de host (~€12–15) → ~€21 minder
verzendkost dwingt volume af. De fee-staffel is een acquisitie-investering, niet de
marge-motor ([ASSUMED]).

### Conclusie unit-economics
- **8 % + €5-minimum is verdedigbaar** voor items ≥ ~€15–20 en voor bundels van €20–40
  (MEMORY-doel). Onder ~€8 redt alleen het €5-minimum het, en QC ¥6 is dan de grootste hap.
- **De drie marge-vreters** zijn, op volgorde: FX/wallet-koers, BuckyDrop
  `platformServiceAmount`, en QC ¥6. Stripe/iDEAL is klein.
- **Verhogen naar 12–15 %** levert vrijwel 1-op-1 extra netto op (kosten zijn niet
  procentueel-gevoelig), maar botst met de transparantie-belofte → houden op 8 % en de
  zwakke (goedkope) items oplossen via **kosten-vooraf tonen + bundelen**, niet via fee-
  verhoging (MEMORY: pricing-transparency-strategy). [ASSUMED] strategie, [CONFIRMED]
  als bestaande beleidslijn.

---

## Surcharging-regel (EU) — samengevat
- **Verboden** om consumenten een aparte toeslag te rekenen voor betaling met
  consumenten-kaart, iDEAL of SEPA ([CONFIRMED] EU PSD2-surcharging-verbod + NL
  implementatie). Daarom: **geen "+€0,29 iDEAL-fee"-regel op de bon**.
- Gevolg voor de ledger: **Stripe-, FX-, Alipay- en per-call-fees zijn ALTIJD Flowva-kosten
  uit de 8 % fee** — nooit een klant-regel. De klant-bon bevat alleen: productprijs,
  service fee, verzending, BTW, (eventueel) supplement.

---

## Openstaande geld-gaten (prioriteit vóór launch)
1. **[TO-VERIFY/KRITIEK]** `pay_shipping_exact`/`haul-shipping`: currency van
   `channel-carriage-list.totalPrice` bevestigen (deelt nu door ¥7,7; als al EUR → 7,7× te
   weinig verzending geïncasseerd). Expliciete TODO in code.
2. **[TO-VERIFY/COMPLIANCE]** Refunds gaan naar in-app saldo; EU-herroeping eist Stripe-refund
   naar originele betaalmethode. Geen `stripe.refunds.create`-pad → bouwen.
3. **[TO-VERIFY]** Supplement-flow (`orderStatus 4`) volledig ontbreekt: geen RPC, webhook
   negeert status 4 → orders hangen "to be confirmed".
4. **[TO-VERIFY]** Buffer-refund-lek in `pay_shipping` (schatting ×1,3): verschil
   geschat↔werkelijk wordt niet teruggestort.
5. **[TO-VERIFY]** Geen Stripe `charge.dispute`/`charge.refunded`-handler → chargeback ná
   saldo-uitgave = dubbel verlies.
6. **[TO-VERIFY]** Wallet-tekort-gedrag bij BuckyDrop (numerieke code vs tekstfout) + live
   wallet-saldo-bewaking (nu handmatige Wise-buffer < €200).
7. **[TO-VERIFY]** Top-up-reconciliatie als webhook nooit aankomt (betaald, geen saldo).
