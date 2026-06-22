# 10 — Voorraad / Stocking Up / Doorstroom

Hoe een fysiek item van een teruggehouden/ingekochte order in een magazijn belandt, daar als
**voorraad** geldt, en hoe een latere klantorder daaruit wordt vervuld in plaats van opnieuw te kopen —
plus dubbel-koop-preventie, voorraad-tracking, dead stock en pre-stocking.

## Fundamentele beperking eerst (lees dit vóór alle scenario's)

BuckyDrop kent twee `businessType`-waarden op order-niveau: **`1` = Sell order** (split in Supplier
Purchase Order / Shopping Agent Purchase Order / **Inventory Purchase Order**) en **`2` = Stock Order**
(split in Supplier Purchase Order / Shopping Agent Purchase Order / **Forwarding Purchase Order**). Op
PO-niveau bestaat `orderType` `1` Supplier / `2` Shopping Agent / `3` Forwarding / `4` Inventory Purchase
Order. **[CONFIRMED]** — gezien in `order/detail`-respons (`order details query` screenshots:
`businessType`, `orderType`, `orderStatus 9: inbound`, `10: outbound`).

**Cruciaal:** `businessType` en `orderType` verschijnen ALLEEN als **read-only velden in de
`order/detail`-respons**. Ze staan **NIET in de request body van `shop-order/create`** (zie
`create shop order` screenshots — body heeft alleen adres + `productList`, geen `businessType`,
`warehouseName`, `otCode` of `stockOrder`-vlag). **[CONFIRMED]**

Gevolg: **via de Solution API zoals Flowva die nu gebruikt kan Flowva GEEN echte Stock Order /
Inventory Purchase Order plaatsen, en geen item naar voorraad parkeren of uit voorraad laten
uitleveren.** Elke `shop-order/create` is een gewone (sell) order die rechtstreeks naar het opgegeven
`detailAddress` van de klant wordt gefulfild. **[CONFIRMED dat het veld ontbreekt; [TO-VERIFY] of er een
apart Stock-Order endpoint bestaat → zoek in BuckyDrop "Solution API" docs naar een endpoint met
`business-type=2`/`stock`/`inbound`/`warehouse`; vraag agent Vera of de API "Inventory Purchase Order /
Stock-in" überhaupt openstelt voor partners, of dat dit alleen in de BuckyDrop-webconsole kan.**

Daarom kent dit hoofdstuk twee sporen:
- **Spoor A — wat NU kan (MVP):** geen gedeelde voorraad; "warehouse" = per-klant verzameling orders op
  status `qc_pending` (zie `WarehouseTab` / `supplyflow-app.jsx`). Doorstroom = haul → internationaal
  verzenden. **[CONFIRMED in code]**
- **Spoor B — echte voorraad (toekomst):** alleen mogelijk als [TO-VERIFY] hierboven "ja" oplevert, óf
  via een Flowva-eigen voorraadtabel + handmatige fulfilment. Alles in Spoor B is `[ASSUMED]`/`[TO-VERIFY]`
  tot het API-pad bevestigd is.

---

## Scenario 1 — Item komt binnen in het magazijn (stock-in / inbound)

**Trigger.** BuckyDrop ontvangt het door de seller verstuurde item in het China-magazijn en zet de PO op
`orderStatus 9` (inbound / stock-in); `putStorageTime` wordt gevuld. **[CONFIRMED]** (order-detail:
`orderStatus 9: inbound`, `putStorageTime` = "Time of product stock-in").

**Flow.**
1. Seller verstuurt → PO `orderStatus 6` (shipped out, richting magazijn).
2. Magazijn ontvangt/scant → PO `orderStatus 9` (inbound) + `putStorageTime`/`warehouseName` gezet.
3. BuckyDrop POST't *Notify Po Status* (MD5-signed) naar `partner_callbackurl`.
4. `buckydrop-webhook` mapt `9 → qc_pending` en zet de order-status (alleen vooruit, via `RANK`).
   **[CONFIRMED in `buckydrop-webhook/index.ts`: `PO_STATUS_MAP[9]="qc_pending"`]**.
5. Klant ziet item in "My warehouse" (`WarehouseTab`, telt orders op `qc_pending`).

**Wie betaalt wat.** Niets extra bij stock-in zelf. Het item is al betaald bij `shop-order/create`
(klant → Stripe → wallet). Opslag in BuckyDrop-magazijn is (binnen de gratis bewaartermijn) kosteloos;
**[TO-VERIFY] BuckyDrop gratis-opslagperiode en storage fee daarna — staat niet in de gelezen docs; vraag
Vera / check "warehouse/storage fee" in console.**

**Wat als het faalt.**
- Webhook komt niet aan / verkeerde sign → status blijft hangen op vorige stap. Mitigatie: poll
  `order/detail` (`action: "order-detail"` in `buckydrop/index.ts`) als reconcile-fallback. **[ASSUMED]**
- Item komt deels binnen (1 van 2) → `poOrderDetails[].packageQuantity` < `originalQuantity`.
  **[CONFIRMED velden bestaan]**; app modelleert dit nu niet → **[TO-VERIFY] partial-inbound afhandeling.**
- Item geweigerd/zoek bij magazijn → typisch een *Notify Po Pending* (defect) of cancel `orderStatus 8`.

**System action.** Inkomend: webhook `PO_STATUS_MAP[9] → setOrderStatus("qc_pending")`. Uitlezen:
`buckyPost("/api/rest/v2/adapt/adaptation/order/detail", { shopOrderNo })`. App-status: `qc_pending`.

**Tag:** [CONFIRMED] (stock-in status + webhook-mapping); opslagkosten [TO-VERIFY].

---

## Scenario 2 — Verplicht QC-pakket op binnenkomst (foto's + meetrapport)

**Trigger.** Item op `qc_pending`; het verplichte QC-pakket (~¥6: Standard Product Photos ¥2/SKU +
Garment Measurement ¥4/SKU) draait via *My Services → Service Preselection* (auto op ALLE orders).
**[ASSUMED — preselection-mechaniek niet in gelezen order-docs; bevestigd als kernmodel in de brief]**.

**Flow.** Magazijn maakt 3-foto-set + meet maten → BuckyDrop POST't foto's. `buckydrop-webhook`
`findPics()` zet `qc_images` op de order. Bij afwijking/defect: *Notify Po Pending* met `confirmType` +
`picList` (beide Required) → `dispute_status="pending"`, `problem_type` gezet. **[CONFIRMED in webhook-code]**.

**Wie betaalt wat.** QC-pakket (~¥6/SKU) zit in `serviceAmount` van de PO (order-detail: `serviceAmount`
= "Value-added service total") en is door Flowva voorgefinancierd uit de wallet; **doorbelasten aan de
klant = Flowva-beslissing** (in fee of als transparante regel). **[ASSUMED bedrag; [CONFIRMED] dat
`serviceAmount` bestaat.]**

**Wat als het faalt.** Meting wijkt af van seller-omschrijving (verkeerde maat) → defect-flow / mogelijke
return vóór internationale verzending (goedkoper: geen retour over de grens). Foto's blijven het
retour-bewijs. **[ASSUMED]**.

**System action.** Webhook: `qc_images` + (bij defect) `dispute_status`/`problem_type`. App-status blijft
`qc_pending` tot klant haul bevestigt.

**Tag:** [CONFIRMED] (QC-foto/defect-pad in code); kosten/preselection [ASSUMED]/[TO-VERIFY].

---

## Scenario 3 — Doorstroom uit het magazijn (haul → internationale verzending) — Spoor A happy path

**Trigger.** Klant bevestigt zijn haul in `WarehouseTab` (`ConfirmHaul`): kies items op `qc_pending`,
betaal internationale verzending (first-weight model + 21% DDP-BTW).

**Flow.**
1. Klant selecteert items → shipping estimate via `haul-shipping` (channel-carriage-list).
2. Klant betaalt verzending (wallet/Stripe). Pakket wordt aangemaakt → PO richting `orderStatus 10`
   (outbound) / `11` (sent, intl). **[CONFIRMED `10: outbound`, `11: sent`]**.
3. Parcel-webhook (`pkgNormalStatus`) en/of PO `11 → shipped_international`, `12 → delivered`.
   **[CONFIRMED in webhook-maps]**.

**Wie betaalt wat.** Klant betaalt internationale verzending (¥1,5/kg boven 2kg overweight; BuckyDrop
fulfilment ¥9,9/parcel 1-5 items + ¥2/item >5). DDP-BTW al in de tax-inclusive lijn → niet dubbel rekenen.
**[CONFIRMED kernmodel]**.

**Wat als het faalt.** Estimate ≠ actual → reconcile: supplement bijbetalen (PO `orderStatus 4` = to be
confirmed incl. supplementary payment) of refund. **[CONFIRMED `4: to be confirmed incl. supplementary
payment`]**. Zie hoofdstuk verzending/reconcile.

**System action.** `haul-shipping` (estimate), parcel-creatie, webhook-status-mapping. App: `qc_pending →
shipped_international → delivered`.

**Tag:** [CONFIRMED].

---

## Scenario 4 — Item teruggehouden i.p.v. uitgeleverd → wordt magazijnvoorraad (Spoor B kern)

**Trigger.** Item is gekocht en op `qc_pending`, maar de klant levert (nog) niet uit, óf de order valt weg
(annulering/herroeping/no-show) terwijl het item al fysiek binnen is → Flowva wil het item NIET weggooien,
maar als **voorraad** aanhouden voor een toekomstige order.

**Flow (zoals het zou moeten).**
1. Markeer order/­item als "naar voorraad" → ontkoppel van de oorspronkelijke klant.
2. Registreer 1 voorraad-eenheid (spu/sku, ¥-kostprijs, magazijn) in een Flowva-voorraadtabel.
3. Later matcht een nieuwe order hierop (zie Scenario 6) i.p.v. nieuw te kopen.

**Wie betaalt wat.** Het item is al betaald (door de oorspronkelijke klant of, bij refund-naar-Stripe, door
Flowva voorgefinancierd → kostprijs wordt **dead-stock-risico** op Flowva's boek). Opslagkosten na de
gratis termijn = Flowva. **[TO-VERIFY] opslagtermijn/-tarief (zie Scenario 1).**

**Wat als het faalt.**
- **API laat geen "stock-in zonder uitlevering" toe** via partner-API → het item blijft technisch een sell
  order met klantadres; "voorraad" bestaat dan alleen als Flowva-DB-laag bovenop een order die je
  *bewust niet verzendt*. **[TO-VERIFY] of een sell order eindeloos op `9 inbound` kan blijven staan
  zonder geforceerde uitlevering / opslagkosten / auto-cancel.**
- Wallet-prefinanciering blokkeert kasstroom (geld zit in onverkochte voorraad).

**System action.** **Geen bestaande RPC.** Vereist NIEUW: voorraadtabel + admin-actie "to_stock". Tot de
API-vraag beantwoord is: **handmatig** in de admin (ai-ops-hud). **[TO-VERIFY] / [ASSUMED]**.

**Tag:** [ASSUMED] (concept) + [TO-VERIFY] (API-haalbaarheid stock-in via partner-API).

---

## Scenario 5 — Fulfill-from-stock vs. nieuw kopen (de beslissing)

**Trigger.** Nieuwe klantorder (`shop-order` aanvraag) op `quote_accepted`; `place-bucky-order` staat op
het punt `shop-order/create` aan te roepen. **[CONFIRMED flow in `place-bucky-order/index.ts`]**.

**Flow (gewenst beslis-tak).**
1. Vóór `shop-order/create`: check Flowva-voorraadtabel op `(spu_code, skuCode)` met `qty_available ≥ qty`.
2. **Hit →** reserveer de voorraad-eenheid, sla `shop-order/create` over, zet order direct naar
   `qc_pending` (item ligt al in magazijn) en plan uitlevering uit voorraad.
3. **Miss →** normale weg: `shop-order/create` (nieuw kopen).

**Wie betaalt wat.** Bij **hit**: klant betaalt normaal; Flowva maakt marge omdat de inkoop al gebeurd is
(geen nieuwe ¥-uitgave, behalve evt. opslag). Bij **miss**: huidig model (wallet betaalt seller).

**Wat als het faalt — de harde edge:** **Hoe lever je uit voorraad daadwerkelijk uit als de API geen
"ship from existing stock / Inventory Purchase Order" endpoint voor partners heeft?** Opties:
- (a) BuckyDrop ondersteunt outbound-from-stock via API → ideaal. **[TO-VERIFY] — zoek endpoint met
  `out-stock`/`otCode`/`outbound`; `order/detail` request kent al `otCode` ("Out stock task code"), wat
  suggereert dat outbound-tasks bestaan, maar er is GEEN gelezen *create-outbound* endpoint.
  **[CONFIRMED dat `otCode` als query-veld bestaat; [TO-VERIFY] of partners outbound kunnen TRIGGEREN.]**
- (b) Geen API → uitlevering uit voorraad = **handmatig in de BuckyDrop-console** door Flowva-operator;
  Flowva-DB houdt de koppeling bij. **[ASSUMED fallback]**.
- (c) Voorraad-mismatch (DB zegt "1 op stock" maar fysiek weg/beschadigd) → val terug op nieuw kopen +
  log discrepantie.

**System action.** NIEUW: pre-create voorraad-lookup-RPC + reserve. Bestaand: `place-bucky-order`
(miss-pad). App-status bij hit: direct `qc_pending` (sla `purchased/bought/shipped_local` over).

**Tag:** [ASSUMED] (beslislogica) + [TO-VERIFY] (outbound-from-stock API).

---

## Scenario 6 — Matchen van een nieuwe order aan bestaande voorraad: AUTO of HANDMATIG?

**Trigger.** Order binnen; voorraad bestaat voor dezelfde `(spu_code, skuCode)`.

**Flow.** Match-sleutel = `(spu_code, skuCode)` (exacte variant), want `place-bucky-order` koppelt al op
`source_url`→product en kiest de SKU via `pickSku(bd_skus, kleur)`. **[CONFIRMED matching-logica in
`place-bucky-order`]**. Een voorraadmatch zou dezelfde sleutel hergebruiken.

**Wie betaalt wat.** Zie Scenario 5.

**Wat als het faalt.** Kernvraag uit de opdracht: **AUTO of HANDMATIG matchen?**
- BuckyDrop matcht een nieuwe partner-`shop-order/create` **NIET** automatisch aan eerder ingekochte
  inbound-voorraad: elke create is een nieuwe sell order die opnieuw bij de seller koopt — er is geen
  "gebruik mijn magazijnvoorraad"-vlag in de body. **[CONFIRMED: body mist zo'n veld]**. Dus **AUTO-match
  aan de BuckyDrop-kant bestaat niet via deze API.** Eventuele match is een **Flowva-eigen (DB) match**,
  en die kan auto (RPC-lookup) of handmatig (admin) zijn — Flowva's keuze.
- Variant-ambiguïteit (meerdere SKU's, lege `props`) → `pickSku` geeft `null` → in huidige flow:
  `fail("Kon variant niet matchen")`. Voor stock-match → val terug op handmatig. **[CONFIRMED faal-pad]**.

**System action.** NIEUW: Flowva-DB match-RPC (auto) met handmatige admin-override. BuckyDrop-kant: n.v.t.

**Tag:** [CONFIRMED] (geen BuckyDrop-auto-match via partner-API) + [ASSUMED] (Flowva-DB-match ontwerp).

---

## Scenario 7 — Dubbel-koop-preventie (niet 2× bij seller kopen)

**Trigger.** Twee triggers die per ongeluk twee keer `shop-order/create` zouden kunnen vuren voor
hetzelfde fysieke doel.

**Flow / bestaande borging.**
1. **Idempotentie op order-niveau (al aanwezig):** `place-bucky-order` returnt vroeg `"already placed"`
   als `order.shop_order_no` al gezet is, en alleen bij status `quote_accepted`. **[CONFIRMED in code]**.
   `partnerOrderNo = order.id` (uniek) → BuckyDrop kan ook server-side dedupliceren op partnerOrderNo.
   **[ASSUMED dedup aan BuckyDrop-kant]**.
2. **Voorraad-reserve (gewenst):** bij een stock-hit moet de voorraad-eenheid **atomair gereserveerd**
   worden (status `reserved`, `reserved_for_order_id`) zodat twee gelijktijdige orders niet dezelfde
   eenheid claimen.

**Wie betaalt wat.** Doel: voorkom dubbele ¥-uitgave (anders koopt Flowva 2× en zit met dead stock).

**Wat als het faalt.**
- Race: 2 orders, 1 voorraad-eenheid → zonder rij-lock (`select … for update` / atomic `update … where
  qty_available > 0`) koopt of reserveert het 2×. Mitigatie: atomic decrement-RPC. **[ASSUMED]**.
- Retry na timeout: `place-bucky-order` zonder `code` flagt `bd_error` en betaalt NIET terug (juist), maar
  een blinde retry kan een 2e create vuren als `shop_order_no` nog niet teruggeschreven is. **[CONFIRMED:
  idempotency hangt aan `shop_order_no`; bij een create die wél bij BuckyDrop slaagde maar waarvan het
  antwoord verloren ging, ontbreekt `shop_order_no` → dubbel-koop-risico]** → **[TO-VERIFY] verifieer of
  BuckyDrop op `partnerOrderNo` dedupliceert; zo niet, query eerst `order/detail` by partnerOrderNo vóór
  retry.**

**System action.** Bestaand: `shop_order_no`-guard. NIEUW: atomic voorraad-reserve-RPC + partnerOrderNo
pre-check vóór retry.

**Tag:** [CONFIRMED] (order-idempotency) + [ASSUMED] (voorraad-reserve) + [TO-VERIFY] (BuckyDrop dedup).

---

## Scenario 8 — Voorraad-tracking in Flowva (DB stock-count)

**Trigger.** Elke stock-in, reserve, uitlevering, retour-naar-voorraad of afschrijving moet de count
bijwerken.

**Flow / datamodel (NIEUW — bestaat nog niet in de gelezen SQL).** Voorgestelde tabel
`stock_units` of geaggregeerd `stock_levels`:
- sleutel `(spu_code, sku_code)`, `qty_on_hand`, `qty_reserved`, `qty_available` (= on_hand − reserved),
  `cost_yuan`, `warehouse_name`, `put_storage_time`, `source_order_id`, `status`
  (`in_stock`/`reserved`/`shipped`/`dead`).
- **[CONFIRMED dat dit NIET bestaat:** `buckydrop-products.sql` voegt alleen `spu_code`, `bd_platform`,
  `bd_skus` (met een informatief `"stock"` in de JSON-vorm, = seller-voorraad, géén Flowva-count) toe;
  `products` heeft geen eigen voorraad-count; "warehouse" in de UI telt enkel orders op `qc_pending`.]**

**Wie betaalt wat.** n.v.t. (administratief).

**Wat als het faalt.**
- DB-drift t.o.v. fysiek magazijn → periodieke reconcile met `order/detail` (`putStorageTime`,
  `warehouseName`, `packageQuantity`) per stock-order. **[CONFIRMED velden bestaan]**.
- Seller-voorraad (`skuList[].quantity` / `soldOutTag` uit `product/detail`) verwarren met Flowva-voorraad
  → strikt scheiden: `bd_skus[].stock` = informatief seller-signaal, NIET Flowva-bezit. **[CONFIRMED
  `soldOutTag`/`quantity` in product-detail].**

**System action.** NIEUW: `stock_levels`-tabel + triggers/RPC's (`stock_in`, `stock_reserve`,
`stock_release`, `stock_ship`, `stock_writeoff`). Reconcile via `order-detail`-call.

**Tag:** [CONFIRMED] (huidige afwezigheid) + [ASSUMED] (voorgesteld model).

---

## Scenario 9 — Pre-stocking hero-items (vooruit inkopen op hero-SKU's)

**Trigger.** Flowva koopt bewust populaire SKU's vooruit in (sneller leveren, MOQ-/bundelvoordeel) vóór er
klantorders zijn.

**Flow.** Forward/Inventory Purchase Order plaatsen → magazijn-inbound (`orderStatus 9`) → voorraad
geregistreerd → later matchen aan binnenkomende orders (Scenario 5/6).

**Wie betaalt wat.** Flowva prefinanciert volledig uit de wallet (CNY). MOQ-aandacht: `product/detail
beginCount` = "Minimum order quantity … wholesale or bulk". **[CONFIRMED `beginCount`]**. Lagere stuksprijs
mogelijk bij bulk; weeg tegen dead-stock-risico en de transparante-prijs-belofte (echte fabrieksprijs blijft
zichtbaar).

**Wat als het faalt.**
- **Het echte risico:** kan Flowva een Forward/Inventory PO **überhaupt via de partner-API plaatsen?**
  `shop-order/create` heeft geen `businessType=2`/`orderType=3|4`. → **[TO-VERIFY] — zelfde openstaande
  vraag als de inleiding; zonder zo'n endpoint moet pre-stocking handmatig in de BuckyDrop-console.**
- Verkeerde maatcurve ingekocht → dead stock (Scenario 10).
- Seller `soldOutTag ≠ 1` / prijs gestegen tussen inkoop en herverkoop → prijs-transparantie geldt op
  herverkoopmoment; eventueel `price_alert`/`hidden` zetten. **[CONFIRMED `soldOutTag`; `price_alert` in
  `price-guard.sql`].**

**System action.** [TO-VERIFY]-endpoint óf handmatige PO; daarna `stock_in`-registratie (Scenario 8).

**Tag:** [ASSUMED] (strategie) + [TO-VERIFY] (API-pad voor Forward/Inventory PO).

---

## Scenario 10 — Dead stock (onverkochte/teruggehouden voorraad)

**Trigger.** Voorraad-eenheid blijft te lang `in_stock` zonder match (verkeerde inkoop, geannuleerde order,
seizoen voorbij).

**Flow.** Detecteer leeftijd (`put_storage_time` → ouderdom-drempel) → kies afhandeling: afprijzen/promo,
bundelen (kernmodel: mik €20-40/bundel om goedkope losse items rendabel te maken), of afschrijven.

**Wie betaalt wat.** Flowva draagt het volledige verlies (kostprijs + opslag). Opslagkosten na gratis
termijn lopen door → **[TO-VERIFY] BuckyDrop opslagtarief & maximale bewaartermijn (en of voorbij de termijn
geforceerde uitlevering/teruglevering/vernietiging volgt).**

**Wat als het faalt.**
- Magazijn dwingt uitlevering/afvoer af vóór Flowva verkocht heeft → geforceerde internationale verzending
  naar Flowva (extra kosten) of weggooien. **[ASSUMED]**.
- Item beschadigd in opslag → afschrijven; QC-foto's bij inbound dienen als nul-meting. **[ASSUMED]**.

**System action.** NIEUW: dead-stock-rapport (admin) + `stock_writeoff`-RPC; optioneel bundel-listing.

**Tag:** [ASSUMED] + [TO-VERIFY] (opslagtermijn/-kosten).

---

## Scenario 11 — Retour komt terug → terug naar voorraad of afschrijven

**Trigger.** Klant doet herroeping/retour (`/withdraw`, `/returns`); BuckyDrop `apply-return` →
`returnFlowCode`. **[CONFIRMED `apply-return` body/respons + `returnFlowCode`].**

**Flow.** Geretourneerd item dat het China-magazijn (opnieuw) bereikt kan — indien onbeschadigd en QC-OK —
**terug als voorraad** geboekt worden i.p.v. afgeschreven.

**Wie betaalt wat.** Refund moet wettelijk naar de **originele betaalmethode (Stripe)**, niet naar in-app
saldo (huidige `refund_order` refundt naar in-app saldo — **[CONFIRMED bekend gebrek]**). Retourkosten:
klant draagt binnen de wet. Terug-in-voorraad bespaart Flowva de afschrijving.

**Wat als het faalt.**
- Item komt niet (terug) in het CN-magazijn (klant stuurde naar fout adres / EU-retour) → niet
  her-voorraadbaar zonder dure herimport. **[ASSUMED]**.
- Beschadigd retour → afschrijven (Scenario 10), QC-foto's als bewijs.
- Match terug-naar-voorraad op `(spu_code, skuCode)` uit de return-details (`productSkuCode`).
  **[CONFIRMED veld in return-details].**

**System action.** `apply-return` → bij fysieke terugkomst `stock_in` (her-voorraad) of `stock_writeoff`.
Refund-naar-Stripe = open finance-actie (buiten dit hoofdstuk).

**Tag:** [CONFIRMED] (return-API + refund-gebrek) + [ASSUMED] (her-voorraad-pad).

---

## Scenario 12 — Reconcile voorraad-DB ↔ BuckyDrop (waarheidsbron)

**Trigger.** Periodiek (cron) of bij twijfel: Flowva-`stock_levels` afstemmen op de fysieke werkelijkheid.

**Flow.** Per stock-order `order/detail` ophalen → vergelijk `putStorageTime`, `warehouseName`,
`packageQuantity`/`originalQuantity`, `orderStatus` (9 inbound / 10 outbound) met de Flowva-count.
**[CONFIRMED velden].**

**Wie betaalt wat.** n.v.t.

**Wat als het faalt.** API rate-limit / per-call fees bij veel stock-items → batch/throttle. **[ASSUMED
per-call fees, genoemd in kernmodel].** Geen Stock-Order-detail beschikbaar voor partners → reconcile valt
terug op handmatige console-telling. **[TO-VERIFY].**

**System action.** Cron-job → `buckyPost("…/order/detail", { shopOrderNo })` per eenheid → update
`stock_levels`; discrepanties loggen voor de admin.

**Tag:** [CONFIRMED] (reconcile-data bestaat) + [ASSUMED]/[TO-VERIFY] (volume/partner-toegang).

---

## Samenvatting van de harde open punten (blokkers voor echte voorraad)

1. **[TO-VERIFY] Kan de partner-Solution-API een Stock/Forward/Inventory Purchase Order plaatsen?**
   `shop-order/create` heeft het veld niet. Vraag agent Vera + zoek een `business-type=2`/`inbound`-endpoint.
2. **[TO-VERIFY] Kan een partner "outbound from stock" (uitleveren uit eerder ingekochte voorraad)
   triggeren?** `otCode`/"Out stock task code" bestaat als query-veld, maar er is geen gelezen
   *create-outbound*-endpoint.
3. **[TO-VERIFY] BuckyDrop opslag: gratis termijn, tarief daarna, max bewaartermijn, geforceerde afvoer.**
4. **[TO-VERIFY] Dedupliceert BuckyDrop op `partnerOrderNo`?** Bepaalt of een retry na verloren response
   dubbel kan kopen.

Zonder (1) en (2) is "echte" gedeelde voorraad alleen te realiseren als Flowva-DB-laag bovenop handmatige
BuckyDrop-console-acties; de happy-path-fulfilment (Spoor A: per-klant warehouse → haul → intl verzending)
werkt vandaag wél volledig via de bestaande code.
