# FLOWVA — MASTER-BLUEPRINT

> **De waterdichte, end-to-end blauwdruk van het Flowva-platform**: één transparant
> China-sourcing e-commerce-systeem (React+Vite + Supabase, live op flowva.app),
> apparel-merk **LITHRA**, fulfilment via **BuckyDrop** (Solution API,
> `bdopenapi.buckydrop.com`). Launch ~2 juli 2026.
>
> Dit master-document bindt de 17 detail-secties (`blueprint/01`–`blueprint/91`) tot één
> geheel: de levenscyclus, de state-machine, de geld-ledger, de wie-betaalt-wat-matrix en
> het geconsolideerde open-vragen-register. Geschreven voor een perfectionistische
> oprichter — uitputtend, concreet, getagd, geen fluff.

---

## 0. Hoe dit document te lezen

- **Begin hier** voor het totaaloverzicht. Elke sectie verwijst naar het detailbestand met de
  volledige scenario-uitwerking (zie §8 Table of Contents). De detailbestanden bevatten per
  scenario: **Trigger → stap-voor-stap Flow → Wie-betaalt-wat → Wat-als-het-faalt (de volgende
  edge-laag) → System action (API-call / app-status / RPC)**.
- **Tags.** Elke materiële bewering is getagd. Verzin nooit een API-capaciteit: staat iets niet
  in de docs/code, dan is het `[TO-VERIFY]`, niet `[CONFIRMED]`.

### Legenda

| Tag | Betekenis |
|---|---|
| **`[CONFIRMED]`** | Direct bevestigd uit BuckyDrop-API-docs, de echte Flowva-code/SQL, of dwingend EU-recht. |
| **`[ASSUMED]`** | Redelijke aanname op basis van het kernmodel of consistente ontwerplijn; niet hard bewezen. |
| **`[TO-VERIFY]`** | Moet expliciet gecheckt worden. Bij elk zo'n punt staat concreet **HOE/waar** (doc, sandbox-test, of agent Vera). |

> **Drie dwarsdoorsneden** lopen door bijna élke sectie heen en zijn de rode draden van het
> hele systeem:
> 1. **Refund-bestemming.** Alle refund-RPC's (`refund_order`, `cancel_paid_order`,
>    `auto-refund`) boeken naar in-app **saldo**, niet naar de originele **Stripe**-methode.
>    EU-recht (art. 13 CRD) eist de originele methode. `[CONFIRMED — auto-refund.sql / refund-order.sql]`
> 2. **Parcel-submit ontbreekt.** Er is GEEN BuckyDrop parcel-create/submit-call in de docs of
>    code; betaling zet de order lokaal op `shipped_international` zonder dat er fysiek iets
>    vertrekt. `[CONFIRMED — 91/P1]`
> 3. **Supplement (PO `orderStatus 4`) is ongemapt.** De webhook negeert status 4 → orders
>    hangen stil "to be confirmed". `[CONFIRMED — buckydrop-webhook PO_STATUS_MAP]`

---

## 1. EXECUTIVE SUMMARY

**Wat Flowva is.** Een transparante sourcing-winkel: de **echte fabrieksprijs** (1688/Taobao/Tmall)
is zichtbaar, plus een **service fee van 8% (minimaal €5)** — géén verborgen retail-markup.
Fulfilment loopt volledig via BuckyDrop. `[CONFIRMED — kernmodel + src/fees.js, pay-cart.sql]`

**De twee-valuta-architectuur.** De klant betaalt en wordt geboekt in **EUR** (in-app saldo,
`profiles.balance`). De BuckyDrop-wallet en álle fulfilment-fees lopen in **CNY (¥), prepaid**.
De FX-sprong tussen die twee werelden is een echte kost die Flowva uit de marge draagt.
`[CONFIRMED — 11/03]`

**De geldstroom (4 lagen).** (1) Klant laadt EUR-saldo op via Stripe iDEAL (idempotente webhook,
`apply_top_up`). (2) Klant koopt → `pay_cart` herprijst **server-side** uit `products` en rekent
één service fee over de hele mand. (3) Flowva betaalt BuckyDrop in CNY uit de prepaid wallet,
gevuld via Wise/Revolut → CNY-bankoverschrijving (~1%) of Alipay (~3%). (4) Refunds/supplementen
lopen terug. `[CONFIRMED — pay-cart.sql, place-bucky-order, finance-hardening.sql]`

**De order-levenscyclus.** `purchased → bought → shipped_local → qc_pending →
shipped_international → delivered`, met `cancelled` als terminale zijtak. BuckyDrop-PO-statussen
(1–12) en parcel-statussen worden via twee maps op deze Flowva-statussen geprojecteerd; de
state-machine is **forward-only** (een lagere of dubbele webhook kan een order nooit terugzetten).
`[CONFIRMED — buckydrop-webhook/index.ts, supplyflow-app.jsx statusConfig]`

**De QC-troef.** Elke order krijgt een verplicht **¥6-QC-pakket**: Standard Product Photos
(¥2/SKU) + Garment Measurement (¥4/SKU). Dit is tegelijk marketing/transparantie én retour-bewijs.
Bij een defect garandeert de "Notify Po Pending"-webhook (`confirmType` + `picList` beide Required)
dat de inspectiefoto meekomt. `[CONFIRMED — kernmodel + Notify Po Pending doc]`

**De drie grootste open risico's vóór launch** (zie §7 voor het volledige register):
1. **Refund naar Stripe ontbreekt** → directe non-compliance bij élke refund. **LAUNCH-BLOCKER.**
2. **Parcel-submit-call ontbekend/ontbreekt** → er vertrekt fysiek mogelijk niets terwijl de app
   "shipped" toont. **LAUNCH-BLOCKER (operationeel).**
3. **IOSS-registratie + €3/item-douaneheffing (1/7/2026)** niet in `pay_shipping`. **LAUNCH-BLOCKER.**

**Unit-economics in één zin.** De 8%-fee (min €5) is de **enige bruto-marge** waaruit Flowva ál
zijn eigen kosten (Stripe, FX, BuckyDrop platform-fee, QC ¥6, per-call) betaalt; product, verzending
en BTW zijn doorlopende posten. Duur item (€100) → netto ~€3,38; goedkoop los item (€5) wordt
alleen door het €5-minimum gered; bundels van €20–40 zijn het doel. `[ASSUMED/CONFIRMED — 11]`

---

## 2. END-TO-END LIFECYCLE (de genummerde keten)

> Eén heldere keten van klant tot retour. Per stap: de kern + de belangrijkste edge-cases.
> Detailverwijzingen tussen haakjes.

**1. Productcuratie (admin).** Agent plakt een bron-link (1688/Taobao/Tmall/Weidian) → BuckyDrop
`product/detail` via de beveiligde `buckydrop` edge-function → mapping naar `spu_code`,
`bd_platform`, `bd_skus` (skuCode/priceYuan/stock/img/props) → fabrieksprijs ¥→€ + 8% fee → opslag
in `public.products`. (→ `blueprint/01`)
- Edge: `soldOutTag` genegeerd → uitverkocht product opslaanbaar; `beginCount`/MOQ niet
  auto-overgenomen; geen save-guard bij lege `spu_code`/`bd_skus`; geen unieke index op
  `source_url` → prijs-mismatch-risico; seller-foto's hot-linked zonder rehosting/rechten-review.

**2. Checkout & klant-acties.** Klant bekijkt feed → kiest varianten → localStorage-mand →
adres → live price-guard-check → `pay_cart` schrijft EUR-saldo af. `pay_cart` herprijst ALTIJD
server-side uit `products` en rekent **één** fee (max 8%, min €5) over de mand. (→ `blueprint/02`)
- Edge: `pay_cart` niet idempotent (dubbelklik/twee tabs → dubbele afschrijving, A12); price-guard
  fail-open bij stale prijs → supplement-naheffing (A8); onvolledig adres geeft tóch
  `hasAddress=true` (A15); niet-ondersteund land → stille NL-fallback (A9); top-up iDEAL-only.

**3. Saldo & treasury.** Top-up via Stripe iDEAL (min €5) → idempotente `apply_top_up`
(`stripe_events`-claim). EUR-saldo (`profiles.balance`) ≠ Wise/Revolut-buffer (`wise_buffer_state`,
handmatig) ≠ BuckyDrop-wallet (CNY, niet via API leesbaar). (→ `blueprint/03`, `blueprint/11`)
- Edge: afgebroken/verlopen top-up (`checkout.session.expired`) zonder pending-state (A3);
  chargeback ná uitgegeven saldo (A14, M2); geen live wallet-saldo-API → handmatige buffer < €200.

**4. Inkoop (BuckyDrop Supplier PO).** `quote_accepted` → pg_net-trigger → `place-bucky-order` →
`order/shop-order/create`. Idempotent via `shop_order_no`. Succes → `purchased`. BuckyDrop trekt
CNY uit de prepaid wallet. (→ `blueprint/04`, `blueprint/14`)
- Edge: uitverkocht (code `70010106`) → auto-refund naar saldo; tijdelijke/netwerkfout → `bd_error`,
  geen retry-cron; wallet leeg mid-flow → onterechte refund i.p.v. retry; `failureType` 1=System vs
  2=Business niet onderscheiden (A28); dubbele PO-venster tussen API-call en DB-write.

**5. Domestic China-handling & QC.** Inbound check → stock-in (PO `orderStatus 9` → `qc_pending`).
Verplicht ¥6-QC-pakket. Value-added via dashboard (Service Preselection = alle orders, Service
Market = per product) — **NIET API-stuurbaar**. (→ `blueprint/05`, `blueprint/10`)
- Edge: value-added/QC alleen achteraf reconcileerbaar via `serviceAmount`; `weight_grams` wordt
  nergens uit order-detail geschreven → haul blokkeert (S4); 30-dagen opslag verloopt → stille
  CNY-wallet-drain (S2); seller→magazijn transit-verlies (status blijft 6, A30).

**6. QC-goedkeuringspoort.** Tussen de verplichte inspectie en internationale verzending. Item
blijft op `qc_pending` tot de klant "Add to parcel" kiest — **geen timeout/auto-proceed**.
(→ `blueprint/06`)
- Edge: GEEN klant-reject-actie aan de poort (A2); defect-banner rendert niet bij `qc_pending`
  (acties zijn pre-payment-only); `dispute_status='pending'` blokkeert de state-machine NIET →
  forward-webhook rijdt eroverheen (Q1); webhook OVERSCHRIJFT `qc_images` (bewijsverlies).

**7. Internationale verzending.** Kanaalkeuze via `channel-carriage-list` → estimate ↔ actual
reconcile → DDP/BTW-inclusieve lijnen. (→ `blueprint/07`, `blueprint/91`)
- Edge: **geen parcel-submit-call** → order=shipped terwijl er niets vertrekt (P1); `haul-shipping`
  hardcodeert NL → quote-zone ≠ bestemmingsland voor elke niet-NL klant (A-NL); volumetrisch gewicht
  & `rateType`-modellen genegeerd (C-V1/C-V2); verzekering nooit geactiveerd (C-INS); supplement
  (PO 4) ongemapt (C-SUP).

**8. Levering & post-levering.** `pkgNormalStatus 4`/PO 12 → `delivered`. POD-velden
(`signStatus`/`signTime`) bestaan in `pkg/detail`. (→ `blueprint/08`)
- Edge: carrier hardcoded op DHL → dode tracking-link bij elke niet-DHL-carrier (T2/A18);
  `TransitTab` pollt niets → statisch nummer (T1); `signTime` niet opgeslagen → geen POD-bewijs bij
  chargeback (X1); geconsolideerde `delivered`-webhook overschrijft achtergehouden defect-item (Q2);
  geweigerde/geretourneerde pakketten (`pkgAbnormalStatus`) ongemapt → blijven hangen.

**9. Retouren & refunds.** Reden × stadium × wie-betaalt-wat. **De refund-brug**: BuckyDrop refundt
traag naar de CNY-wallet (stroom A), terwijl de klant wettelijk EUR terug moet naar Stripe (stroom B)
— twee gescheiden geldstromen die Flowva zelf moet verzoenen; stroom B mag nooit op A wachten.
(→ `blueprint/09`)
- Edge: refund vandaag UITSLUITEND naar saldo; geen `stripe.refunds.create`-pad; apply-return →
  `returnFlowCode` niet in de gewired gateway; geen retour-status-webhook → poll-cron nodig;
  Stripe-chargeback `charge.dispute.created` nu wél geregistreerd maar verlaagt saldo niet.

**10. Voorraad / doorstroom.** `businessType`/`orderType` zijn **read-only** in `order/detail` en
staan NIET in de `shop-order/create`-body → Flowva kan via de Solution API geen echte
Stock/Forward/Inventory PO plaatsen. Spoor A (per-klant warehouse → haul) werkt; Spoor B (gedeelde
voorraad) vereist een Flowva-eigen voorraadtabel. (→ `blueprint/10`)

**Dwars: Flowva Friends (group buying).** Groep vult → elk lid `ff_set_ready` (held_amount) →
atomair `placed` → orders per item naar de **host**. Fee-staffel daalt met groepsgrootte.
(→ `blueprint/15`)
- Edge: geen expiry-cron → geld blijft hangen bij nooit-volle groep; host-adres-validatie ontbreekt
  (A20); fysieke consolidatie = fase 5 (nog niet gebouwd); group-refund naar saldo i.p.v. Stripe.

---

## 3. MASTER ORDER-STATE-MACHINE

### 3.1 Flowva-statussen, rang & transities

Forward-only invariant: `setOrderStatus` weigert elke transitie waarvan `RANK[new] <= RANK[current]`,
en weigert álles als `current === 'cancelled'`. `[CONFIRMED — buckydrop-webhook/index.ts:52-59]`

| Status | UI-step | RANK | Trigger die hem zet | Toegestane volgende transities |
|---|---|---|---|---|
| `requested`/`quote_sent`/`quote_accepted` | 0 | 0 | App/Stripe (betaling, offerte) | → `purchased` (place succes), → `cancelled` (cancel/weigering) |
| `purchased` | 0 | 1 | `place-bucky-order` succes (`shop_order_no`) | → `bought`, → `cancelled` |
| `bought` | 1 | 2 | PO `orderStatus 5` (ordered) | → `shipped_local`, → `cancelled` |
| `shipped_local` | 2 | 3 | PO `orderStatus 6` (shipped out) | → `qc_pending`, → `cancelled` |
| `qc_pending` | 3 | 4 | PO `orderStatus 9` (stock-in) | → `shipped_international`, → `cancelled` |
| `shipped_international` | 4 | 5 | PO 11 / parcel `pkgNormalStatus 2\|3` | → `delivered`, → `cancelled` |
| `delivered` | 5 | 6 | parcel `pkgNormalStatus 4` / PO 12 | (terminaal happy) |
| `cancelled` | — | — | PO `orderStatus 8` → `refund_order`, of `cancel_paid_order` | (terminaal, geen heropening) |

`[CONFIRMED — supplyflow-app.jsx:29-41, buckydrop-webhook/index.ts:32-59]`

### 3.2 BuckyDrop PO `orderStatus` (1–12) → Flowva-status mapping

| PO orderStatus | Betekenis | Flowva-mapping | Opmerking |
|---|---|---|---|
| 1 | paid | — (genegeerd, gelogd) | |
| 2 | in review | — | wenselijkheid micro-update `[TO-VERIFY]` |
| 3 | processing | — | |
| **4** | **to be confirmed (incl. supplementary payment)** | **— ONGEMAPT** | **GAT: supplement hangt stil. `[CONFIRMED]`** |
| 5 | ordered | `bought` | |
| 6 | shipped out (→ magazijn) | `shipped_local` | |
| 7 | received/signed | — (genegeerd) | A37: niet gemapt |
| **8** | **cancelled** | `cancelled` → `refund_order` | refund naar saldo |
| 9 | stock-in | `qc_pending` | QC-foto's klaar |
| 10 | stock-out/outbound | — (genegeerd) | A26: niet gemapt |
| 11 | delivered (international) | `shipped_international` | "in land", nog niet aan deur |
| 12 | fulfilled | `delivered` | |

`[CONFIRMED — buckydrop-webhook/index.ts:32-38,115-121 + order-detail doc]`

### 3.3 BuckyDrop parcel-status → Flowva-status mapping

| Parcel-veld | Waarde | Betekenis | Flowva-mapping |
|---|---|---|---|
| `pkgNormalStatus` | 1 | to-be-shipped | — |
| `pkgNormalStatus` | 2 | shipped out | `shipped_international` |
| `pkgNormalStatus` | 3 | to be delivered | `shipped_international` |
| `pkgNormalStatus` | 4 | delivered | `delivered` |
| `pkgNormalStatus` | **5** | **cancelled** | **— ONGEMAPT (GAT 5.4)** |
| `packageStatus` | 1–10 | pre-verzend substaten | **niet gebruikt** (alleen `pkgNormalStatus`) |
| `packageApprovedStatus` | 1/2/3 | to-be-approved / approved / not-approved | niet gepolld (P2) |
| `packageLockStatus` | 2 | locked | niet gepolld (P3) |

`[CONFIRMED — buckydrop-webhook/index.ts:40-44,91-99 + parcel docs]`

### 3.4 Speciale (niet-status) transities

| Gebeurtenis | Trigger | Effect | Tag |
|---|---|---|---|
| Defect gemeld | Notify Po Pending (`confirmType` + `picList`) | `qc_images`=pics, `dispute_status='pending'`, `problem_type=confirmType`; **geen** status-shift | `[CONFIRMED]` |
| Price-guard on-hold | live ¥-check >5% / sold-out | `products.price_alert=true` (product-niveau, geen order-status) | `[CONFIRMED]` |
| Out-of-order / dubbele webhook | lagere of herhaalde status | "no forward" / "already" — genegeerd | `[CONFIRMED]` |
| **Webhook over actieve defect-hold** | forward-mapped status terwijl `dispute_status='pending'` | **rijdt eroverheen** (RANK negeert dispute_status) | **GAT Q1 `[CONFIRMED]`** |

### 3.5 Bekende state-machine-gaten (te bouwen)

- **PO 4 (supplement)** ongemapt → `awaiting_supplement`-substatus + bij-charge-flow nodig. `[TO-VERIFY/TO-BUILD]`
- **`pkgNormalStatus 5` / `packageStatus 10` (parcel cancelled)** ongemapt → orders blijven hangen. `[TO-VERIFY/TO-BUILD]`
- **`pkgAbnormalStatus` 7/8/9 (returned/geweigerd)** niet verwerkt → blijven op `shipped_international`. `[CONFIRMED gat]`
- **Geen parcel-submit-trigger** → introduceer tussenstatus `ship_requested`; laat alleen een echte parcel-webhook naar `shipped_international` tillen. `[CONFIRMED — 91/P1]`
- **`dispute_status` blokkeert state-machine niet** → voeg een `held`-rang toe in `setOrderStatus`. `[CONFIRMED — Q1]`
- **Geen stuck-order watchdog** → cron over `orders.status` + `updated_at`. `[TO-VERIFY/TO-BUILD]`

---

## 4. VOLLEDIGE FEE / KOSTEN-LEDGER

### 4.1 Wie draagt welke fee

| Fee | Hoogte | Valuta | Grondslag | Wie draagt formeel | Waar in de stack |
|---|---|---|---|---|---|
| Stripe / iDEAL transactiefee | ~€0,29 (iDEAL) of ~1,4%+€0,25 (kaart) | EUR | per top-up | **Flowva** (uit marge) | bij top-up, niet doorbelast |
| FX EUR→CNY (Wise/Revolut) | ~0,4–1% / spread | EUR→CNY | per wallet-vulling | **Flowva** (uit marge) | bij wallet-vulling |
| Alipay-kaartfee (alternatief) | ~3% | CNY | per vulling via kaart | **Flowva** (uit marge) | alleen als wallet via kaart |
| **Service fee Flowva** | **8%, min €5** (solo); lager bij groep | EUR | **per aanvraaggroep/mand** | **Klant** | `service_fee_for()` / `ff_member_fee()` |
| Productprijs (factory) | echte ¥-prijs | CNY | per item | **Klant** (via EUR-saldo) | `pay_cart` / `pay_quote` |
| BuckyDrop platform service fee | `platformServiceAmount` (% / vast) | CNY | per order | **Flowva** (uit marge) | order-detail `platformServiceAmount` |
| BuckyDrop fulfilment/parcel | **¥9,9 (1–5 items) + ¥2/item >5 + ¥1,5/kg >2kg** | CNY | per parcel + per extra item/kg | **Klant** (via shipping-regel) | parcel/freight |
| Value-added / QC | **~¥6/order** (¥2 foto's + ¥4 meting per SKU) | CNY | per SKU | **Flowva** (marketing-kost) | `serviceAmount` |
| Per-call API-fee | piepklein, per call | CNY | per BuckyDrop-call | **Flowva** (uit marge) | elke call |
| Internationale verzending | `channel-carriage-list`, EUR-omrekening | CNY→EUR | per parcel | **Klant** | `pay_shipping` / `pay_shipping_exact` |
| Invoer-BTW (DDP) | 21% over (goederen+verzending), of 0 bij tax-inclusive | EUR | per zending | **Klant** | `pay_shipping` / `haul-shipping` |
| **Douaneheffing (vanaf 1/7/2026)** | **~€3/item** | EUR | per item | **Klant** (mits doorberekend) | **nog NIET in `pay_shipping` — GAT** |
| Supplement (zwaarder/duurder) | verschil | CNY→EUR | per PO orderStatus 4 | **Klant** | **nog NIET afgehandeld — GAT** |

Tags: veldnamen (`platformServiceAmount`, `serviceAmount`, `freightAmount`, `itemTotalAmount`,
`productSupplementAmount`, `otherSupplementAmount`, `actualAmount`) = `[CONFIRMED — order-detail doc]`;
de QC-¥6, de fulfilment-staffel en de "wie-draagt-wat"-toewijzing = `[ASSUMED — beleid, consistent
met het transparantie-model]`.

### 4.2 Surcharging-regel (EU)

Aan de consument mag **GÉÉN** losse Stripe-/Alipay-/FX-toeslag worden doorberekend (PSD2-surcharging-
verbod + NL art. 6:230k BW). Daarom zitten alle betaal-/FX-/platform-/per-call-fees **altijd IN de
8%-fee en de marge** — nooit als aparte klant-regel. De klant-bon bevat enkel: productprijs, service
fee, verzending, BTW, (eventueel) supplement. `[CONFIRMED — EU-recht]`

### 4.3 Uitgewerkt unit-economics rekenvoorbeeld — duur item (productprijs €100, 1 SKU, 0,6 kg)

**Klant betaalt (EUR-bon):**
- Product: €100,00
- Service fee 8%: €8,00 (boven het €5-minimum)
- Verzending exact (first-weight €9 + 0,1 kg × €8,5 ≈ €9,85): ~€10,00
- BTW 21% (DDP, als niet tax-inclusive) over (100+10): €23,10
- **Totaal klant ≈ €141,10** — waarvan **€8 de enige Flowva-marge** is.

**Flowva's kosten UIT die €8 fee:**

| Post | Bedrag (EUR) | Bron |
|---|---|---|
| Stripe/iDEAL top-up-fee | ~€0,29 (iDEAL) | `[ASSUMED]` |
| FX EUR→CNY wallet-vulling (~1% op ~€100 inkoop) | ~€1,00 | `[ASSUMED]` |
| BuckyDrop `platformServiceAmount` (~2–3%) | ~€2,50 | veld `[CONFIRMED]`, % `[ASSUMED]` |
| QC ¥6 (¥2 foto + ¥4 meting) | ~€0,78 | bedrag `[ASSUMED]` |
| Per-call API-fees | ~€0,05 | `[ASSUMED]` |
| **Som kosten** | **~€4,62** | |
| **Netto-marge** | **€8,00 − €4,62 ≈ €3,38 (~3,4% van productwaarde)** | |

**Bij 8% vs 12–15%.** De kosten zijn grotendeels vast/laag-variabel, dus een hogere fee valt vrijwel
1-op-1 in de netto-marge:
- **8%** → fee €8,00 → netto **≈ €3,38**
- **12%** → fee €12,00 → netto **≈ €7,38** (~7,4%)
- **15%** → fee €15,00 → netto **≈ €10,38** (~10,4%)

**Conclusie.** 8% + €5-minimum is verdedigbaar voor items ≥ ~€15–20 en bundels €20–40. Onder ~€8
redt alleen het €5-minimum het en is QC ¥6 de grootste hap (bij puur 8% zou een €5-item negatief
draaien: €0,40 fee − €0,78 QC < 0). De drie marge-vreters, op volgorde: **FX/wallet-koers →
BuckyDrop `platformServiceAmount` → QC ¥6**. Strategie: transparantie houden op 8%, de zwakke
goedkope items oplossen via **kosten-vooraf tonen + bundelen**, niet via fee-verhoging.
`[CONFIRMED/ASSUMED — 11]`

---

## 5. WIE-BETAALT-WAT MATRIX (kern-scenarios)

> Rijen = scenario; kolommen = wie draagt de kost. "Flowva" = uit marge/operationeel verlies.
> Refund-bestemming is overal **vandaag saldo, wettelijk Stripe** (dwarsdoorsnede §0.1).

| Scenario | Klant | Flowva | Leverancier (seller) | Verzekeraar/Carrier |
|---|---|---|---|---|
| **Defect (QC vóór verzending)** | — | refund/herinkoop + QC-kost; draagt verlies als seller-retour faalt | retour-acceptatie (return `applyType=1`); draagt bij top-rang | — |
| **Mislabel / verkeerde maat** (Garment Measurement) | — | refund/reship; QC-bewijs | seller-fout → seller-retour | — |
| **No-reason retour (EU-herroeping)** | **retourzending** (mits vooraf gemeld) | productprijs + standaard outbound terug; service-fee-refund `[TO-VERIFY juridisch]` | — | — |
| **Pakket KWIJT in transit** | — | volledige refund (goederen+vracht) — **geen polis actief (C-INS)** → Flowva draagt | — | carrier-claim *zou* moeten, maar verzekering nooit geactiveerd `[CONFIRMED gat]` |
| **Beschadigd in transit** | — | refund/reship | — | carrier-claim (handmatig portaal `[TO-VERIFY]`) |
| **Douaneheffing/invoer-BTW** | **bij DDP: vooraf in prijs**; bij niet-DDP: onverwachte nota = verboden onder DDP-belofte | draagt BTW-afdracht (IOSS); draagt €3/item als niet doorberekend (GAT) | — | — |
| **Counterfeit/verboden, geweigerd door BD** | — | refund (naar saldo) + IP-/seizing-risico als verkoper | — | — |
| **Partial stock (3 van 5 geleverd, A25)** | proportionele refund van 2 stuks | bouwt detectie + partial-refund | — | — |
| **Supplement (PO 4, zwaarder pakket)** | **hoort bij te betalen** (extra gewicht is klant-goed) | draagt als niet doorbelast (flow ontbreekt) | — | — |

**Beslisregel (samenvattend):** **item-fout = Flowva betaalt** (defect, mislabel, beschadigd,
verloren, niet-conform); **klant-keuze = klant betaalt** (no-reason retourzending binnen de wet,
variant-spijt). `[CONFIRMED — /returns secties + EU-recht]`

---

## 6. END-TO-END FLOW-DIAGRAM (tekst)

```
KLANT                          FLOWVA (Supabase)                 BUCKYDROP (CNY wallet)
  │                                  │                                   │
  │ top-up iDEAL ───────────────────▶│ apply_top_up (idempotent)         │
  │                                  │ profiles.balance += €              │
  │ checkout (pay_cart) ────────────▶│ server-side herprijs + 8% fee     │
  │                                  │ orders.status=quote_accepted ─────▶│ shop-order/create
  │                                  │   (pg_net → place-bucky-order)     │   (CNY uit wallet)
  │                                  │ ◀── status=purchased               │
  │                                  │ ◀── webhook PO5 ─── bought         │
  │                                  │ ◀── webhook PO6 ─── shipped_local  │
  │                                  │ ◀── webhook PO9 ─── qc_pending ────│ QC ¥6 (foto+meting)
  │ "Add to parcel" ────────────────▶│ haul-shipping quote/pay           │
  │ pay verzending+BTW ─────────────▶│ pay_shipping_exact                │
  │                                  │ status=shipped_international  ◀──❓ GEEN parcel-submit-call (P1)
  │                                  │ ◀── webhook pkgNormal4 ── delivered│
  │ retour/withdraw ────────────────▶│ refund_order → SALDO ◀──❓ moet Stripe (art.13 CRD)
  │                                  │ apply-return → returnFlowCode ────▶│ (poll, geen webhook)
```

`[CONFIRMED — code/docs; ❓ = bevestigd gat]`

---

## 7. GECONSOLIDEERD OPEN-VRAGEN-REGISTER (gededupliceerd, geprioriteerd)

> Alle agent-vragen samengevoegd en ontdubbeld. **LB** = launch-blocker.
> Volgorde: launch-blockers eerst, daarna hoog → middel → laag.

### 7.1 LAUNCH-BLOCKERS

| # | Vraag / gat | Hoe te sluiten | LB |
|---|---|---|---|
| 1 | **Refunds gaan naar in-app saldo i.p.v. originele Stripe-methode** (art. 13 CRD). | Bouw service-role edge function die `stripe.refunds.create` op de originele `payment_intent` aanroept; koppel aan `refund_order`/`cancel_paid_order` + `/withdraw`/`/returns`; UI-teksten "to your balance" → "to your original payment method". Verifieer 14-dagen-eis + opt-in-saldo bij NL-jurist. | **Ja** |
| 2 | **Geen parcel-submit-call** → order=shipped terwijl er fysiek niets vertrekt. | Doorzoek volledige BuckyDrop Solution-API/dashboard op "Submit Parcel"/`pkg/create`/deliver, of bevestig bij Vera of consolidatie+verzending auto loopt zodra PO 9. Tot dan: order NIET op `shipped_international` zetten bij betaling; introduceer `ship_requested`. | **Ja** |
| 3 | **IOSS-registratie ontbreekt + €3/item-douaneheffing (1/7/2026) niet in `pay_shipping`.** | NL-fiscalist: heeft Flowva een geldig IOSS-nummer; geef het mee aan BuckyDrop in de zending. Voeg `c_customs_per_item` (~€3) toe in `pay_shipping` + spiegel in `WarehouseAndHaul.jsx`. | **Ja** |
| 4 | **KvK/niveau-2 hangt aan 2 juli** → zonder EU-handelaarsidentiteit geen geldige BTW/IOSS/RP/imprint. | Launchdatum hard koppelen aan KvK-bevestiging. | **Ja** |
| 5 | **`channel-carriage-list.totalPrice`: CNY (yuan) of fen (×100), en in EUR of CNY?** `haul-shipping` deelt door 7,7; bij EUR/fen rekent productie 7,7× of 100× fout. | Eerste echte productie-respons inspecteren + vergelijken met dashboard-calculator; FX-snapshot per haul + sanity-bound vóór cutover. Expliciete TODO staat al in `haul-shipping/index.ts`. | **Ja** |
| 6 | **`pay_cart` niet idempotent** → dubbelklik/twee tabs → dubbele afschrijving. | Client-side `idempotency-key` per checkout (vgl. `apply_top_up` op `event_id`); `pay_cart` weigert tweede call met dezelfde key; test met dubbele invoke. | **Ja** |

### 7.2 HOOG (vóór of vlak na launch)

| # | Vraag / gat | Hoe te sluiten |
|---|---|---|
| 7 | **Supplement (PO `orderStatus 4`) volledig ongemapt** → orders hangen "to be confirmed". | Webhook-branch op `orderStatus===4` → `awaiting_supplement` + `pay_supplement` RPC + push. Zoek bevestig/pay-supplement-endpoint in volledige Order-docs of bij Vera (staat NIET in de gelezen docs). |
| 8 | **`BUCKY_DOMAIN` defaultet naar `dev.buckydrop.com`** → moet productie. | `npx supabase secrets list` → bevestig `bdopenapi.buckydrop.com`. |
| 9 | **`WEBHOOK_SECRET` placeholder** in de `place_bucky_order`-trigger (`PLAK_HIER_JE_WEBHOOK_SECRET`)? | Inspecteer `trigger_place_bucky_order` in Supabase SQL Editor; test-order door de flow (200 vs 401); `pg_net` aan. |
| 10 | **`price-guard.sql` (price_alert-kolommen) nog niet in prod gedraaid** → guard degradeert naar fail-open. | Draai `price-guard.sql`; verifieer dat `check-cart-prices` geen flag-update-fout meer logt. |
| 11 | **Adres niet op de order bevroren** → `place-bucky-order` leest live uit `user_metadata` → mis-ship bij adreswijziging (A1/A19/A44). | Bevries volledig bezorgadres als snapshot-kolommen op de order in `pay_cart`; `place-bucky-order` leest uit de order, niet uit metadata. |
| 12 | **`haul-shipping` hardcodeert NL** (`country:"Netherlands"`/`NL`) → quote-zone ≠ bestemmingsland voor élke niet-NL klant; `countryCodeFor` valt stil terug op NL. | Lees echt land/`provinceCode` uit `user_metadata` (Friends: host); blokkeer niet-ondersteund land hard i.p.v. NL-fallback; vervang vrij land-veld door gevalideerde dropdown. |
| 13 | **Stripe-events: welke handelt `stripe-webhook` af?** (`checkout.session.expired`, `async_payment_failed`, `charge.dispute.created`, `charge.refunded`). | Lees de event-switch in `functions/stripe-webhook/index.ts`; voeg expired/refunded-handlers + saldo-correctie toe. |
| 14 | **`dispute_status`/`qc_images`/`weight_grams` kolommen bestaan?** Webhook schrijft ernaar, geen migratie-SQL gezien. | Check `information_schema.columns` op de orders-tabel; voeg add-column-migratie toe indien afwezig. |
| 15 | **Item in dispuut kan toch in een parcel** → `dispute_status='pending'` blokkeert state-machine niet (Q1). | Server-side hold-guard op `dispute_status`/`confirmType` in `setOrderStatus`/haul; voeg `held`-rang toe. |
| 16 | **Carrier hardcoded op DHL** (twee files) → dode tracking-link bij 4PX/YunExpress/PostNL. | Sla `channelName`/`channelLogo`/tracking-URL uit `pkg/detail` op; bouw carrier→tracking-URL-map, fallback 17track. |
| 17 | **`TransitTab` pollt niets** → statisch nummer, geen `traceStatus`/`traceNodes`. | Bouw `track-haul`-functie die `query-info` (logistics) pollt en opslaat; bedraad de UI; cron tot delivered. |
| 18 | **`weight_grams` wordt nergens uit order-detail geschreven** → haul blokkeert "Weight missing" (S4). | Order-detail-query na `qc_pending` ophalen (`skuWeight`/dims) → `weight_grams` schrijven; admin-gewicht-override + sanity-ondergrens. |
| 19 | **RLS-beleid op orders/transactions/profiles** sluit cross-user lezen/muteren uit? | Lees `security-hardening.sql`; bevestig `user_id = auth.uid()` op alle drie tabellen. |
| 20 | **Privacy/terms/imprint + cookie-consent + SCC's met BuckyDrop (CN-doorgifte)** ontbreken. | Bouw `/privacy`, `/terms`, `/imprint` (KvK/BTW/contact) + cookie-consent; DPA/SCC met BuckyDrop regelen. |
| 21 | **GPSR Responsible Person + RP-gegevens** niet getoond. | Toon Flowva (NL, importeur) als RP + samenstelling op productpagina; Safety-Gate-procedure. |
| 22 | **Herroeping vereist nu `problem_type`** (`cancel_paid_order`) — onvoorwaardelijk recht te ruim geblokkeerd. | Apart herroepingspad zonder `problem_type`-eis; NL-jurist bevestigt; pad ná `bought` via BD-cancel. |

### 7.3 MIDDEL (operationeel waterdicht maken)

| # | Vraag / gat | Hoe te sluiten |
|---|---|---|
| 23 | **Wallet-leeg-foutcode** bij `shop-order/create` (vs out-of-stock)? `place-bucky-order` behandelt élke numerieke `code` als definitieve afwijzing → onterechte refund. | Forceer wallet-tekort in sandbox of vraag Vera; whitelist van "echt-afwijzing"-codes; live wallet-saldo-bewaking i.p.v. handmatige Wise-buffer. |
| 24 | **Debiteert `shop-order/create` de wallet direct of pas bij confirm (orderStatus 4)?** | Vraag Vera of observeer `payAmount` via order-detail vs wallet-stand rond een testorder. |
| 25 | **CNY-bankoverschrijving (~1%) i.p.v. Alipay (~3%)** mogelijk; begunstigde-gegevens? | Open vraag bij Vera; bevestigen vóór launch om FX-fee te drukken. |
| 26 | **BuckyDrop wallet-balance API-endpoint** bestaat? | Niet in gewired gateway/gelezen docs; doorzoek volledige API of vraag Vera; anders blijft saldo handmatig uit dashboard. |
| 27 | **Dedupliceert BuckyDrop op `partnerOrderNo`?** Bepaalt of blinde retry dubbel inkoopt. | 2× dezelfde `partnerOrderNo` posten in sandbox; zo niet → order-detail-lookup vóór elke retry in `place-bucky-order`. |
| 28 | **Partial-success bij `shop-order/create`** voor multi-line PO's (1 in-stock + 1 sold-out)? | Test-order in sandbox + response inspecteren; nu = volledige fail+refund. |
| 29 | **`refund_order` idempotent** bij dubbele `orderStatus-8`-webhook? | Lees de RPC-guard (`not exists … fee_refund` / al-cancelled); simuleer dubbele webhook. |
| 30 | **Herhaalt BuckyDrop een notify bij non-2xx** (401/500)? | Laat de webhook tijdelijk 500/401 geven op een testmelding; check of dezelfde melding terugkomt in `bucky_notifications`. |
| 31 | **MD5-signature: appSecret begin+eind (doc) vs alleen achteraan (code)?** | Eén echte `sign_ok=false`-notify uit `bucky_notifications` herberekenen in beide varianten. |
| 32 | **`findPO()`/`findPics()` pakken alleen het eerste PO-object** → multi-PO-body dropt de rest (Q3). | Verzamel álle PO-objecten + `picList`s; verwerk per `partnerOrderNo`. |
| 33 | **Geconsolideerd `delivered`-event overschrijft achtergehouden defect-item** (Q2). | Per `partnerOrderNo`: check tegen QC-hold/`dispute_status` vóór `delivered` zetten. |
| 34 | **Value-added/QC API-stuurbaar of puur dashboard?** | `[CONFIRMED]` niet in gelezen order/product-docs; bevestig Service Preselection staat AAN in het account (Vera + dashboard). |
| 35 | **Rekent `channel-carriage-list.totalPrice` fulfilment + ¥2/item>5 + ¥1,5/kg>2kg + de 6 `carriageDetail`-subkosten al in?** | Sandbox-test >5-item/>2kg + douane-kanaal; `totalPrice` vs `price + Σ(subjoinFee…)` vergelijken; Vera. |
| 36 | **Garment-measurement-afwijking triggert auto Notify Po Pending?** | Test-order met bekend mislabel; zo niet → menselijke pre-outbound review. |
| 37 | **Volumetrisch gewicht & `rateType` (001/002/003)** genegeerd in schatting (C-V1/C-V2). | Sla echte L/W/H + `bd_category_code` op bij curatie; lees `chargedType`/`volumeWeight`/`rateType` in de schatting. |
| 38 | **Verzekering (`serviceInsurance`) nooit geactiveerd** (C-INS) → niets te claimen bij verlies. | Lees `serviceInsurance`; forceer `lostInsurance` boven een waardegrens; activeer polis bij submit; `[TO-VERIFY]` activatie/claim-call. |
| 39 | **Buffer-refund-lek** (`pay_shipping` ×1,3) wordt niet teruggestort. | Reconcile geschat↔werkelijk → verschil terug (`transactions type refund`), of zet alle klanten over op `pay_shipping_exact`. |
| 40 | **Split/multi-parcel:** zet één parcel-delivered-webhook de hele order op delivered? | Per-order parcel-aggregatie in `partnerOrderNoList`-afhandeling; pas delivered als álle packages traceStatus 3/pkgNormal 4 zijn. |

### 7.4 LAAG / NICE-TO-HAVE

| # | Vraag / gat | Hoe te sluiten |
|---|---|---|
| 41 | **Per-call API-fees** op `product/detail`/`search` niet in docs. | Bevestig facturatie bij Vera / wallet-transacties; quote-caching overwegen. |
| 42 | **Seller-rang/MOQ-veld** in product-API? | Doorzoek `product`-docs op rang/shop + `beginCount`; opslaan als sourcing-signaal. |
| 43 | **Stock-PO / outbound-from-stock via Solution API** (businessType=2, orderType 3/4, `otCode`)? | Zoek stock/inbound/out-stock-endpoint of vraag Vera; anders handmatig in console (Spoor B). |
| 44 | **Magazijn-opslagbeleid** (gratis termijn, tarief, max, disposal)? | Console + Vera; bepaalt dead-stock-/pre-stocking-risico (S1/S2). |
| 45 | **apply-return / lost-claim / address-modify-endpoints** bestaan? | Niet in gelezen PNG-docset; volledige after-sales-docs of Vera; anders handmatig portaal. |
| 46 | **Account-delete / data-export (AVG art. 15/17)** ontbreekt. | Bouw export + delete-flow met poort (geen open orders, restsaldo eerst uit); anonimiseer fiscale records (7 jr). |
| 47 | **Top-up zonder bovengrens** (AML) + niet-ronde bedragen. | Bovengrens + sanity-check server-side in `create-checkout`. |
| 48 | **Granulaire notificatie-consent** (transactioneel vs marketing). | Per-type consent opslaan; unsubscribe-link in e-mails; e-mail-fallback (`notify-order` stuurt nu alleen push). |

---

## 8. TABLE OF CONTENTS — detailbestanden

> Volledige scenario-uitwerkingen. Paden relatief vanaf de repo-root.

| Sectie | Bestand | Onderwerp |
|---|---|---|
| 01 | [blueprint/01-product-curatie.md](blueprint/01-product-curatie.md) | Productontdekking & curatie (admin) |
| 02 | [blueprint/02-checkout-klant.md](blueprint/02-checkout-klant.md) | Checkout & klant-acties (order-flow) |
| 03 | [blueprint/03-treasury-wallet.md](blueprint/03-treasury-wallet.md) | Treasury & Wallet-funding (de geldstroom) |
| 04 | [blueprint/04-inkoop-leverancier.md](blueprint/04-inkoop-leverancier.md) | Inkoop & Leverancier-reacties (BuckyDrop Supplier PO) |
| 05 | [blueprint/05-domestic-china-qc.md](blueprint/05-domestic-china-qc.md) | Domestic China-handling, QC, foto's & value-added services |
| 06 | [blueprint/06-qc-goedkeuringspoort.md](blueprint/06-qc-goedkeuringspoort.md) | QC-goedkeuringspoort en klant-reacties na QC |
| 07 | [blueprint/07-internationale-verzending.md](blueprint/07-internationale-verzending.md) | Internationale verzending en alle logistiek-failures |
| 08 | [blueprint/08-levering-post.md](blueprint/08-levering-post.md) | Levering en post-levering |
| 09 | [blueprint/09-retouren-refunds.md](blueprint/09-retouren-refunds.md) | Retouren en refunds: de volledige matrix |
| 10 | [blueprint/10-voorraad-doorstroom.md](blueprint/10-voorraad-doorstroom.md) | Voorraad / Stocking Up / Doorstroom |
| 11 | [blueprint/11-geld-fee-ledger.md](blueprint/11-geld-fee-ledger.md) | Geld- en fee-ledger (compleet) + unit-economics |
| 12 | [blueprint/12-failures-techniek.md](blueprint/12-failures-techniek.md) | Failures, exceptions & technische edge cases (Flowva × BuckyDrop) |
| 13 | [blueprint/13-juridisch-compliance.md](blueprint/13-juridisch-compliance.md) | Juridisch & Compliance (EU + BuckyDrop) |
| 14 | [blueprint/14-state-machine-notificaties.md](blueprint/14-state-machine-notificaties.md) | Order state machine en notificaties |
| 15 | [blueprint/15-flowva-friends.md](blueprint/15-flowva-friends.md) | Flowva Friends — group-order edge cases |
| 90 | [blueprint/90-aanvullende-scenarios.md](blueprint/90-aanvullende-scenarios.md) | Aanvullende scenarios deel 1 (completeness-review A1–A44) |
| 91 | [blueprint/91-aanvullende-scenarios.md](blueprint/91-aanvullende-scenarios.md) | Aanvullende scenarios deel 2 (parcel/tracking/kosten/QC-hold/bewijs/treasury) |

---

## 9. KLANTCOMMUNICATIE-MATRIX (Web Push per status)

| Status | Titel | Body |
|---|---|---|
| `purchased` | 🛒 Order placed | We're buying your item for you right now. |
| `bought` | ✅ Item bought! | Your item is paid for and heading to our warehouse. |
| `shipped_local` | 🚚 On its way to our warehouse | Your item is in transit in China. |
| `qc_pending` | 📸 QC photos are ready! | View your item and add it to a parcel in the app. |
| `shipped_international` | ✈️ Shipped to you | Your parcel is on its way to you! |
| `delivered` | 🎉 Delivered! | Your order has arrived. Enjoy! |
| `cancelled` | ↩️ Order refunded | An item was unavailable, so we've refunded it to your balance. |

`[CONFIRMED — notify-order/index.ts:17-25]`. **Geen push** voor: `quote_accepted`, problem_type,
`dispute_status`, supplement (PO 4). **Geen e-mailkanaal** (`notify-order` stuurt alleen Web Push) →
Resend-fallback per status nog te bouwen. `[TO-VERIFY]`

---

*Einde master-document. De volledige scenario-by-scenario uitwerking (happy path + élke faal-/edge-laag,
met wie-betaalt-wat en system action) staat in de 17 detailbestanden in §8.*
