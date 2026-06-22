# 09 — Retouren en refunds: de volledige matrix

Deze sectie dekt UITPUTTEND elke retour-/refund-situatie van Flowva: elke **reden** (defect / verkeerd item / mislabel / beschadigd in transit / kwijt / niet-als-omschreven / geen-reden EU-herroeping) × elk **stadium** (QC-poort vóór internationaal verzenden / in-transit / na-levering) × **wie betaalt wat**, plus de fabriek die de retour accepteert óf weigert.

De rode draad is de **REFUND-BRUG**: BuckyDrop refundt naar de **BuckyDrop-wallet in CNY** (traag, op hun tempo), maar de klant betaalde in **EUR**. Wettelijk (EU-herroeping, NL-recht) moet een refund naar de **originele betaalmethode** — bij Flowva is dat de Stripe-betaling (iDEAL) waarmee het saldo is opgeladen, niet alleen het in-app saldo. Flowva moet die brug dus **zelf** slaan: de wallet-refund en de klant-refund zijn twee gescheiden geldstromen die handmatig/automatisch verzoend moeten worden.

> **Grounding-status (zeer belangrijk):**
> - De huidige code refundt **uitsluitend naar in-app `profiles.balance`** — er bestaat **geen Stripe-refund-pad**. Bevestigd in `refund-order.sql` (`refund_order`), `refund-order.sql`/`cancel_paid_order` en `stripe-webhook/index.ts` (alleen `apply_top_up`, geen `stripe.refunds.create`). [CONFIRMED]
> - De `apply-return`-API en `return/get`-API bestaan en zijn hieronder veldsgewijs geverifieerd uit de PNG-docs. [CONFIRMED]
> - Er is in de codebase **nog geen** edge function die `apply-return` aanroept of `returnFlowCode` opslaat. De hele BuckyDrop-retourkant is dus **nog te bouwen**. [CONFIRMED — afwezigheid in `supabase/functions/`]

---

## 0. Referentie: de bouwstenen (uit docs/code geverifieerd)

### 0.1 `apply-return` (`/api/rest/v2/adapt/adaptation/order/apply-return`, POST) [CONFIRMED]
Request: `applySource` (int, **3 = BuckyDrop**), `orderCode` (PO-code, max 20), `applyType` (int, **1 = Product Return / 2 = Product Exchange**, default 1), `applyContent` (reden, max 512, Required), `skuList[]` met `skuCode` (max 20) + `quantity` (Required).
Response: `success`, `data[].returnFlowCode` (code van de retour-order), `errKey`, `code`, `info`, `currentTime`.

### 0.2 `return/get` (`/api/rest/v2/adapt/adaptation/order/return/get`, POST) [CONFIRMED]
Request: `returnFlowCode` (max 64, Required).
Response (kernvelden): `status` (0 pending / 1 cancelled / 3 return-in-process / 4 exchange-in-process / 5 returned / 6 exchanged), `refundStatus` (1 not refunded / 2 refund in process / 3 refunded / 4 refund fails), `refundType` (1 refund **zonder** product retour / 2 refund **met** product retour), `returnType` (1 refund-met-retour / 2 exchange-met-retour), `returnFreightType` (**1 Vendor / 2 BuckyDrop / 3 Shopping agent / 4 BuckyDrop supplier** — wie de retourvracht betaalt), `applyRefundAmount` (door klant gevraagd), `refundAmount(Dollar)`, `repairAmount(Dollar)` (prijsverschil), `freightAmount(Dollar)`, `serviceAmount`, `actualSettlementAmount`, plus `returnFlowDetails[]` met `returnAddress`, `returnStatus`, `quantity`, `productSkuCode`, `picturePath`.

> Let op de **dubbele status-enum**: in `return/get` heeft het top-level `status`-veld een ándere betekenis (1 in-process … 5 exchange-cancelled) dan het geneste `data.status`. Implementeer een expliciete mapping-tabel, niet "magische nummers". [CONFIRMED — twee verschillende enums in de doc-screenshots]

### 0.3 `po-cancel` / `shop-order/cancel` [CONFIRMED]
Annuleren **vóórdat** verzonden: `po-cancel` (body `orderCode`) of `shop-order/cancel` (`shopOrderNo`). Geen retour nodig — dit is de goedkoopste exit.

### 0.4 Defect-signaal: webhook **Notify Po Pending** [CONFIRMED]
`confirmType` ("the product is defective") en `picList` (Array[], "Product's inspection service picture") zijn **BEIDE Required**. Dus zodra BuckyDrop QC een defect vindt, komt de **inspectiefoto gegarandeerd mee**. `buckydrop-webhook/index.ts` vangt dit al: het zet `qc_images = picList`, `dispute_status = 'pending'`, `problem_type = confirmType`. [CONFIRMED in code]

### 0.5 Refund-bestemmingen vandaag [CONFIRMED]
- `refund_order(p_order_id, p_reason)` → credit `profiles.balance` + `transactions(type='refund')`, order → `cancelled`; bij hele groep geannuleerd ook één keer `fee_refund`. Alleen `service_role`.
- `cancel_paid_order(p_order_id)` → alleen status `quote_accepted` + `problem_type` gezet; credit balance. Alleen `authenticated` eigenaar.
- **Geen** functie raakt Stripe aan. De brug naar de originele betaalmethode ontbreekt volledig. [CONFIRMED]

---

## 1. Pre-purchase annulering (vóór BuckyDrop iets kocht)

**Trigger:** klant annuleert, of agent meldt `problem_type` (out_of_stock / variant_unavailable / price_changed / link_broken), terwijl de order nog op `quote_accepted` staat (betaald uit saldo, nog niet ingekocht).

**Flow:**
1. Klant drukt annuleren in de app (of admin doet het) → `cancel_paid_order(orderId)`.
2. Status moet `quote_accepted` zijn én `problem_type` gezet (huidige guard). Anders weigeren.
3. Saldo terug, order → `cancelled`.

**Wie betaalt wat:** niemand betaalt iets. Volledige refund van productprijs naar saldo. Service fee blijft staan tenzij de héle groep cancelt (dan `fee_refund` via `refund_order`-pad). [CONFIRMED]

**Wat als het faalt (volgende edge-laag):**
- BuckyDrop heeft tóch al ingekocht (race tussen `place-bucky-order` en de annulering) → `cancel_paid_order` faalt op de status-guard; val terug op **`po-cancel`** (vóór verzending) of, als al verzonden, op de **retour-flow** (§3+). [ASSUMED — racebescherming nog niet in code]
- Klant wil annuleren zónder dat agent een probleem meldde → huidige guard blokkeert dit. Dit botst met het **EU-herroepingsrecht vóór levering** (klant mag áltijd annuleren vóór verzending). Guard moet versoepeld worden voor pre-purchase consument-annulering. [TO-VERIFY — juridisch: NL-herroeping staat annulering vóór verzending toe; code dwingt nu `problem_type` af]
- Saldo is al uitgegeven aan andere orders → niet van toepassing, refund is een credit, geen debit.

**System action:** RPC `cancel_paid_order` of `refund_order`; bij al-ingekocht: nieuwe edge-actie `po-cancel` (body `{orderCode}`) toevoegen aan de BuckyDrop-gateway. App-status → `cancelled`. [CONFIRMED RPC's; po-cancel-actie TO-BUILD]

---

## 2. QC-poort: defect/verkeerd item ontdekt vóór internationaal verzenden (de sterkste positie)

Dit is Flowva's **goedkoopste en sterkste** retourpunt: het verplichte QC-pakket (Standard Product Photos ¥2 + Garment Measurement ¥4) betrapt fouten **vóórdat** internationale vracht is betaald. De klant heeft het pakket nog niet — er is geen klant-retourvracht, geen NL-retouradres nodig.

**Trigger:** BuckyDrop **Notify Po Pending** met `confirmType` = defect en `picList` (inspectiefoto's), óf QC-meting (Garment Measurement) wijkt af van seller-omschrijving, óf het is een **verkeerd item / mislabel** (verkeerde SKU/kleur/maat geleverd door de seller).

**Flow:**
1. Webhook ontvangt Notify Po Pending → zet `qc_images`, `dispute_status='pending'`, `problem_type` (al in code). [CONFIRMED]
2. Admin (ai-ops-hud Financiën/Missies) ziet de defect-kaart + foto. Beslissing:
   - **(a) Reship/herinkoop:** vraag seller-vervanging of koop opnieuw in (klant merkt niets). Kosten = nieuwe inkoop + eventueel een tweede QC-pakket.
   - **(b) Refund vóór verzending:** annuleer de PO (`po-cancel`) of dien `apply-return` in met `refundType=1` (refund **zonder** product retour — product hoeft niet terug, het zit nog in CN). 
3. Bij refund: bridge naar klant (zie §7).

**Wie betaalt wat:**
- **Defect/mislabel = seller-fout** → idealiter draagt de **Vendor** de kosten (`returnFreightType=1 Vendor`). De klant betaalt niets. [ASSUMED — afhankelijk van of seller compenseert; BuckyDrop bemiddelt]
- Het QC-pakket (¥6) heeft zich hier terugverdiend: het is het **bewijs** waarmee Flowva de seller/BuckyDrop aanspreekt. Die ¥6 is en blijft Flowva-kost (ingecalculeerd in de fee). [CONFIRMED model]
- **Geen internationale vracht betaald** → geen vracht-allocatie nodig. Grootste besparing.

**Wat als het faalt (volgende edge-laag):**
- Seller **weigert** verantwoordelijkheid / BuckyDrop kan niet bemiddelen → Flowva eet de inkoopprijs (refund klant volledig) en probeert resell (§8) als het item bruikbaar is, anders write-off. [ASSUMED]
- "Defect" is in werkelijkheid een **minor variatie** t.o.v. seller-foto (kleurzweem, stiksel) → volgens `/returns` §10 géén defect; Flowva mag verzenden. Risico: klant claimt later alsnog. Documenteer de QC-foto als bewijs van conforme staat. [CONFIRMED beleid in `ReturnsPage.jsx`]
- `picList` ontbreekt door een leveranciersbug terwijl `confirmType` defect zegt → `findPics()` geeft `null`, `qc_images` blijft leeg maar `dispute_status` wordt **niet** gezet (huidige code zet dispute alléén binnen het `if (pics)`-blok). **Bug-risico:** een defect zonder foto wordt stil genegeerd. Fix: zet `dispute_status` ook als `confirmType` aanwezig is zonder pics. [CONFIRMED bug in `buckydrop-webhook/index.ts` regels 108-114]

**System action:** webhook-update (al deels), dan admin-keuze → `po-cancel` óf `apply-return` (`applySource=3`, `applyType=1`, `refundType→1`); app-status `dispute_status` van `pending` → `resolved_refund` / `resolved_reship`. [apply-return-actie TO-BUILD]

---

## 3. In-transit: pakket beschadigd of kwijt onderweg (na QC-poort, vóór levering)

**Trigger:** parcel-webhook (Notify Parcel Status / pkgNormalStatus) blijft hangen of meldt nooit `delivered (4)`; carrier-tracking zegt "lost"/"damaged"; of klant meldt beschadigde doos bij levering.

**Flow:**
1. Detecteer: parcel-status komt niet voorbij `shipped_international` binnen X dagen → admin-flag "mogelijk kwijt". [ASSUMED — geen timeout-job in code]
2. Open claim bij de **logistieke partner/carrier** via BuckyDrop (vrachtclaim), niet via `apply-return` (er is geen product om te retourneren — het is weg). [TO-VERIFY — BuckyDrop-vrachtclaim-endpoint niet in de gegoten doc-set; checken in logistics-docs]
3. Klant krijgt **reship** of **refund** afhankelijk van uitkomst claim.

**Wie betaalt wat:**
- **Kwijt door carrier** → carrier/verzekering vergoedt (DDP-lijn bevat vracht). Flowva voorschiet de reship/refund aan de klant en verhaalt op de carrier. [ASSUMED]
- **Beschadigd in transit** → idem; QC-foto's bewijzen dat het item **goed** vertrok, dus de schade ontstond ná QC → carrier-aansprakelijk, niet seller. Dit is opnieuw de waarde van het QC-pakket. [CONFIRMED model-logica]
- **DDP/BTW:** bij refund van een kwijt pakket moet ook de **al-betaalde DDP-BTW** (21%) mee terug naar de klant — niet dubbel rekenen, maar ook niet inslikken. [CONFIRMED model — tax-inclusive lijnen]

**Wat als het faalt (volgende edge-laag):**
- Carrier **weigert** de claim (te laat gemeld, geen verzekering) → Flowva eet de volledige kost (inkoop + vracht + BTW). Refund klant blijft wettelijk verplicht bij niet-levering. [CONFIRMED wettelijk: bij non-conformiteit/niet-levering draagt verkoper risico]
- Pakket duikt **alsnog op** ná refund → klant heeft gratis item; cul-de-sac. Beleid: vraag terug of schrijf af; klein bedrag = afschrijven. [ASSUMED]
- "Kwijt" is in werkelijkheid **vertraging** → reship te vroeg getriggerd = dubbele kost. Wacht op carrier-uitspraak vóór reship. [ASSUMED]

**System action:** carrier-claim (endpoint TO-VERIFY), refund-brug §7; app-status nieuwe `lost_in_transit` → `resolved_*`. RPC `refund_order` voor saldo-deel, plus Stripe-refund-brug. [TO-BUILD]

---

## 4. Na levering — EU 14-dagen herroeping zonder reden (no-reason return)

**Trigger:** klant gebruikt `/withdraw` (publiek, geen login) binnen 14 dagen na **ontvangst** (window start bij aankomst pakket, niet bij besteldatum). [CONFIRMED in `ReturnsPage.jsx`/`WithdrawalPage.jsx`]

**Flow:**
1. `/withdraw` → edge `withdrawal-request` → rij in `withdrawal_requests` (status `new`) + bevestigingsmail (Resend). [CONFIRMED tabel; Resend TO-VERIFY of live]
2. Admin geeft **NL-retouradres** door (klant stuurt nooit naar China). [CONFIRMED beleid]
3. Klant stuurt binnen 14 dagen terug op **eigen kosten** (return shipping = klant, want geen defect). [CONFIRMED `/returns` §5]
4. Item arriveert NL → inspectie (oorspronkelijke staat, labels, verpakking).
5. Refund binnen 14 dagen na ontvangst (of bewijs van verzending) → **naar originele betaalmethode** (wettelijk; vandaag echter naar saldo — zie §7 gap).

**Wie betaalt wat:**
- **Retourvracht NL→(opslag): klant.** [CONFIRMED]
- **Refundbedrag:**
  - *Partiële retour* (klant houdt enkele items): alléén productprijs van geretourneerde items; outbound shipping **niet** terug. [CONFIRMED `/returns` §4]
  - *Volledige herroeping:* productprijs **plus** de standaard outbound leverkost terug. [CONFIRMED `/returns` §4]
- **Waardevermindering:** Flowva mag refund verlagen voor waardeverlies door gebruik verder dan inspectie (gedragen, labels eraf). [CONFIRMED `/returns` §6]
- **Service fee (8%):** [TO-VERIFY juridisch] — bij volledige herroeping is het verdedigbaar dat de fee een dienst dekt die al geleverd is (sourcing/QC), maar NL-recht kan eisen dat ook deze terug moet bij volledige herroeping. Concreet checken bij NL-adviseur.

**Wat als het faalt (volgende edge-laag):**
- Klant stuurt **niets** terug binnen 14 dagen → geen refund; sluit `withdrawal_requests`-rij als `expired`. [ASSUMED]
- Item komt **beschadigd/gedragen** terug → pro-rata refund (waardevermindering); documenteer met foto's. [CONFIRMED beleid, proces TO-BUILD]
- Klant stuurt **verkeerd/leeg pakket** terug (fraude) → geen refund; bewijs via inkomende inspectie + foto. [ASSUMED]
- **Uitgesloten item** (custom/gepersonaliseerd, ontzegelde hygiëne, bederfelijk) → herroeping geweigerd, met verwijzing naar `/returns` §9. [CONFIRMED beleid]
- Klant eist refund naar **bankrekening** terwijl wettelijk de originele methode geldt → refund naar Stripe-iDEAL-betaling (§7). [CONFIRMED wettelijk]

**System action:** `withdrawal_requests` (logging), NL-inbound-inspectie (handmatig), dan refund-brug §7. **Geen BuckyDrop `apply-return` nodig** — het item gaat naar NL-opslag, niet terug naar de CN-seller, dus dit is puur Flowva↔klant. [CONFIRMED — `/returns` §5 zegt expliciet "never ship back to China"]

---

## 5. Na levering — defect / niet-als-omschreven / verkeerd item (Flowva betaalt retour)

**Trigger:** klant meldt na ontvangst dat het item defect/beschadigd/niet-conform/het verkeerde item is. Onderscheid met §4: hier draagt **Flowva** de retourkosten.

**Flow:**
1. Klant meldt via support/`/withdraw` met reden + foto's.
2. Admin beoordeelt tegen de **QC-foto's + meetrapport** die al bij de order zitten (`qc_images`): vertrok het item conform? 
   - Conform vertrokken → schade ontstond na levering of is klant-perceptie → val terug op §4-herroeping (klant betaalt retour) of weiger bij misbruik.
   - Niet-conform / defect bij QC gemist → Flowva-fout-pad (dit scenario).
3. Flowva geeft **gratis** retourlabel (NL-adres) of vergoedt retourvracht. Keuze: **repair / replacement / full refund** (`/returns` §10). [CONFIRMED]
4. Optioneel BuckyDrop-kant: als het item terug naar CN-seller moet voor verhaal → `apply-return` (`applyType=1` of `2` voor exchange) met `returnFreightType` richting Vendor/BuckyDrop. Meestal blijft het in NL en verhaalt Flowva los op de seller. [ASSUMED]

**Wie betaalt wat:**
- **Retourvracht: Flowva** (item is faulty/wrong). [CONFIRMED `/returns` §10]
- **Refund: volledig** (productprijs + outbound + DDP-BTW) óf replacement/repair naar keuze klant. [CONFIRMED]
- **Verhaal op seller:** Flowva probeert de inkoop terug te halen via BuckyDrop/seller met de QC-foto als bewijs (`returnFreightType=1 Vendor` = seller draagt). Lukt dit niet → Flowva eet het. [ASSUMED]

**Wat als het faalt (volgende edge-laag):**
- Seller weigert + item is in NL → Flowva-write-off of resell (§8).
- Klant claimt defect maar QC-foto toont conform item → dispuut; bied coulance of §4-herroeping; documenteer. [CONFIRMED bewijspositie via QC]
- Replacement (exchange) gekozen → **`apply-return applyType=2`**, `repairAmount` dekt prijsverschil bij andere variant; nieuwe outbound vracht = wiens kost? Bij Flowva-fout: Flowva. [CONFIRMED repairAmount-veld; allocatie ASSUMED]
- Item arriveert nooit terug terwijl refund al gegeven (coulance-refund-first) → risico ingecalculeerd bij lage waarde. [ASSUMED]

**System action:** support-ticket + `dispute_status`; optioneel `apply-return` → `returnFlowCode` opslaan, pollen via `return/get`; refund-brug §7. [apply-return TO-BUILD]

---

## 6. De BuckyDrop-retour zelf: apply-return → return/get lifecycle (wanneer het item écht terug naar CN moet)

Gebruik dit pad alléén als de seller/BuckyDrop het fysieke item terug wil in China (zeldzaam bij Flowva, want NL-opslag is de norm). Relevant voor **exchange** of seller-verhaal.

**Trigger:** admin besluit BuckyDrop-retour/exchange in te dienen.

**Flow:**
1. `apply-return` POST: `applySource=3`, `orderCode`=PO, `applyType` (1 return / 2 exchange), `applyContent`=reden, `skuList[{skuCode, quantity}]`. → response `data[].returnFlowCode`. [CONFIRMED]
2. Sla elke `returnFlowCode` op de order op (nieuwe kolom `return_flow_codes jsonb`). [TO-BUILD]
3. Poll `return/get` (of via webhook indien BuckyDrop er een stuurt — **niet bevestigd dat er een retour-webhook bestaat**, alleen Po/Parcel/Pending) op `status` + `refundStatus`. [status enums CONFIRMED; retour-webhook TO-VERIFY]
4. Bij `refundStatus=3 refunded` → BuckyDrop heeft naar de **wallet (CNY)** gerefund → start klant-refund-brug §7.

**Wie betaalt wat:** bepaald door `returnFreightType` (1 Vendor / 2 BuckyDrop / 3 Shopping agent / 4 BuckyDrop supplier). `refundAmount`/`repairAmount`/`freightAmount` in de `return/get`-response vertellen de exacte CNY/USD-splitsing. [CONFIRMED velden]

**Wat als het faalt (volgende edge-laag):**
- `apply-return` `success=false` (verkeerde skuCode, PO niet in retourneerbare staat, te laat) → toon `errKey`/`info`, retry of escaleer naar agent Vera. [CONFIRMED foutvelden]
- `refundStatus=4 refund fails` → wallet-refund mislukt aan BuckyDrop-kant; Flowva moet de klant **toch** refunden (eigen risico) en los verhalen. [CONFIRMED enum, beleid ASSUMED]
- `status=1 cancelled` (BuckyDrop annuleert de retour) → terug naar admin-beslissing.
- **Partial refund:** `applyRefundAmount` < volle prijs (slechts deel van skuList of waardevermindering door seller) → Flowva moet beslissen of het verschil naar de klant gaat (coulance) of niet. [CONFIRMED applyRefundAmount-veld]
- Geen retour-webhook → poll-job nodig; zonder poll blijft `returnFlowCode` "hangen". [TO-VERIFY of webhook bestaat]

**System action:** nieuwe edge-actie `apply-return` + `return-get` in de BuckyDrop-gateway (witte lijst in `buckydrop/index.ts`); poll-cron; kolommen `return_flow_codes`, `return_status`, `refund_status`. [TO-BUILD]

---

## 7. DE REFUND-BRUG: wallet-CNY ↔ Stripe-EUR ↔ klant (de kern van dit domein)

Dit is het belangrijkste en meest onderbelichte deel. **Twee gescheiden geldstromen:**

- **Stroom A (BuckyDrop → Flowva):** retour-refund komt traag terug in de **wallet (CNY)**, op BuckyDrop's tempo, `refundStatus 1→2→3`. Soms gedeeltelijk, soms helemaal niet (`refundStatus=4`).
- **Stroom B (Flowva → klant):** wettelijk binnen 14 dagen, naar de **originele betaalmethode (EUR, Stripe-iDEAL)**.

**Stroom B mag NOOIT wachten op Stroom A.** Flowva voorschiet altijd de klant-refund; de wallet-recovery is een aparte boekhoudkundige kwestie.

**Huidige situatie (de gap):** [CONFIRMED]
- `refund_order` / `cancel_paid_order` crediteren **alleen `profiles.balance`** (in-app saldo). 
- Dat is **niet** de originele betaalmethode. De klant betaalde via Stripe-iDEAL (top-up) → `apply_top_up` → saldo. Een refund-naar-saldo geeft de klant geen geld terug, alleen Flowva-tegoed.
- Wettelijk bij **herroeping** (§4) en bij **non-conformiteit** (§3/§5) moet het geld terug naar de Stripe-betaling. → **`stripe.refunds.create({ payment_intent })` ontbreekt volledig.**

**Te bouwen brug:**
1. **Refund-type bepalen:**
   - *Naar saldo* — alleen acceptabel als de klant er expliciet voor kiest (sneller, bv. store-credit met bonus) of bij niet-wettelijk-verplichte coulance. 
   - *Naar Stripe* — verplicht bij EU-herroeping en non-conformiteit. Vereist de `payment_intent`/`charge`-id van de oorspronkelijke top-up.
2. **Stripe-link bewaren:** sla bij elke top-up de `payment_intent` op (nu gooit `stripe-webhook` die weg — alleen `apply_top_up` met `session_id`). Nieuwe kolom in een `stripe_payments`-tabel. [CONFIRMED gap — `session.payment_intent` niet opgeslagen]
3. **Refund-allocatie bij partiële top-ups:** een order is betaald uit saldo dat uit **meerdere** top-ups kan komen → welke `payment_intent` refunden? FIFO/laatste-top-up of meerdere deel-refunds. Niet triviaal. [ASSUMED — ontwerpbeslissing]
4. **Stripe-refund-window:** Stripe staat refunds doorgaans ~180 dagen toe op de originele charge; daarbuiten moet je naar bankrekening/andere methode (SEPA-payout). [TO-VERIFY exacte iDEAL-refund-termijn bij Stripe]
5. **Reconcile A↔B:** boek per order: klant-refund (EUR, uitbetaald), wallet-recovery (CNY, ontvangen of niet), en het **verschil = Flowva-verlies/winst** (incl. FX, fees). Admin Financiën-tab moet dit tonen.

**Wie betaalt wat (netto):**
- Klant: krijgt (deel-)refund EUR naar Stripe.
- BuckyDrop/seller: betaalt (deel) terug in CNY-wallet, of niet.
- Flowva: draagt het **gat** tussen B en A — FX-verschil, BuckyDrop-fees die niet meekomen, niet-gerecupereerde inkoop, retourvracht bij Flowva-fout, en de ¥6 QC per order. Dit gat moet in de marge/fee zitten.

**Wat als het faalt (volgende edge-laag):**
- Stripe-refund faalt (charge te oud / methode verlopen) → fallback SEPA-uitbetaling naar IBAN; vraag IBAN op. [TO-VERIFY Stripe iDEAL-refundtermijn]
- Wallet-refund komt nooit (`refundStatus=4`) → B is al uitbetaald → puur Flowva-verlies; log als `write_off`.
- Dubbele refund (saldo én Stripe) door race → idempotentie op `transactions(type, order_id)` zoals `fee_refund` nu al doet; uitbreiden naar `stripe_refund` met uniek `refund_id`. [CONFIRMED patroon aanwezig in `auto-refund.sql`]
- Klant heeft refund-saldo al **uitgegeven** aan nieuwe order, en eist daarna alsnog Stripe-refund → saldo kan negatief worden; blokkeer dubbel-claim. [ASSUMED]

**System action (TO-BUILD):** nieuwe edge function `refund-to-stripe` (service role) die `stripe.refunds.create` aanroept op de juiste `payment_intent`; tabel `stripe_payments` (top-up → payment_intent); RPC `refund_order_to_source` die kiest tussen saldo en Stripe; reconcile-view in admin. [CONFIRMED gap; ontwerp ASSUMED]

---

## 8. Restocking, resell vs write-off, supplement-reconcile

**Trigger:** een geretourneerd/geweigerd item is fysiek terug (NL-opslag of CN), of er is een vracht-supplement.

**Flow / beslisboom:**
1. **Item in oorspronkelijke staat (NL)** → **resell**: terug in `products`-voorraad / nieuwe haul-bundel. Restocking-fee mag alleen bij niet-wettelijke retour (niet bij herroeping/defect). [ASSUMED]
2. **Item beschadigd/gedragen/ontzegeld** → **write-off**: boek als verlies; eventueel B-stock/outlet. 
3. **Supplement-reconcile (zwaarder pakket):** PO `orderStatus=4` ("to be confirmed incl. supplementary payment") → de geschatte vracht week af van de werkelijke (channel-carriage-list estimate ↔ actual). Bij **bijbetaling**: Flowva betaalt BuckyDrop bij; haalt dit NIET met terugwerkende kracht bij de klant tenzij vooraf gecommuniceerd. Bij **teveel betaald**: refund-deel → reconcile naar klant of marge. [CONFIRMED model — estimate↔actual reconcile + orderStatus 4]

**Wie betaalt wat:**
- Resell-item: verlies beperkt tot tijd/opslag; kan zelfs winst opleveren.
- Write-off: volledige inkoop + vracht is Flowva-verlies.
- Supplement bij: Flowva-kost (klant betaalde DDP-prijs vooraf); supplement af: kan refund naar klant zijn of marge.

**Wat als het faalt (volgende edge-laag):**
- Resell-item blijkt tóch defect bij her-inspectie → alsnog write-off.
- Supplement `orderStatus=4` blijft onbevestigd → PO hangt; admin moet bevestigen/betalen anders gaat het pakket niet door. [CONFIRMED status-semantiek]
- Reconcile vergeten → stille marge-lek (vracht-onderschatting structureel). Bouw een estimate-vs-actual rapport. [ASSUMED]

**System action:** voorraad-update in `products`; transactie-type `write_off` / `resell`; supplement-betaling via wallet; reconcile-view. [TO-BUILD]

---

## 9. Stripe chargebacks & disputes (de klant gaat buiten Flowva om)

**Trigger:** klant opent een **chargeback/dispute** bij zijn bank (iDEAL/kaart) i.p.v. de Flowva-retourflow → Stripe `charge.dispute.created` webhook-event.

**Flow:**
1. `stripe-webhook` ontvangt `charge.dispute.created` (**nu NIET afgehandeld** — code luistert alleen op `checkout.session.completed`). [CONFIRMED gap]
2. Verzamel bewijs: order, QC-foto's (`qc_images`), meetrapport, levering-tracking (`delivered`-webhook), `/returns`-beleid → upload als dispute-evidence naar Stripe.
3. Wacht op uitkomst (`charge.dispute.closed` → won/lost).

**Wie betaalt wat:**
- **Dispute verloren:** Stripe trekt het bedrag + **dispute-fee** terug → Flowva-verlies; en de klant heeft mogelijk het item nog → dubbel verlies.
- **Dispute gewonnen:** geld blijft; fee kan alsnog gelden. QC-foto's zijn hier de **doorslaggevende** bewijslast (item vertrok conform). [CONFIRMED bewijswaarde QC-pakket]

**Wat als het faalt (volgende edge-laag):**
- Geen webhook-handler → dispute verloopt **automatisch in het nadeel** van Flowva (geen bewijs ingediend). **Hoge prioriteit:** `charge.dispute.created` afhandelen. [CONFIRMED gap — must-fix]
- Klant deed **al** een Flowva-refund én een chargeback → dubbele terugbetaling; detecteer via `payment_intent`-match en betwist. [ASSUMED]
- Friendly fraud (klant kreeg item, claimt niet-ontvangen) → tracking + `delivered`-webhook + signTime als bewijs. [CONFIRMED velden beschikbaar]

**System action (TO-BUILD):** `stripe-webhook` uitbreiden met `charge.dispute.created`/`closed`; evidence-submission (handmatig of via API); `dispute_status` op order; admin-alert. [CONFIRMED gap]

---

## 10. Samenvattende wie-betaalt-wat-matrix

| Reden \ Stadium | QC-poort (vóór intl. vracht) | In-transit | Na levering |
|---|---|---|---|
| **Defect** | Seller/Vendor (`returnFreightType=1`); QC-foto = bewijs; geen klant-vracht | n.v.t. (defect = QC/levering) | **Flowva** betaalt retour; refund/replace; verhaal op seller |
| **Verkeerd item / mislabel** | Seller; reship of refund vóór verzending | n.v.t. | **Flowva** betaalt retour; verhaal op seller |
| **Beschadigd in transit** | n.v.t. | **Carrier/verzekering**; Flowva voorschiet | **Flowva** betaalt retour; carrier-claim |
| **Kwijt** | n.v.t. | **Carrier/verzekering**; refund/reship door Flowva | (gold niet geleverd → zelfde als in-transit) |
| **Niet-als-omschreven** | QC-meting vangt het; seller | n.v.t. | **Flowva** betaalt retour |
| **Geen reden (EU-herroeping)** | annuleer gratis (`po-cancel`) | annuleer/onderschep | **Klant** betaalt retour; refund prod(+outbound bij volledig) naar Stripe |
| **Pre-purchase annulering** | n.v.t. (nog niet gekocht) | n.v.t. | volledige refund, niemand betaalt |

> In **alle** refund-cellen geldt: refund loopt via de **brug §7** naar de **originele Stripe-betaling** (wettelijk), niet (alleen) naar saldo. Dat is vandaag nog niet gebouwd.

---

## 11. Geprioriteerde gaps (must-build vóór launch 2 juli)

1. **[CONFIRMED, KRITIEK] Stripe-refund-pad ontbreekt.** Refunds gaan naar saldo i.p.v. originele betaalmethode → schending EU-herroepingsrecht. Bouw `refund-to-stripe` + bewaar `payment_intent` per top-up. (§7)
2. **[CONFIRMED, KRITIEK] `charge.dispute.created` niet afgehandeld** → chargebacks verloren by default. (§9)
3. **[CONFIRMED, bug] Webhook zet `dispute_status` alléén binnen `if(pics)`** → defect zonder foto wordt stil genegeerd. (§2)
4. **[CONFIRMED, TO-BUILD] `apply-return` + `return/get`** zitten nog niet in de BuckyDrop-gateway; geen `returnFlowCode`-opslag/poll. (§6)
5. **[TO-VERIFY] Service-fee-refund bij volledige herroeping** — juridisch checken bij NL-adviseur. (§4)
6. **[TO-VERIFY] Bestaat er een BuckyDrop-retour-webhook?** Zo niet, poll-cron op `return/get` nodig. (§6)
7. **[TO-VERIFY] Stripe iDEAL-refundtermijn** (refund-window op originele charge) → fallback SEPA bij verlopen. (§7)
8. **[TO-VERIFY] In-transit lost/damaged claim-endpoint** in BuckyDrop logistics-docs. (§3)
9. **[ASSUMED, TO-BUILD] Reconcile-view A↔B** (wallet-CNY vs Stripe-EUR) + estimate-vs-actual vracht in admin Financiën. (§7/§8)
10. **[ASSUMED] Pre-purchase consument-annulering** zonder `problem_type` toestaan (EU-recht vóór verzending). (§1)
