# 14 — Order-state-machine & notificaties

De complete levenscyclus van een Flowva-order: elke status, de trigger die hem
zet, de toegestane (forward-only) transities, de BuckyDrop PO/parcel → Flowva
mapping, elke webhook-type, de klantcommunicatie (Web Push + e-mail) en alle
faal-/edge-transities (cancel, refund, dispuut, supplement, lost, on-hold,
reconcile). Elke claim is getagd [CONFIRMED] (uit docs/code/wet), [ASSUMED]
(redelijke aanname) of [TO-VERIFY] (moet gecheckt — met HOE/waar).

> Grounding: `supabase/functions/buckydrop-webhook/index.ts`,
> `supabase/functions/notify-order/index.ts`, `src/supplyflow-app.jsx`
> (`statusConfig`, `foxMessages`, `trackingSteps`, `RANK`),
> `supabase/{refund-order,auto-refund,price-guard,problem-flow}.sql`,
> en de PNG-docs in `Downloads/api buckydrop/notifications`.

---

## 0. Canonieke status-set & rang (forward-only)

**De officiële Flowva-statussen** (`statusConfig` + webhook `RANK`): [CONFIRMED — `supplyflow-app.jsx:29-41`, `buckydrop-webhook/index.ts:47-50`]

| Status | step (UI) | RANK | Betekenis |
|---|---|---|---|
| `requested` / `quote_sent` / `quote_accepted` | 0 | 0 | Legacy/overgang; "Order placed" |
| `purchased` | 0 | 1 | Order succesvol bij BuckyDrop geplaatst |
| `bought` | 1 | 2 | Seller-PO betaald (ordered) |
| `shipped_local` | 2 | 3 | Onderweg naar BuckyDrop-magazijn (CN) |
| `qc_pending` | 3 | 4 | Stock-in → QC-foto's klaar |
| `shipped_international` | 4 | 5 | Internationaal pakket onderweg |
| `delivered` | 5 | 6 | Afgeleverd |
| `cancelled` | — | — | Terminale zijtak (refund gedaan) |

**Forward-only invariant.** `setOrderStatus` weigert elke transitie waarvan
`RANK[new] <= RANK[current]`, en weigert álles als `current === 'cancelled'`.
Daardoor kan een out-of-order of dubbele webhook een order nooit terugzetten of
een geannuleerde order heropenen. [CONFIRMED — `buckydrop-webhook/index.ts:52-59`]

> **Gat [TO-VERIFY]:** `cancelled` zit níét in de `RANK`-map → `RANK['cancelled']`
> is `undefined` → `?? 0`. De cancelled-guard (`o.status === 'cancelled' → return`)
> vangt dit af vóór de rang-check, dus in de praktijk veilig. Maar `requested/
> quote_sent/quote_accepted` delen allemaal rang 0 mét `purchased`-stap 0 maar
> `purchased` heeft RANK 1 — controleer dat geen webhook ooit `quote_accepted`
> probeert te zetten (dat doet alleen Stripe/de app, niet BuckyDrop). HOE: grep op
> `quote_accepted` in de edge functions.

---

## 1. HAPPY PATH

### 1.1 Order geplaatst → `purchased`

- **Trigger:** Stripe-betaling geslaagd → app/trigger zet order op `quote_accepted`
  → pg_net-trigger roept `place-bucky-order` aan; bij succes schrijft die
  `shop_order_no` + `status='purchased'`. [CONFIRMED — `place-bucky-order/index.ts:2,94,168-171`]
- **Flow:** (1) klant betaalt cart (Stripe, EUR); (2) order → `quote_accepted`;
  (3) `place-bucky-order` POST't de shop-order naar BuckyDrop; (4) succes →
  `shop_order_no` opgeslagen, `status='purchased'`, `bd_error=null`.
- **Wie betaalt wat:** klant heeft al betaald (productprijs + 8% fee, min €5) via
  Stripe; founder vult later de BuckyDrop-wallet (CNY, prepaid). [CONFIRMED — kernmodel]
- **Wat als het faalt:** zie 3.1 (BuckyDrop weigert → auto-refund) en 4.1
  (idempotentie: `shop_order_no` al gezet → "already placed", geen dubbele order).
  [CONFIRMED — `place-bucky-order/index.ts:93`]
- **System action:** `place-bucky-order` → BuckyDrop create-shop-order; DB-update
  `orders.status='purchased'`. DB-webhook → `notify-order` push **"🛒 Order placed
  — We're buying your item for you right now."** [CONFIRMED — `notify-order/index.ts:18`]
- **Tag:** [CONFIRMED]

### 1.2 Seller betaald → `bought`

- **Trigger:** BuckyDrop **Notify Po Status** met PO `orderStatus = 5` (ordered).
  [CONFIRMED — doc 133538 "5: ordered", `buckydrop-webhook/index.ts:33`]
- **Flow:** webhook → sign-check → `findPO(body)` vindt object met `orderCode` +
  `orderStatus` → `PO_STATUS_MAP[5]='bought'` → `setOrderStatus`. [CONFIRMED — `index.ts:62-67,33,119-120`]
- **Wie betaalt wat:** BuckyDrop-wallet (CNY, prepaid) is afgeschreven voor de
  fabrieksprijs + per-call API-fee. Geen extra klant-charge. [CONFIRMED — kernmodel]
- **Wat als het faalt:** wallet-saldo te laag → PO blijft hangen op een eerdere
  status; geen `bought`-webhook → order blijft `purchased`. **[TO-VERIFY]** of
  BuckyDrop een aparte "insufficient balance"-status/notify stuurt. HOE: testorder
  met lege wallet + bucky_notifications-log inspecteren.
- **System action:** `orders.status='bought'`; push **"✅ Item bought! — Your item
  is paid for and heading to our warehouse."** [CONFIRMED — `notify-order/index.ts:19`]
- **Tag:** [CONFIRMED] (mapping & push); [TO-VERIFY] (balance-faalpad)

### 1.3 Onderweg naar magazijn → `shipped_local`

- **Trigger:** **Notify Po Status**, PO `orderStatus = 6` (shipped out, richting
  magazijn). [CONFIRMED — doc 133538 "6: shipped out", `index.ts:34`]
- **Flow:** webhook → `PO_STATUS_MAP[6]='shipped_local'` → `setOrderStatus`.
- **Wie betaalt wat:** binnenlandse CN-verzending seller→magazijn zit in de
  fabrieks-/sellerkosten of is verwaarloosbaar; al gedekt. [ASSUMED]
- **Wat als het faalt:** webhook 6 gemist → status 9 (stock-in) komt later en
  springt rechtstreeks naar `qc_pending` (rang 3→4 ok, forward-only houdt stand).
  Geen schade. [CONFIRMED — forward-only `index.ts:56`]
- **System action:** `orders.status='shipped_local'`; push **"🚚 On its way to our
  warehouse — Your item is in transit in China."** [CONFIRMED — `notify-order/index.ts:20`]
- **Tag:** [CONFIRMED]

### 1.4 Stock-in + QC-foto's klaar → `qc_pending`

- **Trigger:** **Notify Po Status**, PO `orderStatus = 9` (stock-in). [CONFIRMED —
  doc 133538 "9: stock-in", `index.ts:35`]
- **Flow:** webhook → `PO_STATUS_MAP[9]='qc_pending'`. Het VERPLICHTE QC-pakket
  (Standard Product Photos ¥2 + Garment Measurement ¥4) is in dit stadium
  uitgevoerd; foto's komen mee (zie 6) en worden in `orders.qc_images` gezet zodra
  een notify met `picList` binnenkomt. [CONFIRMED — `index.ts:35,108-113`; QC-pakket = kernmodel]
- **Wie betaalt wat:** QC-pakket ~¥6/order, vooraf in de klantprijs gecalculeerd;
  betaald uit de wallet. [CONFIRMED — kernmodel]
- **Wat als het faalt:** stock-in zonder foto's → status gaat naar `qc_pending`
  maar `qc_images` is leeg → UI toont alsnog "QC photos ready" zonder beelden.
  **[TO-VERIFY]** of `picList` áltijd meekomt bij gewone stock-in of alléén bij de
  defect-notify (Notify Po Pending). Volgens de docs is `picList` Required in
  **Notify Po Pending** (defect), niet gegarandeerd in **Notify Po Status**. HOE:
  log inspecteren + admin "re-fetch QC photos"-knop overwegen. Zie ook 7.1.
- **System action:** `orders.status='qc_pending'` (+ `qc_images` indien foto's);
  push **"📸 QC photos are ready! — View your item and add it to a parcel in the
  app."** UI ontgrendelt parcel-consolidatie. [CONFIRMED — `notify-order/index.ts:21`,
  `supplyflow-app.jsx:1651`]
- **Tag:** [CONFIRMED] (status & push); [TO-VERIFY] (foto-garantie bij happy path)

### 1.5 Internationaal verzonden → `shipped_international`

- **Trigger:** twee mogelijke bronnen, beide geaccepteerd:
  1. **Notify Po Status**, PO `orderStatus = 11` (delivered – international delivery).
     [CONFIRMED — doc 133538 "11: delivered (international)", `index.ts:36`]
  2. **Notify Parcel Status**, `pkgNormalStatus = 2` (shipped out) of `= 3`
     (to be delivered). [CONFIRMED — doc 133627, `index.ts:40-44`]
- **Flow:** parcel-webhook → `PKG_STATUS_MAP[2|3]='shipped_international'`; de
  `partnerOrderNoList`-array bevat alle order-id's in het pakket → loop +
  `setOrderStatus` per order. [CONFIRMED — `index.ts:92-98`]
- **Wie betaalt wat:** internationale verzending: BuckyDrop fulfilment ¥9,9/parcel
  (1-5 items) + ¥2/item boven 5 + ¥1,5/kg boven 2 kg, plus DDP-BTW (tax-inclusive
  lijnen). Geschat bij checkout via channel-carriage-list, daarna reconcile (zie 5.3).
  [CONFIRMED — kernmodel]
- **Wat als het faalt:** `partnerOrderNoList` leeg of `pkgNormalStatus` ongemapt →
  `action = "parcel X (no map/ids)"`, status onveranderd, maar wél gelogd. [CONFIRMED — `index.ts:99`]
- **System action:** `orders.status='shipped_international'`; push **"✈️ Shipped to
  you — Your parcel is on its way to you!"** UI toont tracking-number. [CONFIRMED —
  `notify-order/index.ts:22`, `supplyflow-app.jsx:1687`]
- **Tag:** [CONFIRMED]

### 1.6 Afgeleverd → `delivered`

- **Trigger:** drie bronnen, alle geaccepteerd:
  1. **Notify Parcel Status**, `pkgNormalStatus = 4` (delivered). [CONFIRMED — doc 133627, `index.ts:43`]
  2. **Notify Po Status**, PO `orderStatus = 12` (fulfilled). [CONFIRMED — doc 133538, `index.ts:37`]
  3. (PO 11 = international delivered mapt naar `shipped_international`, NIET delivered
     — bewust, want "international delivered" = aangekomen in land, nog niet bij deur.)
     [CONFIRMED — `index.ts:36`]
- **Flow:** parcel-webhook `pkgNormalStatus=4` → `PKG_STATUS_MAP[4]='delivered'`.
- **Wie betaalt wat:** niets extra; alle kosten al verrekend (behoudens openstaande
  reconcile/supplement, zie 5.3). [ASSUMED]
- **Wat als het faalt:** carrier markeert "delivered" terwijl klant niets ontving
  (lost/stolen) → zie 5.5 (dispuut, geen automatische refund). [ASSUMED — wet/proces]
- **System action:** `orders.status='delivered'`; push **"🎉 Delivered! — Your
  order has arrived. Enjoy!"** [CONFIRMED — `notify-order/index.ts:23`]
- **Tag:** [CONFIRMED]

---

## 2. WEBHOOK-TYPES (BuckyDrop → Flowva)

Alle drie POSTen naar dezelfde `partner_callbackurl` (= `buckydrop-webhook`),
MD5-gesigneerd over de niet-lege `notifyHeader`-velden, alfabetisch gesorteerd,
met `appSecret` aan begin én eind in het doc-voorbeeld; de **code verifieert** met
`MD5(gesorteerde-header-params + "&appSecret=" + appSecret)`. [CONFIRMED — docs
133513/133547/133616 + `index.ts:17-29`]

> **Discrepantie [TO-VERIFY]:** docs zeggen "Add appSecret to the **beginning and
> end** of string A"; de code plakt `appSecret` alléén achteraan. De code-comment
> claimt "bewezen tegen hun voorbeeld". HOE: één echte inkomende notify met
> `sign_ok=false` in `bucky_notifications` → herbereken beide varianten en vergelijk.

### 2.1 Notify Po Status (`notifyType` PO-niveau)
- **Doel:** PO-status verandert. Body bevat `shopOrderInfo` (partnerOrderNo,
  shopOrderNo, orderTime), `soOrderInfo` (businessType, orderStatus 0-3, createTime)
  en `poOrderInfo` (orderCode, orderStatus **1-12**, orderType, warehouseName,
  signTime, putStorageTime). [CONFIRMED — docs 133526/133532/133538]
- **PO orderStatus → Flowva-map:** 5→bought, 6→shipped_local, 9→qc_pending,
  11→shipped_international, 12→delivered. **Niet gemapt** (genegeerd, wel gelogd):
  1 paid, 2 in review, 3 processing, 7 received, 10 stock-out. **Speciaal:** 4 =
  to-be-confirmed/supplement (zie 5.3), 8 = cancelled (zie 3.1). [CONFIRMED — `index.ts:32-38,115-121`]

### 2.2 Notify Po Pending (defect-melding)
- **Doel:** PO heeft handmatige afhandeling nodig — typisch een **defect**. Velden
  `confirmType` (string, "the product is defective") én `picList` (Array[]
  inspectiefoto's) zijn **BEIDE Required**. [CONFIRMED — doc 133608]
- **Gevolg in Flowva:** `findPics` haalt `picList`; webhook zet `orders.qc_images`
  = foto's én — als `confirmType`/`po.confirmType` aanwezig — `dispute_status='pending'`
  + `problem_type=<confirmType>`. [CONFIRMED — `index.ts:108-113`]
- **Garantie:** bij een defect komt de bewijsfoto gegarandeerd mee (Required). =
  retour-/transparantie-troef. [CONFIRMED — doc 133608 + kernmodel]

### 2.3 Notify Parcel Status (`notifyType` parcel-niveau)
- **Doel:** parcel-status verandert. Header heeft eigen `packageCode`; body bevat
  `packageStatus` (1-10), `partnerOrderNoList` (Array — alle orders in 't pakket),
  `pkgNormalStatus` (1-5), `outboundTime`, `deliveryTime`, optioneel
  length/width/height/weight. [CONFIRMED — docs 133621/133627/133633]
- **pkgNormalStatus → Flowva-map:** 2→shipped_international, 3→shipped_international,
  4→delivered. **Niet gemapt:** 1 to-be-shipped, 5 cancelled (zie 5.4). [CONFIRMED — `index.ts:40-44`]
- **packageStatus (1-10)** wordt momenteel NIET gebruikt (alleen `pkgNormalStatus`).
  Detectie of het een parcel-notify is: `body.packageCode != null || header.packageCode
  != null || body.pkgNormalStatus != null`. [CONFIRMED — `index.ts:91`]

### 2.4 Idempotentie & logging (alle types)
- **Elke** notify (ook ongeldige sign) wordt rauw in `bucky_notifications` gelogd
  met `notify_type`, `matched`, `action`, `sign_ok`, `payload`. [CONFIRMED — `index.ts:128-131`]
- Ongeldige sign → HTTP 401 `{success:false}`; geldige → 200 `{success:true, action}`.
  **[TO-VERIFY]** of BuckyDrop bij 401 herhaalt/retried (en hoe vaak) — zo niet, dan
  is een verkeerde appSecret-config stil dataverlies. HOE: agent Vera vragen +
  retry-gedrag in productie loggen.

---

## 3. ANNULEREN & REFUND-EDGES

### 3.1 BuckyDrop annuleert de order (uitverkocht/weigering) → `cancelled`
- **Trigger A (webhook):** **Notify Po Status** met PO `orderStatus = 8` (cancelled).
  [CONFIRMED — doc 133538 "8: cancelled", `index.ts:115`]
- **Trigger B (server-side):** `place-bucky-order` krijgt een weigering bij plaatsing
  (out-of-stock) → roept zelf `refund_order` aan. [CONFIRMED — `auto-refund.sql:3-7`]
- **Flow:** webhook PO=8 → `admin.rpc('refund_order', {p_order_id, p_reason:'BuckyDrop
  cancelled the order'})`. `refund_order`: (1) lock order; (2) idempotent — al
  `cancelled` → `{already:true}`; (3) productprijs (`quoted_total`||`price`) terug
  naar `profiles.balance` + `transactions(type='refund')`; (4) `status='cancelled'`,
  `bd_error=reason`; (5) als hele `request_group_id` nu cancelled is → service fee
  één keer terug (`type='fee_refund'`, dubbel-refund-guard). [CONFIRMED — `index.ts:115-117`,
  `auto-refund.sql:26-62`]
- **Wie betaalt wat:** klant krijgt productprijs (+ fee als laatste item van de groep)
  terug. **LET OP — wettelijk gat:** refund gaat nu naar IN-APP saldo, niet naar de
  originele Stripe-betaalmethode. EU-recht eist terug naar originele methode.
  [CONFIRMED — `auto-refund.sql:34-36` + kernmodel/MEMORY]
- **Wat als het faalt:** dubbele PO=8-webhook → `refund_order` idempotent (al
  cancelled → geen tweede refund). Forward-only: na `cancelled` weigert
  `setOrderStatus` elke latere status-webhook. [CONFIRMED — `index.ts:55`, `auto-refund.sql:28`]
- **System action:** RPC `refund_order`; `orders.status='cancelled'`; push **"↩️
  Order refunded — An item was unavailable, so we've refunded it to your balance."**
  [CONFIRMED — `notify-order/index.ts:24`]
- **Tag:** [CONFIRMED] (mechaniek); [TO-VERIFY/risico] (refund-bestemming Stripe i.p.v. saldo)

### 3.2 Klant annuleert ná betaling, vóór aankoop → `cancelled`
- **Trigger:** klant in app, order in `quote_accepted` (betaald, nog niet gekocht)
  ÉN agent heeft een `problem_type` gemeld → `cancel_paid_order(p_order_id)`.
  [CONFIRMED — `refund-order.sql:5-9,12`]
- **Flow:** RPC checkt: ingelogd, eigenaar, status `quote_accepted`, `problem_type`
  niet null → refund (`price`||`quoted_total`) naar balance + `transactions('refund')`
  → `status='cancelled'`, `problem_type=null`. [CONFIRMED — `refund-order.sql:23-50`]
- **Wie betaalt wat:** klant krijgt het lijnbedrag terug (naar saldo — zelfde
  Stripe-gat als 3.1). [CONFIRMED]
- **Wat als het faalt:** status ≠ `quote_accepted` → geweigerd ("kan alleen na
  betaling, vóór aankoop"); geen `problem_type` → geweigerd ("alleen als agent een
  probleem meldde"). Eenmaal `purchased`/`bought` is dit pad dicht → klant moet de
  EU-herroeping (/withdraw) of retour (/returns) gebruiken (zie 5.6). [CONFIRMED —
  `refund-order.sql:32-38`]
- **System action:** RPC `cancel_paid_order`; `orders.status='cancelled'`. Push idem
  als 3.1 (status→cancelled triggert dezelfde melding). [CONFIRMED]
- **Tag:** [CONFIRMED]

### 3.3 Probleemmelding door agent (geen cancel) — zijtak
- **Trigger:** agent/admin meldt `problem_type` (`out_of_stock`, `variant_unavailable`,
  `price_changed`, `link_broken`) op de order. [CONFIRMED — `problem-flow.sql:6-8`]
- **Flow:** `orders.problem_type` gezet; order blijft in z'n huidige status maar de
  klant kan nu 3.2 gebruiken, of de admin lost het op (variant wijzigen, herprijzen).
  [CONFIRMED — `problem-flow.sql` + `refund-order.sql:36`]
- **Wie betaalt wat:** nog niets; afhankelijk van resolutie (refund of doorgaan). [ASSUMED]
- **Wat als het faalt:** klant negeert de melding → order blijft hangen. **[TO-VERIFY]**
  of er een auto-cancel-timeout is. HOE: zoek naar cron/timeout-job; lijkt te
  ontbreken → handmatige admin-opvolging vereist.
- **System action:** DB-update `problem_type`. **[TO-VERIFY]** of er een aparte
  push/e-mail bij een probleem hoort — `notify-order` heeft géén bericht voor
  "problem", alleen voor statuswijzigingen. HOE: aparte notify toevoegen of admin
  meldt buiten de app. Zie 8.2.
- **Tag:** [CONFIRMED] (data); [TO-VERIFY] (klantnotificatie + timeout)

### 3.4 Defect gemeld via Notify Po Pending → `dispute_status='pending'`
- **Trigger:** **Notify Po Pending** met `confirmType` (defect) + `picList`. [CONFIRMED — doc 133608]
- **Flow:** webhook zet `qc_images=picList`, `dispute_status='pending'`,
  `problem_type=confirmType`. De order-status zelf verandert NIET hier (defect ⊥
  forward-progressie). [CONFIRMED — `index.ts:108-113`]
- **Wie betaalt wat:** afhankelijk van klantkeuze (doorgaan / vervangen / refund);
  inspectiekosten al gedekt door QC-pakket. [ASSUMED]
- **Wat als het faalt:** klant reageert niet op het dispuut → order blijft met
  `dispute_status='pending'`. **[TO-VERIFY]** beslis-UI + timeout + welke API-call
  (apply-return vs. doorgaan). HOE: ontwerp dispuut-resolutiescherm; koppel aan
  BuckyDrop apply-return → `returnFlowCode`.
- **System action:** DB-update (geen status-shift). **[TO-VERIFY]** push voor "we
  found a defect" ontbreekt in `notify-order`. HOE: bericht toevoegen voor
  `dispute_status`-wijziging (aparte DB-webhook-conditie).
- **Tag:** [CONFIRMED] (detectie + foto-vastlegging); [TO-VERIFY] (resolutie-flow + notificatie)

---

## 4. IDEMPOTENTIE, DUBBELE & OUT-OF-ORDER WEBHOOKS

### 4.1 Dubbele order-plaatsing
- **Trigger:** trigger vuurt twee keer, of retry op `place-bucky-order`.
- **Flow/guard:** als `order.shop_order_no` al bestaat → "already placed", geen tweede
  BuckyDrop-order; als `order.status !== 'quote_accepted'` → "not payable". [CONFIRMED —
  `place-bucky-order/index.ts:93-94`]
- **Wie betaalt wat:** geen dubbele wallet-afschrijving. [CONFIRMED]
- **System action:** geen-op / 200. **Tag:** [CONFIRMED]

### 4.2 Terugwaartse / ongeldige status-webhook
- **Trigger:** BuckyDrop stuurt een lagere status na een hogere (bijv. 6 ná 9), of
  herhaalt 9.
- **Flow/guard:** `setOrderStatus` → `RANK[new] <= RANK[current]` → "no forward",
  niets gewijzigd. [CONFIRMED — `index.ts:56`]
- **System action:** geen status-shift, wel gelogd. **Tag:** [CONFIRMED]

### 4.3 Status-webhook op een gecancelde order
- **Trigger:** late PO/parcel-notify nadat de order al `cancelled` is.
- **Flow/guard:** `setOrderStatus` → `o.status === 'cancelled'` → "cancelled",
  geweigerd. [CONFIRMED — `index.ts:55`]
- **System action:** geen heropening. **Tag:** [CONFIRMED]

### 4.4 Ongemapte status
- **Trigger:** PO 1/2/3/7/10 of parcel `pkgNormalStatus` 1 (en `packageStatus`-only
  events).
- **Flow:** geen mapping → geen status-shift; `action="po X (no map)"` /
  `"parcel X (no map/ids)"`; gelogd. [CONFIRMED — `index.ts:99,121`]
- **Wat als het faalt:** een statusovergang die de klant wél zou willen zien (bijv.
  "in review") is onzichtbaar. **[TO-VERIFY]** of PO 2/3 een tussenstatus verdienen
  (bijv. een "agent is reviewing"-micro-update). HOE: productbeslissing.
- **Tag:** [CONFIRMED] (gedrag); [TO-VERIFY] (wenselijkheid extra mapping)

### 4.5 Push-levering faalt
- **Trigger:** verlopen/ongeldige Web Push-subscription (HTTP 404/410).
- **Flow:** `notify-order` vangt de fout, verwijdert de subscription
  (`push_subscriptions.delete`). [CONFIRMED — `notify-order/index.ts:57-63`]
- **Wat als het faalt:** klant zonder geldige subscription mist de push → leunt op
  in-app status + (toekomstige) e-mail. **[TO-VERIFY]** e-mail-fallback: `notify-order`
  stuurt alléén Web Push, geen e-mail. HOE: Resend-mail toevoegen per status. Zie 8.1.
- **Tag:** [CONFIRMED] (push-cleanup); [TO-VERIFY] (e-mailkanaal)

### 4.6 DB-webhook zonder echte statuswijziging
- **Trigger:** `orders`-UPDATE waarbij `status` gelijk blijft, of niet-UPDATE event.
- **Flow:** `notify-order` → `record.status === old.status` → "no status change", géén
  push; ook geen push voor statussen zonder bericht (bijv. `quote_accepted`). [CONFIRMED —
  `notify-order/index.ts:36-40`]
- **Tag:** [CONFIRMED]

---

## 5. VERZEND-, SUPPLEMENT-, LOST- & RETOUR-EDGES

### 5.1 Parcel-consolidatie (klant bundelt orders)
- **Trigger:** meerdere orders op `qc_pending`; klant kiest items en maakt één
  internationaal pakket. [CONFIRMED — UI ontgrendelt bij `qc_pending`,
  `supplyflow-app.jsx:1297-1298,1651`]
- **Flow:** klant betaalt geschatte internationale verzending (channel-carriage-list
  estimate) → BuckyDrop maakt parcel → `partnerOrderNoList` koppelt álle order-id's →
  latere parcel-webhooks updaten ze samen. [CONFIRMED — `index.ts:94-97`; estimate = kernmodel]
- **Wie betaalt wat:** klant betaalt verzend-estimate (fulfilment-fee + gewicht +
  DDP-BTW). [CONFIRMED — kernmodel]
- **Wat als het faalt:** zie 5.3 (reconcile bij gewicht-/prijsverschil). **Tag:** [CONFIRMED]/[ASSUMED]

### 5.2 Overgewicht / supplement → PO `orderStatus = 4`
- **Trigger:** **Notify Po Status** met PO `orderStatus = 4` (to be confirmed,
  inclusief supplementary payment). [CONFIRMED — doc 133538 "4: to be confirmed
  (including supplementary payment)"]
- **Flow (huidig):** status 4 is **niet gemapt** in `PO_STATUS_MAP` → de webhook
  doet niets behalve loggen (`"po 4 (no map)"`). [CONFIRMED — `index.ts:32-38`]
- **Wie betaalt wat:** klant moet bijbetalen (extra gewicht/kosten). [CONFIRMED — kernmodel]
- **Wat als het faalt:** **GAT — supplement wordt nu genegeerd.** Geen bij-charge,
  geen klant-prompt → BuckyDrop wacht op betaling, parcel blijft hangen. **[TO-VERIFY/
  TO-BUILD]:** een `awaiting_supplement`-substatus + bij-charge-flow (Stripe of
  saldo) + API-call om het supplement te bevestigen. HOE: order-substatus + UI-prompt
  + reconcile-RPC bouwen; PO=4 in de webhook afvangen. Zie open vragen.
- **System action (gewenst):** detecteer PO=4 → markeer `awaiting_supplement` + push
  "Action needed: extra shipping". Nu: alleen log. **Tag:** [TO-VERIFY/TO-BUILD]

### 5.3 Reconcile estimate ↔ actual
- **Trigger:** werkelijk parcelgewicht/-kosten ≠ estimate (parcel-notify bevat
  optioneel `weight`/length/width/height). [CONFIRMED — doc 133633 weight/length etc.]
- **Flow (gewenst):** vergelijk actual vs. estimate → tekort = supplement bij-charge
  (PO=4-pad, 5.2); overschot = refund naar saldo. [ASSUMED — kernmodel "reconcile"]
- **Wie betaalt wat:** klant betaalt tekort bij of krijgt overschot terug. [CONFIRMED — kernmodel]
- **Wat als het faalt:** zonder reconcile-logica draagt de founder het verschil.
  **[TO-VERIFY/TO-BUILD]** reconcile-job. HOE: parcel-notify-`weight` opslaan,
  vergelijken met `haul-shipping`-estimate, RPC voor supplement/refund.
- **System action:** **[TO-BUILD]**. **Tag:** [TO-VERIFY]

### 5.4 Parcel geannuleerd → `pkgNormalStatus = 5` / `packageStatus = 10`
- **Trigger:** **Notify Parcel Status** met `pkgNormalStatus=5` (cancelled) of
  `packageStatus=10` (cancelled). [CONFIRMED — docs 133627/133633]
- **Flow (huidig):** 5 is niet gemapt → geen status-shift, alleen log. [CONFIRMED — `index.ts:40-44`]
- **Wat als het faalt:** **GAT** — een geannuleerd pakket laat orders op
  `shipped_international`/`qc_pending` staan zonder dat de klant geld terugziet.
  **[TO-VERIFY/TO-BUILD]:** parcel-cancel → orders terug naar `qc_pending` of refund
  van de verzendkosten. HOE: pkgNormalStatus=5 in webhook afvangen + verzend-refund-RPC.
- **Tag:** [TO-VERIFY/TO-BUILD]

### 5.5 Lost / niet aangekomen ondanks "delivered"
- **Trigger:** carrier zegt delivered (PO 12 / pkg 4) maar klant ontving niets, of
  pakket verdwijnt onderweg (geen verdere webhook).
- **Flow:** geen auto-detectie; klant opent dispuut/claim. [ASSUMED]
- **Wie betaalt wat:** afhankelijk van carrier-claim/verzekering; bij niet-leverbaar
  draagt de founder of de carrier. [ASSUMED]
- **Wat als het faalt:** geen "stuck parcel"-timeout. **[TO-VERIFY/TO-BUILD]:** een
  SLA-timer (bijv. X dagen op `shipped_international` zonder `delivered` → admin-flag).
  HOE: cron over `orders` + `updated_at`. Zie 7.2.
- **Tag:** [ASSUMED]/[TO-VERIFY]

### 5.6 EU-herroeping & retour (na delivered) → returnFlowCode
- **Trigger:** klant gebruikt `/withdraw` (14-dagen-herroeping) of `/returns` na
  ontvangst. [CONFIRMED — kernmodel/MEMORY; `ReturnsPage.jsx` bestaat]
- **Flow:** Flowva → BuckyDrop **apply-return** → `returnFlowCode`; retour fysiek
  terug; refund verwerkt. [CONFIRMED — kernmodel]
- **Wie betaalt wat:** binnen de wet draagt de klant de retourkosten; productprijs
  terug naar de **originele methode (Stripe)** — wettelijk vereist (huidige
  `refund_order` doet saldo → zelfde gat als 3.1). [CONFIRMED — wet + MEMORY]
- **Wat als het faalt:** retour komt niet aan / weigering door seller. **[TO-VERIFY/
  TO-BUILD]:** returnFlowCode-status-tracking + refund-trigger-bij-ontvangst. HOE:
  return-status-webhook/polling + Stripe-refund i.p.v. saldo.
- **Tag:** [CONFIRMED] (proces); [TO-VERIFY] (Stripe-refund + return-tracking)

### 5.7 On-hold door price-guard (vóór aankoop)
- **Trigger:** live BuckyDrop-prijscheck bij checkout ziet te grote ¥-stijging of
  uitverkocht → `products.price_alert=true` + `hidden`/`alert_reason`. [CONFIRMED —
  `price-guard.sql:1-8`, `OrderRequest.jsx:66`]
- **Flow:** klant krijgt "temporarily on hold — we're updating it, check back soon";
  admin re-fetcht prijs + reactiveert (clear flag + unhide). [CONFIRMED —
  `OrderRequest.jsx:66`, `price-guard.sql:4-5`]
- **Wie betaalt wat:** niets — order wordt niet geplaatst tot reactivatie. [CONFIRMED]
- **Wat als het faalt:** klant heeft al betaald voordat de stijging zichtbaar werd →
  valt terug op `place-bucky-order`-weigering → auto-refund (3.1). [CONFIRMED]
- **System action:** product-flags; geen order-status-shift (dit is product-, niet
  order-niveau). **Tag:** [CONFIRMED]

---

## 6. QC-FOTO'S & VERPLICHT INSPECTIEPAKKET

- **Bron 1 (defect):** Notify Po Pending → `picList` gegarandeerd (Required). [CONFIRMED — doc 133608]
- **Bron 2 (regulier):** standaard QC-pakket (¥2 foto's + ¥4 maatmeting) bij elke
  order; foto's verschijnen rond stock-in/`qc_pending`. [CONFIRMED — kernmodel]
- **Opslag:** webhook zet `orders.qc_images=pics` zodra een notify met `picList`
  binnenkomt (via generieke `findPics`, ongeacht type). [CONFIRMED — `index.ts:70-78,108-113`]
- **UI:** foto's tonen bij `qc_pending` (`selectedOrder.qc_images?.length>0`).
  [CONFIRMED — `supplyflow-app.jsx:1651`]
- **Gat [TO-VERIFY]:** of de *reguliere* (niet-defect) Notify Po Status bij stock-in
  óók `picList` meestuurt. Zo niet → reguliere QC-foto's missen. HOE: log inspecteren;
  desnoods aparte product-API-call om QC-foto's op te halen. Zie 7.1.

---

## 7. GAPS & WATCHDOGS (volgende edge-laag)

### 7.1 Reguliere QC-foto's mogelijk afwezig
- **[TO-VERIFY]** `picList` is alleen bewezen Required in **Notify Po Pending**
  (defect). HOE: bevestig met Vera/log of stock-in-notify ook foto's draagt; anders
  product-/order-detail-API pollen na `qc_pending`.

### 7.2 Stuck-order watchdog ontbreekt
- **[TO-VERIFY/TO-BUILD]** geen timeout-job die orders detecteert die te lang in één
  status hangen (purchased zonder bought, shipped_international zonder delivered).
  HOE: dagelijkse cron over `orders.status` + `updated_at`, admin-flag/alert.

### 7.3 Supplement (PO=4) & parcel-cancel (pkg=5) niet afgehandeld
- **[TO-VERIFY/TO-BUILD]** zie 5.2 / 5.4 — beide alleen gelogd, geen geld-/status-actie.

### 7.4 Refund-bestemming wettelijk fout
- **[CONFIRMED-risico]** `refund_order`/`cancel_paid_order` refunden naar saldo;
  EU-recht eist originele methode (Stripe). HOE: Stripe-refund-pad bouwen, saldo
  alleen als klant dat expliciet kiest.

### 7.5 PO=8 verwacht header.partnerOrderNo
- **[TO-VERIFY]** de cancel-tak gebruikt `partnerOrderNo` uit header óf
  `body.shopOrderInfo.partnerOrderNo`; bij PO=8 zonder die velden gebeurt er niets
  (geen refund). HOE: bevestigen dat PO-notifies altijd `partnerOrderNo` dragen
  (doc zegt Required in shopOrderInfo). [CONFIRMED Required — doc 133526]

---

## 8. KLANTCOMMUNICATIE-MATRIX

### 8.1 Web Push (per statuswijziging) [CONFIRMED — `notify-order/index.ts:17-25`]
| Status | Titel | Body |
|---|---|---|
| purchased | 🛒 Order placed | We're buying your item for you right now. |
| bought | ✅ Item bought! | Your item is paid for and heading to our warehouse. |
| shipped_local | 🚚 On its way to our warehouse | Your item is in transit in China. |
| qc_pending | 📸 QC photos are ready! | View your item and add it to a parcel in the app. |
| shipped_international | ✈️ Shipped to you | Your parcel is on its way to you! |
| delivered | 🎉 Delivered! | Your order has arrived. Enjoy! |
| cancelled | ↩️ Order refunded | An item was unavailable, so we've refunded it to your balance. |

- Levering: VAPID Web Push naar alle `push_subscriptions` van de user; 404/410 →
  subscription opruimen. [CONFIRMED — `index.ts:42-64`]
- **Geen push voor:** quote_accepted, requested/quote_sent, problem_type-melding,
  dispute_status, supplement (PO=4). [CONFIRMED — geen entry in `MESSAGES`]

### 8.2 In-app fox-messages (statusverhaal) [CONFIRMED — `supplyflow-app.jsx:53-63`]
- Per status een vriendelijke `foxMessages`-tekst + icoon, getoond in de
  order-detail/journey-UI; `trackingSteps`-bolletjes tonen de 6 fasen.

### 8.3 E-mail [TO-VERIFY]
- `notify-order` stuurt **geen** e-mail. Resend is genoemd voor withdrawal/returns
  maar niet gekoppeld aan statuswijzigingen. HOE: Resend-template per status als
  fallback/aanvulling op push.

---

## 9. SAMENVATTENDE TRANSITIE-TABEL

| Van | Naar | Trigger (BuckyDrop / app) | Toegestaan? |
|---|---|---|---|
| quote_accepted | purchased | place-bucky-order succes | ✅ [CONFIRMED] |
| quote_accepted | cancelled | cancel_paid_order (problem_type) / BD-weigering | ✅ [CONFIRMED] |
| purchased | bought | PO orderStatus 5 | ✅ forward |
| bought | shipped_local | PO 6 | ✅ forward |
| shipped_local | qc_pending | PO 9 | ✅ forward |
| qc_pending | shipped_international | PO 11 / parcel pkgNormal 2,3 | ✅ forward |
| shipped_international | delivered | PO 12 / parcel pkgNormal 4 | ✅ forward |
| elke (≠ cancelled) | cancelled | PO 8 → refund_order | ✅ [CONFIRMED] |
| hoger | lager | out-of-order webhook | ❌ "no forward" |
| cancelled | elke | late webhook | ❌ "cancelled" |
| elke | (geen shift) | PO 1/2/3/4/7/10, pkg 1/5 | — alleen log |
| qc_pending/elke | dispute pending | Notify Po Pending (defect) | ⊥ geen status-shift, flag |

[CONFIRMED tenzij anders gemarkeerd — `buckydrop-webhook/index.ts`]
