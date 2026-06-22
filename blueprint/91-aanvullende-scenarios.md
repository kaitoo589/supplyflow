# 91 — Aanvullende scenarios (completeness-review deel 2)

Dit deel sluit de gaten die de completeness-critics vonden ná de hoofd-secties (01–15).
Elk scenario heeft dezelfde rigor: **Trigger → Flow → Wie betaalt wat → Wat als het faalt
(volgende edge-laag) → System action → tag**. Tags:
**[CONFIRMED]** (uit BuckyDrop-docs / Flowva-code / EU-wet),
**[ASSUMED]** (redelijke aanname), **[TO-VERIFY]** (concreet checken — staat HOE/waar erbij).

> Geverifieerde grondwaarheid (gebruikt door meerdere scenario's hieronder):
> - **Parcel-docs bevatten UITSLUITEND `pkg/detail` (read-only).** Er is GEEN parcel-create,
>   parcel-submit of parcel-cancel-endpoint in `api buckydrop/parcel/`. **[CONFIRMED]**
> - **Order-docs bevatten:** Create Shop Order, Order Details Query, Cancel Shop Order,
>   Cancel Purchase Order, Return Application, Return Details Query. Geen parcel-/supplement-
>   betaal-endpoint. **[CONFIRMED]**
> - `pkg/detail.salePrice` = "Selling price (RMB, unit: **fen**, 1 Yuan = 100 Fen)";
>   `channel-carriage-list` rekent in **Yuan/RMB** (`totalPrice`, `goodsPrice`). **[CONFIRMED]**
> - `channel-carriage-list` levert: `chargedType` (0 actueel / 1 max(actueel,volumetrisch) /
>   2 conditioneel-op-zijdelengte / 3 conditioneel-op-gewicht), `chargedSideLimit`,
>   `chargedWeightLimit`, `volumeWeight`, `dimensionalParam`, `rateType`
>   (template001 first-weight+additional / template002 weight-range / template003 unit-price-by-range),
>   `riskList` (1=gewicht-limiet / 2=maat-limiet), `weightHighLimit`/`weightLowLimit` (kg),
>   `restrictedGoods`, `declareForbidName`, `available`/`unavailableReason`,
>   `serviceInsurance` (delay+loss, `premiumRate`, `min/maxInsuranceAmount`, `delayInsuranceCharge`),
>   `carriageDetail` (`price`, `totalPrice`, `subjoinFee`=brandstof, `registrationFee`,
>   `operationFee`, `takeGoodsFee`=pick-up, `printReceiptFee`, `reportTariffFee`=douane-clearance),
>   `goodsList` (`hsCode`, `declaredNameEn/Cn`, `declaredLevel` 0 general/1 sensitive/2 restricted,
>   `isRecommendDeclared`, `categoryCode`), `vatDetail`, `isTariffCover`. **[CONFIRMED]**
> - `pkg/detail` levert: `outboundTime` (verlaat magazijn) ≠ `deliveryTime` (overgedragen aan
>   koerier), `finishTime`, `closeTime` (cut-off ontvangst), `packageApprovedStatus`
>   (1 to-be-approved / 2 approved / 3 not-approved), `packageLockStatus` (1 unlocked / 2 locked),
>   `signStatus` (1 not-signed / 2 signed), `signTime`, `packageRisk`, `packageDeclareStatus`,
>   `channelName`/`channelLogo`, `packageType` (incl. 2=temporary), `packageStatus` (1-5
>   pre-verzend substaten), `partnerOrderNoList`, `packageQuantity`. **[CONFIRMED]**
> - **`parseChannels()` filtert alleen op `available && serviceCode && priceCny>0`** en pakt
>   alleen `totalPrice`. Het leest `riskList`, `restrictedGoods`, `declareForbidName`,
>   `serviceInsurance`, `chargedType`, `rateType` of de `carriageDetail`-subkosten NIET. **[CONFIRMED]**
> - **Er bestaat nergens een parcel-submit-call.** `confirmHaul`/`payLive` (WarehouseAndHaul.jsx)
>   + `pay_shipping`/`pay_shipping_exact` zetten orders lokaal op `shipped_international`. **[CONFIRMED]**

---

## P. PARCEL-LIFECYCLE & VERZEND-INDIENING (07 — internationale verzending)

### P1. Geen parcel-submit-call — order=verzonden terwijl er fysiek niets is ingediend
**Trigger:** Klant betaalt de haul. `payLive` (live-kanaal) → `pay_shipping_exact`, of
`confirmHaul` (schatting) → `pay_shipping` + client-side `update orders … status =
'shipped_international'` (WarehouseAndHaul.jsx ~regel 401).
**Flow:**
1. Saldo wordt afgeschreven (vracht + BTW).
2. `pay_shipping_exact` zet `update orders set status='shipped_international'` (RPC) —
   OF `confirmHaul` doet het client-side na `pay_shipping`.
3. **Er volgt GEEN BuckyDrop-call die een parcel aanmaakt/indient/laat verzenden.**
   De Parcel-docs hebben alleen `pkg/detail` (read-only); de Order-docs hebben geen
   parcel-submit. **[CONFIRMED]** → fysiek vertrekt er niets; alleen onze DB liegt.
**Wie betaalt wat:** Klant betaalde vracht+BTW; BuckyDrop ontving NIETS voor die haul
(geen parcel = geen fulfilment-fee getrokken). Flowva houdt het vrachtgeld vast zonder
tegenprestatie → bij ontdekking volledige refund-plicht + reputatieschade.
**Wat als het faalt (volgende laag):**
- (a) **Klant ziet "shipped" maar tracking blijft leeg** → support-storm; geen `tracking_number`
  want er is geen parcel.
- (b) **De webhook kan dit nooit corrigeren**: `PO_STATUS_MAP`/`PKG_STATUS_MAP` hebben geen
  "parcel-ingediend"-trigger, dus er komt nooit een tegen-event. De order blijft eeuwig
  "shipped_international" zonder beweging.
- (c) **Geen compensatie/retry-laag**: zelfs als de submit later handmatig moet, is er geen
  idempotente queue die het pakket alsnog indient.
**System action (te bouwen):** [TO-VERIFY] vind de echte indien-stap — kandidaten: (1) een
parcel-create-endpoint dat in de getoonde PNG's ontbreekt (check volledige BuckyDrop-
dashboard/Solution-API "Submit Parcel"); (2) of BuckyDrop automatisch consolideert/verzendt
zodra de PO `orderStatus 9` (stock-in) bereikt en de klant in het dashboard "ship" kiest.
Tot dat bevestigd is: **zet de order NIET op `shipped_international` bij betaling**; introduceer
een tussenstatus `ship_requested` en laat alleen een echte parcel-webhook (`pkgNormalStatus`/
`packageStatus`) de status naar `shipped_international` tillen. Voeg een idempotente
submit-functie toe met `bd_parcel_no`-idempotentie + compensatie-refund bij submit-failure
(zelfde patroon als `place-bucky-order`).
**Tag:** [CONFIRMED] (afwezigheid submit-call + lokale status-zet); echte indien-mechaniek [TO-VERIFY].
**Kruisverwijzing:** verscherpt 07-A2(4)/(c) van [TO-VERIFY] naar een concreet faalpad.

### P2. Pakket-goedkeuringspoort blijft hangen op `packageApprovedStatus 1` (to be approved)
**Trigger:** Een (handmatig of toekomstig) aangemaakt parcel komt bij BuckyDrop binnen op
`packageApprovedStatus 1` ("To be approved") en wacht op review.
**Flow:**
1. Parcel bestaat, maar BuckyDrop keurt het nog niet goed (declaratie-/risk-/inhoud-review).
2. Pas bij `2` (approved) gaat het naar verzending; `3` (not approved) is terminaal.
3. Er is **geen webhook voor "parcel under approval"** voor het normale parcel — `notifyType 3`
   dekt alleen "Shopping Agent PO under approval", niet het parcel-goedkeuringsmoment. **[CONFIRMED]**
**Wie betaalt wat:** Klant betaalde al vracht; pakket beweegt niet → opslag loopt door (zie S2),
geen extra fee tijdens hang.
**Wat als het faalt (volgende laag):**
- (a) **Status-leugen**: Flowva heeft de order al op `shipped_international` (P1) terwijl het
  parcel op "1" hangt → klant verwacht beweging die er niet is.
- (b) **Stille time-out**: zonder webhook én zonder poll merkt niemand de hang; pas een klacht
  legt het bloot.
- (c) Bij `3` (not approved) is er evenmin een event → het pakket valt stil zonder reden in de UI.
**System action:** [TO-VERIFY] poll `pkg/detail.packageApprovedStatus` op een interval voor alle
parcels in een niet-terminale staat; bij `1` ouder dan X uur → admin-alert + reden (`exceptionReason`/
`packageApprovedContent`); bij `3` → order terug naar een handmatige resolutie-status, niet
`shipped_international`.
**Tag:** [CONFIRMED] (status-enum + geen webhook); poll-implementatie [TO-VERIFY].
**Kruisverwijzing:** verscherpt 07-H4 (die alleen status 3 noemde) met het ACTIEVE hang-pad op 1.

### P3. `packageLockStatus 2` (locked) ná betaling, vóór verzending
**Trigger:** BuckyDrop lockt een parcel (risk/declaratie-issue) NA betaling maar VOOR verzending,
zonder cancel.
**Flow:**
1. Parcel staat betaald, klaar; BuckyDrop zet `packageLockStatus 2`.
2. Geen webhook voor lock-events; alleen `pkg/detail` onthult het. **[CONFIRMED]**
3. Pakket blijft onbeweeglijk tot Flowva het issue oplost (declaratie aanvullen, risk-vrijgave).
**Wie betaalt wat:** Klant betaalde vracht; pakket vast → opslag loopt door; lock zelf kost niets.
**Wat als het faalt (volgende laag):**
- (a) Onzichtbaar zonder poll → order hangt op `shipped_international` zonder tracking.
- (b) Als de lock-oorzaak (bv. `packageRisk 2`) niet wordt opgelost vóór `closeTime` (S1) →
  pakket kan niet meer verzonden/ontvangen → product verloren in magazijn.
**System action:** [TO-VERIFY] poll `pkg/detail.packageLockStatus`/`packageRisk`; bij `2` →
admin-alert + blokkeer de "shipped"-belofte; resolutie via dashboard (er is geen unlock-API in
de docs). Onderscheid lock (oplosbaar) van not-approved (P2, terminaal).
**Tag:** [CONFIRMED] (lock-enum + geen webhook); detectie/oplossing [TO-VERIFY].
**Kruisverwijzing:** dynamiseert 07-H4's statische `packageLockStatus`-vermelding.

### P4. `packageType 2` (Temporary parcel) / pre-verzend substaten worden nooit gemapt
**Trigger:** Een parcel ontstaat als "temporary" (`packageType 2`) en doorloopt
`packageStatus 1→5` (in process → in package → packed → verified) vóór outbound.
**Flow:**
1. BuckyDrop maakt een temporary parcel; het is nog niet "verified" (5).
2. De Flowva-statemachine kent alleen `qc_pending → shipped_international → delivered` en mist
   álle pre-outbound substaten. **[CONFIRMED]**
3. Een temporary parcel dat nooit naar `verified (5)` gaat blijft onzichtbaar hangen.
**Wie betaalt wat:** Geen extra kosten in deze fase; risico = stille stilstand + opslag.
**Wat als het faalt (volgende laag):**
- (a) Order springt direct naar `shipped_international` (P1) terwijl het parcel feitelijk nog
  "in process/packed" is → leverbelofte loopt voor op de realiteit.
- (b) Een temporary parcel kan vervallen/samengevoegd worden; zonder mapping merkt Flowva het niet.
**System action:** [TO-VERIFY] map `pkg/detail.packageStatus` 1-5 op tussenstatussen
(`packing`/`packed`/`verified`) en laat `shipped_international` pas toe vanaf een echte
outbound-trigger (`outboundTime` gezet / `packageStatus ≥ verified`).
**Tag:** [CONFIRMED] (packageType/packageStatus-enums + ontbrekende mapping); mapping-fix [TO-VERIFY].
**Kruisverwijzing:** vult het gat tussen 14 (state-machine) en 07.

### P5. Magazijn-outbound ≠ carrier-handover — het "geen beweging"-venster
**Trigger:** Parcel verlaat het magazijn (`outboundTime` gezet, `notifyType 2`-vuurt) maar de
koerier heeft het nog niet (eerste carrier-scan = `deliveryTime`, nog leeg).
**Flow:**
1. `pkg/detail.outboundTime` < `deliveryTime`: tussen "verlaten magazijn" en "overgedragen aan
   koerier" is er geen tracking (`traceStatus 9` "no info yet") en geen webhook. **[CONFIRMED]**
2. Flowva zet de order al op `shipped_international` → klant verwacht beweging.
**Wie betaalt wat:** Niets extra; puur communicatie-/verwachting-gat.
**Wat als het faalt (volgende laag):**
- (a) Klant opent tracking → leeg/"coming soon" (zie T1) → support-ticket "is mijn pakket weg?".
- (b) Als handover lang duurt (magazijn-backlog) lijkt het pakket "kwijt" terwijl het in de
  outbound-buffer ligt.
**System action:** Toon expliciet "Left warehouse — awaiting first carrier scan" tussen
`outboundTime` en `deliveryTime`; pas "in transit" claimen ná `deliveryTime`/eerste `traceNode`.
**Tag:** [CONFIRMED] (outboundTime/deliveryTime-onderscheid + notifyType 2).
**Kruisverwijzing:** koppelt 08-D1 ("no tracking yet") aan dit specifieke venster.

---

## T. TRACKING & CARRIER-DISPLAY (07/08)

### T1. TransitTab pollt niets — statisch nummer, nooit echte tussenstops
**Trigger:** Klant opent de Transit-tab na verzending.
**Flow:**
1. `TransitTab` (WarehouseAndHaul.jsx ~798) toont permanent **"Live tracking updates coming
   soon"** (~877). **[CONFIRMED]**
2. `hauls.tracking_number` wordt uit een onbekende bron gevuld; er is **geen poll-/sync-job**
   die `query-info` → `traceStatus`/`traceNodes` ophaalt. **[CONFIRMED]**
3. De klant ziet hooguit een statisch nummer, nooit tussenstops.
**Wie betaalt wat:** N.v.t.; verwachting-/UX-gat (per-call API-fee zou minimaal zijn bij echte poll).
**Wat als het faalt (volgende laag):**
- (a) D1-D5 in 08 beschrijven `traceStatus`-failures **alsof** tracking gepoll'd wordt — maar de
  app pollt feitelijk niets, dus die afhandeling bestaat niet.
- (b) Geen `traceNodes` = geen POD-bewijs in de UI (zie X1 voor chargeback-impact).
**System action:** [TO-VERIFY] bouw een `track-haul`-functie die `query-info` (logistics) pollt,
`traceNodes`/`traceStatus` opslaat per haul, en de UI bedraadt; cron/poll bij actieve hauls tot
`finishTime`/delivered. Bron van `tracking_number` traceren (nu onbekend).
**Tag:** [CONFIRMED] (statische UI + geen poll); query-info-bedrading [TO-VERIFY].

### T2. Carrier hardgecodeerd op DHL → dode tracking-link bij elke klant
**Trigger:** Order bereikt `shipped_international` met een `tracking_number`.
**Flow:**
1. `supplyflow-app.jsx` (~1689-1691) toont **"DHL Express"** + linkt naar
   `dhl.com/nl-nl/home/tracking.html?tracking-id=<nr>`. **[CONFIRMED]**
2. `WarehouseAndHaul.jsx` (~871) doet hetzelfde (`dhl.com/nl-en/...`). **[CONFIRMED]**
3. BuckyDrop levert echter `pkg/detail.channelName`/`channelLogo` en `channel-carriage-list`-
   carriers die vaak **4PX / YunExpress / Yanwen / PostNL / Cainiao** zijn — niet DHL. **[CONFIRMED]**
**Wie betaalt wat:** N.v.t.; bug raakt elke geleverde klant.
**Wat als het faalt (volgende laag):**
- (a) Klant klikt op een DHL-link die zijn 4PX/YunExpress-nummer niet kent → "ongeldig
  trackingnummer" → wantrouwen + support-last.
- (b) Bij multi-leg (CN-carrier → last-mile PostNL) wisselt de juiste carrier onderweg; één
  hardcoded carrier is sowieso fout.
**System action:** Sla `carrier_name`/`carrier_link`/`channel_name` op de haul/order op (uit
`pkg/detail.channelName` of `serviceName`/`logo` uit `channel-carriage-list`) en bouw de
tracking-link uit `channelName` → carrier-tracking-URL-map; fallback naar een universele
tracking-aggregator (bv. 17track) i.p.v. DHL.
**Tag:** [CONFIRMED] (hardcode in twee files + BuckyDrop levert carrier-velden).
**Kruisverwijzing:** verscherpt 07-D5 (carrier-mismatch in data) naar de hardcoded UI-URL.

---

## C. KOSTEN, RECONCILE & FEE-MODELLEN (07/11)

### C-V1. Volumetrisch gewicht — lichte-maar-volumineuze haul wordt onderschat
**Trigger:** Volumineuze, lichte haul (bv. donsjassen) wordt gequote.
**Flow:**
1. `channel-carriage-list` rekent via `chargedType`: 0=actueel, 1=max(actueel, volumetrisch),
   2/3=conditioneel op `chargedSideLimit`/`chargedWeightLimit`; `volumeWeight =
   L×W×H×qty / dimensionalParam`. **[CONFIRMED]**
2. `quoteBody()` hardcodeert **20×20×10 cm per item** (geen echte dims). **[CONFIRMED]**
3. De interne fallback-schatting (`pay_shipping`) gebruikt **alleen `weight_grams`** — geen
   volume. **[CONFIRMED]**
**Wie betaalt wat:** Bij `chargedType 1` belast BuckyDrop op volumetrisch (hoger); de schatting
ziet alleen werkelijk gewicht → klant betaalt te weinig → **Flowva draait op voor het verschil**,
óf het live-kanaal weigert/onderschat door foute dims.
**Wat als het faalt (volgende laag):**
- (a) Hardcoded doos te klein → volumetrisch onderschat → live-quote zelf is te laag → verlies
  ook op het "echte" pad.
- (b) `chargedType 2/3` springt pas boven `chargedSideLimit`/`chargedWeightLimit` — een net-te-
  lange jas verandert plots de billing-basis; schatting voorspelt dit nooit.
**System action:** Sla echte L/W/H per product op bij curatie; lees `chargedType`, `volumeWeight`,
`chargedSideLimit`, `chargedWeightLimit` uit `channel-carriage-list` en gebruik ze in de
fallback-schatting (max(actueel, volumetrisch)); reconcile tegen `pkg/detail.packageWeight` +
`packageLength/Width/Height`.
**Tag:** [CONFIRMED] (chargedType/volumeWeight + hardcoded doos + weight-only schatting).
**Kruisverwijzing:** verbijzondert 07-C1 (werkelijk-gewicht-afwijking) naar volumetrische billing.

### C-V2. `rateType`-modellen (001/002/003) — schatting kent maar één model
**Trigger:** Een haul valt net over een gewichts-/range-grens van het gekozen kanaal.
**Flow:**
1. De fallback-schatting (`SHIP_FIRST_KG=0.5`, `SHIP_FIRST_EUR=9`, `SHIP_PER_KG=8.5`) is **puur
   een first-weight-model** (≈ template001). **[CONFIRMED]**
2. Het echte kanaal kan **template002 (weight-range)** of **template003 (unit-price-by-range)**
   zijn, met **sprongkosten op gewichtsgrenzen**. **[CONFIRMED]**
3. Een haul die net over een range-grens valt springt in prijs op een manier die de lineaire
   schatting nooit voorspelt.
**Wie betaalt wat:** Bij template002/003 ligt de echte prijs hoger dan de lineaire schatting →
onderdekking; bij `confirmHaul`-pad (schatting) betaalt de klant te weinig → Flowva-verlies.
**Wat als het faalt (volgende laag):**
- (a) `confirmHaul` rekent zélfs op het live-pad de schatting af als er geen channels zijn
  (sandbox/`isSandbox`) → bij cutover (zie F-CUT) kan het verschil ineens groot worden.
- (b) Reconcile estimate↔actual is er niet voor template002/003-sprongen → structureel lek.
**System action:** Lees `rateType` uit het kanaal; bij template002/003 schatting niet lineair
toepassen maar het echte kanaal-tarief gebruiken (geen schatting tonen), of een veiligheids-
buffer rond de dichtstbijzijnde range-grens.
**Tag:** [CONFIRMED] (rateType-enum + single-model schatting).
**Kruisverwijzing:** nieuw t.o.v. 11-C-reeks.

### C-V3. `carriageDetail`-subkosten genegeerd (6 fee-velden) — alleen `totalPrice` gepakt
**Trigger:** Quote/reconcile van een kanaal met toeslagen.
**Flow:**
1. `parseChannels()` pakt **alleen `totalPrice`** (`r.totalPrice ?? r.carriageDetail?.totalPrice`).
   **[CONFIRMED]**
2. `carriageDetail` bevat daarnaast: `subjoinFee` (brandstof), `registrationFee`, `operationFee`,
   `takeGoodsFee` (pick-up), `printReceiptFee`, `reportTariffFee` (douane-clearance). **[CONFIRMED]**
**Wie betaalt wat:** **[TO-VERIFY]** of `totalPrice` deze toeslagen al optelt. Zo NIET (of als ze
bij actual afwijken), betaalt de klant te weinig en draait Flowva op voor de toeslagen
(m.n. `reportTariffFee` douane-clearance en `subjoinFee` brandstof kunnen fors zijn).
**Wat als het faalt (volgende laag):**
- (a) `totalPrice` is een momentopname (`priceChangeTime`) → brandstoftoeslag kan tussen quote en
  submit stijgen → onderdekking ook als `totalPrice` ze normaal omvat.
- (b) `reportTariffFee` valt soms pas bij douane → niet in de quote → verschijnt als
  actual-supplement (07-C1 / PO `orderStatus 4`, zie C-SUP).
**System action:** [TO-VERIFY] bevestig in de docs/sandbox of `totalPrice == price + Σ(subfees)`;
zo niet, som de zes subfees expliciet op in `priceEur`. Log `priceChangeTime` om quote-veroudering
te detecteren.
**Tag:** `totalPrice`/subfees [CONFIRMED]; insluiting in `totalPrice` [TO-VERIFY].
**Kruisverwijzing:** breidt 07-C3 (alleen `subjoinFee`) uit met de vijf overige velden.

### C-SUP. PO `orderStatus 4` (supplement) wordt door de webhook NIET gemapt
**Trigger:** Werkelijk internationaal gewicht > geschat → BuckyDrop vraagt een
supplementaire betaling; de PO komt binnen op `orderStatus 4` ("to be confirmed incl.
supplementary payment").
**Flow:**
1. De webhook leest het PO-object via `findPO()`, maar **`PO_STATUS_MAP` heeft alleen
   5/6/9/11/12** — **geen 4**. **[CONFIRMED]**
2. `poStatus 4` valt door als "po 4 (no map)" → geen status-zet, geen actie, geen alert.
3. De PO hangt stil; niemand betaalt het supplement; het pakket blijft staan.
**Wie betaalt wat:** Het supplement (extra vracht) blijft onbetaald → BuckyDrop verzendt niet;
opslag loopt door (S1/S2). Bij niet-betalen vóór `closeTime` → product verloren.
**Wat als het faalt (volgende laag):**
- (a) Klant zit op `shipped_international` (P1) terwijl de PO feitelijk op 4 wacht → dubbele leugen.
- (b) Geen supplement-betaal-endpoint in de docs → zelfs als gedetecteerd, is de
  bevestigings-call onbekend ([TO-VERIFY] dashboard/wallet-trek).
**System action:** Voeg `4` toe aan de webhook-afhandeling → zet order op een `supplement_due`-
status, alert admin, her-quote en charge de klant het verschil (of refund bij minder).
[TO-VERIFY] welke API/dashboard-stap het supplement aan BuckyDrop bevestigt.
**Tag:** [CONFIRMED] (orderStatus 4 ontbreekt in map); bevestigings-call [TO-VERIFY].
**Kruisverwijzing:** maakt 07-C1's slot-[TO-VERIFY] concreet.

### C-INS. Verzekering (`lostInsurance`/`delayInsurance`) wordt nooit geactiveerd → niets te claimen
**Trigger:** Pakket gaat verloren (08-D3) of vertraagt (08-D2); men wil claimen.
**Flow:**
1. `channel-carriage-list` levert `serviceInsurance` met `lostInsuranceFlag`, `premiumRate`,
   `min/maxInsuranceAmount`, `delayInsuranceFlag`, `delayInsuranceCharge`, `delayInsuranceClaims`.
   **[CONFIRMED]**
2. `haul-shipping`/`parseChannels` **lezen deze velden niet**; `pay_shipping_exact` rekent **geen
   premie**. **[CONFIRMED]**
3. Bij verlies/vertraging is er dus **per definitie geen actieve polis** om op te claimen.
**Wie betaalt wat:** Geen premie betaald → geen dekking → bij verlies draagt **Flowva** de volledige
goederen+vracht-refund aan de klant (geen verzekeraar-recovery).
**Wat als het faalt (volgende laag):**
- (a) De hele 07-G/D-claim-aanname ("we claimen bij verlies") valt weg.
- (b) Hoge-waarde hauls (bundels €20-40+) zonder polis = onbegrensd Flowva-risico per kwijt pakket.
**System action:** Lees `serviceInsurance`; bied (of forceer boven een waardegrens) `lostInsurance`
aan; tel `premiumRate × verzekerde waarde` (binnen min/max) bij de vracht; activeer de polis bij
submit. [TO-VERIFY] hoe de polis bij BuckyDrop wordt geactiveerd (vlag in submit-body?) en hoe
geclaimd wordt.
**Tag:** [CONFIRMED] (velden bestaan + code leest/activeert ze niet); activatie/claim-call [TO-VERIFY].
**Kruisverwijzing:** ontkracht de claim-aanname in 07-G1/D3/H3.

---

## W. WEEG-GATE, SPLIT & DECLARATIE (07/01)

### W1. Per-parcel weeg-gate splitst een haul — app betaalt voor één parcel
**Trigger:** Eén gecombineerd pakket overschrijdt `weightHighLimit` (`riskList 1`) of
`chargedSideLimit` (`riskList 2`) van het kanaal.
**Flow:**
1. Het kanaal verplicht dan **meerdere parcels** (elk eigen ¥9,9-fulfilment + mogelijk duurder
   per-parcel-tarief). **[CONFIRMED]** (`riskList`, `weightHighLimit`, fulfilment-staffel).
2. De app quote't en betaalt als **één haul / één bedrag**; er is **geen split-logica** bij
   betaling. **[CONFIRMED]**
**Wie betaalt wat:** Klant betaalt één parcel; er zijn er twee nodig → **onderdekking** (extra ¥9,9
+ tweede first-weight-blok), óf het kanaal weigert de oversized parcel.
**Wat als het faalt (volgende laag):**
- (a) Bij gedwongen split verdubbelt ook het first-weight-blok → de groeps-/bundel-besparing
  (15-Friends) verdampt.
- (b) Friends/multi-item hauls raken dit het vaakst (veel items = zwaar/groot).
**System action:** Lees `riskList`/`weightHighLimit`/`chargedSideLimit`; als de haul de limiet
overschrijdt, split server-side in N parcels, her-quote per parcel en reken het totaal af
(N×fulfilment + N first-weight-blokken).
**Tag:** [CONFIRMED] (riskList/limieten + geen split-billing).
**Kruisverwijzing:** verscherpt 07-H1/B2 (die bij "overschrijdt limiet" stopten).

### W2. Geen pre-check op verboden/risk-goederen — `parseChannels` negeert `declareForbidName`/`restrictedGoods`/`riskList`
**Trigger:** Een verboden/restricted artikel wordt gequote.
**Flow:**
1. `parseChannels()` filtert **alleen** op `available && serviceCode && priceCny>0`. **[CONFIRMED]**
2. Het leest **`declareForbidName`, `restrictedGoods` of `riskList` NIET** om een artikel te weren.
   **[CONFIRMED]**
3. Verboden artikel passeert de quote, wordt betaald en verzonden; pas in transit tegengehouden
   (07-F4) — terwijl het kanaal de info vooraf gaf.
**Wie betaalt wat:** Klant betaalt; bij confiscatie/return-to-sender draait Flowva op voor refund +
verloren vracht (geen polis, zie C-INS).
**Wat als het faalt (volgende laag):**
- (a) `declareForbidName` is een semicolon-lijst per kanaal → matchen vereist productnaam/HS-mapping
  die Flowva niet opslaat (zie W3).
- (b) Een ander beschikbaar kanaal staat het artikel misschien wél toe → zonder pre-check kies je
  blind het goedkoopste (dat het juist verbiedt).
**System action:** Lees `declareForbidName`/`restrictedGoods`/`riskList` in `parseChannels`; weer
kanalen die het artikel verbieden; als geen enkel kanaal het toestaat → blokkeer vóór betaling met
duidelijke melding.
**Tag:** [CONFIRMED] (parseChannels-filter negeert deze velden).
**Kruisverwijzing:** maakt 07-B3/F4's aanname ("pre-check bestaat") tot een concreet code-gat.

### W3. Geen `hsCode`/`declaredLevel`-opslag bij curatie — sensitive/restricted niet classificeerbaar
**Trigger:** Curatie van een product dat `declaredLevel 1` (sensitive) of `2` (restricted) is.
**Flow:**
1. `channel-carriage-list`/`goodsList` vragen `hsCode`, `declaredNameEn/Cn`, `declaredLevel`
   (0/1/2), `isRecommendDeclared`. **[CONFIRMED]**
2. Flowva slaat **geen `hsCode` of `declaredLevel`** per product op; zelfs `bd_category_code` wordt
   bij curatie nog niet gevuld (default "1"). **[CONFIRMED]** (kolom bestaat, blijft leeg).
3. Een sensitive/restricted artikel wordt zonder juiste declaratie verzonden → douane-hold (07-F1),
   confiscatie (07-F3) of return-to-sender — vooraf detecteerbaar.
**Wie betaalt wat:** Bij hold/confiscatie: verloren goederen + vracht → Flowva-refund-plicht.
**Wat als het faalt (volgende laag):**
- (a) Zonder `hsCode` kan de declaratie bij submit niet correct worden ingevuld → carrier weigert
  of declareert verkeerd → BTW/douane-fout.
- (b) `isRecommendDeclared`/`declaredLevel` per kanaal verschilt → zonder opgeslagen classificatie
  kun je niet het juiste kanaal kiezen.
**System action:** Voeg `hs_code` + `declared_level` + `declared_name_en/cn` aan `products` toe; vul
bij curatie (uit BuckyDrop-productdata of handmatig); gebruik `declaredLevel` om sensitive/restricted
te flaggen vóór publicatie (en koppel aan W2).
**Tag:** [CONFIRMED] (velden bestaan in docs; opslag ontbreekt in code).
**Kruisverwijzing:** plaatst 01-B4's generieke "HS-codes ontbreken" als concreet curatie-gat.

---

## A. ADRES & BESTEMMING (07/08)

### A-NL. `haul-shipping` hardcodeert NL — quote-zone ≠ PO-bestemmingsland voor elke niet-NL klant
**Trigger:** Een klant of Friends-host in BE/DE/FR (etc.) vraagt een verzend-quote.
**Flow:**
1. `addressOf()` in `haul-shipping` zet **altijd** `country:"Netherlands"`, `countryCode:"NL"`,
   `provinceCode:"NL"` — ongeacht de klant. **[CONFIRMED]**
2. `place-bucky-order` stuurt daarentegen het **echte** land (`countryCodeFor(m.land)`) naar de PO.
   **[CONFIRMED]**
3. → De quote rekent op de **NL-zone/tarief**, maar het pakket gaat naar een ander land →
   structurele divergentie voor élke niet-NL klant.
**Wie betaalt wat:** Niet-NL-zones zijn vaak duurder → klant betaalt het NL-tarief → **onderdekking**;
of het kanaal is voor dat land niet beschikbaar (quote toont kanalen die niet leveren).
**Wat als het faalt (volgende laag):**
- (a) Friends-host in BE: alle leden krijgen een NL-quote terwijl het pakket naar BE gaat.
- (b) DDP/BTW-aanname (21% NL) klopt niet voor andere EU-landen (andere tarieven/IOSS-grondslag).
**System action:** Lees het echte land/`provinceCode` uit `user_metadata` (en bij Friends uit de
**host**) in `addressOf`; quote per bestemmingsland; valideer land tegen de ondersteunde lijst.
**Tag:** [CONFIRMED] (NL-hardcode in `addressOf` vs echt land in PO).
**Kruisverwijzing:** verscherpt 07-H2(b) van [TO-VERIFY] naar concreet onderdekkings-scenario.

### A-RACE. Land-wijziging tussen `pay_cart` en `place-bucky-order` → stille NL-default / fout belast
**Trigger:** Klant wijzigt `land` in `user_metadata` ná `pay_cart` (order op `quote_accepted`) maar
vóór `place-bucky-order` draait.
**Flow:**
1. `place-bucky-order` leest `m.land` **live** op het moment van inkoop. **[CONFIRMED]**
2. `countryCodeFor(name)` valt voor **elk niet-herkend land stil terug op `"NL"`**. **[CONFIRMED]**
3. Wijzigt de klant naar een niet-ondersteund land → `countryCode` wordt "NL" → pakket gaat naar NL
   of met een verkeerde DDP/BTW-aanname de deur uit.
**Wie betaalt wat:** Verkeerd land = verkeerde zone/BTW → onderdekking of onbezorgbaar; bij NL-default
gaat het pakket naar het verkeerde land → totaalverlies + nieuwe verzending.
**Wat als het faalt (volgende laag):**
- (a) Geen waarschuwing bij de stille fallback → pas zichtbaar als het pakket verdwijnt/terugkomt.
- (b) Adresvelden komen óók live uit metadata → een half-ingevulde wijziging geeft `"-"`-velden
  (zie A-GDPR).
**System action:** Bevries land/adres als snapshot op de order bij `pay_cart`/`quote_accepted`
(niet live lezen); blokkeer niet-ondersteunde landen hard i.p.v. NL-fallback.
**Tag:** [CONFIRMED] (live read + stille NL-default).
**Kruisverwijzing:** verbijzondert 08 "adres-correctie voor/tijdens verzending".

---

## S. OPSLAG, CUT-OFF & PERMANENTE STILSTAND (05/06)

### S1. `closeTime` cut-off genegeerd — betaalde items "verlopen" in het magazijn
**Trigger:** Items liggen te lang in het magazijn (na de 30-dagen gratis opslag); `pkg/detail`
levert `closeTime` (cut-off waarna een parcel niet meer ontvangen/aangemeld kan worden).
**Flow:**
1. `closeTime` is een hard moment; de app heeft **geen timer** die hierop alarmeert. **[CONFIRMED]**
2. Een klant die zijn haul te lang uitstelt kan na `closeTime` zijn items niet meer in een parcel
   krijgen → "verloren" zonder waarschuwing.
**Wie betaalt wat:** Reeds betaalde goederen kunnen vervallen → Flowva-refund of klant-verlies +
opslagkosten die uit de CNY-wallet lopen (S2).
**Wat als het faalt (volgende laag):**
- (a) Bij PO `orderStatus 4` (C-SUP) of dispute-hold (Q1) loopt de klok door terwijl niemand handelt.
- (b) BuckyDrop disposal na verloop = totaalverlies van het fysieke item.
**System action:** Lees `closeTime`; zet een timer/alert (X dagen vóór) → push de klant om de haul
te betalen; auto-proceed-beleid vóór cut-off.
**Tag:** [CONFIRMED] (closeTime-veld + geen timer).
**Kruisverwijzing:** concretiseert 05-08's generieke "30-dagen opslagverloop".

### S2. Gratis opslag verloopt terwijl order in QC-poort hangt → stille CNY-wallet-drain + disposal
**Trigger:** Order hangt in de QC-goedkeuringspoort (klant reageert niet, of dispute loopt) voorbij
de 30-dagen gratis opslag.
**Flow:**
1. BuckyDrop begint opslagkosten te rekenen die **uit de CNY-wallet** lopen. **[ASSUMED]**
   (BuckyDrop-opslagbeleid; exacte tarief/termijn [TO-VERIFY]).
2. Er is **geen timer/auto-proceed-beleid, geen doorbelasting aan de klant, geen waarschuwing**.
   **[CONFIRMED]** (geen code).
**Wie betaalt wat:** Opslag drukt op de **CNY-wallet (Flowva)**; uiteindelijk mogelijk auto-disposal
door BuckyDrop = totaalverlies van het item (Flowva droeg de inkoop al).
**Wat als het faalt (volgende laag):**
- (a) Geen CNY-wallet-ledger in `admin_finance_overview` (zie M3) → de drain is onzichtbaar.
- (b) Combineert met S1 (`closeTime`) → na cut-off geen redding meer mogelijk.
**System action:** Harde auto-proceed-deadline na X dagen QC-hang (klant gewaarschuwd) → doorbelasten
of automatisch verzenden/afhandelen; CNY-opslag zichtbaar maken in finance. [TO-VERIFY] BuckyDrop-
opslagtarief + disposal-termijn.
**Tag:** opslag-cascade [ASSUMED]; ontbrekende timer/doorbelasting [CONFIRMED]; tarieven [TO-VERIFY].
**Kruisverwijzing:** geldelijke uitwerking van 06's "timeout/opslagkosten-beleid".

### S3. Domestic-inbound tracking-gat: seller → magazijn met onbekende koerier
**Trigger:** Seller verzendt naar het BuckyDrop-magazijn via een koerier die BuckyDrop niet
auto-trackt.
**Flow:**
1. BuckyDrop biedt `order/delivery/update` (Supplement Domestic Logistics) om handmatig
   `deliveryCode`/`deliveryName`/`deliveryNo` te injecteren, en `express-company-list` voor de
   CN-koerierslijst. **[CONFIRMED — order-docs vermelden deze endpoints]** ([TO-VERIFY] exacte
   velden in de PNG's).
2. Flowva gebruikt **geen van beide**. **[CONFIRMED]** (geen call in code).
3. → Bij een niet-herkende koerier blijft de PO zonder zichtbare voortgang tussen `bought` en
   `qc_pending`; niemand weet waar het binnenlandse pakket is.
**Wie betaalt wat:** N.v.t. financieel; risico = zoekgeraakt binnenlands pakket → vertraging/verlies.
**Wat als het faalt (volgende laag):**
- (a) Klant ziet "bought" maar nooit "in warehouse" → support-vraag + onzekerheid.
- (b) Als de seller niet levert (04-leverancier-failures) is er geen tracking om dat te bewijzen.
**System action:** [TO-VERIFY] integreer `express-company-list` + `order/delivery/update` zodat de
agent een binnenlands trackingnummer kan injecteren; toon binnenlandse voortgang.
**Tag:** [CONFIRMED] (endpoints bestaan, niet gebruikt); velddetails [TO-VERIFY].
**Kruisverwijzing:** nieuw t.o.v. 05.

### S4. `weight_grams` nooit/0/onrealistisch — order hangt eeuwig in `qc_pending`
**Trigger:** BuckyDrop vult `weight_grams` niet (of stuurt 0/onrealistisch laag) ná stock-in.
**Flow:**
1. `pay_shipping` weigert bij `v_weight <= 0` met "Weight missing"; `ff_pay_group_shipping` weigert
   de hele groep bij `v_unweighed > 0`. **[CONFIRMED]**
2. Er is **geen admin-gewicht-override** en geen vangnet bij blijvend ontbrekend/fout gewicht.
   **[CONFIRMED]**
3. → De order hangt **permanent** in `qc_pending`; kan niet verzonden worden.
**Wie betaalt wat:** Goederen al betaald; opslag loopt door (S2) → Flowva draagt; klant kan niets.
**Wat als het faalt (volgende laag):**
- (a) Bij Friends gijzelt één gewichtsloos item de hele groep (zie F-DEAD).
- (b) Voorbij `closeTime` (S1) → item verloren.
**System action:** Admin-gewicht-override (uit `pkg/detail.packageWeight` of handmatig); sanity-
ondergrens (bv. > 5 g); fallback-flow als BuckyDrop geen gewicht levert binnen X dagen.
**Tag:** [CONFIRMED] (weight-gates + geen override).
**Kruisverwijzing:** maakt 05's "needWeight blokkeert" tot permanente-stilstand-variant.

---

## Q. QC-HOLD ↔ STATE-MACHINE ONTKOPPELING (06/07)

### Q1. `dispute_status='pending'` blokkeert de status-machine NIET — forward-webhook rijdt eroverheen
**Trigger:** Order staat in QC op `dispute_status='pending'` (defect, via "Notify Po Pending"); daarna
komt een normale forward-webhook (PO `orderStatus 6` shipped, of parcel `delivered`).
**Flow:**
1. De webhook zet defect-velden (`dispute_status='pending'`, `problem_type`, `qc_images`) **náást**
   de status — `setOrderStatus` checkt **alleen `RANK`**, niet `dispute_status`. **[CONFIRMED]**
2. Een forward-mapped status (`shipped_local`→`shipped_international`→`delivered`) passeert de
   forward-only-check en **zet de order door, OVER de actieve defect-hold heen**. **[CONFIRMED]**
**Wie betaalt wat:** Een defect/afgekeurd item wordt als verzonden/geleverd gemarkeerd → klant
betaalt vracht voor een kapot item; refund-recht genegeerd → latere refund + verloren vracht.
**Wat als het faalt (volgende laag):**
- (a) Geconsolideerde delivered-webhook (Q2) overschrijft óók een achtergehouden defect-item.
- (b) `dispute_status` leeft compleet naast de state-machine → geen enkel pad respecteert de hold.
**System action:** In `setOrderStatus`: weiger forward-zetten naar `shipped_*`/`delivered` zolang
`dispute_status='pending'` (of een terminale dispute-resolutie ontbreekt); voeg een `held`-rang toe.
**Tag:** [CONFIRMED] (RANK negeert dispute_status).
**Kruisverwijzing:** concretiseert 06's "hold blokkeert verzending" als code-ontkoppeling.

### Q2. Geconsolideerd `delivered`-event overschrijft een achtergehouden/defect item
**Trigger:** Eén parcel bevat meerdere van onze orders (consolidatie); parcel-webhook komt binnen
met `pkgNormalStatus 4` (delivered) en een `partnerOrderNoList`.
**Flow:**
1. De parcel-tak loopt **`partnerOrderNoList` klakkeloos door** en zet elke order op `delivered`.
   **[CONFIRMED]**
2. Forward-only (`RANK`) staat `qc_pending→delivered` toe. **[CONFIRMED]**
3. Als één order binnen de consolidatie in QC defect was bevonden en **eruit gehaald**
   (niet meegezonden), wordt hij **alsnog "delivered"** — state-corruptie.
**Wie betaalt wat:** Achtergehouden defect-item wordt onterecht "delivered" → klant denkt geleverd,
refund-recht/QC-hold verdwijnt → Flowva-verlies of dispuut.
**Wat als het faalt (volgende laag):**
- (a) Combineert met Q1: noch RANK noch de per-order-check stopt het.
- (b) Klant krijgt "Delivered!"-push (notify-order) voor iets dat hij nooit krijgt.
**System action:** Per `partnerOrderNo` in de lijst: check of die order echt in dít parcel zat
(`pkg/detail.partnerOrderNoList` vs onze QC-hold/`dispute_status`); sla `delivered` over voor
achtergehouden/defect items.
**Tag:** [CONFIRMED] (klakkeloze partnerOrderNoList-loop + forward-only).
**Kruisverwijzing:** verbijzondert 07-H1 (split/partial) naar QC-overschrijving.

### Q3. Multi-PO in één webhook-body — `findPO()` pakt alleen het eerste, dropt de rest
**Trigger:** Eén notify-body bevat **meerdere PO-objecten** (seller-split: één order in 2
deelzendingen; of consolidatie van meerdere `partnerOrderNo`'s).
**Flow:**
1. `findPO(node)` is **depth-first en returnt het EERSTE** object met `orderCode`+`orderStatus`;
   de rest wordt genegeerd. **[CONFIRMED]**
2. `findPics()` idem (eerste niet-lege `picList`). **[CONFIRMED]**
3. → Status-updates en defect-`picList` van de overige PO's worden **stil gedropt**.
**Wie betaalt wat:** N.v.t. direct; gevolg = vastgelopen orders + gemiste defect-foto's (bewijs weg).
**Wat als het faalt (volgende laag):**
- (a) Seller-split: deelzending B krijgt nooit zijn status → hangt eeuwig.
- (b) Defect in PO #2 met inspectiefoto → foto's verdwijnen → geen QC-bewijs voor refund/chargeback.
**System action:** Verzamel **alle** PO-objecten (en alle `picList`s) in de body en verwerk ze per
`partnerOrderNo`; matchen op order-id i.p.v. één globale `partnerOrderNo` uit de header.
**Tag:** [CONFIRMED] (single-first findPO/findPics).
**Kruisverwijzing:** nieuw t.o.v. 14's "out-of-order/dubbele webhook".

---

## X. BEWIJS & FRAUDE (08/03)

### X1. `signTime`/`signStatus` niet opgeslagen — geen snel POD-bewijs bij "niet ontvangen"/chargeback
**Trigger:** POD-dispuut (08-D4) of friendly fraud: klant claimt niet-ontvangen; of bank-chargeback.
**Flow:**
1. `pkg/detail` levert `signStatus 2` (signed) + `signTime` + `traceNodes` als bewijs. **[CONFIRMED]**
2. De app slaat `signTime`/`signStatus`/`traceNodes` **nergens op de haul/order** op (geen poll —
   zie T1). **[CONFIRMED]**
3. → Bij een Stripe-chargeback (`charge.dispute.created` wordt wél verwerkt) is het leverbewijs
   niet snel te overleggen.
**Wie betaalt wat:** Zonder bewijs verliest Flowva de chargeback → verloren goederen + vracht +
chargeback-fee.
**Wat als het faalt (volgende laag):**
- (a) `stripe-webhook` mailt de admin "dien QC-foto's + meetrapport + delivery-tracking in" —
  maar de delivery-tracking/POD bestaat niet in onze DB (T1) → de admin kan het niet leveren.
- (b) Chargeback-deadline (`due_by`) verloopt terwijl het bewijs handmatig verzameld wordt.
**System action:** Poll/sla `signStatus`, `signTime`, `traceNodes`, `pkg/detail.finishTime` op de
haul op; koppel als bewijs aan `record_stripe_dispute`/`admin_alerts.meta`.
**Tag:** [CONFIRMED] (velden bestaan; opslag ontbreekt; dispute-handler bestaat).
**Kruisverwijzing:** vult het bewijs-gat dat 08-D4/09 + de stripe-dispute-mail veronderstellen.

---

## M. TREASURY, FEES & GELD-INTEGRITEIT (03/11/09)

### M1. Stripe top-up: metadata-`amount` i.p.v. werkelijk ontvangen bedrag gecrediteerd
**Trigger:** `apply_top_up` crediteert `metadata.amount/100`; `create-checkout` vertrouwt de
client-meegegeven `amount` voor zowel `unit_amount` als `metadata`.
**Flow:**
1. Stripe garandeert dat het betaalde bedrag = `unit_amount` (= `metadata.amount`) → **vandaag
   klopt het** omdat beide uit dezelfde client-`amount` komen. **[CONFIRMED]**
2. Er is **geen verificatie** dat `session.amount_total` (werkelijk betaald, juiste currency) ===
   `metadata.amount`. **[CONFIRMED]**
**Wie betaalt wat:** Vandaag niemand; **toekomstig** risico: bij coupons, multi-currency of FX
crediteert Flowva het metadata-bedrag i.p.v. wat netto in EUR is ontvangen → over-crediteren.
**Wat als het faalt (volgende laag):**
- (a) Een tamperbare client-`amount` zou `unit_amount` én `metadata` samen verzetten — Stripe int
  dan wel het verzette bedrag, dus geen directe diefstal; maar een coupon/FX breekt de gelijkheid.
- (b) Bij currency ≠ EUR is `amount_total` in een andere eenheid → 1:1 crediteren is fout.
**System action:** Crediteer in `apply_top_up`/`stripe-webhook` op basis van
`session.amount_total` + `currency==='eur'`-check (de echt ontvangen waarde), niet `metadata.amount`;
of valideer gelijkheid en weiger bij mismatch.
**Tag:** [CONFIRMED] (metadata-gebaseerde credit, geen amount_total-check).
**Kruisverwijzing:** aanvulling op 03 top-up-idempotentie.

### M2. iDEAL-chargeback/refund-events — saldo-realiteit
**Status:** **Deels al afgedekt** sinds de huidige code. `stripe-webhook` **verwerkt nu**
`charge.dispute.created` en `charge.dispute.closed` → `record_stripe_dispute` (idempotent) +
admin-mail; `create-checkout`/`stripe-webhook` **slaan `payment_intent` op** bij top-up. **[CONFIRMED]**
**Resterend gat (Trigger):** iDEAL-betaling "paid" → balance opgehoogd → saldo uitgegeven; daarna komt
de chargeback/terugboeking.
**Flow / Wie betaalt wat / Wat als het faalt:**
1. De dispute wordt nu **wel** geregistreerd, maar `record_stripe_dispute` **verlaagt het saldo niet
   automatisch** en er is **geen handler voor `charge.refunded` / payment_intent-reversals**.
   **[TO-VERIFY in `record_stripe_dispute`/`stripe-disputes.sql`]** — als het saldo verhoogd blijft
   terwijl het geld is teruggevorderd én al uitgegeven, ontstaat een negatief-economisch gat
   (klant gaf geleend geld uit).
2. Volgende laag: als de klant het saldo al heeft **uitbetaald via /withdraw** (zie M5) vóór de
   chargeback, is recovery onmogelijk → directe verlies-/witwas-vector.
**System action:** [TO-VERIFY] of `record_stripe_dispute` het beschikbare saldo bevriest/terugboekt;
voeg `charge.refunded`-handler toe; blokkeer withdraw zolang een recente top-up nog binnen de
chargeback-/terugboektermijn valt.
**Tag:** dispute/refund-registratie [CONFIRMED]; saldo-terugboeking + `charge.refunded` [TO-VERIFY].
**Kruisverwijzing:** update t.o.v. eerdere "geen dispute-handler"-aanname (code is inmiddels verder).

### M3. CNY-wallet & echte BuckyDrop-fees nooit gereconcilieerd in finance-overview
**Trigger:** Maand-/marge-review; admin opent `admin_finance_overview`.
**Flow:**
1. Flowva **schat** verzending met het EUR-first-weight-model, maar reconcilieert nooit tegen de
   **werkelijke** per-parcel BuckyDrop-afschrijving uit de CNY-wallet: fulfilment ¥9,9 (1-5 items)
   + ¥2/item boven 5 + ¥1,5/kg overweight boven 2 kg. **[CONFIRMED — model]**
2. `admin_finance_overview` toont **alleen EUR + een handmatig ingevoerd Wise-bufferbedrag**, geen
   CNY-wallet-ledger. **[ASSUMED — op basis van finance-hardening]** ([TO-VERIFY in
   `finance-hardening.sql`]).
**Wie betaalt wat:** Het verschil tussen geschatte verzendmarge en echte fulfilment+overweight-fees
blijft onzichtbaar → structureel verliesgevend zonder dat iemand het ziet.
**Wat als het faalt (volgende laag):**
- (a) Per-parcel ¥9,9 × meerdere parcels (W1/multi-supplier M4) telt op terwijl klant één blok betaalde.
- (b) Opslag-drain (S2) loopt ook door de CNY-wallet maar staat nergens.
**System action:** Importeer BuckyDrop-wallet-transacties (CNY) in een ledger; reconcile per parcel
geschat-EUR ↔ werkelijk-CNY; toon CNY-saldo + fee-breakdown in `admin_finance_overview`.
**Tag:** fee-staffel [CONFIRMED]; ontbrekende CNY-ledger [ASSUMED/TO-VERIFY].
**Kruisverwijzing:** concretiseert 03's "reconciliatie CNY ontbreekt".

### M4. Multi-supplier mand: één service fee + één verzendblok aangenomen, meerdere parcels in werkelijkheid
**Trigger:** `pay_cart` rekent **exact één** service fee (`service_fee_for`, min €5) over een mand die
items van **meerdere leveranciers/platforms** bevat.
**Flow:**
1. Die items worden als **aparte BuckyDrop-parcels** vervuld → **meerdere ¥9,9-fulfilmentfees +
   meerdere first-weight-blokken**. **[CONFIRMED — model + geen split-logica in pay_cart]**
2. De klant verwacht één fee + (later) één verzending; er is **geen logica die een multi-supplier-
   mand splitst of de fee/verzendkost herrekent**. **[CONFIRMED]**
**Wie betaalt wat:** Flowva draagt de extra fulfilment-fees en first-weight-blokken die de schatting
(één blok) niet dekt → margelek zodra een mand 2 bronnen mengt.
**Wat als het faalt (volgende laag):**
- (a) Combineert met W1 (gewicht-split) → nóg meer parcels.
- (b) Geen unit-economics-voorbeeld (A/B/C in 11) modelleert dit → onzichtbaar verlies.
**System action:** Detecteer aantal distinct suppliers/platforms in de mand; herreken
verzending/fulfilment per parcel; overweeg per-supplier-fee of een minimum dat de extra parcels dekt.
**Tag:** [CONFIRMED] (één fee/één blok in pay_cart; fysiek per parcel).
**Kruisverwijzing:** nieuw t.o.v. 11-unit-economics.

### M5. Withdraw als witwas-/cash-cycling-kanaal (Wwft/AML)
**Trigger:** Klant laadt €100 via iDEAL, koopt **niets**, vraagt €100 withdraw aan → SEPA-uitbetaling.
**Flow:**
1. `/withdraw` betaalt saldo terug; geld in via iDEAL, uit via SEPA naar (mogelijk) een **andere**
   rekening zonder dat er ooit goederen stroomden. **[CONFIRMED — feature bestaat]**
2. **Geen anti-witwas-/minimale-aankoop-/cooldown-controle.** **[CONFIRMED]** ([TO-VERIFY exacte
   controles in `withdrawal-request`/`withdrawal-requests.sql`]).
**Wie betaalt wat:** Flowva draagt de iDEAL- én SEPA-kosten; erger: **compliance-blootstelling**
(Wwft/AML voor een KvK-onderneming) + chargeback-misbruik (top-up later teruggeboekt, M2).
**Wat als het faalt (volgende laag):**
- (a) Combineert met M2: top-up via iDEAL → withdraw via SEPA → daarna chargeback op de iDEAL →
  Flowva betaalt twee keer uit.
- (b) Structureel cash-cyclen = transactie-monitoring-plicht.
**System action:** Withdraw alleen van **niet uit recente top-up afkomstig** saldo; cooldown +
minimum-aankoop-vereiste; withdraw bevriezen binnen de chargeback-termijn; AML-monitoring/limieten.
**Tag:** [CONFIRMED] (feature zonder AML-guard); exacte controles [TO-VERIFY].
**Kruisverwijzing:** nieuw compliance-scenario t.o.v. 03/13.

### M6. Geen `payment_intent`-FIFO-allocatie → Stripe-refund naar de bron technisch onmogelijk
**Trigger:** Geldige EU-herroeping 14 dagen na levering; refund moet wettelijk naar Stripe/iDEAL.
**Flow:**
1. Het saldo kan uit **meerdere iDEAL-stortingen** zijn opgebouwd en deels al uitgegeven/uitbetaald.
2. `create-checkout`/`stripe-webhook` slaan inmiddels **wél** `payment_intent` op per top-up
   (`apply_top_up(p_payment_intent)`). **[CONFIRMED]** → de **data-koppeling bestaat nu**.
3. Maar er is **geen FIFO-allocatie** die een refund-bedrag aan specifieke (nog niet uitgegeven)
   top-up-PaymentIntents toewijst. **[CONFIRMED]** → een programmatische Stripe-refund naar de
   juiste PaymentIntent vereist nog steeds handwerk.
**Wie betaalt wat:** Refund moet naar de originele betaalmethode (consumentenrecht); zonder FIFO kan
het naar de verkeerde PI of alleen naar in-app saldo (wat juridisch niet voldoet).
**Wat als het faalt (volgende laag):**
- (a) `refund_order` refundt nu naar **in-app saldo**, niet Stripe → wettelijk onvoldoende.
- (b) Gedeeltelijk uitgegeven top-up → welk deel naar welke PI?
**System action:** Bouw FIFO-allocatie (top-up-ledger met resterend-per-PI) zodat een refund
programmatisch over de juiste PaymentIntents naar de bron gaat (Stripe `refunds.create`).
**Tag:** payment_intent-opslag [CONFIRMED, inmiddels aanwezig]; FIFO + Stripe-refund-routering [CONFIRMED ontbrekend].
**Kruisverwijzing:** update t.o.v. eerdere "payment_intent wordt nergens opgeslagen"-aanname.

### M7. `refund_order` refundt QC-pakket (¥6) noch value-added-services niet terug
**Trigger:** Annulering ná stock-in (`orderStatus 9`) of na een al-uitgevoerde foto/meet-service.
**Flow:**
1. `refund_order` refundt **alleen `quoted_total`/`price`** (de goederen-lijn) — **niet** het
   verplichte QC-pakket (~¥6/order: Standard Product Photos ¥2 + Garment Measurement ¥4) en **niet**
   eventueel al gemaakte value-added-servicekosten. **[CONFIRMED]**
2. Bij annulering ná uitvoering van die services is dat geld al aan BuckyDrop betaald.
**Wie betaalt wat:** De ¥6 QC + services worden noch teruggevraagd bij BuckyDrop, noch correct als
**Flowva-verlies** geboekt → klein-maar-systematisch verlies op élke geannuleerde order met QC.
**Wat als het faalt (volgende laag):**
- (a) De QC-troef (verplicht ¥6 op élke order) wordt economisch ondergraven bij elke annulering.
- (b) Op goedkope items (M8) tikt dit dubbel aan.
**System action:** Boek QC/value-added als aparte (niet-restitueerbare) kostenpost; toon als
Flowva-verlies in finance; overweeg QC pas te triggeren ná de QC-poort/non-annuleer-venster.
**Tag:** [CONFIRMED] (refund_order refundt alleen de goederen-lijn).
**Kruisverwijzing:** nieuw t.o.v. 09-refund-scenario's.

### M8. Floor-fee + verplichte fee-restitutie bij herroeping = dubbel verlies op goedkope items
**Trigger:** Klant koopt een goedkoop item €5 → service fee = **€5 floor** (`max(8%, €5)`) → charge €10;
daarna geldige EU-herroeping.
**Flow:**
1. QC ¥6 + fulfilment ¥9,9 + verzending maken €5-items **gegarandeerd verlieslatend**. **[CONFIRMED]**
2. Bij herroeping moet (consumentenrecht) **ook de standaard-leveringskost/dienst** terug → de
   service fee moet (deels) gerestitueerd. **[CONFIRMED — EU-recht]** ([TO-VERIFY exacte reikwijdte
   per dienst].)
3. Er is **geen guard** die losse sub-€X-aankopen weigert of de fee binnen wettelijke grenzen
   niet-restitueerbaar markeert. **[CONFIRMED]**
**Wie betaalt wat:** Flowva verliest op het item én moet de fee terugbetalen → **dubbel verlies** op
precies de items die al verliesgevend zijn.
**Wat als het faalt (volgende laag):**
- (a) M7: QC/services óók niet terug te halen → drievoudig.
- (b) Bundel-strategie (mik €20-40) wordt ondergraven door losse goedkope checkouts.
**System action:** Minimum-mandwaarde of bundel-dwang; markeer (binnen wettelijke grenzen)
niet-restitueerbare kosten; modelleer fee-restitutie in unit-economics.
**Tag:** [CONFIRMED] (floor-fee + geen guard + herroeping-restitutieplicht).
**Kruisverwijzing:** combineert 11-B (goedkoop item) met 09 (fee-refund).

---

## R. RACES & PRODUCT-KOPPELING (02/01/12)

### R1. Oversell-race: twee Flowva-klanten kopen tegelijk het laatste stuk
**Trigger:** Twee klanten kopen gelijktijdig het LAATSTE stuk van een 1-voorraad-SKU.
**Flow:**
1. Beide `pay_cart`'s slagen — de saldo-lock is **per-profiel (`for update` op `profiles`), niet
   per-product**; er is **geen Flowva-interne voorraadreservering**. **[CONFIRMED]**
2. Beide orders → `quote_accepted` → `place-bucky-order` vuurt 2×.
3. BuckyDrop koopt voor A, geeft out-of-stock voor B → B krijgt auto-refund (numerieke code-tak).
4. De price-guard checkte **alleen prijs**, niet realtime voorraad-vs-andere-Flowva-klanten. **[CONFIRMED]**
**Wie betaalt wat:** B krijgt een verwarrende auto-refund nadat de UX "gekocht" beloofde; willekeurige
verliezer; Flowva draagt de QC/fee-kosten van B (M7).
**Wat als het faalt (volgende laag):**
- (a) Hero-/schaarse items (LITHRA-launch) → dit gebeurt gegarandeerd bij drops.
- (b) Als BuckyDrop géén nette code geeft (netwerkfout) → B hangt op `bd_error` i.p.v. refund (zie R3).
**System action:** Optimistische voorraad-decrement met per-SKU-lock in `pay_cart` (reserveer →
bevestig bij BuckyDrop-succes → vrijgeven bij refund); toon "reserved"-state; bij drops een
queue/allocatie.
**Tag:** [CONFIRMED] (per-profiel-lock, geen voorraadreservering, prijs-only guard).
**Kruisverwijzing:** nieuw t.o.v. 02 (prijs-race / server-side-uitverkocht).

### R2. Ambigue `source_url`: `pay_cart` en `place-bucky-order` kunnen twee verschillende products-rijen kiezen
**Trigger:** Twee catalogus-producten delen dezelfde `source_url` (bewust herbruikt of dubbel
gecureerd met afwijkende `bd_skus`/marge).
**Flow:**
1. `pay_cart` neemt de **prijs** via `products.price` op `source_url` (`limit 1`). **[CONFIRMED]**
2. `place-bucky-order` doet `.eq('source_url', …).limit(5)` en kiest het **eerste record met een
   `spu_code` + niet-lege `bd_skus`** (anders het eerste record). **[CONFIRMED]**
3. → De prijs kan uit **rij A** komen en de `skuCode`/`spu_code` uit **rij B** → stille prijs/SKU-
   mismatch.
**Wie betaalt wat:** Klant betaalt rij-A-prijs maar krijgt rij-B-product/SKU → marge-lek of verkeerd
artikel; geen foutmelding.
**Wat als het faalt (volgende laag):**
- (a) Verschillende marges per rij → onvoorspelbaar verlies.
- (b) `pickSku` matcht dan op de verkeerde `bd_skus`-set → variant-mismatch.
**System action:** Forceer unieke `source_url` (unique index) of koppel `pay_cart` én
`place-bucky-order` aan hetzelfde `product_id` (niet `source_url`); selecteer deterministisch dezelfde rij.
**Tag:** [CONFIRMED] (limit-1 vs limit-5 + first-with-spu).
**Kruisverwijzing:** verscherpt 01-scenario L (dubbele source_url) naar cross-functie-divergentie.

### R3. Lege CNY-wallet ≠ uitverkocht — misclassificatie geeft onterechte annulering
**Trigger:** CNY-wallet (prepaid) staat te laag wanneer `place-bucky-order` `shop-order/create` doet.
**Flow:**
1. BuckyDrop weigert **vermoedelijk met een numerieke `code`** (saldo-fout). **[ASSUMED — BuckyDrop
   geeft codes; exacte wallet-fout-code [TO-VERIFY]]**.
2. De code-tak interpreteert **élke numerieke `res.code`** als "gestructureerde afwijzing" →
   `refund_order` + cancel. **[CONFIRMED]**
3. → Een **treasury-probleem** (lege wallet, op te lossen met bijvullen + retry) wordt behandeld als
   een **echt-uitverkocht-fout** → klant verliest onterecht zijn aankoop.
**Wie betaalt wat:** Klant krijgt refund (goed), maar verliest het product dat hij wél had kunnen
krijgen; Flowva mist de verkoop juist op **piekmomenten** (wallet leeg = veel orders).
**Wat als het faalt (volgende laag):**
- (a) Bij een drop loopt de wallet leeg → een **golf** onterechte annuleringen tegelijk.
- (b) QC/fee al gemaakt? Nee (vóór inkoop), maar reputatie + gemiste marge.
**System action:** Onderscheid wallet-saldo-fouten (specifieke code) van out-of-stock; bij
wallet-fout → **niet** refunden maar `bd_error`/retry-queue + admin-alert "bijvullen"; lage-wallet-
drempel-alert vóór de drop.
**Tag:** misclassificatie [CONFIRMED]; exacte wallet-code [TO-VERIFY].
**Kruisverwijzing:** verbijzondert 12 "wallet leeg → refund te grof".

---

## V. SIGNATURE, FEN/YUAN & CUTOVER (12)

### V1. Inkomende sign-verificatie: false-negatives door lege-veld-filtering / type-coercion / encoding
**Trigger:** BuckyDrop stuurt een veld dat in **hún** sign meetelt maar bij ons als lege string /
`'0'` vs `0` / met encoding-verschil binnenkomt.
**Flow:**
1. `verifySign` **filtert `null`/`undefined`/`''` eruit** vóór sorteren+hashen. **[CONFIRMED]**
2. Als BuckyDrop een veld in de sign meeneemt dat bij ons leeg/anders-getypeerd is → de
   gereconstrueerde string wijkt af → MD5 matcht niet → **401**, en de échte status-update
   (delivered / defect-`picList`) wordt **afgewezen** en alleen rauw gelogd. **[CONFIRMED]**
3. Er is **geen alerting** op een burst van sign-fails. **[CONFIRMED]** (alleen `bucky_notifications`-log).
**Wie betaalt wat:** N.v.t. direct; gevolg = **stille status-drift** (orders missen delivered/defect-
updates) → verkeerde state → fout richting klant.
**Wat als het faalt (volgende laag):**
- (a) Defect-`picList` afgewezen → geen QC-bewijs (chargeback-impact X1).
- (b) Delivered afgewezen → order blijft "shipped" → klant krijgt geen "Delivered"-push.
**System action:** [TO-VERIFY] reconstrueer de sign exact zoals BuckyDrop (inclusief lege velden /
`'0'`-strings / UTF-8) tegen een echt voorbeeld; voeg een teller + alert toe bij aanhoudende
`sign_ok=false`-burst.
**Tag:** [CONFIRMED] (filter + 401 + geen alert); exacte sign-recept [TO-VERIFY].
**Kruisverwijzing:** verbijzondert 12 "signature-fail".

### V2. Fen/Yuan-eenheidsval bij parcel-reconcile (100×-risico)
**Trigger:** Reconcile/supplement kruist `pkg/detail.salePrice` (FEN) met `channel-carriage-list`
(`totalPrice`/`goodsPrice` in YUAN).
**Flow:**
1. `pkg/detail.salePrice` is expliciet **FEN** (1 Yuan = 100 Fen); logistics rekent in **YUAN/RMB**;
   `haul-shipping` deelt door `CNY_PER_EUR`. **[CONFIRMED]**
2. Behandelt de reconcile/supplement een fen-veld als yuan (of omgekeerd) → bedrag is **100× fout**.
**Wie betaalt wat:** 100× te weinig afrekenen = enorme onderdekking; 100× te veel = klant overcharged
+ refund-storm.
**Wat als het faalt (volgende laag):**
- (a) De cutover-memo waarschuwt generiek voor fen×100 maar **niet specifiek voor `salePrice`**.
- (b) Combineert met C-SUP (supplement) → een 100× supplement-charge.
**System action:** Normaliseer alle CNY naar één eenheid bij binnenkomst (markeer fen-velden expliciet
/100); unit-test op `salePrice`-conversie; sanity-bound op elk afgeleid EUR-bedrag.
**Tag:** [CONFIRMED] (salePrice in fen vs logistics in yuan).
**Kruisverwijzing:** scherpt 12's generieke fen/yuan-checklist.

### V3. Cutover booby-trap: `IS_SANDBOX`-fallback valt weg terwijl currency/FX onbevestigd is
**Trigger:** Productie-cutover: `BUCKY_DOMAIN` wijzigt → `IS_SANDBOX` → `false`.
**Flow:**
1. `haul-shipping` toont dan **echte kanalen** i.p.v. terug te vallen op de schatting
   (`isSandbox` werd door de UI gebruikt om de schatting te kiezen). **[CONFIRMED]**
2. `CNY_PER_EUR` is een **hardgecodeerde env-default (7.7)**, niet per order vastgelegd; de
   channel-currency staat met **TODO "te bevestigen"** gemarkeerd. **[CONFIRMED]**
3. → Als de echte currency **fen** blijkt (×100, V2) of de koers afwijkt, rekent Flowva op live-prod
   **meteen 100× of fors fout** zonder snapshot of sanity-check.
**Wie betaalt wat:** Op cutover-moment direct over/onder-charging op élke haul tot iemand het merkt.
**Wat als het faalt (volgende laag):**
- (a) Dubbel risico op één moment: fallback verdwijnt **precies** wanneer onbevestigde currency/FX
  live gaat.
- (b) Geen per-order FX-snapshot → historische reconcile onmogelijk.
**System action:** Bevestig channel-currency vóór cutover (V2); leg per haul een **FX-snapshot** vast;
sanity-bound (afwijzen als verzending buiten [€X, €Y]); behoud de schatting als veiligheidsnet tot
één echte order is gevalideerd.
**Tag:** [CONFIRMED] (IS_SANDBOX-fallback + hardcoded FX + currency-TODO).
**Kruisverwijzing:** samengesteld cutover-gat t.o.v. 12-checklist.

---

## F. FRIENDS — HOST-ADRES & DEADLOCK (15/13)

### F-HOST. Host-adres niet bevroren bij plaatsing — live read kan groeps-pakketten misrouten
**Trigger:** Host wijzigt adres (of host-overdracht na leave/kick) **tussen** groep-plaatsing en
inkoop.
**Flow:**
1. `ff_create_orders_on_placement` zet per lid een order met **alleen `host_user_id`** — het
   host-**adres** wordt **niet** bevroren. **[CONFIRMED]**
2. `place-bucky-order` leest het host-adres **live** uit `user_metadata` op het inkoopmoment
   (`getUserById(host_user_id)`). **[CONFIRMED]**
3. → Wijzigt de host zijn adres (of wordt een nieuwe host) ná plaatsing, dan gaan **alle**
   groeps-pakketten naar het **nieuwe/verkeerde** adres, zonder dat de leden dat wisten/goedkeurden.
**Wie betaalt wat:** Misrouted pakketten → return-to-sender of verloren → Flowva-refund/herverzending;
leden gedupeerd.
**Wat als het faalt (volgende laag):**
- (a) Host-overdracht (`flowva-friends-money` zet `host_id` over) ná plaatsing → orders wijzen naar
  oud `host_user_id` of het adres verandert onder de leden vandaan.
- (b) Privacy: leden-pakketten naar het privéadres van een nieuwe host die ze niet kozen.
**System action:** Bevries het host-**adres** als snapshot op de order bij `ff_create_orders_on_placement`
(niet alleen `host_user_id`); bij host-wijziging expliciete her-bevestiging door leden.
**Tag:** [CONFIRMED] (alleen host_user_id opgeslagen; live address-read).
**Kruisverwijzing:** verbijzondert 15 "afleveradres bevroren bij plaatsing" (intentie ≠ code).

### F-GDPR. Host-account gewist ná plaatsing → dangling `host_user_id` → lege adresvelden
**Trigger:** De host verlaat via een pad **buiten** `ff_leave_group` — bv. **GDPR-account-deletie**
van de host-user — terwijl leden al ready+held zijn.
**Flow:**
1. `host_user_id` op de reeds-geplaatste orders wijst dan naar een **niet-bestaande/gewiste** user.
   **[CONFIRMED — adres niet bevroren, zie F-HOST]**.
2. `place-bucky-order`'s `getUserById(host_user_id)` **faalt of geeft lege metadata** → adresvelden
   worden allemaal `"-"`/leeg. **[CONFIRMED — default `"-"`/`""` in orderBody]**.
3. → BuckyDrop weigert of verzendt naar een onbruikbaar adres.
**Wie betaalt wat:** Onbezorgbaar/weigering → refund/blokkade; leden gedupeerd; mogelijk QC al gemaakt (M7).
**Wat als het faalt (volgende laag):**
- (a) `countryCodeFor("")` → stille NL-default (A-RACE) → "NL" met lege straat → onbezorgbaar.
- (b) GDPR-deletie zelf moet de groeps-host-rol netjes overdragen — doet het pad dat niet, dan hangen
  alle orders.
**System action:** Bij GDPR-deletie van een host met openstaande groeps-orders: blokkeer/forceer
host-overdracht + adres-snapshot; `place-bucky-order` moet leeg/`-`-adres **hard weigeren** i.p.v.
indienen.
**Tag:** [CONFIRMED] (dangling host_user_id → lege metadata → `-`-velden).
**Kruisverwijzing:** koppelt 15 (host-vertrek) aan 13 (GDPR-deletie).

### F-DEAD. `ff_pay_group_shipping` all-items-weighed-gate → één kapot item gijzelt de hele groep
**Trigger:** Eén lid-item zit permanent vast (defect-hold, leverancier levert nooit, of `weight=0`,
zie S4).
**Flow:**
1. `ff_pay_group_shipping` weigert zolang **`v_unweighed > 0`** ("Shipping opens once every item in
   the group has reached the warehouse and been weighed"). **[CONFIRMED]**
2. → **ALLE** andere leden kunnen hun reeds gekochte, gewogen items **nooit** laten verzenden — de
   hele groep is gegijzeld door één probleem-item. **[CONFIRMED]**
3. Er is **geen ontsnappings-/split-pad** (de gate bestaat juist om het first-weight-blok één keer te
   delen).
**Wie betaalt wat:** Onschuldige leden betalen niet kunnen verzenden → hun items hangen → opslag-drain
(S2) → mogelijk `closeTime`-verlies (S1).
**Wat als het faalt (volgende laag):**
- (a) `ff_cancel_group_order` kan een lid-item annuleren **vóór** group-shipping-betaling, maar lost
  een **gewichtsloos/defect** item van een **ander** lid niet op.
- (b) Het probleem-item kan nooit gewogen worden (S4) → permanente deadlock.
**System action:** Sta een **split-uitweg** toe: leden mogen verzenden zonder het probleem-item
(herbereken het gecombineerde blok over de wél-gewogen items), of zet een deadline waarna het
probleem-item geannuleerd/uitgesloten wordt en de rest doorgaat.
**Tag:** [CONFIRMED] (v_unweighed-gate blokkeert de hele groep).
**Kruisverwijzing:** uitwerking van 15's group-consolidatie/gewicht-split als deadlock.

---

## L. JURIDISCH — TRANSPARANTIE-MODEL (13)

### L1. Transparante fabrieksbron/-prijs lokt IP-/merk-/platform-claims uit — geen pre-publicatie-check of takedown
**Trigger:** GPSR/markttoezicht of een betaalprovider vraagt productveiligheids-/herkomstdata; óf een
merk/fabrikant/bronplatform ziet zijn product (met **publieke 1688/Taobao-link + fabrieksprijs**) in
de Flowva-feed.
**Flow:**
1. Flowva toont **publiek** de echte fabrieksbron + prijs (kern van het transparante model). **[CONFIRMED]**
2. Een merk (wiens product zonder toestemming wordt doorverkocht) of het bronplatform kan een
   **IP-/merkrecht-** of **BuckyDrop-agreement-claim** (no-reselling/kwalificatie) indienen. **[ASSUMED — juridisch]**
3. Er is **geen takedown-/notice-and-action-flow** en **geen pre-publicatie-check** of een gecureerd
   product een beschermd merk/namaak is. **[CONFIRMED — geen code/proces]**
**Wie betaalt wat:** Bij een claim: verwijderkosten, mogelijke schadevergoeding/boete, accountrisico
bij BuckyDrop (agreement-schending) en bij de betaalprovider.
**Wat als het faalt (volgende laag):**
- (a) Namaak (counterfeit) passeert curatie (04 noemt het pas bij QC) → IP-inbreuk + douane (07-F3).
- (b) Het transparante model maakt inbreuk **makkelijk aantoonbaar** voor de klager (bron staat erbij).
- (c) GPSR vereist een verantwoordelijke marktdeelnemer/veiligheidsdata die Flowva niet vastlegt.
**System action:** Pre-publicatie merk-/namaak-check (merknaam-blocklist, beschermde-merken-screening);
notice-and-action/takedown-procedure + contactpunt; GPSR-velden (verantwoordelijke persoon,
veiligheids-/herkomstdata) opslaan; juridisch toetsen of fabrieksprijs/-link publiek tonen mag onder
het BuckyDrop-agreement.
**Tag:** publieke bron/prijs + geen check/takedown [CONFIRMED]; claim-blootstelling [ASSUMED]; 5 punten
voor NL-adviseur.
**Kruisverwijzing:** uniek transparantie-model-risico t.o.v. 13 (agreement) en 04 (counterfeit-QC).
