# 05 — Domestic China-handling, QC, foto's & value-added services

Deze sectie dekt alles wat er met een order gebeurt vanaf het moment dat de seller-zending het BuckyDrop-magazijn in China bereikt, tot het pakket internationaal vertrekt: inbound-check, het verplichte QC-pakket (standard photos ¥2 + garment measurement ¥4), value-added services, defect-detectie, consolidatie/haul, warehousing en alle faal-/edge-cases. Het transparante kernmodel maakt QC tot dubbele troef: marketing/transparantie-bewijs én retour-/dispuut-bewijs. Alle prijzen in CNY (¥) zijn BuckyDrop-wallet-kosten (prepaid); de klant heeft in EUR via Stripe betaald.

**Grounding-status van dit hoofdstuk (lees dit eerst):**
- De BuckyDrop API-docs (order/parcel/product/logistics/notifications) bevatten **GEEN** endpoint of request-veld om value-added services (foto's, opmeten, ironing, tag-switch, reinforcement, preselect) per order via de API aan/uit te zetten. [CONFIRMED — gecontroleerd: `order/create shop order` body heeft alleen adres + `productList`; `product/*` heeft search/detail/category/create-custom; geen service-veld]
- Conclusie: value-added/QC wordt **dashboard-side** geconfigureerd (My Services → Service Preselection = auto op alle orders, of Service Market = per los product). De API laat de *kosten* en *uitkomst* alleen achteraf zien (order-detail `serviceAmount`, Po Pending `picList`/`confirmType`). Dit is de grootste open afhankelijkheid van dit hoofdstuk → zie open questions. [CONFIRMED dat het niet in de API-docs staat] [TO-VERIFY of er een verborgen/ongedocumenteerd service-veld bestaat — vraag agent Vera + check dashboard My Services]
- De ¥2 / ¥4 / ¥6-bedragen en "30 dagen gratis opslag" staan **niet** in de gelezen API-docs; ze komen uit het Flowva-kernmodel/agent-afspraak. Overal als [ASSUMED]/[TO-VERIFY] getagd.

---

## 0. Statusmodel & webhook-mapping (referentie voor alle scenario's hieronder)

**Flowva-orderstatussen:** `purchased → bought → shipped_local → qc_pending → shipped_international → delivered`. De webhook beweegt alleen vooruit (RANK-gate) en zet nooit terug. [CONFIRMED — `buckydrop-webhook/index.ts` `RANK` + `setOrderStatus`]

**BuckyDrop PO `orderStatus` (1–12), uit de docs:** 1 paid, 2 in review/under approval, 3 processing, **4 to be confirmed (incl. supplementary payment)**, 5 ordered, 6 shipped out, 7 received/signed, **8 cancelled**, 9 stock-in/inbound, 10 stock-out/outbound, 11 delivered (international), 12 fulfilled. [CONFIRMED — Notify Po Status screenshot + order-details-query screenshot]

**Webhook → app-status mapping (huidige code):** 5→bought, 6→shipped_local, **9→qc_pending**, 11→shipped_international, 12→delivered; 8→`refund_order`. [CONFIRMED — `PO_STATUS_MAP` + status 8-tak in `buckydrop-webhook/index.ts`]

**Belangrijke observatie voor dit hoofdstuk:** "QC" in Flowva = de fase die begint bij **orderStatus 9 (stock-in)** → app-status `qc_pending`. De QC-foto's/metingen worden door BuckyDrop ná inbound gemaakt; defecten komen via **Notify Po Pending** (`confirmType` + `picList`). [CONFIRMED — mapping + webhook pic-afhandeling]

**Notify Po Pending (defect-melding):** velden `confirmType` (string, "the product is defective", **Required**) en `picList` (Array[], "Product's inspection service picture", **Required**) zijn beide verplicht → bij een defect komt de inspectiefoto **gegarandeerd** mee. [CONFIRMED — Notify Po Pending screenshot]

**Notify Parcel Status `packageStatus` (1–10):** o.a. **8 = parcel returned domestically**, 9 = parcel returned from abroad, 10 = cancelled; `pkgNormalStatus` (1–5): 4 = delivered. [CONFIRMED — Notify Parcel Status screenshot]

**Order-detail query levert ná inbound de échte fysieke data:** `skuWeight` (g), `skuLong/skuWide/skuHeight` (cm), `warehouseName`, `signTime`, `putStorageTime`, en kosten `serviceAmount` (service fees total), `freightAmount`, `productSupplementAmount`, `repairAmount` (price difference), `returnQuantity`. [CONFIRMED — order-details-query screenshots]

---

## 1. Happy path — inbound check & stock-in

**Trigger:** Seller-zending arriveert bij het BuckyDrop-magazijn; BuckyDrop scant in. PO gaat naar `orderStatus 9` (stock-in). Webhook `Notify Po Status` (notifyType 1 = "PO arrives at warehouse") wordt verstuurd. [CONFIRMED — Notify Po Status notifyType + orderStatus 9]

**Flow:**
1. BuckyDrop ontvangt de seller-doos, telt de items, doet basale inbound-check (juiste SKU/aantal). [ASSUMED — standaard agent-werkwijze; niet in API-docs]
2. Webhook POST naar `buckydrop-webhook`; handtekening (MD5 over gesorteerde niet-lege `notifyHeader` + `&appSecret=`) wordt geverifieerd. [CONFIRMED — `verifySign`]
3. `findPO` vindt het PO-object (`orderCode` + `orderStatus`); `orderStatus 9` mapt naar `qc_pending`; `setOrderStatus` zet de order vooruit. [CONFIRMED]
4. Order-detail query (op `shop_order_no`) kan nu de échte `skuWeight` + `skuLong/Wide/Height` ophalen → die vullen `weight_grams` (nu nog leeg → verzendquote blokkeert). [CONFIRMED dat detail-query die velden heeft; TO-VERIFY of Flowva ze al ophaalt — `haul-shipping` gebruikt `weight_grams` maar er is geen code die het uit de detail-query schrijft]

**Wie betaalt wat:** Inbound-check zelf = gratis/inbegrepen in fulfilment-fee ¥9,9/parcel. [ASSUMED — niet apart in docs] De QC-services (foto ¥2 + meten ¥4 = ¥6) worden ná stock-in uitgevoerd → zie §2. De klant heeft alles al in EUR voorbetaald; deze ¥-kosten gaan uit de prepaid wallet.

**Wat als het faalt (volgende edge-laag):**
- **Webhook komt nooit / mist** (BuckyDrop stuurt niet, of onze functie was down): order blijft hangen op `bought`/`shipped_local`. → Need: cron/fallback die periodiek de order-detail query draait en de status reconcilieert. [TO-VERIFY — bestaat nog niet; geen polling-functie gevonden]
- **Out-of-order webhook** (11 vóór 9): RANK-gate negeert de lagere status, maar als 9 nooit komt slaan we `qc_pending` over → QC-foto-stap mist in onze UI. [CONFIRMED gedrag; ASSUMED risico]
- **Ongeldige handtekening:** 401 terug, ruwe payload toch gelogd in `bucky_notifications`, geen statusupdate. [CONFIRMED]
- **Aantal mismatch bij inbound** (minder items dan besteld): valt waarschijnlijk onder Po Pending of een supplement → §5/§9. [ASSUMED]

**System action:** Webhook → `PO_STATUS_MAP[9]='qc_pending'` → `setOrderStatus`. Aanbevolen aanvulling: na `qc_pending` een order-detail query om `weight_grams`/dims te schrijven (RPC of edge-functie). [CONFIRMED bestaande tak; TO-VERIFY de aanvulling]

---

## 2. Verplicht QC-pakket — Standard Product Photos (¥2) + Garment Measurement (¥4)

**Trigger:** Order staat op `qc_pending` (stock-in voltooid). Voor ELKE LITHRA-order is het ¥6-QC-pakket verplicht. [ASSUMED — Flowva-kernmodel, geen API-bron]

**Flow:**
1. **Standard Product Photos** (¥2/SKU, 3-foto-set): magazijn maakt 3 foto's per SKU → bewijs van werkelijk ontvangen artikel. [ASSUMED prijs/inhoud; geen API-doc]
2. **Garment Measurement Service** (¥4/SKU): magazijn meet de echte maten (borst/lengte/etc.) en vergelijkt met de seller-omschrijving → vangt verkeerde maat/mislabel vóór internationale verzending. [ASSUMED]
3. Resultaat (foto's + meetrapport) verschijnt in het BuckyDrop-dashboard/order-detail; in Flowva tonen we het als transparantie-bewijs op de orderpagina. [TO-VERIFY hoe we de QC-foto's bij een *gezonde* order ophalen — de webhook levert `picList` alleen bij Po Pending/defect; voor de normale 3-foto-set is er geen webhook-veld gevonden → waarschijnlijk alleen via dashboard of order-detail `picturePath`]

**Wie betaalt wat:** ¥6/SKU uit de prepaid BuckyDrop-wallet (Flowva voorgefinancierd via Stripe→Wise→wallet). In het transparante prijsmodel zit dit in de service fee 8% (min €5) óf wordt apart als "QC & transparantie" getoond. [ASSUMED — modelbeslissing; TO-VERIFY hoe het in de prijsopbouw/checkout staat]

**Wat als het faalt (volgende edge-laag):**
- **Meting wijkt af van seller-omschrijving** (bv. besteld M = 102cm borst, gemeten 94cm): dit is functioneel een "foute maat"-defect → BuckyDrop kan dit als Po Pending defect melden, óf het komt alleen in het meetrapport zonder defect-flag. [TO-VERIFY of measurement-afwijking automatisch een Po Pending triggert of alleen passief in het rapport staat — vraag Vera]
- **Foto toont schade** die de seller niet vermeldde → defect-route §5.
- **Service is dashboard-side niet geactiveerd** (Preselection vergeten): order gaat zónder QC door → grootste transparantie-/retourrisico. Mitigatie: My Services → Service Preselection AAN voor alle orders, niet per product. [CONFIRMED dat dit dashboard-side moet; ASSUMED de mitigatie]
- **Per-SKU vs per-order kosten** bij multi-item order: ¥2/¥4 zijn *per SKU* → een 5-item bundel = ¥30 QC, niet ¥6. Belangrijk voor de bundel-economie (mik €20–40/bundel). [ASSUMED prijsstructuur per SKU]

**System action:** Geen directe API-call (dashboard-config). App-side: order-detail query om `serviceAmount` te lezen en de QC-kosten te reconciliëren; QC-foto's tonen via `qc_images`. [CONFIRMED `serviceAmount` bestaat + `qc_images` kolom bestaat; TO-VERIFY de ophaal-flow voor niet-defecte foto's]

---

## 3. Value-added services — Preselection (alle orders) vs Service Market (per product)

**Trigger:** Flowva wil extra bewerkingen op (scommige) orders: ironing (strijken), tag switch/removal (sellertag eraf, eigen LITHRA-label erop), reinforcement (extra verpakkingsbescherming), extra foto's. [ASSUMED diensten-lijst; geen API-doc]

**Flow:**
1. **Service Preselection** (My Services): zet een dienst AAN voor **alle** toekomstige orders automatisch — gebruik voor het verplichte QC-pakket (foto + meten). [CONFIRMED dat dit het Preselection-mechanisme is per kernmodel; ASSUMED exacte UI]
2. **Service Market**: voeg een dienst toe aan **één los product/SKU** — gebruik voor incidenteel (bv. tag-switch alleen op een specifieke drop). [CONFIRMED concept per kernmodel]
3. BuckyDrop voert de dienst uit tijdens warehouse-handling (tussen stock-in en outbound). [ASSUMED timing]

**Wie betaalt wat:** Elke value-added dienst = extra ¥ uit de wallet, zichtbaar achteraf in order-detail `serviceAmount` (totaal service-fees). [CONFIRMED `serviceAmount` veld; ASSUMED dat alle VAS daarin landen] Per-dienst tarieven staan **niet** in de API-docs → [TO-VERIFY in dashboard Service Market prijslijst].

**Wat als het faalt (volgende edge-laag):**
- **Dienst niet uitvoerbaar** (bv. tag zit vastgenaaid, niet te switchen): magazijn kan het overslaan of als Po Pending opwerpen. [ASSUMED]
- **Preselection geldt ook voor Flowva Friends groeps-orders** → kosten vermenigvuldigen per lid-SKU; check of dat de groepsprijs niet onderuit haalt. [ASSUMED — raakvlak met Friends-economie]
- **Dubbele config** (zowel Preselection áls Market voor dezelfde dienst) → mogelijk dubbel uitgevoerd/gefactureerd. [TO-VERIFY of BuckyDrop dedupliceert]
- **Geen API-controle:** we kunnen niet programmatisch garanderen dat een dienst aanstond per order; enige verificatie achteraf is `serviceAmount` > 0. → reconcile-check inbouwen. [CONFIRMED beperking]

**System action:** Dashboard-config (geen API). App-side reconcile: order-detail query → vergelijk `serviceAmount` met verwacht (¥6 + VAS). Bij €0 service terwijl verwacht → alert in ai-ops-hud. [TO-VERIFY — reconcile bestaat nog niet]

---

## 4. Defect gevonden (heel-item defect) → Notify Po Pending

**Trigger:** Tijdens inbound/QC ontdekt het magazijn dat het artikel defect is (scheur, vlek, kapot, verkeerd artikel). BuckyDrop stuurt **Notify Po Pending** met `confirmType` ("the product is defective") + `picList` (inspectiefoto's). [CONFIRMED — Po Pending screenshot]

**Flow:**
1. Webhook arriveert; `findPics` vindt `picList`, `confirmType` (of `po.confirmType`) aanwezig. [CONFIRMED]
2. Order krijgt `qc_images = picList`, `dispute_status = 'pending'`, `problem_type = confirmType`. [CONFIRMED — `buckydrop-webhook/index.ts` regels 108–114]
3. PO blijft "pending" tot Flowva een beslissing doorgeeft (doorsturen-met-defect / vervangen / annuleren-refund). [ASSUMED — "PO need to be resolved" uit doc-titel; exacte resolve-API niet in gelezen docs]
4. Flowva toont de inspectiefoto's aan admin (ai-ops-hud) en/of klant; beslissing → refund of doorgaan.

**Wie betaalt wat:** Inspectie zelf = onderdeel QC. Bij annulering/refund: klant krijgt terug (zie refund-lek hieronder). Reeds gemaakte QC-kosten (¥6) zijn al uitgegeven en niet terugvorderbaar van de klant. [ASSUMED]

**Wat als het faalt (volgende edge-laag):**
- **Refund naar verkeerde bron:** `refund_order` RPC refundt NU naar in-app saldo, maar wettelijk (EU) moet het naar de originele Stripe-betaalmethode. → bekend lek, zie memory `flowva-audit`. [CONFIRMED probleem bestaat in code-pad]
- **`confirmType` ontbreekt maar `picList` is er wel:** code zet dan wél `qc_images` maar GEEN `dispute_status` → defect blijft onopgemerkt in de UI. [CONFIRMED — conditionele spread regel 111]
- **Resolve-actie niet teruggestuurd:** PO hangt op pending → magazijn doet niets → 30-dagen-opslagklok kan gaan tikken (§8). [ASSUMED]
- **Geen menselijke triage:** `dispute_status='pending'` zonder admin-alert blijft liggen. → push/ai-ops-hud-alert koppelen aan deze update. [TO-VERIFY of er een trigger op `dispute_status` staat]

**System action:** Webhook schrijft `qc_images`/`dispute_status`/`problem_type`. Resolve → (a) doorgaan: niets, status loopt door; (b) annuleren: BuckyDrop cancel → PO 8 → `refund_order`. [CONFIRMED de 8→refund-tak] Aanbevolen: aparte resolve-RPC die naar Stripe refundt. [TO-VERIFY]

---

## 5. Deel van een multi-item order defect (partieel defect)

**Trigger:** Bij een order met meerdere SKU's/quantity is er één defect, de rest OK. Po Pending komt voor het PO, maar mogelijk op item-niveau. [ASSUMED — `picList`/`confirmType` lijken op PO-niveau gemodelleerd, niet per item]

**Flow:**
1. Webhook zet `dispute_status='pending'` op de hele order-id (Flowva-order = 1 partnerOrderNo). [CONFIRMED — update op `id = partnerOrderNo`]
2. Beslissing: alleen het defecte item refunden/vervangen, de rest doorsturen.

**Wie betaalt wat:** Partiële refund = alleen de defecte SKU + evt. pro-rata verzend/QC. De rest van de order betaalt klant volledig. [ASSUMED]

**Wat als het faalt (volgende edge-laag):**
- **`refund_order` is order-breed, niet per item:** een partiële refund vereist een per-line refund die de huidige RPC waarschijnlijk niet ondersteunt → ofwel hele order refunden (te veel), ofwel handmatig. [TO-VERIFY — `refund-order.sql` lezen; vermoedelijk order-niveau]
- **Doorsturen-met-defect zónder klantakkoord** = juridisch/UX-risico (klant krijgt half-defecte bundel). → klant moet kiezen. [ASSUMED]
- **Consolidatie al gebeurd:** als het pakket al geconsolideerd is met het defecte item erin, kost uithalen extra handling. [ASSUMED]
- **Flowva-model = 1 product per order** (place-bucky-order pakt eerste gematchte product, `productList` met 1 entry): partieel-defect speelt dan vooral bij `qty > 1` of bij Friends-bundels, niet bij losse multi-SKU. [CONFIRMED — `productList` heeft 1 item in `place-bucky-order/index.ts`]

**System action:** Bij partieel: handmatige/te-bouwen per-line refund-RPC. Nu: `dispute_status='pending'` + admin-triage. [TO-VERIFY per-line support]

---

## 6. Verkeerde maat / mislabel ontdekt door measurement-service

**Trigger:** Garment Measurement (¥4) meet maten die niet matchen met wat de seller claimde (bv. "L" is feitelijk een "M"). [ASSUMED — kernmodel-doel van de meetservice]

**Flow:**
1. Magazijn legt de echte maten vast in het meetrapport (en order-detail `specifications`/dims). [CONFIRMED dims-velden bestaan]
2. Als de afwijking groot is → behandeld als defect (Po Pending) of als info-only rapport. [TO-VERIFY of measurement-mismatch automatisch Po Pending triggert]
3. Flowva-beslissing: doorsturen met de échte maat in de productdata (size-chart correctie), of annuleren.

**Wie betaalt wat:** Meting al betaald (¥4, in QC-pakket). Bij annulering → refund (Stripe-lek geldt). Bij doorsturen → niets extra.

**Wat als het faalt (volgende edge-laag):**
- **Geen automatische defect-flag:** mismatch staat alleen passief in het rapport → menselijke review nodig vóór outbound. [TO-VERIFY]
- **Size-chart niet bijgewerkt:** klant ontvangt verkeerde maat ondanks dat wij het wisten → retour + verlies. → koppel measurement aan de productdata/size-chart (memory: AI size chart is verwijderd; dit is een handmatige stap). [ASSUMED]
- **Tijd:** measurement vóór outbound betekent dat de status `qc_pending` lang genoeg moet blijven voor menselijke review. [ASSUMED]

**System action:** Order-detail query → schrijf echte dims naar product/order. Bij ernstige mismatch → `dispute_status='pending'`. [TO-VERIFY automatisering]

---

## 7. Beschadigd binnengekomen / item zoek in magazijn

**Trigger A (beschadigd):** Item arriveert beschadigd bij inbound (transportschade seller→magazijn) → Po Pending defect. [CONFIRMED route bestaat]
**Trigger B (zoek):** Magazijn kan het ingeboekte item niet vinden / nooit fysiek ontvangen ondanks seller-"verzonden". [ASSUMED — niet in API-docs als status]

**Flow (zoek):**
1. Geen stock-in (orderStatus blijft < 9) → Flowva-order blijft op `bought`/`shipped_local`. [CONFIRMED gedrag]
2. Na X dagen geen inbound → escaleren naar agent (Vera) / seller-claim. [ASSUMED]

**Wie betaalt wat:** Zoek/niet-aangekomen door seller → seller/agent-claim; klant volledig refunden indען onvindbaar. Transportschade → mogelijk verzekering/agent-coulance. [ASSUMED]

**Wat als het faalt (volgende edge-laag):**
- **Geen timeout-detectie:** een order die nooit stock-in bereikt hangt stil zonder alert. → cron die `bought`/`shipped_local` ouder dan N dagen flagt. [TO-VERIFY — bestaat niet]
- **Item "zoek" maar later teruggevonden:** late stock-in webhook → RANK-gate laat hem alsnog door (vooruit). [CONFIRMED]
- **Beschadigd maar geen `picList`:** zonder foto geen bewijs voor retour/claim → vertrouwen op order-detail of dashboard. [ASSUMED]

**System action:** Geen native "lost"-status in mapping → handmatig/`refund_order`. Aanbevolen: stale-order cron + order-detail polling. [TO-VERIFY]

---

## 8. 30 dagen gratis opslag / warehousing & opslag verloopt

**Trigger:** Item ligt stock-in maar wordt niet verzonden (wacht op consolidatie/bundel/Friends-groep/klantbeslissing). [ASSUMED concept]

**Flow:**
1. Na stock-in (`putStorageTime` bekend) loopt de gratis-opslagklok. [CONFIRMED `putStorageTime` veld bestaat; ASSUMED 30-dagen-regel]
2. Binnen het venster: gratis consolideren/wachten. [ASSUMED]
3. Bij overschrijding: opslagkosten per dag/m³. [TO-VERIFY tarief — niet in API-docs]

**Wie betaalt wat:** Binnen 30 dagen gratis. Daarna opslagkosten uit wallet → Flowva-verlies tenzij doorbelast. [ASSUMED]

**Wat als het faalt (volgende edge-laag):**
- **Opslag verloopt ongemerkt:** geen webhook voor "storage expiring" gevonden → moet zelf berekend uit `putStorageTime` + 30d. [CONFIRMED geen webhook; ASSUMED berekening]
- **Friends-groep vult niet vol:** items van vroege leden liggen te wachten op late leden → opslagklok tikt → failure-flowchart (memory: Friends failure-flowchart = volgende klus). [ASSUMED — raakvlak Friends]
- **Geforceerde outbound bij naderende verloop:** Flowva moet beslissen verzenden (verzendkosten nu) vs opslag betalen. [ASSUMED]

**System action:** Bereken vervaldatum uit `putStorageTime` (order-detail/webhook). Cron-alert N dagen vóór verloop in ai-ops-hud. [TO-VERIFY — bestaat niet]

---

## 9. Consolidatie / haul (meerdere items → één pakket) & overweight/item-surcharge

**Trigger:** Klant (of Flowva/Friends) wil meerdere stock-in items samen verzenden. Flowva quote't via `haul-shipping`. [CONFIRMED — `haul-shipping/index.ts`]

**Flow:**
1. `haul-shipping` action `quote`: laadt orders van de user met status `qc_pending` (en niet-lege `weight_grams`), bouwt `productList` (per item dims default 20×20×10cm, weight uit `weight_grams`/1000, count = qty), roept `logistics/channel-carriage-list` aan. [CONFIRMED]
2. Kanalen → EUR (CNY/EUR ÷ FX-marge 1,03), gesorteerd op prijs; sandbox → `isSandbox=true` fallback op schatting. [CONFIRMED]
3. `pay`: her-quote server-side, kies kanaal op `serviceCode`, reken exact af via `pay_shipping_exact` RPC; tax-inclusive lijnen (`isTariffCover`/`isVat`) → géén 21% bovenop, anders +21% BTW. [CONFIRMED]

**Wie betaalt wat (BuckyDrop fulfilment-kosten, kernmodel):** fulfilment ¥9,9/parcel (1–5 items) + **¥2/item boven 5** + **¥1,5/kg boven 2kg** (overweight). Klant betaalt de verzendquote (EUR, DDP). [ASSUMED tarieven — niet in gelezen API-docs; uit kernmodel] De quote uit `channel-carriage-list` zou deze surcharges idealiter al moeten bevatten. [TO-VERIFY of `totalPrice` de ¥9,9 + per-item + overweight al inrekent of dat Flowva ze apart moet optellen]

**Wat als het faalt (volgende edge-laag):**
- **`weight_grams` leeg:** quote weigert (`needWeight: true`) → klant kan niet verzenden tot wij de echte weight schrijven (uit order-detail `skuWeight`). [CONFIRMED — regel 114] → ontbrekende schakel: niets vult `weight_grams` automatisch. [TO-VERIFY]
- **Default dims 20×20×10:** echte volumetric weight kan hoger zijn → onderschatte quote → Flowva draait op voor het verschil. [CONFIRMED default; ASSUMED risico] Mitigatie: echte `skuLong/Wide/Height` uit order-detail gebruiken.
- **Overweight >2kg / >5 items niet in quote:** als `channel-carriage-list` de surcharges niet meerekent → onderbetaling. → reconcile estimate↔actual (supplement of refund). [TO-VERIFY]
- **Gekozen kanaal verdwenen** tussen quote en pay (her-quote vindt `serviceCode` niet): "shipping option no longer available", 400. [CONFIRMED — regel 128]
- **FX-schommeling:** 1,03-marge kan onvoldoende zijn → klein verlies. [CONFIRMED marge bestaat; ASSUMED risico]
- **Item van andere user/niet qc_pending:** `loadOrders` filtert op `user_id` + status → afgewezen. [CONFIRMED regels 112–113]
- **Categorie default "1":** `bd_category_code` default → verkeerde categorie kan tarief/legaliteit beïnvloeden. [CONFIRMED default; TO-VERIFY echte Cat-Level-III opslaan]

**System action:** `haul-shipping` quote/pay → `channel-carriage-list` + `pay_shipping_exact`. Aanbevolen: order-detail polling om `weight_grams`/dims te vullen; reconcile-RPC voor estimate↔actual. [CONFIRMED bestaand; TO-VERIFY aanvullingen]

---

## 10. Supplementaire bijbetaling (zwaarder/duurder dan geschat) → PO orderStatus 4

**Trigger:** Na inbound blijkt het pakket zwaarder/groter (overweight) of de seller-prijs/verzendprijs hoger → BuckyDrop zet PO op **orderStatus 4 ("to be confirmed incl. supplementary payment")**. [CONFIRMED — orderStatus 4 definitie in docs]

**Flow:**
1. Webhook Notify Po Status met `orderStatus 4`. **Huidige code mapt 4 NIET** (`PO_STATUS_MAP` heeft geen key 4) → actie = "po 4 (no map)", geen statuswijziging, geen klant-actie. [CONFIRMED — ontbreekt in map]
2. Vereist: bijbetaling regelen (extra ¥ in wallet) en/of klant om supplement vragen.

**Wie betaalt wat:** Het supplement (`productSupplementAmount` / `repairAmount` in order-detail) → uit wallet; doorbelasten aan klant indien verzend-gerelateerd (reconcile). Prijsverschil product (`repairAmount`) = Flowva-beleid (slikken of doorbelasten binnen transparantie). [CONFIRMED velden bestaan; ASSUMED doorbelastbeleid]

**Wat als het faalt (volgende edge-laag):**
- **Status 4 genegeerd:** PO hangt op "to be confirmed", magazijn verzendt niet, niemand merkt het → stille stilstand + opslagklok. [CONFIRMED gat in code] → key 4 toevoegen aan handling met admin-alert/klant-supplement-flow.
- **Klant betaalt supplement niet:** order blijft hangen → uiteindelijk annuleren+refunden. [ASSUMED]
- **Auto-bevestigen zonder review:** als we 4 blind zouden bevestigen → onbeperkte kosten. → altijd human/threshold. [ASSUMED]

**System action:** TE BOUWEN: webhook-tak voor `orderStatus 4` → `dispute_status`/nieuw `supplement_pending` + ai-ops-hud-alert; supplement betalen via order-detail `repairAmount`/`productSupplementAmount`; daarna confirm-API. [TO-VERIFY — confirm/supplement-API niet in gelezen docs; check Order-folder]

---

## 11. Tag switch/removal, ironing, reinforcement (specifieke VAS-failures)

**Trigger:** LITHRA wil sellertag eraf + eigen label, gestreken, versterkt verpakt. Geconfigureerd via Preselection/Market (§3). [ASSUMED]

**Flow:** magazijn voert uit tijdens handling; kosten in `serviceAmount`. [ASSUMED]

**Wie betaalt wat:** per-dienst-¥ uit wallet, in service fee/marge verwerkt. [ASSUMED]

**Wat als het faalt:**
- **Tag-switch onmogelijk** (vastgenaaid/geprint) → overslaan of Po Pending. [ASSUMED]
- **Ironing beschadigt** (smelt/print) → wordt dat defect? → claim/coulance. [ASSUMED]
- **Reinforcement verhoogt gewicht/volume** → kan overweight-surcharge triggeren (§9). [ASSUMED]
- **Geen per-order bevestiging via API** dat de dienst écht gebeurde, alleen `serviceAmount`. [CONFIRMED beperking]

**System action:** Dashboard-config + `serviceAmount`-reconcile. [TO-VERIFY]

---

## 12. Returns vanuit het domestic-perspectief (returnFlowCode / parcel returned)

**Trigger:** Een al-verzonden pakket komt terug (klant-retour binnen EU-herroeping, of weigering). Notify Parcel Status `packageStatus` **8 (returned domestically)** of **9 (returned from abroad)**. [CONFIRMED — packageStatus 8/9]

**Flow:**
1. BuckyDrop `apply-return` → `returnFlowCode`; retourparcel komt terug naar magazijn. [CONFIRMED returnFlowCode-mechanisme uit kernmodel/Order-folder Return Application]
2. Parcel-webhook met returned-status; huidige `PKG_STATUS_MAP` mapt alleen 2/3/4 (`pkgNormalStatus`), NIET de returned `packageStatus` 8/9 → return-statuses worden in de huidige code niet naar app-status vertaald. [CONFIRMED — alleen pkgNormalStatus gemapt; packageStatus returned niet]
3. Refund regelen (Stripe-lek geldt).

**Wie betaalt wat:** Klant draagt retourkosten binnen de wet (EU-herroeping). Re-stocking/re-inbound = handling-¥. [ASSUMED]

**Wat als het faalt:**
- **Returned-webhook genegeerd:** code mapt `packageStatus` 8/9 niet → app weet niet dat het pakket terug is. [CONFIRMED gat] → tak toevoegen.
- **Refund naar in-app i.p.v. Stripe** (wettelijk fout). [CONFIRMED lek]
- **Retouritem defect/incompleet terug** → nieuwe QC nodig (her-inbound). [ASSUMED]

**System action:** TE BOUWEN: parcel-webhook-tak voor returned (8/9) → order-status `returned` + refund (Stripe). Nu: alleen gelogd. [CONFIRMED huidige beperking]

---

## Samenvatting van de grootste gaten (voor de bouw-backlog)
1. **value-added/QC is niet API-stuurbaar** → volledig afhankelijk van dashboard Service Preselection; geen programmatische garantie per order (alleen `serviceAmount`-reconcile achteraf). [CONFIRMED]
2. **`weight_grams`/dims worden nergens uit order-detail geschreven** → `haul-shipping` blokkeert tot iemand het invult. [TO-VERIFY]
3. **orderStatus 4 (supplement) ongemapt** → stille stilstand. [CONFIRMED]
4. **packageStatus 8/9 (returned) ongemapt** → returns onzichtbaar in-app. [CONFIRMED]
5. **refund gaat naar in-app saldo i.p.v. Stripe** (wettelijk). [CONFIRMED]
6. **geen polling/cron** voor stale orders, opslag-verloop, ontbrekende webhooks. [TO-VERIFY]
