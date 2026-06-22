# 06 — QC-goedkeuringspoort en klant-reacties na QC

De QC-poort is het beslismoment ná de verplichte BuckyDrop-inspectie (Standard Product Photos ¥2/SKU + Garment Measurement Service ¥4/SKU, samen ~¥6) en vóór internationale verzending. Het item is gearriveerd in het BuckyDrop-magazijn (PO `orderStatus = 9` stock-in → Flowva-status `qc_pending`), de foto-set en gemeten maten staan klaar, en de klant moet beslissen wat er met dit item gebeurt. Dit document dekt élke klant-reactie en élke faallaag.

**Wat in code/docs vaststaat (grounding):**
- De QC-foto's landen via webhook `Notify Po Pending` of `Notify Po Status`; `picList` (Array[], **Required**) en `confirmType` (string, **Required**, "the product is defective") zijn allebei verplicht in `Notify Po Pending` — bij een defect komt de inspectiefoto dus gegarandeerd mee. [CONFIRMED — `notifications/…133608.png`]
- `buckydrop-webhook/index.ts` zet bij gevonden `picList` → `orders.qc_images = pics`; en als `confirmType` aanwezig is → `dispute_status = "pending"`, `problem_type = confirmType`. Bij PO `orderStatus = 8` (cancelled) → `refund_order` RPC. [CONFIRMED — `functions/buckydrop-webhook/index.ts`]
- `qc_pending` toont in de klant-app de QC-foto's (4e foto = "⚖️ Weight"), optioneel `weight_grams`, en één knop **"🏭 Add to parcel →"**. Er is **geen** afwijs-/defect-knop, **geen** timer, **geen** auto-proceed. [CONFIRMED — `src/supplyflow-app.jsx` r.1651-1685]
- BuckyDrop order-acties die bestaan: `order/shop-order/cancel` (partnerOrderNo|shopOrderNo), `order/po-cancel` (orderCode), `order/apply-return` (applySource, orderCode, applyContent, skuList → `returnFlowCode`), `order/apply-return`-details-query. [CONFIRMED — `api buckydrop/order/…134947/134953/135002.png`]
- De `buckydrop` edge-gateway wired op dit moment **alleen** `product-detail` en `order-detail` — geen cancel/return-acties. Die moeten nog gebouwd worden. [CONFIRMED — `functions/buckydrop/index.ts`]
- `refund_order` en `cancel_paid_order` boeken naar **in-app balance**, niet naar Stripe. Wettelijk moet het naar de originele betaalmethode. [CONFIRMED — `refund-order.sql`, `auto-refund.sql`; bekend gat per MEMORY]

> Legenda tags: **[CONFIRMED]** uit docs/code/wet · **[ASSUMED]** redelijke aanname · **[TO-VERIFY]** moet gecheckt — met concreet HOE.

---

## Scenario 0 — Happy path: klant keurt goed en verzendt

**Trigger:** Item arriveert in BD-magazijn → webhook `Notify Po Status` met PO `orderStatus = 9` (stock-in). `setOrderStatus` zet de order op `qc_pending`; push-melding "QC photos ready". De foto-set + maten staan in `qc_images`/`weight_grams`. [CONFIRMED — webhook map `9: "qc_pending"`]

**Flow:**
1. Klant opent de order → ziet QC-foto's (3-set + weight-foto) en gemeten maten.
2. Klant vergelijkt met de seller-omschrijving/eigen verwachting, is tevreden.
3. Klant tikt **"🏭 Add to parcel →"** → gaat naar de warehouse-tab en bundelt het item in een parcel.
4. Verzendkosten worden berekend (channel-carriage-list estimate), klant betaalt verzending, parcel wordt verzonden → `shipped_international`.

**Wie betaalt wat:** Klant heeft productprijs + 8% fee (min €5) al betaald bij checkout. QC-pakket (~¥6) zit in de kostprijs/marge — Flowva draagt het richting BuckyDrop-wallet. Verzending betaalt de klant bij parcel-creatie (DDP, BTW inbegrepen). [ASSUMED — QC-kost in marge; CONFIRMED — verzending door klant in `WarehouseAndHaul`/`pay-shipping.sql`]

**Wat als het faalt:**
- Klant tikt niets → item blijft hangen op `qc_pending` (geen timeout, zie Scenario 6).
- Parcel-creatie faalt bij BuckyDrop (item niet meer beschikbaar voor outbound) → terug naar warehouse, fout tonen. [TO-VERIFY — gedrag van create-parcel API bij stock-in item; check `parcel`-docs]

**System action:** geen extra BD-call nodig voor de goedkeuring zelf; verzending = create-parcel + channel-carriage-list. App-status `qc_pending → shipped_international`. [CONFIRMED happy-path UI; ASSUMED parcel-call]

---

## Scenario 1 — Klant keurt goed (expliciete "approve"-tik)

**Trigger:** Klant drukt expliciet op een "Goedkeuren / Approve QC"-knop (nu nog impliciet via "Add to parcel").

**Flow:** Identiek aan Scenario 0, maar met een audit-log-regel "customer approved QC at <ts>" zodat we bij latere disputen kunnen aantonen dat de klant de foto's zag en akkoord ging. [ASSUMED — nu niet gelogd]

**Wie betaalt wat:** Zoals Scenario 0.

**Wat als het faalt:** Klant klikt approve maar het item is intussen door BD geannuleerd (`orderStatus = 8`) of als defect gemarkeerd (`confirmType`) → approve moet geblokkeerd worden en de defect-flow (Scenario 2) tonen. [ASSUMED — guard nog niet gebouwd]

**System action:** schrijf `qc_approved_at` + log-regel; daarna parcel-flow. [TO-VERIFY — kolom toevoegen; nu bestaat alleen impliciete "Add to parcel"]

---

## Scenario 2 — Afwijzen wegens DEFECT (BD heeft defect zelf gemeld)

**Trigger:** BD-inspecteur vindt een defect → webhook `Notify Po Pending` met `confirmType` (= defect) + `picList` (inspectiefoto's, Required). Webhook zet `qc_images = pics`, `dispute_status = "pending"`, `problem_type = confirmType`. [CONFIRMED — webhook r.108-114, doc `133608.png`]

**Flow:**
1. Order krijgt een "Action needed: issue with <product>"-notificatie (de notifications-lijst filtert op `problem_type`). [CONFIRMED — `supplyflow-app.jsx` r.1308]
2. Klant ziet de defect-foto's + de defect-reden.
3. Klant kiest: (a) **toch verzenden** (accepteer ondanks defect, evt. met korting), (b) **vervanging**, (c) **refund/annuleren**.
4. BD verwacht een respons op de pending-PO: bevestigen (doorgaan) of de PO annuleren/retourneren. [TO-VERIFY — exact mechanisme om op een Po Pending te "antwoorden"; check of `confirmType` een waardeset heeft en of er een confirm-endpoint is. Nu niet gewired.]

**Wie betaalt wat:**
- Defect = niet-conform → **Flowva/BuckyDrop draagt** de kosten (geen procurement-%, maar wel het verloren item + ¥6 QC). Klant betaalt niets extra; bij refund krijgt klant volledige productprijs terug. [CONFIRMED wettelijk — `ReturnsPage` sectie 10 "Faulty or wrong items: we cover the return cost"]
- Retour binnen China naar de seller via `apply-return` → eventuele seller-restocking/retourkosten draagt Flowva, niet de klant. [ASSUMED]

**Wat als het faalt (volgende edge-laag):**
- Klant **reageert niet** op de defect-melding → item mag NOOIT auto-verzenden bij defect (anders sturen we bewust een kapot item). Hold tot expliciete klant-keuze of admin-beslissing. [ASSUMED policy — moet hard in code]
- BD-PO blijft hangen op pending → admin moet handmatig PO annuleren (`po-cancel`) of bevestigen. [TO-VERIFY — pending-timeout aan BD-kant?]
- `dispute_status` wordt gezet maar **er is nog geen UI die `dispute_status` leest** → klant ziet alleen de generieke `problem_type`-banner, en die banner-acties (`acknowledgeProblem`/`cancelRequest`) werken alleen in fases `requested/quote_sent/quote_accepted`, NIET in `qc_pending`. Dus de defect-banner toont nu geen knoppen bij `qc_pending`. **Gat.** [CONFIRMED — `supplyflow-app.jsx` r.1610]
- `problem_type` = ruwe `confirmType`-string → die zit NIET in `problemTypes.js` → de banner-render (`problemTypes[selectedOrder.problem_type]`) faalt/leeg. **Gat.** [CONFIRMED — `problemTypes.js` heeft alleen out_of_stock/variant/price/link]

**System action:** webhook → `orders.update({qc_images, dispute_status:'pending', problem_type})`. Klant-keuze → (refund) `refund_order` RPC + `order/po-cancel` of `order/apply-return`; (vervanging) nieuwe PO; (toch verzenden) ack + parcel-flow. Cancel/return-acties **nog niet in de gateway** → bouwen in `functions/buckydrop`. [CONFIRMED webhook-deel; TO-VERIFY actie-deel]

---

## Scenario 3 — Afwijzen wegens FOUTE MAAT vs omschrijving (Garment Measurement)

**Trigger:** De Garment Measurement Service-foto/maten wijken af van de seller-maattabel of de maat die de klant koos (bv. besteld M, gemeten = S). BD meldt dit NIET per se als `confirmType`-defect — afwijkende maat is vaak géén "defect" maar "not as described". Klant ziet het zelf op de meet-foto. [ASSUMED — measurement levert maten, geen defect-flag tenzij BD het zo classificeert]

**Flow:**
1. Klant vergelijkt gemeten maten met de productpagina-maattabel.
2. Bij significante afwijking → klant opent een dispuut "wrong size / not as described".
3. Flowva-beslissing: is dit binnen tolerantie (kleding ±1-2 cm normaal) of echt mis?
   - Binnen tolerantie → uitleg, klant kan alsnog goedkeuren of herroepen op eigen kosten (geen fout van ons).
   - Buiten tolerantie / niet-conform → behandeld als "not as described" = onze kosten (refund/vervanging/return).

**Wie betaalt wat:**
- **Not as described** (echte afwijking) = Flowva draagt return + biedt refund/vervanging. [CONFIRMED wettelijk — `ReturnsPage` sectie 10]
- **Binnen normale variatie** ("Minor variations from supplier photos are normal and not a defect") = klant draagt eventuele herroepingsretour zelf. [CONFIRMED — `ReturnsPage` sectie 10]

**Wat als het faalt:**
- Discussie over wat "binnen tolerantie" is → nodig: een vastgelegde maat-toleranties-policy per categorie. [TO-VERIFY — bestaat nog niet; bouw tolerantietabel]
- Maattabel op de productpagina ontbreekt of is generiek → geen referentie om tegen te meten → dispuut onbeslisbaar. [ASSUMED — `product-size-chart.sql` bestaat; vul altijd]
- Klant koos zelf verkeerde maat → géén "not as described", valt onder gewone 14-dagen herroeping (klant betaalt retour). [CONFIRMED — `ReturnsPage` sectie 5]

**System action:** dispuut-record (`dispute_status='size_mismatch'`), measurement-foto als bewijs in `qc_images`. Uitkomst → `refund_order`/`apply-return` (onze fout) óf `withdrawal-request` (klant-keuze). [TO-VERIFY — size-mismatch dispuut-type nog niet gemodelleerd]

---

## Scenario 4 — Klant verandert van gedachten (géén fout aan het item)

**Trigger:** Item is correct, foto's zijn goed, maar de klant wil het na QC tóch niet (smaak, spijt, te lang gewacht).

**Flow:**
1. Klant heeft het item nog niet verzonden (staat op `qc_pending` in het CN-magazijn) — dit is het goedkoopste annuleermoment.
2. Klant kiest "annuleren / niet verzenden".
3. Twee sub-routes:
   - **Vóór parcel/internationale verzending** (het geval hier): in-China retour naar seller of doorverkoop; geen internationale verzendkosten gemaakt.
   - **Ná verzending**: valt onder 14-dagen herroeping `/withdraw` → klant stuurt terug naar NL-adres op eigen kosten. [CONFIRMED — `WithdrawalPage`, `ReturnsPage` sectie 8]

**Wie betaalt wat:**
- Géén fout aan het item → **klant draagt** de kosten van zijn spijt: de al gemaakte kosten (productprijs al betaald aan seller, QC ¥6, eventuele in-China retour-/restocking-kosten) zijn niet allemaal terugvorderbaar. Wettelijk minimaal: bij herroeping vóór verzending heeft de klant recht op terugbetaling productprijs; service fee en reeds geleverde diensten (QC) mogen mogelijk worden ingehouden. [ASSUMED — exacte inhouding TO-VERIFY met NL-adviseur]
- `refund_order` refundt nu de volledige productlijn + (bij hele groep) de fee → mogelijk te genereus bij "van-gedachten-veranderen". [CONFIRMED — `refund-order.sql`; beleidskeuze TO-VERIFY]

**Wat als het faalt:**
- Item al door BD outbound gezet tussen klik en verwerking → race; dan is het geen pre-verzend-annulering meer maar een retour. Guard op status nodig. [ASSUMED]
- Refund gaat naar **in-app balance** i.p.v. Stripe → wettelijk gebrek bij herroeping (moet originele betaalmethode). [CONFIRMED gat — MEMORY + `refund-order.sql`]

**System action:** pre-verzend → `order/po-cancel` of `order/shop-order/cancel` + `refund_order`. Post-verzend → `withdrawal-request` flow + `order/apply-return`. **Cancel/return-calls nog niet gewired.** [TO-VERIFY]

---

## Scenario 5 — GEEN respons / timeout (auto-proceed policy?)

**Trigger:** Item staat op `qc_pending`, klant onderneemt niets (dagen/weken).

**Flow (huidige werkelijkheid):** Er is **geen timer en geen auto-proceed**. Het item blijft eindeloos op `qc_pending` staan; alleen "Add to parcel" beweegt het verder. [CONFIRMED — geen timeout-code aanwezig]

**Gewenste policy (te bouwen):**
1. **Geen defect** → na X dagen reminder-push; na Y dagen mag Flowva NIET zomaar verzenden zonder betaalde verzending (verzending vereist klant-betaling). Dus item blijft "geparkeerd" in het CN-magazijn. → magazijnopslagkosten gaan tellen. [ASSUMED — opslagkosten BD; TO-VERIFY tarief/free-period in `parcel`/logistics-docs]
2. **Wél defect (`dispute_status='pending'`)** → NOOIT auto-proceed; escaleer naar admin na timeout.
3. Optioneel: na lange inactiviteit + opslagkosten → klant waarschuwen dat opslag in rekening komt of item wordt afgevoerd/geretourneerd.

**Wie betaalt wat:**
- Magazijnopslag na free-period → in principe klant (het is zijn item dat hij niet laat verzenden), maar dat moet vooraf in de voorwaarden staan. [TO-VERIFY — opslagtarief BD + opname in T&C]
- Bij defect-timeout: Flowva draagt, want het item is niet-conform.

**Wat als het faalt:**
- Klant claimt "ik wist niet dat ik moest handelen" → reminders + duidelijke status-uitleg nodig (push al aanwezig). [CONFIRMED — push bestaat]
- BD rekent stilzwijgend opslag aan de wallet → onverwachte CNY-afschrijving. [TO-VERIFY — wallet-debet voor opslag?]

**System action (te bouwen):** cron/edge job die `qc_pending`-orders ouder dan N dagen vindt → reminder-push; defect-orders → admin-queue. App-status blijft `qc_pending`. [TO-VERIFY — nog niet gebouwd]

---

## Scenario 6 — Deels: multi-item order, sommige items goed, andere afgewezen

**Trigger:** Eén aanvraag/checkout bevat meerdere items (`request_group_id`); na QC is item A goed, item B defect of fout-maat.

**Flow:**
1. Elk item is een aparte `orders`-rij met eigen status → A blijft `qc_pending` → goedkeuren; B → defect/return-flow.
2. A kan in een parcel; B wacht op dispuut-uitkomst. Klant kan kiezen: A nu verzenden, of wachten tot B is opgelost en samen bundelen (verzendkosten besparen — "bundle to save"). [CONFIRMED — bundel-advies in UI r.1679]
3. Parcel = per-item samenstellen, dus partiële verzending kan. [ASSUMED — parcel groepeert losse PO's; TO-VERIFY create-parcel met subset]

**Wie betaalt wat:**
- Goede items: klant betaalt verzending normaal.
- Afgewezen item B (defect): Flowva draagt; (van gedachten veranderd): klant draagt.
- Fee-refund: `refund_order` geeft de service fee pas terug als de **hele** groep geannuleerd is → bij deels annuleren blijft de fee staan. [CONFIRMED — `auto-refund.sql` r.43-59]

**Wat als het faalt:**
- Klant wil A vasthouden voor B maar B duurt lang → opslagkosten op A. [TO-VERIFY]
- Verzendkosten-estimate was voor de hele groep; bij splitsen verandert het gewicht/parcel → reconcile estimate↔actual (supplement of refund). [CONFIRMED concept — channel-carriage-list reconcile; ASSUMED bij splitsing]
- Refund van alleen B: `refund_order` werkt per `p_order_id` → refundt alleen B's lijn, fee blijft (correct). [CONFIRMED]

**System action:** per-item status; `refund_order(B)` voor de afgewezen lijn; A via parcel-flow. [CONFIRMED RPC per-item]

---

## Scenario 7 — Klant vraagt EXTRA foto-set / her-inspectie

**Trigger:** Foto's zijn onduidelijk/onvoldoende; klant wil meer of betere foto's, of een extra meting (bv. specifieke detail-naad).

**Flow:**
1. Klant vraagt via chat extra foto's aan.
2. Admin bestelt een extra value-added service bij BD via **Service Market** (per los product) of een ad-hoc foto-verzoek. [ASSUMED — Service Market per-product genoemd in kernmodel; TO-VERIFY exacte API/handmatige route]
3. Nieuwe foto's komen binnen → opnieuw via webhook in `qc_images` (append of vervang?). [TO-VERIFY — overschrijft webhook `qc_images` of voegt toe? Nu: `qc_images = pics` = **overschrijft**, oude set verloren] [CONFIRMED — webhook r.109 zet hard]

**Wie betaalt wat:**
- Eerste verplichte QC-set = inbegrepen.
- Extra foto's op klant-verzoek zonder gegronde defect-verdenking → **klant** kan de extra ¥2-kost dragen (transparant doorbelasten). Bij gegronde defect-verdenking die bevestigd wordt → Flowva. [ASSUMED — doorbelasten; TO-VERIFY policy + bedrag]

**Wat als het faalt:**
- Extra foto's overschrijven de originele set → bewijslast bij dispuut verzwakt. **Fix: append i.p.v. overschrijven.** [CONFIRMED gat — webhook]
- BD biedt geen losse her-inspectie aan via API → handmatig via BD-portal door admin. [TO-VERIFY]

**System action:** Service Market-bestelling (handmatig of API); webhook-update `qc_images` (moet append worden). [TO-VERIFY/gat]

---

## Scenario 8 — Klant opent een DISPUUT (formele klacht)

**Trigger:** Klant is het oneens met de QC-uitkomst of wil formeel klagen (defect ontkend door ons, of maat-discussie, of "niet zoals beschreven").

**Flow:**
1. Klant opent dispuut → `dispute_status = 'open'`, item op hold (mag niet verzonden worden zolang dispuut loopt). [ASSUMED — hold-logica te bouwen; `dispute_status` kolom wordt al door webhook gebruikt maar zonder migratie/UI]
2. Admin beoordeelt foto's + maten + seller-omschrijving.
3. Uitkomst:
   - In klant-voordeel → refund/vervanging/return op Flowva-kosten.
   - In klant-nadeel (binnen tolerantie / klant-spijt) → uitleg; klant kan herroepen op eigen kosten.
4. Bij seller-aansprakelijkheid → Flowva opent BD-retour `apply-return` met `applyContent` (reden) + `skuList` → krijgt `returnFlowCode` → volgt via Return Details Query. [CONFIRMED — `apply-return` doc `135002.png`]

**Wie betaalt wat:** afhankelijk van uitkomst (zie Scenario 2/3/4). Bij ons ongelijk: Flowva. Bij klant-spijt: klant.

**Wat als het faalt:**
- Geen dispuut-UI/RPC aanwezig → klant kan nu alleen via chat klagen; geen gestructureerd dispuut-record. **Gat.** [CONFIRMED — geen dispuut-tabel/RPC gevonden]
- `dispute_status` kolom heeft **geen migratie-SQL** (webhook schrijft naar een kolom die mogelijk nog niet bestaat) → webhook-update kan stil falen. **Bouw `add column dispute_status`.** [CONFIRMED gat — geen SQL voor `dispute_status`/`qc_images`/`weight_grams` gevonden]
- Hold-logica ontbreekt → een item in dispuut kan per ongeluk toch in een parcel → verzonden terwijl het dispuut loopt. **Bouw guard: blokkeer "Add to parcel" als `dispute_status in (pending,open)`.** [CONFIRMED gat]
- Refund naar balance i.p.v. Stripe (wettelijk). [CONFIRMED gat]

**System action:** dispuut-record + hold; bij seller-fout `order/apply-return` → `returnFlowCode`; `refund_order` voor het geld. **apply-return nog niet gewired in gateway.** [CONFIRMED docs; TO-VERIFY wiring]

---

## Scenario 9 — BD annuleert/weigert tijdens of na QC (orderStatus 8)

**Trigger:** Tussen stock-in en verzending annuleert BD de PO (`orderStatus = 8`) — bv. seller kan toch niet leveren, item afgekeurd bij outbound.

**Flow:** Webhook detecteert `poStatus === 8` → roept direct `refund_order(partnerOrderNo, "BuckyDrop cancelled the order")` aan → order `cancelled`, productprijs terug naar balance, fee terug bij hele-groep-annulering. Klant krijgt push. [CONFIRMED — webhook r.115-117 + `refund-order.sql`]

**Wie betaalt wat:** Flowva/BD draagt; klant volledig gerefund (balance). [CONFIRMED]

**Wat als het faalt:**
- Refund naar balance i.p.v. Stripe. [CONFIRMED gat]
- `refund_order` is idempotent (`already`-guard op `status='cancelled'`) → dubbele webhook = geen dubbele refund. [CONFIRMED — `refund-order.sql` r.28]
- `partnerOrderNo` matcht niet op een `orders.id` → refund mist; webhook logt `matched` leeg. [CONFIRMED — webhook logt altijd in `bucky_notifications`]

**System action:** webhook → `refund_order` RPC; status `cancelled`. [CONFIRMED]

---

## Scenario 10 — Supplement/bijbetaling vereist na QC (orderStatus 4)

**Trigger:** Na inspectie/weging blijkt het pakket zwaarder dan geschat → PO `orderStatus = 4` ("to be confirmed incl. supplementary payment"), of channel-carriage reconcile estimate < actual. [CONFIRMED — orderStatus 4 doc `133538.png`; reconcile-concept kernmodel]

**Flow:**
1. BD meldt supplement → admin ziet bij te betalen bedrag.
2. Klant moet bijbetalen (verzend-supplement) vóór verzending, of het item blijft hangen.

**Wie betaalt wat:** **Klant** betaalt het verzend-supplement (DDP, het is zijn werkelijke gewicht). Bij overgewicht-fee ¥1,5/kg boven 2kg etc. [CONFIRMED — overweight-model kernmodel]

**Wat als het faalt:**
- Klant weigert/negeert supplement → item blijft `qc_pending`/hold; opslagkosten (Scenario 5). [ASSUMED]
- Supplement-betaling niet gemodelleerd in app → bouwen (vergelijkbaar met `pay-shipping`/`pay-quote`). [TO-VERIFY — bestaat `pay-shipping.sql`, supplement-flow apart? TO-VERIFY]

**System action:** supplement-quote → klant betaalt → bevestig PO. App-status blijft `qc_pending` tot betaald. [TO-VERIFY wiring]

---

## Overkoepelende hold-, timeout- en communicatie-logica

- **Hold-trigger:** `dispute_status in (pending, open)` of `confirmType` aanwezig → item MAG NIET verzonden worden. Guard op "Add to parcel" + op create-parcel server-side. [CONFIRMED gewenst; gat in code]
- **Geen timeout/auto-proceed vandaag:** item blijft op `qc_pending` tot klant handelt. Te bouwen: reminders + opslagkosten-beleid + defect-escalatie. [CONFIRMED — geen timer]
- **Communicatie:** push-meldingen bestaan (PWA Web Push); `order_messages`-chat bestaat; notifications-lijst filtert op `problem_type`, `quote_sent`, agent-reply, `delivered`. [CONFIRMED]
- **Bewijslast:** `qc_images` (foto's + weight-foto) + measurement = retour-/dispuut-bewijs. Webhook **overschrijft** `qc_images` → bij her-inspectie gaat bewijs verloren; maak het append + log per inspectie-event. [CONFIRMED gat]
- **Wie betaalt — samenvattende regel:** item-fout (defect / not-as-described / fout-maat buiten tolerantie / BD-cancel) = **Flowva**; klant-keuze (spijt / eigen verkeerde maat / extra foto's zonder grond / overgewicht-supplement) = **klant**. [CONFIRMED wettelijk + kernmodel]
- **Refund-bestemming:** alles gaat nu naar in-app balance; wettelijk moet herroeping/defect naar Stripe (originele betaalmethode). Grootste open juridische gat. [CONFIRMED gat — MEMORY + code]

## Concrete bouw-/verificatielijst (uit deze analyse)
1. `dispute_status`/`qc_images`/`weight_grams`-migratie-SQL toevoegen (webhook schrijft er al naar). [CONFIRMED gat]
2. Defect/dispuut-UI bij `qc_pending` (banner-acties werken nu alleen pre-payment). [CONFIRMED gat]
3. `problem_type = confirmType` matcht niet op `problemTypes.js` → defect-rendering faalt; map BD-`confirmType` naar een eigen QC-probleemtype. [CONFIRMED gat]
4. Hold-guard op "Add to parcel" bij open dispuut/defect. [CONFIRMED gat]
5. Cancel/return-acties (`po-cancel`, `shop-order/cancel`, `apply-return`) toevoegen aan de `buckydrop`-gateway. [CONFIRMED gat]
6. `qc_images` append i.p.v. overschrijven (her-inspectie/extra foto's). [CONFIRMED gat]
7. Timeout/reminder/opslag-beleid voor stille `qc_pending`-items. [TO-VERIFY beleid + BD-opslagtarief]
8. Maat-tolerantietabel per categorie voor maat-disputen. [TO-VERIFY]
9. Refund naar Stripe i.p.v. balance voor wettelijke herroeping/defect. [CONFIRMED gat]
10. Supplement-betaalflow (orderStatus 4) modelleren. [TO-VERIFY]
