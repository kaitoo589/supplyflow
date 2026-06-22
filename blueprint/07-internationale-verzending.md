# 07 — Internationale verzending en alle logistiek-failures

Deze sectie dekt de volledige internationale-verzendlaag van Flowva: van kanaalkeuze
(`channel-carriage-list`) en de estimate↔actual-reconcile, via DDP/BTW-inclusief tarieven,
carriers, transittijden en tracking (`query-info` / `traceStatus`), tot **elke** denkbare
logistiek-failure: pakket kwijt, vertraagd, beschadigd in transit, douane (heffing/vasthouden/
inbeslagname), return-to-sender, fout/onvolledig adres, partial/split delivery, vastgelopen
tracking, verzekering/claims, landspecifieke issues en verboden goederen.

Per scenario: **Trigger → Flow → Wie betaalt wat → Wat als het faalt (volgende edge-laag) →
System action → tag**. Tags: **[CONFIRMED]** (uit BuckyDrop-docs/Flowva-code/EU-wet),
**[ASSUMED]** (redelijke aanname), **[TO-VERIFY]** (concreet checken — staat HOE/waar erbij).

---

## 0. Grondwaarheid uit docs en code (referentie voor alle scenario's)

Alles hieronder is letterlijk waargenomen; gebruik dit als bron bij de scenario's.

**Endpoints (Logistics + Parcel):** [CONFIRMED]
- `POST /api/rest/v2/adapt/adaptation/logistics/channel-carriage-list` — Shipping Rate Estimate (kanalenlijst + tarief). Body: `item{ lang, country, countryCode(IATA-2), provinceCode, province, detailAddress(≤200), postCode(≤10), productList[{ length, width, height (cm, 2 dec), weight (kg, 3 dec), count, goodsPrice, productNameCn/En, categoryCode (Cat-Level-III, mag niet samen met goodsAttrCode null zijn), categoryName, productCode(SKU), goodsAttrCode, orderBy(price|time|create), orderType(asc|desc) }] }`. Paginatie via `size`/`current`.
- `POST /api/rest/v2/adapt/adaptation/logistics/query-info` — Logistics Tracking Query. Body: `packageCode` (≤20). Geeft `traceStatus` + `traceNodes[]`.
- `POST /api/rest/v2/adapt/adaptation/pkg/detail` — Parcel Details Query. Body: `packageCode`. Geeft `packageStatus`, `packageType`, `pkgNormalStatus`, `pkgAbnormalStatus`, `packageLockStatus`, `packageApprovedStatus`, `signStatus`, `exceptionReason`, `packageWeight`(g), dims, tijdstempels, `declareList[]`, etc.
- `POST /api/rest/v2/adapt/adaptation/order/delivery/update` — Supplement Domestic Logistics. Body: `orderCode`(PO), `deliveryCode`, `deliveryName`, `deliveryNo`. (Domestic CN tracking seller→BD-magazijn aanvullen.)
- `POST /api/rest/v2/adapt/adaptation/logistics/express-company-list` — Domestic Logistics Companies (lijst CN-koeriers). Body: `expressCompanyId`/`deliveryName`/`deliveryCode`/`lang`.

**`traceStatus` (query-info) enum:** [CONFIRMED]
`1` in transit · `2` to be delivered · `3` delivered successfully · `4` delivery failure ·
`5` confiscated at customs · `6` to be returned · `7` returned successfully · `8` return pending ·
`9` no tracking info yet.
Verdere tracking-velden: `traceNo`, `providerTraceNo`, `carrierTraceNo`, `originalCountry`,
`destinationCountry`, `carrierName/Link/Phone/Logo`, `traceNodes[]{ recordTime, pos, description }`,
`originTraceInfo`, `destinationTraceInfo`.

**`packageStatus` (pkg/detail) enum:** [CONFIRMED]
`1` In process · `2` Shipping out · `3` In package · `4` Packed · `5` Verified · `6` Delivered ·
`7` To be confirmed received · `8` Domestic returned · `9` Foreign returned · `10` Cancelled.
- `packageType`: `1` Normal · `2` Temporary · `3` **Abnormal** · `4` **Parcel associated with risks**.
- `pkgNormalStatus`: `1` to be shipped out · `2` shipped out · `3` to be delivered · `4` delivered · `5` cancelled.
- `pkgAbnormalStatus`: `0` Normal · `1` To be returned · `2` Returned · `3` Cancelled.
- `packageLockStatus`: `1` Unlocked · `2` Locked. `packageApprovedStatus`: `1` to be approved · `2` approved · `3` not approved. `signStatus`: `1` not signed · `2` signed. `exceptionReason` (string).

**channel-carriage-list response-velden (per `records[]`):** [CONFIRMED]
`serviceCode`, `serviceName`, `standardServiceCode`, `providerCode/Name`, `logo`,
`cooperationType` (0 outsourced / 1 direct), `minTimeInTransit`/`maxTimeInTransit` (werkdagen),
`weightHighLimit`/`weightLowLimit` (kg), `declareCurrencyCode`, **`declareForbidName`** (verboden
namen, `;`-gescheiden), `declareNum`, `isDeclaration` (0/1), **`isTariffCover`** (0/1 = DDP/tarief
gedekt) + `isTariffCoverDesc`, `calculateWeight`/`parcelTotalWeight`/`volumeWeight`/`dimensionalParam`,
**`chargedType`** (0 actueel · 1 max(actueel,volumetrisch) · 2 max indien zijde > limiet · 3 actueel+volumetrisch indien gewicht > limiet) + `chargedSideLimit`/`chargedWeightLimit`/`longSide`,
`volume`, `price`/`totalPrice` (RMB), `priceChangeTime`, `feature`, **`restrictedGoods`**,
**`rateType`** (template001 first-weight+additional · template002 weight-range · template003 unit-price weight-range),
**`available`** (bool) + **`unavailableReason`**, **`riskList[]`** (`1` exceeding weight limit · `2` exceeding size limit),
`serviceNoticeList[]`, **`serviceInsurance{ delayInsurance(Flag/Code/Name/Charge/Claims), lostInsurance(Flag/Code/Name, premiumRate, min/maxInsuranceAmount) }`**,
`carriageDetail{ price, totalPrice, subjoinFee(fuel), registrationFee, operationFee, takeGoodsFee(pick-up), printReceiptFee, reportTariffFee(customs clearance) }`,
`goodsList[]{ categoryCode, goodsNum, goodsPrice, hsCode, declaredNameEn/Cn, isRecommendDeclared, declaredLevel(0 general/1 sensitive/2 restricted) }`,
**`vatDetail{ isVat(0/1), vatAmount }`**.

**Flowva-code (waargenomen):** [CONFIRMED]
- `haul-shipping/index.ts`: actie `quote` (haalt `channel-carriage-list`, parse't naar EUR-kanalen) en `pay` (her-quote server-side, kiest kanaal, RPC `pay_shipping_exact`). Prijs komt **server-side**, client stuurt nooit prijs mee. VAT-regel: `taxInclusive` (uit `isTariffCover===1 || vatDetail.isVat===1`) ⇒ 0 BTW erbij, anders 21%. `isSandbox` flag (dev.buckydrop.com geeft nep-kanalen). Vereist order-status `qc_pending` + `weight_grams` per item, anders `needWeight`.
- `buckydrop-webhook/index.ts`: MD5-sign verify; mapt PO `orderStatus` (5→bought, 6→shipped_local, 9→qc_pending, 11→shipped_international, 12→delivered; **8→`refund_order`** + cancel) en parcel `pkgNormalStatus` (2/3→shipped_international, 4→delivered). RANK voorkomt terugzetten. Defect-foto's (`picList`) → `orders.qc_images` + `dispute_status:pending` + `problem_type`. Alle calls in `bucky_notifications` gelogd.
- `place-bucky-order/index.ts`: maakt PO via `order/shop-order/create`; bij gestructureerde afwijzing (numerieke `code`) → `refund_order` + cancel; bij netwerkfout → `bd_error` flag (geen refund). Idempotent op `shop_order_no`.

**Flowva order-statussen:** `requested → quote_sent → quote_accepted → purchased → bought →
shipped_local → qc_pending → shipped_international → delivered` (+ `cancelled`). [CONFIRMED uit code]

**Geldmodel (vastgesteld in projectbrief, niet in deze docs):** [CONFIRMED projectbrief]
Klant betaalt verzending in EUR (Stripe) → uitbetaling Wise/Revolut → BuckyDrop-wallet (CNY,
prepaid). channel-carriage-list rekent in **RMB**; `haul-shipping` rekent om met `CNY_PER_EUR`
(env, default 7.7) × `FX_MARGIN` 1.03.

---

## A. HAPPY PATH

### A1. Kanaalkeuze: quote ophalen en tonen
**Trigger:** Alle items van het pakket staan op `qc_pending` (QC klaar) en hebben `weight_grams`; klant opent de verzendkeuze (of app her-quote't bij betaling).
**Flow:**
1. App roept `haul-shipping` actie `quote` aan met `orderIds[]` (klant-JWT).
2. Server laadt orders (alleen die van de gebruiker, allen `qc_pending`, allen met gewicht), bouwt `productList` (default doos 20×20×10 cm — zie failure A1.f), adres uit `user_metadata`.
3. `channel-carriage-list` → `records[]`; `parseChannels` filtert op `available && serviceCode`, sorteert op prijs oplopend, rekent RMB→EUR.
4. App toont kanalen met naam, EUR-prijs, `minDays`–`maxDays` (werkdagen), `taxInclusive`-badge.
**Wie betaalt wat:** Nog niemand — dit is een offerte. De getoonde prijs is de internationale vracht (`totalPrice` RMB → EUR).
**Wat als het faalt:**
- **(a) Geen kanalen** (`records` leeg / allen `available:false`): toon "geen verzendoptie nu" + fallback-schatting. Reden zit in `unavailableReason`/`riskList`. → zie B1/B2.
- **(b) Sandbox**: `isSandbox:true` → app valt terug op interne schatting tot productie-cutover. [CONFIRMED code]
- **(c) Item zonder gewicht**: server geeft `needWeight:true` → app vraagt QC-gewicht eerst (komt uit Garment Measurement / `pkg/detail.packageWeight`).
- **(d) FX-koers verschoven**: `FX_MARGIN 1.03` vangt kleine drift; grote drift = onderdekking → [TO-VERIFY] periodiek `CNY_PER_EUR` actualiseren (env of live FX-feed).
- **(e) Prijs verandert tussen quote en pay**: `priceChangeTime` in response; pay her-quote't server-side, dus klant betaalt altijd de actuele prijs (kan afwijken van getoonde) → toon "prijs geüpdatet, bevestig opnieuw". [CONFIRMED code: pay her-quote't]
- **(f) Verkeerde dims/categorie**: default doos + `categoryCode "1"` → fout volumetrisch gewicht/tarief. → [TO-VERIFY] echte dims + Cat-Level-III opslaan bij curatie.
**System action:** `POST channel-carriage-list` → `parseChannels` → `json({channels, isSandbox, totalWeightG})`. Geen status-wijziging.
**Tag:** [CONFIRMED] (endpoint + code), dims/categorie-default [TO-VERIFY].

### A2. Verzending afrekenen (pay) en label/parcel aanmaken
**Trigger:** Klant kiest een `serviceCode` en betaalt.
**Flow:**
1. App roept `haul-shipping` actie `pay` met `orderIds[]` + `serviceCode`.
2. Server her-quote't, vindt het kanaal; bereken `shipping = priceEur`, `vat = taxInclusive ? 0 : shipping*0.21`, `amount = shipping+vat`.
3. RPC `pay_shipping_exact(p_uid, p_order_ids, p_amount, p_shipping, p_vat, p_service_code, p_service_name)` — int saldo/Stripe afboeken, exact, geen buffer.
4. [TO-VERIFY] Daarna moet het pakket bij BuckyDrop **ingediend/verzonden** worden met het gekozen kanaal (parcel-submit/"deliver" stap). De getoonde docs dekken alleen quote/track/detail; de submit-call zelf staat niet in de gelezen logistics-PNG's → check Order-doc (`order/...`) of BuckyDrop-dashboard "Submit Parcel".
**Wie betaalt wat:** Klant betaalt **internationale vracht + (eventueel) 21% BTW** in EUR. Bij `isTariffCover=1`/DDP-lijn zit BTW/duty al in de prijs (geen dubbele BTW). Flowva vult later de wallet (CNY) → BuckyDrop trekt de vracht van de wallet.
**Wat als het faalt:**
- **(a) Kanaal niet meer beschikbaar**: `channels.find` faalt → `400 "no longer available"` → klant herkiest (A1). [CONFIRMED code]
- **(b) RPC-fout (saldo/atomiciteit)**: `500` met `error.message`; geen parcel ingediend; klant niet dubbel belast. [CONFIRMED code]
- **(c) Betaling ok maar parcel-submit faalt**: geld geïnd, geen verzending → **moet** automatische refund of retry triggeren. → [TO-VERIFY] submit-stap met idempotentie + compensatie (zelfde patroon als place-bucky-order).
- **(d) Dubbel betalen**: idempotentie op `orderIds` in `pay_shipping_exact` vereist. → [TO-VERIFY] of RPC dubbele afrekening blokkeert.
**System action:** `haul-shipping` `pay` → `pay_shipping_exact` → [TO-VERIFY parcel-submit] → status blijft `qc_pending` tot webhook `shipped_international`.
**Tag:** [CONFIRMED] pay/VAT-logica; parcel-submit [TO-VERIFY].

### A3. Internationaal onderweg → afgeleverd (tracking happy path)
**Trigger:** BuckyDrop verzendt het pakket internationaal; carrier scant.
**Flow:**
1. **Notify Parcel Status**-webhook: `pkgNormalStatus 2/3` → Flowva `shipped_international`; `4` → `delivered`. (PO `orderStatus 11` → `shipped_international`, `12` → `delivered` via PO-webhook.) [CONFIRMED code]
2. App pollt/queriet `query-info(packageCode)` voor live nodes: `traceStatus 1` in transit → `2` to be delivered → `3` delivered successfully; toont `traceNodes[]` (recordTime/pos/description) + carrier + `carrierTraceNo`.
3. Bij delivered: `signStatus 2` (signed) / `pkg/detail.packageStatus 6`.
**Wie betaalt wat:** Niets extra (vracht al betaald in A2), tenzij reconcile-supplement (zie C1) of douaneheffing bij niet-DDP (zie F-reeks).
**Wat als het faalt:** Elke afwijking van dit pad = secties B–H.
**System action:** webhook `setOrderStatus`; UI `query-info`. Push-melding bij statuswissel.
**Tag:** [CONFIRMED].

---

## B. KANAAL- EN GESCHIKTHEIDS-FAILURES (vóór verzending)

### B1. Geen enkel kanaal beschikbaar voor bestemming/inhoud
**Trigger:** `channel-carriage-list` geeft 0 bruikbare `records` (allen `available:false` of leeg).
**Flow:** `parseChannels` → lege lijst; app toont "geen verzendoptie". Lees `unavailableReason` per record voor de echte reden.
**Wie betaalt wat:** Niemand; nog niet verzonden.
**Wat als het faalt:** Klant zit vast met betaald (QC-klaar) product. → opties: (a) ander/duurder kanaal, (b) wachten op heropening lijn, (c) refund verzending niet van toepassing (nog niet betaald), maar product-refund/opslag-policy. → [TO-VERIFY] hoe lang BD het pakket gratis bewaart (`closeTime` = cut-off ontvangst in pkg/detail).
**System action:** `quote` → lege channels → UI-fallback; manueel via ai-ops-hud opvolgen.
**Tag:** [CONFIRMED] (veld `unavailableReason`/`available`).

### B2. Pakket overschrijdt gewicht- of maatlimiet van het kanaal
**Trigger:** `riskList` bevat `1` (exceeding weight limit) of `2` (exceeding size limit); of gewicht buiten `weightLowLimit`–`weightHighLimit`.
**Flow:** Kanaal valt af (of `available:false`); kies kanaal met hogere `weightHighLimit`/`chargedSideLimit`. Volumetrisch gewicht telt mee via `chargedType` (1/2/3) + `volumeWeight`/`calculateWeight`.
**Wie betaalt wat:** Klant betaalt op basis van `calculateWeight` (max van actueel vs volumetrisch), niet alleen actueel gewicht → grote lichte dozen kosten meer. **Belangrijk economisch punt** (rijmt met bundel-strategie €20–40).
**Wat als het faalt:** Geen enkel kanaal accepteert maat → pakket splitsen (meerdere parcels) of herverpakken. → [TO-VERIFY] BD repack/split-flow + extra fulfilment ¥9,9/parcel per extra parcel.
**System action:** UI filtert op `riskList`/limieten; toon waarschuwing; eventueel split.
**Tag:** [CONFIRMED] (riskList + chargedType + limieten).

### B3. Verboden / restricted goederen tegengehouden vóór verzending
**Trigger:** Inhoud staat in `declareForbidName` van het kanaal, of `restrictedGoods` / `goodsList.declaredLevel 2 (restricted)` markeert het; of `packageType 4` (parcel associated with risks) / `packageRisk 2`.
**Flow:** Kanaal weigert die inhoud → filter kanalen die het wél mogen; mogelijk geen enkel kanaal → BD houdt parcel vast (`packageLockStatus 2` Locked / `packageApprovedStatus 3` not approved, `exceptionReason`).
**Wie betaalt wat:** Geen vracht (niet verzonden). Bij afkeuring product mogelijk niet-retourneerbaar naar seller → product-refund-policy. **Wettelijk**: refund naar originele betaalmethode (Stripe), niet in-app (memo-aandachtspunt).
**Wat als het faalt:** Klant betwist → dispute. Defecte/afgekeurde-foto's komen via Notify Po Pending (`picList` Required). → `dispute_status:pending`.
**System action:** `pkg/detail` lezen (`packageApprovedStatus`, `packageLockStatus`, `exceptionReason`, `packageRisk`); webhook zet foto's/dispute; eventueel `refund_order`.
**Tag:** [CONFIRMED] (declareForbidName, restrictedGoods, packageType 4, declaredLevel, lock/approved status).

### B4. Verzendkanaal vereist douaneverklaring / HS-codes ontbreken
**Trigger:** `isDeclaration 1` en/of `goodsList` mist `hsCode`/`declaredNameEn`/`declaredLevel`; `isRecommendDeclared`.
**Flow:** Vul declaratiedata aan (HS-code, EN-naam, declared amount/currency uit `declareList`) vóór submit; `declareNum` = max aantal declarabel.
**Wie betaalt wat:** `reportTariffFee` (customs clearance fee) zit in `carriageDetail` → klant. Bij DDP (`isTariffCover 1`) ook duty/VAT inbegrepen.
**Wat als het faalt:** Onjuiste/te lage declaratie → douane houdt vast / boete / inbeslagname → sectie F. Onderdeclaratie = juridisch risico Flowva (transparantie-merk → declareer correct = troef).
**System action:** declaratie meesturen bij submit; `pkg/detail.packageDeclareStatus` checken (1 undeclared / 2 declared).
**Tag:** [CONFIRMED] (isDeclaration, goodsList, declareList, packageDeclareStatus).

---

## C. ESTIMATE ↔ ACTUAL RECONCILE (supplement / refund)

### C1. Werkelijk gewicht/volume wijkt af van schatting → supplement bijbetalen
**Trigger:** Na inweeg in BD-magazijn (`pkg/detail.packageWeight` g, `packageLength/Width/Height` van WMS) is `calculateWeight` hoger dan bij quote (default doos of fout opgegeven gewicht). PO `orderStatus 4` (to be confirmed incl. supplementary payment).
**Flow:**
1. Webhook/`pkg/detail` toont hoger billing-gewicht → vracht-delta.
2. PO `orderStatus 4` = wacht op aanvullende betaling. App genereert een supplement-charge (delta in EUR, server-side her-quote).
3. Klant betaalt supplement (Stripe) → wallet dekt extra CNY-vracht → PO bevestigd → verzending gaat door.
**Wie betaalt wat:** Klant betaalt het verschil (actueel − geschat), incl. eventueel `subjoinFee` (fuel), `overweight` ¥1,5/kg >2kg en ¥2/item >5 (BD-fulfilment, projectbrief).
**Wat als het faalt:**
- **(a) Klant betaalt supplement niet**: PO blijft `orderStatus 4` → parcel niet verzonden → na `closeTime` cut-off mogelijk geannuleerd/teruggestuurd. → product-refund of opslag-policy. → [TO-VERIFY] BD-timeout op `orderStatus 4`.
- **(b) Werkelijk LICHTER dan geschat**: klant te veel betaald → refund delta naar Stripe (origineel). Let op bekende VAT-buffer-refund-lek (audit #4): refund moet naar originele betaalmethode, niet in-app.
- **(c) Supplement-call faalt**: retry; geen verzending tot betaald.
**System action:** `pkg/detail` (gewicht/dims) → her-quote `channel-carriage-list` → supplement-charge (Stripe) of refund-RPC → PO `orderStatus 4` afhandelen. → [TO-VERIFY] welke API/dashboard-stap de supplement-betaling aan BD bevestigt.
**Tag:** [CONFIRMED] (PO orderStatus 4 = supplementary payment; pkg/detail weight/dims), supplement-confirm-call [TO-VERIFY].

### C2. DDP / BTW-inclusief lijnen — geen dubbele BTW
**Trigger:** Gekozen kanaal heeft `isTariffCover 1` (tariff covered = DDP) of `vatDetail.isVat 1`.
**Flow:** `haul-shipping` zet `taxInclusive=true` → `vat=0` (BTW/duty zit al in `totalPrice`). Bij `isTariffCover 0` + `vatDetail.isVat 0` → Flowva rekent 21% NL-BTW erbovenop.
**Wie betaalt wat:** Bij DDP betaalt klant alles vooraf (incl. EU-duty/BTW) → geen verrassingsheffing bij levering. Bij niet-DDP: klant kan bij levering door koerier/douane apart aangeslagen worden → sectie F2.
**Wat als het faalt:**
- **(a) DDP-lijn maar douane heft tóch**: zeldzaam; claim bij BD/carrier (DDP-belofte) → [TO-VERIFY] BD's DDP-garantie/refund bij dubbele heffing.
- **(b) BTW-grondslag fout**: `vatDetail.vatAmount` (Yuan) gebruiken als referentie i.p.v. plat 21% op vracht. → [TO-VERIFY] of NL-BTW over goederenwaarde+vracht moet (IOSS), niet alleen vracht. Belangrijk voor correcte BTW-afdracht.
**System action:** `isTariffCover`/`vatDetail.isVat` → `taxInclusive`-tak in `haul-shipping`.
**Tag:** [CONFIRMED] (isTariffCover, vatDetail, code-tak), IOSS-grondslag [TO-VERIFY].

### C3. Brandstoftoeslag / extra fees in carriageDetail
**Trigger:** `carriageDetail` bevat `subjoinFee` (fuel), `registrationFee`, `operationFee`, `takeGoodsFee`, `printReceiptFee`, `reportTariffFee`.
**Flow:** `totalPrice` = som incl. deze fees → al in `priceEur`. Voor transparantie kan UI de breakdown tonen.
**Wie betaalt wat:** Klant (zit in vracht). Transparantie-troef: toon breakdown.
**Wat als het faalt:** Fee verandert na quote (`priceChangeTime`) → pay her-quote vangt het op.
**System action:** parse `carriageDetail` → optioneel breakdown-UI.
**Tag:** [CONFIRMED] (carriageDetail-velden).

---

## D. TRACKING-FAILURES

### D1. Tracking blijft hangen op "no tracking info yet"
**Trigger:** `query-info.traceStatus 9` (no tracking info yet) langer dan X dagen ná verzending.
**Flow:** Poll `query-info`; `traceNodes` leeg. Onderscheid: net verzonden (normaal) vs vastgelopen (>5–7 werkdagen). Vergelijk met `pkg/detail.outboundTime`/`deliveryTime`.
**Wie betaalt wat:** Nog niemand extra; risico op verlies-claim later (D3).
**Wat als het faalt:** Na drempel → behandel als mogelijk kwijt (D3) of vertraagd (D2). Open ticket bij BD/carrier.
**System action:** `query-info`; timer op `outboundTime`; UI "tracking nog niet beschikbaar".
**Tag:** [CONFIRMED] (traceStatus 9), drempel [ASSUMED].

### D2. Pakket vertraagd (transit > maxTimeInTransit)
**Trigger:** Werkelijke transit > `maxTimeInTransit` (werkdagen) zonder afleverscan; `traceStatus 1` blijft, of `4` delivery failure.
**Flow:** Toon vertraging; check `traceNodes` laatste `pos`/`description`; check `serviceInsurance.delayInsurance` (`delayInsuranceFlag 1` = gedekt, `delayInsuranceClaims` = vergoeding).
**Wie betaalt wat:** Geen extra kosten klant; bij delay-insurance + claim keert BD/insurer uit. EU-recht: bij ernstige vertraging mag klant ontbinden/terugbetaling vragen.
**Wat als het faalt:** Vertraging → klant eist refund. → refund-policy + `delayInsuranceClaims`. Indien geen insurance → Flowva draagt het (goodwill) of claimt bij carrier.
**System action:** `query-info` (`maxTimeInTransit` vergelijken); `pkg/detail`; eventueel claim + `refund_order`.
**Tag:** [CONFIRMED] (maxTimeInTransit, delayInsurance), refund-policy [ASSUMED].

### D3. Pakket KWIJT (verloren in transit)
**Trigger:** `traceStatus 4` (delivery failure) gevolgd door geen voortgang; of lang `traceStatus 1`/`9`; carrier bevestigt verlies; nooit `signStatus 2`.
**Flow:**
1. Bevestig via `query-info`/`pkg/detail` (geen `finishTime`/`signTime`).
2. Check `serviceInsurance.lostInsurance` (`lostInsuranceFlag 1` = gedekt, `premiumRate`, `min/maxInsuranceAmount`).
3. Dien verliesclaim in bij BD/carrier (binnen claim-venster).
**Wie betaalt wat:** Bij lost-insurance keert insurer uit (tot `maxInsuranceAmount`, Yuan). **Niet-verzekerde** pakketten: Flowva draagt het verlies of claimt bij carrier. Klant krijgt **volledige** refund (product + vracht) → naar originele betaalmethode (Stripe).
**Wat als het faalt:**
- **(a) Claim afgewezen** (buiten venster / onverzekerd): Flowva eet het verlies; klant toch refunden (klantbehoud + EU-recht: niet-geleverd = geen levering).
- **(b) Onderverzekerd**: `maxInsuranceAmount` < productwaarde → restschade voor Flowva.
- **(c) "Geleverd" maar klant ontkent**: `signStatus 2` maar geen ontvangst → POD/handtekening opvragen → sectie D4.
**System action:** `query-info` + `pkg/detail`; claim-flow (BD); `refund_order` (→ aanpassen naar Stripe-refund). → [TO-VERIFY] BD lost-claim-endpoint/dashboard + claim-deadline.
**Tag:** [CONFIRMED] (lostInsurance, traceStatus), claim-procedure [TO-VERIFY].

### D4. "Afgeleverd" maar klant heeft niets ontvangen (POD-dispuut)
**Trigger:** `traceStatus 3` delivered / `signStatus 2` signed, maar klant meldt niet-ontvangst.
**Flow:** Vraag carrier-POD (handtekening/GPS/foto via `traceNodes`/`destinationTraceInfo`); check `pos` van laatste node; eventueel buren/afhaalpunt.
**Wie betaalt wat:** Als carrier POD heeft → mogelijk geen refund (geleverd). Geen POD → behandel als kwijt (D3) → refund Stripe.
**Wat als het faalt:** Fraude-risico (klant liegt) vs echte mislevering → handmatige beoordeling in ai-ops-hud; insurance dekt dit meestal niet.
**System action:** `query-info` (nodes/POD); dispute-beoordeling; conditionele `refund_order`.
**Tag:** [CONFIRMED] (signStatus, traceStatus, traceNodes), POD-detail [TO-VERIFY].

### D5. Tracking toont verkeerde bestemming / carrier-mismatch
**Trigger:** `destinationCountry` ≠ klantland, of `carrierTraceNo`/`providerTraceNo` klopt niet, of routing fout.
**Flow:** Vergelijk `originalCountry`/`destinationCountry` met order-adres; check `originTraceInfo` vs `destinationTraceInfo`.
**Wie betaalt wat:** Mis-routing = carrier/BD-fout → zij dragen herroutering; geen klantkosten.
**Wat als het faalt:** Pakket gaat naar verkeerd land → return-to-sender (E2) of verlies (D3).
**System action:** `query-info` cross-check; ticket BD.
**Tag:** [CONFIRMED] (destinationCountry, carrierTraceNo).

---

## E. RETOUREN & RETURN-TO-SENDER (internationale richting)

### E1. EU-herroeping: klant stuurt geleverd pakket terug
**Trigger:** Klant gebruikt `/withdraw` of `/returns` binnen 14 dagen (EU-herroepingsrecht).
**Flow:**
1. Flowva opent return (BD `apply-return` → `returnFlowCode`).
2. Klant verstuurt zelf terug (internationale retourzending).
3. `traceStatus 6` to be returned → `8` return pending → `7` returned successfully; `pkg/detail.pkgAbnormalStatus 1→2`, `packageStatus 9` (foreign returned).
**Wie betaalt wat:** **Klant draagt retourkosten** (binnen de wet, mits vooraf gemeld). Flowva refundt productprijs (en oorspronkelijke standaardverzending) → **naar originele betaalmethode (Stripe)**, niet in-app (huidige `refund_order` = in-app → moet aangepast; memo).
**Wat als het faalt:**
- **(a) Retour gaat zelf verloren**: bewijs van verzending bij klant; risico ligt bij klant tot ontvangst (mits correct geïnformeerd). → [TO-VERIFY] BD-bevestiging van retour-ontvangst (`traceStatus 7`).
- **(b) Retour beschadigd terug**: waardevermindering mag verrekend (EU). → QC-foto's bij ontvangst als bewijs.
- **(c) Buiten 14 dagen**: geen herroeping; alleen garantie/defect-route (G-reeks).
**System action:** BD `apply-return` → `returnFlowCode`; `query-info` retour-tracking (`traceStatus 6/7/8`); `refund_order` (→ Stripe).
**Tag:** [CONFIRMED] (traceStatus 6/7/8, pkgAbnormalStatus, packageStatus 9, EU-recht), apply-return-endpoint [TO-VERIFY in Order-docs].

### E2. Return-to-sender (carrier/douane stuurt terug)
**Trigger:** `traceStatus 6` to be returned zónder klant-initiatief (onbestelbaar, geweigerd door douane/ontvanger, adres fout); `pkg/detail.packageStatus 8` domestic returned / `9` foreign returned.
**Flow:** Carrier retourneert naar BD-magazijn/seller; `pkgAbnormalStatus 1→2`.
**Wie betaalt wat:** Retourvracht meestal voor verzender (Flowva) → kosten + product terug zonder levering. Klant krijgt refund (niet geleverd) → Stripe.
**Wat als het faalt:** Pakket onbestelbaar én niet retourneerbaar → afgeschreven (`packageStatus 10` cancelled). → Flowva-verlies; refund klant.
**System action:** webhook/`pkg/detail` `packageStatus 8/9`, `traceStatus 6`; `refund_order`; oorzaak-analyse (adres → E3).
**Tag:** [CONFIRMED] (traceStatus 6, packageStatus 8/9, pkgAbnormalStatus).

### E3. Fout / onvolledig adres
**Trigger:** Adres in `user_metadata` incompleet (`place-bucky-order` valt terug op `"-"` voor stad/adres; `haul-shipping` op `"NA"`/`"0000AA"` postcode); carrier kan niet bezorgen → `traceStatus 4` delivery failure.
**Flow:** Valideer adres bij submit (postcode-regex, verplichte velden); carrier biedt soms adrescorrectie/herbezorging.
**Wie betaalt wat:** Adrescorrectie/herbezorging soms tegen fee (carrier) → klant (klantfout). Bij definitieve mislukking → return-to-sender (E2).
**Wat als het faalt:** Default `"-"`/`"NA"` veroorzaakt **quote met verkeerde zone** én onbezorgbaarheid → structureel: adres verplicht + gevalideerd vóór quote/submit. → [TO-VERIFY] adresvalidatie afdwingen (nu fallback-strings).
**System action:** adresvalidatie pre-submit; `query-info traceStatus 4` → klant adres laten bevestigen; herbezorging of E2.
**Tag:** [CONFIRMED] (fallback-strings in code, traceStatus 4), validatie-fix [TO-VERIFY].

---

## F. DOUANE-FAILURES

### F1. Douane houdt pakket vast (inspectie/documentatie)
**Trigger:** `query-info traceStatus 1` blijft hangen met node `pos`/`description` = customs hold; geen voortgang.
**Flow:** Douane vraagt extra info/declaratie/betaling; BD/carrier of ontvanger levert aan. Check `declareList`/`goodsList.declaredLevel`.
**Wie betaalt wat:** Inspectie-/opslagkosten variëren. Bij niet-DDP kan ontvanger info/betaling moeten leveren.
**Wat als het faalt:** Niet opgelost binnen termijn → inbeslagname (F3) of return-to-sender (E2).
**System action:** `query-info` node-analyse; klant informeren; eventueel aanvullende declaratie.
**Tag:** [CONFIRMED] (traceStatus 1 + nodes, declareList), termijnen [ASSUMED].

### F2. Douaneheffing / invoer-BTW bij levering (niet-DDP)
**Trigger:** Kanaal `isTariffCover 0` → bestemmingsland heft duty/BTW; carrier int bij ontvanger.
**Flow:** Klant betaalt heffing aan koerier/douane vóór vrijgave.
**Wie betaalt wat:** **Klant** (bij niet-DDP). Transparantie: meld vooraf "mogelijk invoerheffing". Bij DDP (`isTariffCover 1`): al inbegrepen → geen verrassing.
**Wat als het faalt:**
- **(a) Klant weigert heffing**: pakket niet vrijgegeven → return-to-sender (E2) of inbeslagname (F3).
- **(b) Dubbele BTW** (DDP + lokale heffing): claim bij BD/carrier → C2(a).
- **(c) Onverwachte hoge heffing**: klantontevredenheid → liefst DDP-kanalen aanbieden (`isTariffCover 1`) als default.
**System action:** kanaalkeuze toont `isTariffCover`/`isTariffCoverDesc`; UI-waarschuwing bij niet-DDP; `vatDetail.vatAmount` als referentie.
**Tag:** [CONFIRMED] (isTariffCover, vatDetail, reportTariffFee).

### F3. Pakket in beslag genomen door douane
**Trigger:** `query-info traceStatus 5` (confiscated at customs).
**Flow:** Pakket definitief weg (verboden goed, valse declaratie, onbetaalde heffing). Geen levering, geen retour.
**Wie betaalt wat:** Verlies. Oorzaak bepaalt aansprakelijkheid: Flowva-declaratiefout → Flowva draagt + refund klant (Stripe). Klant-veroorzaakt (weigerde heffing/verboden artikel besteld) → policy. Insurance dekt confiscatie meestal **niet**.
**Wat als het faalt:** Geen verhaal mogelijk → afschrijven; klant refunden voor klantbehoud + EU (niet geleverd). Herhaling voorkomen: `declareForbidName`/`restrictedGoods` pre-check (B3).
**System action:** `query-info traceStatus 5` → markeer verloren → `refund_order` (→ Stripe) + interne analyse.
**Tag:** [CONFIRMED] (traceStatus 5 = confiscated at customs).

### F4. Verboden goederen tegengehouden in transit (na verzending)
**Trigger:** Kanaal-`restrictedGoods`/`declareForbidName` overtreden, ontdekt onderweg → `traceStatus 5` of `4`, of `packageType 4` (risk).
**Flow:** Pakket gestopt/teruggestuurd/inbeslag. Idealiter vóóraf gevangen in B3.
**Wie betaalt wat:** Zie F3/E2. Flowva-curatie moet verboden goed weren (transparantie-merk).
**Wat als het faalt:** Reputatie/juridisch risico → strikte category/declareForbid-validatie bij productcuratie.
**System action:** pre-check `declareForbidName`/`restrictedGoods` bij A1; post: `query-info`/`pkg/detail.packageType 4`.
**Tag:** [CONFIRMED] (restrictedGoods, declareForbidName, packageType 4).

---

## G. SCHADE & DEFECT (in transit / bij ontvangst)

### G1. Pakket beschadigd in transit
**Trigger:** Klant meldt schade bij ontvangst (`traceStatus 3` delivered maar product kapot).
**Flow:**
1. Klant levert foto's; vergelijk met verplichte QC-foto's (Standard Product Photos ¥2/SKU) → bewijs dat schade transit-veroorzaakt is (was heel vóór verzending).
2. Open dispute → return/replacement (E1) of refund.
3. Check `serviceInsurance.lostInsurance`/delay (schade meestal onder verlies-/schadeverzekering indien aanwezig).
**Wie betaalt wat:** Transit-schade door carrier → claim bij BD/carrier/insurer. Anders Flowva-goodwill. Klant betaalt niets.
**Wat als het faalt:**
- **(a) Geen schadeverzekering**: Flowva draagt of claimt carrier.
- **(b) Onduidelijk of schade pre-bestond**: QC-foto's beslissen → vandaar het verplichte QC-pakket als troef.
**System action:** dispute (`dispute_status`); QC-foto's vergelijken; claim; `refund_order`/replacement.
**Tag:** [CONFIRMED] (QC-pakket projectbrief, serviceInsurance), schade-claim-endpoint [TO-VERIFY].

### G2. Defect ontdekt bij QC vóór internationale verzending (Notify Po Pending)
**Trigger:** BD QC vindt defect → **Notify Po Pending** webhook met `confirmType` + `picList` (beide Required → defect-foto gegarandeerd mee). PO mogelijk `orderStatus 4`.
**Flow:** Webhook zet `orders.qc_images = picList`, `dispute_status:pending`, `problem_type`. Flowva/klant beslist: vervangen, refunden, of toch verzenden.
**Wie betaalt wat:** Defect = seller-fout → BD-replacement/refund vóór verzending → geen internationale vracht verspild. Klant betaalt niets extra.
**Wat als het faalt:** Geen vervanging beschikbaar → refund (Stripe) + cancel (PO `orderStatus 8` → webhook `refund_order`).
**System action:** Notify Po Pending → `qc_images`+`dispute_status` (code); beslis-RPC; bij cancel PO 8 → `refund_order`.
**Tag:** [CONFIRMED] (Notify Po Pending velden, webhook-code, PO orderStatus 4/8).

---

## H. SPLIT / PARTIAL / LANDSPECIFIEK / OVERIG

### H1. Partial / split delivery (meerdere parcels per order)
**Trigger:** Order/bundel verzonden in meerdere parcels (gewicht/maat-split B2, of multi-item Friends-order); meerdere `packageCode`s, `pkg/detail.packageQuantity > 1`.
**Flow:** Elk parcel eigen `query-info`/tracking. Order pas `delivered` als **alle** parcels `traceStatus 3`/`pkgNormalStatus 4`. Webhook `partnerOrderNoList[]` koppelt parcel→orders.
**Wie betaalt wat:** Elk extra parcel = extra fulfilment ¥9,9 (projectbrief) → meegerekend in vracht. Klant betaalt totaal.
**Wat als het faalt:**
- **(a) Eén parcel kwijt, andere aankomt**: partial refund voor missend deel (D3) → Stripe.
- **(b) Order-status zet voortijdig op delivered**: RANK-logica + per-parcel-check vereist → order pas delivered bij álle parcels. → [TO-VERIFY] of webhook meerdere parcels per order correct aggregeert (nu zet één parcel-`delivered`-webhook de order op delivered).
**System action:** `query-info` per `packageCode`; aggregatie-logica order-status; `refund_order` partial.
**Tag:** [CONFIRMED] (packageQuantity, partnerOrderNoList), aggregatie-gat [TO-VERIFY].

### H2. Landspecifieke issues (buiten NL: BE/DE/FR/UK/ES/IT/AT/LU/IE/PT/DK/SE + Friends-host)
**Trigger:** Bestemming ≠ NL; `place-bucky-order` mapt landnaam→IATA (`COUNTRY_CODES`); onbekend land → fallback **NL** (fout!). UK = post-Brexit douane (altijd duty/BTW).
**Flow:** Verzendzone/tarief/transit verschilt per `countryCode`; `channel-carriage-list` met juiste IATA-code. Friends-groeps-order: pakket naar **host** (`host_user_id`), niet individueel lid.
**Wie betaalt wat:** Per land verschillende vracht + (niet-DDP) lokale heffing. UK/non-EU: vrijwel altijd invoer-BTW (F2).
**Wat als het faalt:**
- **(a) Onbekend land → fallback NL**: verkeerde zone/IATA → fout tarief én onbezorgbaar. → [TO-VERIFY] onbekend land hard blokkeren i.p.v. NL-fallback.
- **(b) `haul-shipping` hardcodeert `country:"Netherlands"`/`countryCode:"NL"`**: quote klopt niet voor niet-NL klanten. → [TO-VERIFY] land uit metadata gebruiken in haul-shipping (nu hardcoded NL — `addressOf` zet altijd NL).
- **(c) Provincie ontbreekt**: `provinceCode` fallback stad/NL → mogelijk fout tarief.
**System action:** `countryCodeFor`/`COUNTRY_CODES`; `channel-carriage-list` per land; Friends host-adres.
**Tag:** [CONFIRMED] (COUNTRY_CODES map, host_user_id, NL-hardcode in haul-shipping), fallback-fixes [TO-VERIFY].

### H3. Verzekering & claims (overkoepelend)
**Trigger:** Verlies (D3), schade (G1), vertraging (D2) bij een kanaal met `serviceInsurance`.
**Flow:** Bij quote/submit beslissen of `delayInsurance`/`lostInsurance` wordt afgenomen (`premiumRate`, `min/maxInsuranceAmount`, `delayInsuranceCharge`). Bij incident: claim → `delayInsuranceClaims`/uitkering tot `maxInsuranceAmount`.
**Wie betaalt wat:** Premie (klein) optioneel doorbelasten aan klant of door Flowva gedragen voor hoogwaardige bundels (€20–40). Claim-uitkering dekt (deel van) het verlies.
**Wat als het faalt:** Onverzekerd of onderverzekerd → restschade Flowva. Claim buiten venster afgewezen → tijdig indienen.
**System action:** `serviceInsurance` lezen bij quote; verzekering kiezen bij submit; claim-flow bij incident. → [TO-VERIFY] hoe verzekering wordt geactiveerd bij submit (welk veld in submit-call) + claim-endpoint.
**Tag:** [CONFIRMED] (serviceInsurance-velden), activatie/claim-flow [TO-VERIFY].

### H4. Parcel geannuleerd / locked / niet-goedgekeurd door BD
**Trigger:** `pkg/detail.packageStatus 10` cancelled, `packageLockStatus 2` locked, `packageApprovedStatus 3` not approved, of `packageType 3` abnormal / `4` risk; `exceptionReason` ingevuld.
**Flow:** Pakket gaat niet (verder); lees `exceptionReason`/`packageApprovedContent`. Mogelijk handmatige BD-review nodig.
**Wie betaalt wat:** Niet verzonden → vracht refunden (Stripe) indien al betaald; product-refund-policy.
**Wat als het faalt:** Onoplosbaar → cancel + refund; oorzaak (verboden goed/risk) voorkomen via B3.
**System action:** `pkg/detail` exception-velden; webhook PO `orderStatus 8` → `refund_order`; UI-melding.
**Tag:** [CONFIRMED] (packageStatus 10, lock/approved/exception, packageType 3/4).

### H5. Out-of-order / dubbele webhooks (idempotentie tracking-status)
**Trigger:** BD stuurt status-webhooks in verkeerde volgorde of dubbel.
**Flow:** `RANK`-tabel laat status alleen **vooruit** bewegen; `cancelled` is terminaal; alle calls in `bucky_notifications` gelogd.
**Wie betaalt wat:** N.v.t.
**Wat als het faalt:** Status-regressie voorkomen door RANK; maar refund-triggers (PO 8) moeten ook idempotent zijn (niet dubbel refunden). → [TO-VERIFY] `refund_order` idempotentie tegen dubbele cancel-webhook.
**System action:** `setOrderStatus` RANK-guard; `bucky_notifications` log.
**Tag:** [CONFIRMED] (RANK-code, logging), refund-idempotentie [TO-VERIFY].

---

## Belangrijkste openstaande verificaties (samengevat)
1. **Parcel-submit-call** na `pay` (welke endpoint dient het pakket bij BD in met gekozen kanaal) — niet in gelezen logistics-PNG's; check Order-docs/dashboard. [TO-VERIFY]
2. **Supplement-betaling bij PO `orderStatus 4`** — welke API/dashboard-stap bevestigt de aanvullende vracht aan BD + timeout-gedrag. [TO-VERIFY]
3. **Lost/damage/claim-endpoint + claim-deadlines + verzekering-activatie** bij submit. [TO-VERIFY]
4. **`haul-shipping` hardcodeert NL** (`addressOf` + quoteBody) — moet land/provincie uit metadata pakken voor niet-NL klanten; onbekend land hard blokkeren i.p.v. NL-fallback. [TO-VERIFY/FIX]
5. **Refund-richting**: `refund_order` refundt nu in-app; wettelijk → originele betaalmethode (Stripe). Geldt voor D3/E1/E2/F3/G. [CONFIRMED gap]
6. **Order-status-aggregatie bij split/multi-parcel** — order pas `delivered` als álle parcels delivered. [TO-VERIFY]
7. **BTW-grondslag** (IOSS: BTW over goederen+vracht, niet alleen vracht) i.p.v. plat 21% op vracht. [TO-VERIFY]
8. **Echte dims + Cat-Level-III categoryCode** opslaan bij curatie (nu default doos + `"1"`) → correct volumetrisch tarief. [TO-VERIFY/FIX]
