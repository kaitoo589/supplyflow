# 04 — Inkoop & Leverancier-reacties (BuckyDrop Supplier PO)

Deze sectie dekt UITPUTTEND de inkoopfase: vanaf het moment dat een betaalde Flowva-order
een BuckyDrop **Shop Order** (`/order/shop-order/create`) wordt, die BuckyDrop intern splitst
in een of meer **Supplier PO's** (`orderType 1`), tot en met élke fabriek/leverancier-reactie.
Per scenario: trigger → flow → wie-betaalt-wat → wat-als-het-faalt (volgende edge-laag) →
system action (API-call / app-status / RPC) → tag.

## Grounding & kernbegrippen (gelezen in docs/code)

- **Create Shop Order** [CONFIRMED — `order/create shop order/*.png`]: `POST api/rest/v2/adapt/adaptation/order/shop-order/create`. Required velden: `partnerOrderNo` (max 32, = onze `order.id`), `country`, `countryCode`, `province`, `city`, `detailAddress`, `contactName`, `contactPhone`, `productList[]`. Per product Required: `productCount`, `skuCode` (max 40), `spuCode` (max 40), `productPrice` (max 999999999), `platform` (TB/TMALL/ALIBABA…). `postCode`, `email`, `orderRemark`, `productAttribute`, `productName`, `productImage`, `productLink` zijn optioneel.
- **Response create** [CONFIRMED]: `success:boolean`, `data.shopOrderNo` (store order number), `data.productList[].productUniqueCode` (= `platform_spuCode_skuCode`), plus `errKey`, `code`, `info`, `currentTime`.
- **Failed-creation voorbeeld** [CONFIRMED — `133211.png`]: `{"success":false,"data":["TMALL_..._..."],"code":70010106,"info":"No product sku or stock is 0"}` — d.w.z. bij uitverkocht/0 voorraad geeft BuckyDrop een **numerieke `code`** terug + de unieke code(s) van de falende SKU's in `data`.
- **Onze code** [CONFIRMED — `place-bucky-order/index.ts`]: bouwt `orderBody`, doet `buckyPost(...shop-order/create)`. Bij `success !== true || !data.shopOrderNo`: als `typeof res.code === "number"` → `refund_order` RPC + order blijft (impliciet) onbetaald/teruggedraaid; als géén code (netwerk/timeout) → `fail()` zet alleen `bd_error`, géén refund. Bij succes → `shop_order_no` opslaan + status `purchased`.
- **Idempotentie-guard** [CONFIRMED]: `if (order.shop_order_no) return "already placed"` en `if (order.status !== "quote_accepted") return "not payable"`. Zie scenario "Idempotentie".
- **Order Detail** [CONFIRMED — `order details query/*.png`]: `POST api/rest/v2/adapt/adaptation/order/detail`. Levert per PO `orderStatus` (1=paid, 2=in review, 3=processing, 4=to be confirmed incl. supplementary payment, 5=ordered, 6=shipped out, 7=received, 8=cancelled, 9=stock-in, 10=stock-out, 11=delivered intl, 12=fulfilled), `orderType` (1=Supplier PO, 2=Purchase Order, 3=Forward PO, 4=Stock Order), `failureReasonList[]` met `failureType` (1=System, 2=Business) + `failureContent`, en bedragen: `productSupplementAmount`, `otherSupplementAmount`, `actualAmount`, `freightAmount`, `serviceAmount`, `platformServiceAmount`.
- **Cancel Shop Order** [CONFIRMED — `134947.png`]: `POST .../order/shop-order/cancel`, body `shopOrderNo` (Required) of `partnerOrderNo`.
- **Cancel Purchase Order** [CONFIRMED — `134953.png`]: `POST .../order/po-cancel`, body `orderCode` (Required, PO-code, max 64).
- **Apply Return** [CONFIRMED — `135002.png`/`135005.png`]: `POST .../order/apply-return`, body `applySource` (Required, 3=BuckyDrop), `orderCode` (Required, PO-code), `applyType` (1=Product Return, 2=Exchange, default 1), `applyContent` (Required, reden), `skuList[]` ({skuCode, quantity}). Response → `data[].returnFlowCode`.
- **Notify Po Pending (defect)** [CONFIRMED — `notifications/133547.png`/`133608.png`]: webhook `POST partner_callbackurl`, MD5-signed. notifyBody bevat o.a. `orderStatus`, `confirmType` (string, "the product is defective") **Required** en `picList` (Array, "product's inspection service picture") **Required**. → bij een defect-melding komt de QC-/inspectiefoto gegarandeerd mee.
- **Webhook-verwerking** [CONFIRMED — `buckydrop-webhook/index.ts`]: mapt PO `orderStatus` → app-status (5→bought, 6→shipped_local, 9→qc_pending, 11→shipped_international, 12→delivered); `orderStatus 8` → `refund_order` RPC + reden "BuckyDrop cancelled the order"; `picList` aanwezig → `qc_images` + bij `confirmType` → `dispute_status:'pending'` + `problem_type`. Statussen bewegen alleen vóóruit (RANK-guard) en nooit voorbij `cancelled`.
- **refund_order RPC** [CONFIRMED — gebruik in code] / **cancel_paid_order RPC** [CONFIRMED — `refund-order.sql`]: refundt naar IN-APP balance + `transactions`-log. LET OP (juridisch): EU-herroeping vereist refund naar de ORIGINELE betaalmethode (Stripe) — open punt, zie "Refund-route".
- **Price-guard** [CONFIRMED — `price-guard.sql` + `check-cart-prices/index.ts`]: vóór afschrijven checkt `check-cart-prices` de live ¥-prijs (`product/detail`) vs opgeslagen `priceYuan`; >5% stijging of uitverkocht → `products.price_alert=true, hidden=true, alert_reason`; checkout blokkeert het item. Admin "re-fetch & reactivate" wist de vlag.

---

## 1. Happy path — voorraad aanwezig, PO geplaatst

**Trigger.** Klant betaalt; trigger zet `orders.status='quote_accepted'`; pg_net roept `place-bucky-order` aan. [CONFIRMED — `place-bucky-order-trigger.sql` + index.ts]

**Flow.**
1. Function leest order, vindt gekoppeld `product` via `source_url`, kiest SKU via `pickSku(bd_skus, kleur)`, leest `priceYuan`. [CONFIRMED]
2. Adres uit `auth.users.user_metadata` (bij Flowva Friends → `host_user_id`). [CONFIRMED]
3. `POST shop-order/create` met `partnerOrderNo=order.id` + `productList`. [CONFIRMED]
4. BuckyDrop maakt Shop Order + splitst in Supplier PO(`orderType 1`); leverancier heeft voorraad. [ASSUMED — splitsing staat in `businessType`-note, exacte timing TO-VERIFY]
5. Response `success:true` + `shopOrderNo` → order krijgt `shop_order_no`, status `purchased` (triggert "Gekocht"-push). [CONFIRMED]
6. PO doorloopt `orderStatus` 5→6→…; webhooks duwen app-status bought→shipped_local→qc_pending→… [CONFIRMED]

**Wie betaalt wat.** Klant heeft al betaald (Stripe, EUR, in-app balance). BuckyDrop trekt de fabrieksprijs + service-fee + fulfilment-fee uit de **prepaid CNY-wallet**. Geen procurement-%. [CONFIRMED kernmodel] De klant betaalt geen extra in dit pad.

**Wat als het faalt.** Wallet-saldo (CNY) te laag → PO kan niet worden afgerekend bij de bron (volgende laag). [TO-VERIFY — geeft BuckyDrop dan een eigen `code`/`failureType` of blijft de PO in `orderStatus 1/2` hangen? Checken in `order/detail.failureReasonList`.] Mitigatie: wallet-saldo-monitor + lage-saldo-alert. [ASSUMED]

**System action.** `shop-order/create` → `orders.update{shop_order_no, status:'purchased'}`. Verder via `buckydrop-webhook` PO_STATUS_MAP. [CONFIRMED]

**Tag.** [CONFIRMED] (happy path + schema), met genoemde [TO-VERIFY] randen.

---

## 2. Uitverkocht / 0 voorraad (SKU sold out)

**Trigger.** `shop-order/create` retourneert `success:false`, `code:70010106`, `info:"No product sku or stock is 0"`, `data:[productUniqueCode...]`. [CONFIRMED — `133211.png`]

**Flow.**
1. Function ziet `success!==true` + numerieke `code` → roept `refund_order` RPC aan met reden `"BuckyDrop rejected: No product sku or stock is 0"`. [CONFIRMED]
2. Response naar trigger: `{ok:false, refunded:true}`. Order krijgt géén `shop_order_no`. [CONFIRMED]

**Wie betaalt wat.** Klant krijgt **volledige refund** (nu naar in-app balance). Flowva draagt eventuele Stripe-transactiekosten van de oorspronkelijke betaling (die zijn niet-restitueerbaar). [ASSUMED — Stripe houdt fee bij refund] BuckyDrop rekent niets (PO niet geplaatst). [CONFIRMED]

**Wat als het faalt (volgende laag).**
- **Race vs price-guard**: price-guard checkt vóór betaling, maar voorraad kan tussen check en `create` verdwijnen → dit pad is het vangnet. [CONFIRMED logica]
- **Deels: 1 van meerdere SKU's sold out** (multi-line PO) → `data` bevat alleen de falende uniqueCodes; faalt de hele `create` of plaatst BuckyDrop de rest? [TO-VERIFY — failed-voorbeeld toont array-`data`; onduidelijk of partial-success bestaat. Checken via test-order met 1 in-stock + 1 sold-out SKU.] Onze code behandelt elke non-success als volledige fail+refund → bij echte partial zou dat een geldige order onterecht refunden. [ASSUMED risico]
- **Refund-route juridisch**: refund gaat naar in-app saldo i.p.v. Stripe. [CONFIRMED gap — zie "Refund-route"]

**System action.** `refund_order` RPC (in-app). Geen `shop_order_no`. [CONFIRMED]

**Tag.** [CONFIRMED] (code + info exact in docs), partial-gedrag [TO-VERIFY].

---

## 3. Deels op voorraad (partial stock binnen 1 SKU)

**Trigger.** Klant bestelt `productCount > beschikbare voorraad` van één SKU; leverancier heeft minder. [ASSUMED scenario]

**Flow.**
1. `create` kan: (a) volledig falen met sold-out-achtige `code`, of (b) slagen en later via `order/detail` een lagere bevestigde hoeveelheid / `failureReasonList` tonen, of (c) `orderStatus 4` (to be confirmed) afdwingen. [TO-VERIFY — niet expliciet in docs; checken met test-order >voorraad.]
2. Bij (b)/(c): admin ziet discrepantie in `order/detail` (`originalQuantity` vs werkelijke `packageQuantity`/`returnQuantity`-velden). [CONFIRMED dat die velden bestaan]

**Wie betaalt wat.** Voor het niet-leverbare deel: **partial refund** naar de klant. Geleverde deel: klant betaalt zoals gequote. [ASSUMED] Verzendkosten kunnen relatief stijgen (minder items, zelfde first-weight) → mogelijk verlieslatend op kleine bundels. [CONFIRMED economie-note in memory]

**Wat als het faalt.**
- Geen API-veld dat "X van Y geleverd" eenduidig bevestigt vóór stock-in → admin moet `order/detail` pollen. [TO-VERIFY]
- Klant wil alles-of-niets (bundel-logica) → annuleren + volledige refund i.p.v. partial. [ASSUMED beleidskeuze]

**System action.** `order/detail` poll → bij tekort: handmatige admin-`refund_order` (partial) of `cancel_paid_order`. Geen kant-en-klare partial-refund-RPC gevonden. [TO-VERIFY — bouwen?]

**Tag.** [ASSUMED]/[TO-VERIFY] — partial-stock-semantiek staat niet in de gelezen docs.

---

## 4. Prijs OMHOOG bij de leverancier (price-guard interplay)

**Trigger.** Live ¥-prijs > opgeslagen `priceYuan`. Twee momenten: (a) bij checkout (`check-cart-prices`), (b) na betaling bij `create`. [CONFIRMED]

**Flow (a) pre-pay.**
1. `check-cart-prices` haalt `product/detail`, vergelijkt; `>5%` (`THRESHOLD=0.05`) → `products.update{price_alert:true, alert_reason:"Supplier price increased (+X%)", hidden:true}`; item "changed" → checkout blokkeert vóór afschrijven. [CONFIRMED]
2. Admin re-fetcht prijs + reactiveert (`price_alert=false`, `hidden=false`). [CONFIRMED — `price-guard.sql` note]

**Flow (b) post-pay.**
1. `create` slaagt soms toch (BuckyDrop accepteert hogere bronprijs) of komt later als **supplementary payment** terug → PO `orderStatus 4` (to be confirmed incl. supplementary payment) + `productSupplementAmount` in `order/detail`. [CONFIRMED dat 4 = supplement; dat prijsstijging dit triggert = ASSUMED]

**Wie betaalt wat.**
- Pre-pay: niemand betaalt; order geblokkeerd tot reactivatie. [CONFIRMED]
- Post-pay supplement: het verschil moet **bijbetaald** uit de CNY-wallet. Vraag: doorbelasten aan klant (transparant model) of door Flowva slikken? [TO-VERIFY beleids- + technische keuze — er is nog géén klant-supplement-betaalflow voor PO orderStatus 4.]

**Wat als het faalt.**
- Prijsdaling → géén alert (bewust; klant benadeeld niet). [CONFIRMED]
- `THRESHOLD` te laag → valse alarmen door ¥-rounding; te hoog → wallet-verlies. [CONFIRMED afweging]
- BuckyDrop onbereikbaar tijdens check → fail-open (laat door); post-pay refund = vangnet. [CONFIRMED]
- Supplement onbetaald → PO blijft in `orderStatus 4` hangen, geen voortgang. [ASSUMED — checken of BuckyDrop na X tijd auto-cancelt → `orderStatus 8`.] [TO-VERIFY]

**System action.** `check-cart-prices` → `products.update{price_alert,hidden}`. Post-pay: `order/detail` toont `orderStatus 4` + `productSupplementAmount`; supplement-betaling = **nog te bouwen**. [CONFIRMED gap]

**Tag.** Pre-pay [CONFIRMED]; post-pay-supplement-koppeling [ASSUMED]/[TO-VERIFY].

---

## 5. Supplementaire betaling gevraagd (orderStatus 4 — generiek)

**Trigger.** `order/detail` of `Notify Po Status` toont `orderStatus 4` ("to be confirmed including supplementary payment"). Oorzaken: prijsstijging (#4), zwaarder/groter pakket dan geschat, extra kosten leverancier. [CONFIRMED status-betekenis]

**Flow.**
1. Webhook/poll detecteert `orderStatus 4`. **Huidige webhook mapt 4 NIET** (PO_STATUS_MAP heeft geen 4) → app-status verandert niet, order "stil". [CONFIRMED gap in `buckydrop-webhook`]
2. Bedragen: `productSupplementAmount` (product), `otherSupplementAmount` (overig, bv. freight). [CONFIRMED]
3. Admin moet supplement reviewen + uit wallet bevestigen/bijbetalen. [ASSUMED proces]

**Wie betaalt wat.** Supplement uit CNY-wallet; doorbelasten aan klant = open. Bij verzend-supplement: reconcile estimate↔actual (channel-carriage-list), bijbetalen of refund. [CONFIRMED kernmodel]

**Wat als het faalt.**
- Supplement niet bevestigd → PO hangt; mogelijk auto-cancel → `orderStatus 8` → onze webhook refundt (in-app). [CONFIRMED webhook-pad voor 8; auto-cancel-timing TO-VERIFY]
- Klant weigert bij te betalen → annuleren + refund. [ASSUMED]
- Hoe bevestig/betaal je een supplement via API? Geen "confirm-supplement"-endpoint in de gelezen order-docs. [TO-VERIFY — mogelijk alleen via BuckyDrop-dashboard of een ongeziene endpoint.]

**System action.** `order/detail` poll voor `orderStatus 4` + supplement-bedragen. App: nieuwe status nodig (bv. `supplement_pending`) + webhook-mapping voor 4 = **te bouwen**. [CONFIRMED gap]

**Tag.** Status-betekenis [CONFIRMED]; confirm-mechanisme [TO-VERIFY]; app-afhandeling [ASSUMED/te bouwen].

---

## 6. MOQ-issue (minimum order quantity)

**Trigger.** Leverancier (vooral 1688/ALIBABA-fabrieken) hanteert een MOQ; bestelde aantal < MOQ. [ASSUMED — MOQ niet in API-docs gevonden]

**Flow.**
1. `create` kan falen (numerieke `code`) of de PO komt als `orderStatus 4`/`failureReasonList` (failureType 2=Business) terug. [TO-VERIFY — geen MOQ-specifieke code in docs]
2. Admin ziet `failureContent` ~ "below MOQ" in `order/detail`. [ASSUMED veldgebruik]

**Wie betaalt wat.** Opties: (a) klant moet meer kopen tot MOQ (upsell/bundel), (b) Flowva koopt MOQ in als voorraad (`orderType 4` Stock Order), (c) refund. Voor LITHRA-bundels (€20-40) is dit minder relevant; voor losse goedkope items wel. [ASSUMED beleid]

**Wat als het faalt.** Geen MOQ-veld vooraf in `product/detail` zichtbaar → kan pas bij `create` blijken. [TO-VERIFY — check of `product/detail` een MOQ/min-buy-veld heeft.] Risico: herhaalde sold-out-achtige fails.

**System action.** Bij fail met code → `refund_order` (bestaand pad). Pre-emptief MOQ tonen = **niet gebouwd**. [CONFIRMED gap]

**Tag.** [ASSUMED]/[TO-VERIFY] — MOQ niet in gelezen docs.

---

## 7. FOUT item geleverd aan magazijn (verkeerd product/variant)

**Trigger.** Leverancier stuurt verkeerd artikel/kleur/maat; BuckyDrop QC (verplicht Garment Measurement + Photos) detecteert dit bij stock-in (`orderStatus 9`). [CONFIRMED QC-pakket model + status 9]

**Flow.**
1. QC ziet mismatch → **Notify Po Pending** met `confirmType` ("product is defective"/mismatch) + `picList` (inspectiefoto's). [CONFIRMED — beide Required]
2. Webhook: `qc_images=picList`, `dispute_status='pending'`, `problem_type=confirmType`. [CONFIRMED]
3. Admin/klant beslist: return/exchange via `apply-return` (`applyType 2`=Exchange). [CONFIRMED endpoint]

**Wie betaalt wat.** Bij seller-fout: in principe leverancier/BuckyDrop draagt retour-/herzendkosten; de QC-foto is het bewijs. [ASSUMED — acceptatie hangt af van seller-rang, zie #15] Anders draagt klant retourkosten binnen de wet (EU). [CONFIRMED kernmodel]

**Wat als het faalt.**
- Leverancier betwist de mismatch → dispute; QC-foto + Garment Measurement Service (maat vs seller-omschrijving) = bewijs. [CONFIRMED troef]
- `apply-return` afgewezen door lagere-rang seller → BuckyDrop-bemiddeling of afschrijven. [ASSUMED]

**System action.** Inkomend: `buckydrop-webhook` (pics+dispute). Uitgaand: `apply-return` (`applyType 2`) → `returnFlowCode`; status volgen via `order/return/get`. [CONFIRMED]

**Tag.** Detectie+webhook [CONFIRMED]; kostenverdeling/acceptatie [ASSUMED].

---

## 8. Namaak / counterfeit / kwaliteitsvariatie

**Trigger.** QC of klant constateert namaak of significante kwaliteitsafwijking t.o.v. seller-foto's. [ASSUMED]

**Flow.**
1. QC-foto's (`picList`) tonen afwijking → Notify Po Pending → `dispute_status='pending'`. [CONFIRMED mechanisme]
2. Vóór internationale verzending: niet verzenden, `apply-return` (`applyType 1`=Return) richting seller. [CONFIRMED endpoint]
3. Ná verzending/levering: klant meldt → `apply-return` of EU-herroeping (`/returns`, `/withdraw`). [CONFIRMED gebouwd]

**Wie betaalt wat.** Bij counterfeit (sellerfout): refund klant; Flowva claimt bij seller/BuckyDrop. Verlies als claim faalt bij lagere-rang seller. [ASSUMED — rang-afhankelijk]

**Wat als het faalt.**
- Subjectiviteit "kwaliteitsvariatie" → moeilijk hard te maken zonder QC-bewijs; Garment Measurement + Photos verkleinen dit. [CONFIRMED troef]
- Seller weigert namaak-claim → BuckyDrop-platformbemiddeling; uitkomst onzeker. [ASSUMED]

**System action.** `buckydrop-webhook` (dispute), `apply-return` → `returnFlowCode`, en bij refund: `refund_order`/`cancel_paid_order`. [CONFIRMED]

**Tag.** [ASSUMED] kostenkant; mechanisme [CONFIRMED].

---

## 9. Leverancier ANNULEERT / weigert / discontinueert

**Trigger.** Seller annuleert de bestelling, weigert te leveren, of product is gediscontinueerd ná plaatsing. → BuckyDrop zet PO `orderStatus 8` (cancelled) of toont `failureReasonList`. [CONFIRMED status 8]

**Flow.**
1. `Notify Po Status` met `orderStatus 8` → webhook roept `refund_order` RPC aan, reden "BuckyDrop cancelled the order". [CONFIRMED]
2. App-status → effectief geannuleerd (refund verwerkt); RANK-guard blokkeert latere "vooruit"-webhooks. [CONFIRMED]

**Wie betaalt wat.** Volledige refund klant (in-app). BuckyDrop rekent niets voor een geannuleerde, niet-gekochte PO. [CONFIRMED]/[ASSUMED voor fee-vrijheid]

**Wat als het faalt (volgende laag).**
- **Onderscheid pre-purchase vs post-purchase annulering**: als de seller annuleert ná dat BuckyDrop al betaalde, kan er een gedeeltelijke fee/restocking gelden. [TO-VERIFY — `order/detail.actualAmount` vs refundbedrag vergelijken.]
- **Discontinued na herhaalorders**: `product` blijft in catalogus → toekomstige checkouts falen opnieuw. Mitigatie: bij `code`-fail of status 8 ook `products.update{hidden:true, alert_reason:'discontinued'}`. [ASSUMED — nu doet de webhook dit NIET, alleen refund.] [CONFIRMED gap]
- **Refund-route** naar in-app i.p.v. Stripe. [CONFIRMED gap]

**System action.** `buckydrop-webhook` orderStatus 8 → `refund_order`. Aanbevolen toevoeging: product auto-hide bij discontinued. [CONFIRMED bestaand pad + voorgestelde uitbreiding]

**Tag.** Refund-bij-8 [CONFIRMED]; pre/post-purchase-fee + auto-hide [TO-VERIFY]/[ASSUMED].

---

## 10. Leverancier ANNULEERT via expliciete Cancel-call (onze kant)

**Trigger.** Flowva/agent wil een nog-niet-verzonden order intrekken (klant herroept vóór verzending, of admin-beslissing). [CONFIRMED — `/withdraw` gebouwd]

**Flow.**
1. Klant-kant: `cancel_paid_order` RPC — alléén in fase `quote_accepted` (betaald, nog niet gekocht) én alleen als agent een `problem_type` meldde. [CONFIRMED — `refund-order.sql`]
2. BuckyDrop-kant: `shop-order/cancel` (body `shopOrderNo`) voor de hele shop-order, of `po-cancel` (body `orderCode`) voor één Supplier PO. [CONFIRMED endpoints]

**Wie betaalt wat.** Refund klant. Als de PO al `orderStatus 5/6` (ordered/shipped) is, is annuleren waarschijnlijk niet meer mogelijk → return-flow i.p.v. cancel. [ASSUMED — cancel-window]

**Wat als het faalt.**
- `cancel_paid_order` blokkeert als status ≠ `quote_accepted` → ná `purchased` kan de klant niet zelf annuleren; admin moet `shop-order/cancel`/`po-cancel` proberen. [CONFIRMED guard]
- `shop-order/cancel` faalt als de PO al te ver is → fallback `apply-return`. [ASSUMED]
- Idempotentie: dubbele cancel → BuckyDrop geeft vermoedelijk `success:false`/code; afhandelen als no-op. [TO-VERIFY]

**System action.** `cancel_paid_order` RPC (in-app refund) en/of `shop-order/cancel` / `po-cancel`. [CONFIRMED]

**Tag.** Endpoints + RPC [CONFIRMED]; cancel-window-grenzen [ASSUMED/TO-VERIFY].

---

## 11. Vertraging (geen status-progressie)

**Trigger.** PO blijft lang in `orderStatus 2/3` (in review/processing) of `5` (ordered) zonder verder te komen. [CONFIRMED statussen]

**Flow.**
1. Geen webhook → app-status blijft `purchased`/`bought`. Admin pollt periodiek `order/detail`. [CONFIRMED — geen auto-poller gevonden] [CONFIRMED gap]
2. Klant ziet stilstand → support/chat.

**Wie betaalt wat.** Niemand extra; mogelijke goodwill-compensatie = beleidskeuze. [ASSUMED]

**Wat als het faalt.**
- Stilte = ofwel echte vertraging, ofwel een **gemiste webhook** (zie #14). Zonder reconcile-poller niet te onderscheiden. [CONFIRMED gap]
- SLA-overschrijding → recht op annulering/refund (EU bij niet-tijdige levering). [CONFIRMED wettelijk kader]

**System action.** Aanbevolen: cron die open PO's via `order/detail` reconcilet tegen app-status. **Nog te bouwen.** [CONFIRMED gap]

**Tag.** [CONFIRMED] (statussen + ontbrekende poller); compensatiebeleid [ASSUMED].

---

## 12. Idempotentie van place-bucky-order

**Trigger.** `place-bucky-order` wordt >1× aangeroepen voor dezelfde order (pg_net-retry, dubbele trigger, handmatige re-run). [CONFIRMED risico]

**Flow / guards (bestaand).**
1. `if (order.shop_order_no) return "already placed"` → na een geslaagde plaatsing wordt nooit een 2e PO gemaakt. [CONFIRMED]
2. `if (order.status !== "quote_accepted") return "not payable"` → na `purchased`/`cancelled` geen herplaatsing. [CONFIRMED]
3. `partnerOrderNo = order.id` (uniek, max 32) → BuckyDrop kan server-side dedupliceren op partner-order-no. [ASSUMED — dedup-gedrag niet in docs bevestigd] [TO-VERIFY]

**Wie betaalt wat.** Correct: klant betaalt 1×. Bij falende idempotentie: dubbele PO = dubbele wallet-afschrijving (Flowva-verlies) + 2 pakketten. [ASSUMED risico]

**Wat als het faalt (volgende laag).**
- **Race window**: twee gelijktijdige invocaties lezen beide `shop_order_no=null` vóór de 1e zijn update doet → beide plaatsen een PO. De guard is een read-then-write zonder lock. [CONFIRMED zwakte — geen row-lock/`status='placing'`-tussenstap.] Mitigatie: atomic `update ... where shop_order_no is null returning` of een `placing`-status vóór de API-call. [ASSUMED fix]
- **Timeout-dubbelzinnigheid**: BuckyDrop ontvangt `create`, maakt PO, maar het antwoord time-out → onze code ziet "geen code" → `fail()` (geen refund), `shop_order_no` blijft null → volgende retry plaatst een 2e PO. [CONFIRMED gevaar] Mitigatie: bij timeout eerst `order/detail` op `partnerOrderNo` checken vóór re-`create`. [ASSUMED fix]
- BuckyDrop-dedup op `partnerOrderNo` onbekend → niet op vertrouwen. [TO-VERIFY]

**System action.** Huidig: `shop_order_no`-guard + status-guard. Aanbevolen: atomic claim (`placing`) + pre-create `order/detail`-lookup bij retry. [CONFIRMED bestaand + voorgesteld]

**Tag.** Bestaande guards [CONFIRMED]; race/timeout-dubbel-PO [CONFIRMED zwakte] + fixes [ASSUMED]; BuckyDrop-dedup [TO-VERIFY].

---

## 13. Variant-/SKU-mismatch bij plaatsing (interne fail vóór BuckyDrop)

**Trigger.** `pickSku` kan de gekozen variant (`order.kleur`, bv. "Size: M, Color: Blue") niet matchen, of `priceYuan`/`spuCode`/`bd_skus` ontbreekt. [CONFIRMED — `place-bucky-order`]

**Flow.**
1. Geen product gekoppeld → `fail("Geen gekoppeld product...")`. [CONFIRMED]
2. Geen `spu_code`/`bd_skus` → `fail("geen BuckyDrop-koppeling")`. [CONFIRMED]
3. Variant niet te matchen → `fail("Kon variant niet matchen: <kleur>")`. [CONFIRMED]
4. Geen ¥-prijs → `fail("Geen ¥-prijs bekend")`. [CONFIRMED]

**Wie betaalt wat.** `fail()` zet alleen `bd_error` en **refundt NIET** → klant heeft betaald maar order hangt. [CONFIRMED] Vereist admin-interventie (handmatige fix + re-run, of `cancel_paid_order`/`refund_order`). [ASSUMED proces]

**Wat als het faalt (volgende laag).**
- Klant zit met afgeschreven saldo en stille order → support-druk. Mitigatie: `fail()` zou bij permanente mismatch ook moeten refunden of een admin-alert moeten triggeren. [CONFIRMED gap — nu geen alert/refund bij interne fail]
- `parseKleur`/`pickSku` mismatch door whitespace/casing/propnaam-verschillen tussen opgeslagen `props` en `order.kleur`. [CONFIRMED fragiliteit — exacte `every`-match.]

**System action.** `orders.update{bd_error}` (geen status-wijziging, geen refund). Aanbevolen: admin-alert + optionele auto-refund bij niet-herstelbare mismatch. [CONFIRMED bestaand + voorstel]

**Tag.** [CONFIRMED] — direct uit code.

---

## 14. Gemiste / dubbele / out-of-order webhook (status-integriteit)

**Trigger.** BuckyDrop-webhook komt niet aan, komt dubbel, of in verkeerde volgorde. [CONFIRMED risico]

**Flow / guards (bestaand).**
1. `verifySign` (MD5) verwerpt vervalste/ongetekende calls (401). [CONFIRMED]
2. RANK-guard: status beweegt alleen vooruit; `cancelled` is absorberend. [CONFIRMED]
3. Alles wordt rauw gelogd in `bucky_notifications` (ook bij invalid sign). [CONFIRMED]

**Wie betaalt wat.** N.v.t. direct; indirect: gemiste `orderStatus 8` = gemiste refund (klant benadeeld) of gemiste `4` = gemist supplement (Flowva-risico). [ASSUMED]

**Wat als het faalt (volgende laag).**
- **Gemiste 8 (cancel)** → geen refund tot reconcile. [CONFIRMED gap — geen poller]
- **Gemiste 4 (supplement)** → niet gemapt sowieso (#5). [CONFIRMED gap]
- **Dubbele webhook** → idempotent door RANK (her-zetten van dezelfde status = "no forward"); maar dubbele `refund_order` bij 2× orderStatus 8? `refund_order` moet zelf idempotent zijn. [TO-VERIFY — check of `refund_order` dubbele refunds voorkomt.]
- **picList 2×** → `qc_images` overschreven (idempotent genoeg). [CONFIRMED]

**System action.** `buckydrop-webhook` (sign+RANK+log). Aanbevolen: reconcile-cron + idempotente `refund_order`. [CONFIRMED bestaand + voorstel]

**Tag.** Guards [CONFIRMED]; refund-idempotentie [TO-VERIFY]; reconcile [CONFIRMED gap].

---

## 15. Top-rang vs lagere-rang leveranciers (gedrag & retour-acceptatie)

**Trigger.** Verschil in betrouwbaarheid tussen Tmall/gevestigde 1688-fabrieken (top-rang) en goedkope Taobao-sellers (lagere-rang). [ASSUMED — geen rang-veld in gelezen API-docs]

**Flow / verwacht gedrag.**
- **Top-rang (Tmall/TMALL, gevestigde 1688)**: stabielere voorraad/prijs, snellere bevestiging, ruimere retour-/exchange-acceptatie, minder counterfeit-risico. [ASSUMED]
- **Lagere-rang (losse Taobao/TB)**: hoger risico op sold-out na bestelling, prijswisselingen, MOQ-verrassingen, traag, retour-weigering, namaak. [ASSUMED]

**Wie betaalt wat.** Bij lagere-rang weigering draagt Flowva vaker het verlies (claim faalt). De verplichte QC (foto's + Garment Measurement) verschuift bewijslast en verkleint dit verlies. [CONFIRMED QC-troef]

**Wat als het faalt.**
- Geen API-veld om seller-rang vóóraf te scoren → sourcing-beslissing is handmatig/curatie. [TO-VERIFY — heeft `product/detail` een shop-/seller-rating-veld? Checken in product-docs.]
- Strategie: voor LITHRA bij voorkeur top-rang/gecureerde fabrieken; bundels €20-40 om fee-economie te dragen. [CONFIRMED strategie in memory]

**System action.** Curatie bij productimport (handmatig). Optioneel: seller-rating uit `product/detail` opslaan als sourcing-signaal — **te onderzoeken**. [TO-VERIFY/te bouwen]

**Tag.** [ASSUMED]/[TO-VERIFY] — rang-gedrag is ervarings-/aanname-gebaseerd, niet in de gelezen order-docs.

---

## 16. Refund-route (juridische dwarsdoorsnede over alle fail-scenario's)

**Trigger.** Elk scenario dat een refund vereist (sold-out, cancel, defect, namaak, herroeping). [CONFIRMED — meerdere paden]

**Flow (huidig).** `refund_order` / `cancel_paid_order` boeken terug naar **in-app balance** + `transactions`-log. [CONFIRMED — `refund-order.sql` + code]

**Wie betaalt wat.** Klant krijgt waarde terug, maar als in-app saldo i.p.v. originele Stripe-betaling. [CONFIRMED]

**Wat als het faalt (juridische laag).** EU-consumentenrecht/herroeping eist refund naar de **oorspronkelijke betaalmethode (Stripe)** binnen 14 dagen. In-app-only refund is daarmee niet conform voor herroeping. [CONFIRMED juridische gap — staat ook in memory]

**System action.** Nu: in-app RPC. Vereist: Stripe-refund-pad (via `notify-order`/edge function naar Stripe API) gekoppeld aan de refund-RPC's. **Te bouwen.** [CONFIRMED gap]

**Tag.** Huidig pad [CONFIRMED]; Stripe-refund [CONFIRMED te bouwen].

---

## Samenvattende gap-lijst (voor de bouw-backlog)

1. **Stripe-refund-route** i.p.v. in-app — juridisch verplicht bij herroeping. [CONFIRMED]
2. **orderStatus 4 (supplement)**: webhook-mapping + klant/admin-supplement-betaalflow ontbreekt. [CONFIRMED]
3. **Reconcile-cron** op `order/detail` voor gemiste webhooks + vertraging-detectie. [CONFIRMED]
4. **Idempotentie-hardening** van `place-bucky-order`: atomic claim + pre-create `order/detail`-lookup bij retry/timeout. [CONFIRMED zwakte]
5. **Interne fail (#13)** zou admin-alert/auto-refund moeten triggeren i.p.v. stille `bd_error`. [CONFIRMED]
6. **Discontinued/sold-out product auto-hide** na herhaalde fails/orderStatus 8. [CONFIRMED]
7. **`refund_order` idempotentie** bij dubbele orderStatus-8-webhook. [TO-VERIFY]
8. **Partial-stock / multi-line partial-success** gedrag van `create`. [TO-VERIFY]
9. **MOQ + seller-rating vóóraf** uit `product/detail`. [TO-VERIFY]
10. **BuckyDrop dedup op `partnerOrderNo`** + cancel-window + supplement-confirm-endpoint. [TO-VERIFY]
