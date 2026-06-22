# 02 — Checkout & klant-acties (order-flow)

Deze sectie dekt UITPUTTEND elke klant-actie van feed → productpagina → winkelmand → betaling, plus de groep-checkout (Flowva Friends). Per scenario: trigger, stap-voor-stap flow, wie-betaalt-wat, wat-als-het-faalt (volgende edge-laag), en de system action (API-call / app-status / RPC). Elke bewering is getagd `[CONFIRMED]` (gezien in code/SQL), `[ASSUMED]` (redelijke aanname) of `[TO-VERIFY]` (moet gecheckt, met HOE).

**Geld-DNA dat overal terugkomt (lees dit eerst):**
- Saldo-model: de klant koopt NIET direct met kaart af. Hij laadt een **in-app saldo** op (`profiles.balance`, EUR) via Stripe iDEAL, en `pay_cart` schrijft van dat saldo af. `[CONFIRMED]` — `pay-cart.sql`, `create-checkout/index.ts`, `supplyflow-app.jsx`.
- Prijs komt **ALTIJD server-side** uit `public.products` (match op `source_url`), NOOIT uit de client-JSON. Dit is de fix voor het pay_cart-prijslek (audit #1). `[CONFIRMED]` — `pay-cart.sql` r.61-74,97-99.
- Service fee = `max(8% × items_totaal, €5)`, **één keer over de hele mand** (`service_fee_for`). `[CONFIRMED]` — `pay-cart.sql` r.27-30,80,125-127.
- Internationale verzending wordt **NIET** bij checkout betaald — later per parcel op gewicht. `[CONFIRMED]` — checkout-UI r.679-681; QC-pakket (¥6/order) en BTW/DDP zitten óók niet in `pay_cart`. `[TO-VERIFY]` — waar QC-kosten & DDP-BTW in de geldstroom landen (zie open vragen).

---

## 1. Feed bekijken → product openen
**Trigger:** klant tikt op een feed-kaart.
**Flow:** `products`-lijst is geladen via `supabase.from("products").select("*")` en client-side gefilterd op `!p.hidden`; tik opent `OrderRequest` als morphing bottom-sheet (layoutId-animatie). `[CONFIRMED]` — `supplyflow-app.jsx` r.1204-1212; `OrderRequest.jsx`.
**Wie betaalt wat:** niets.
**Wat als het faalt:** `products`-fetch faalt → `productsError` gezet, feed toont foutstaat. `[CONFIRMED]` r.1207-1208. Een product dat ná het laden `hidden=true` wordt (price-guard flag) blijft in deze sessie zichtbaar tot refresh → checkout vangt het alsnog. `[ASSUMED]`.
**System action:** read-only select; geen status-mutatie.
**Tag:** `[CONFIRMED]`.

## 2. Opties / varianten kiezen op de productpagina
**Trigger:** klant kiest maat/kleur (`product.sizes`), aantal (± knop), leest beschrijving/materiaal/size-guide.
**Flow:** `selectedVariants` per variant-naam; `variantImage` wisselt mee met de gekozen optie; `aantal` ≥ 1 (min geklemd op 1). `buildItem()` valideert dat ELKE variant gekozen is; ontbreekt er één → `missingVariants` gezet, shake-animatie + "Choose an option", geen item gebouwd. `[CONFIRMED]` — `OrderRequest.jsx` r.33-52, 312-335.
**Wie betaalt wat:** niets.
**Wat als het faalt:** product zonder `sizes` → `productVariants=null`, validatie overgeslagen. `[CONFIRMED]` r.21,34. Aantal kan onbeperkt omhoog (geen max / geen voorraadcheck client-side) → voorraad/MOQ pas bij BuckyDrop (F3). `[ASSUMED]`; `[TO-VERIFY]` of er een client-max moet komen.
**System action:** lokale React-state; geen call.
**Tag:** `[CONFIRMED]`.

## 3. "Add to cart" (item aan winkelmand toevoegen)
**Trigger:** klant tikt "+ Add to cart".
**Flow:** `handleAddToList()` → `buildItem()` → `onAddToList(item)` → `setRequestList([...list, item])`, sheet sluit. Mand is **client-side**, gepersisteerd in `localStorage("supplyflow_request_list")`. `[CONFIRMED]` r.85-89, 1045-1050, 1879.
**Wie betaalt wat:** niets (mand = intentie, niet betaald).
**Wat als het faalt:** localStorage geblokkeerd/vol → init valt terug op `[]` (try/catch). `[CONFIRMED]` r.1046-1049. Hetzelfde product 2× toegevoegd → 2 losse cart-regels (geen merge/dedup) → klant ziet dubbel, kan er één verwijderen. `[CONFIRMED]` (geen dedup-logica in `onAddToList`). De **client-prijs** in het cart-item is cosmetisch; pay_cart negeert 'm en herrekent server-side. `[CONFIRMED]`.
**System action:** lokale state + localStorage-schrijf.
**Tag:** `[CONFIRMED]`.

## 4. Winkelmand aanpassen (qty ±, verwijderen, leeg)
**Trigger:** in de cart-sheet: `−`/`+` per regel of "Remove".
**Flow:** `onSetQty(i,q)` klemt op `max(1,q)`; `−` bij qty=1 verwijdert de regel (`onRemove`). Totaal/fee/per-item herrekenen live; "per item"-bedrag kleurt groen <€2, oranje <€4. `[CONFIRMED]` r.576-580, 1953-1954, 499-503.
**Wie betaalt wat:** niets.
**Wat als het faalt:** mand leeg → "Go to checkout" disabled (`items.length===0`). `[CONFIRMED]` r.613-614. Negatieve/0-qty onmogelijk door de klem. `[CONFIRMED]`.
**System action:** lokale state.
**Tag:** `[CONFIRMED]`.

## 5. Bundelen (fee-optimalisatie) — happy nudge
**Trigger:** klant heeft 1 item, ziet "voeg meer toe = goedkoper per item".
**Flow:** fee is vast 8% (min €5), gedeeld over alle items → per-item-fee daalt naarmate de mand groeit; vanaf €62,50 items-totaal is het een platte 8% (geen min meer). UI duwt hierop ("From €62.50 it's just a flat 8%"). `[CONFIRMED]` r.553, 358-365 (OrderRequest), `service_fee_for`.
**Wie betaalt wat:** klant betaalt uiteindelijk één fee i.p.v. één-per-losse-order.
**Wat als het faalt:** klant koopt items toch los → elke order draagt z'n eigen `max(8%,€5)`; dat is correct, geen bug, alleen duurder. `[CONFIRMED]`.
**System action:** geen.
**Tag:** `[CONFIRMED]`.

## 6. "Go to checkout" → adres tonen
**Trigger:** klant tikt "Go to checkout →".
**Flow:** sheet wisselt naar `view="checkout"`; toont "SHIPPING TO" uit `session.user.user_metadata` (`voornaam/achternaam/adres/postcode/stad/land/telefoon`). `hasAddress = !!(adres && stad)`. `[CONFIRMED]` r.504-507, 633-648.
**Wie betaalt wat:** nog niets.
**Wat als het faalt:** geen adres → gele waarschuwing + "Confirm & pay"-knop disabled, label "Add an address to continue"; "Edit" opent het adresformulier (`onEditAddress`). `[CONFIRMED]` r.638-647, 690-693. Onvolledig adres (wél `adres`+`stad` maar geen `postcode`/`land`/`telefoon`) → telt tóch als `hasAddress`, checkout gaat door, maar BuckyDrop-orderplaatsing (F3) kan later struikelen op ontbrekend land/postcode. `[CONFIRMED]` dat `hasAddress` alleen adres+stad eist; `[TO-VERIFY]` welke adresvelden `place-bucky-order` verplicht stelt (lees `place-bucky-order/index.ts` + create-shop-order-doc PNG's).
**System action:** geen call; alleen view-switch.
**Tag:** `[CONFIRMED]`.

## 7. Adres invoeren / corrigeren
**Trigger:** klant tikt "Edit" bij shipping, of heeft nog geen adres.
**Flow:** opent adresformulier, schrijft naar `user_metadata` (Supabase Auth update). `[ASSUMED]` op basis van `onEditAddress` + metadata-lezing; exact formulier niet in dit bestand gelezen.
**Wie betaalt wat:** niets.
**Wat als het faalt:** ongeldige/onvolledige invoer → `hasAddress` blijft false zolang `adres`/`stad` leeg is. Land-formaat (NL vs ISO) en postcode-validatie: `[TO-VERIFY]` — is er client-validatie + matcht het BuckyDrop's adresvereisten? (lees adresformulier-component + create-shop-order PNG's).
**System action:** `supabase.auth.updateUser({ data: {...} })` `[ASSUMED]`.
**Tag:** `[ASSUMED]`.

## 8. Live prijscheck vóór afschrijven (price-guard)
**Trigger:** klant tikt "Confirm & pay" (cart óf vanuit OrderRequest direct-koop).
**Flow:** vóór `pay_cart` roept de client `supabase.functions.invoke("check-cart-prices", { items:[{source_url,kleur}] })` aan. De functie haalt per item de **live BuckyDrop ¥-prijs** op (`product/detail`, MD5-signed) en vergelijkt met de opgeslagen `priceYuan` van de gekozen SKU. `[CONFIRMED]` — `supplyflow-app.jsx` r.1176-1187; `check-cart-prices/index.ts`.
**Wie betaalt wat:** nog niets — dit is een poort vóór de afschrijving.
**Wat als het faalt (edge-lagen):**
- **Prijs >5% gestegen** → product wordt server-side gevlagd (`price_alert=true, hidden=true, alert_reason`), `anyChanged=true` → checkout blokkeert, item komt "on hold" (doorgestreept), klant moet 'm verwijderen; **niet afgeschreven**. `[CONFIRMED]` r.126-138 (functie), r.1180-1186 (client), checkout-UI r.685-693.
- **Variant niet matchbaar / `priceYuan` ontbreekt / SKU niet te kiezen** → fail-open per item (`changed=false`), pay_cart beslist. `[CONFIRMED]` r.109-111.
- **BuckyDrop onbereikbaar / `success=false` / geen data** → fail-open per item; en als de hele invoke gooit → client-`catch` laat door ("fail-open; pay_cart + post-pay refund vangen het af"). `[CONFIRMED]` r.114-119, 1187.
- **Al gevlagd door een andere klant/admin** → meteen `changed=true`, geen BuckyDrop-call nodig. `[CONFIRMED]` r.104. Bovendien leest de cart bij openen proactief de `price_alert`-vlag en zet items vooraf "on hold". `[CONFIRMED]` r.1142-1152.
- **Uitverkocht bij leverancier** (`liveYuan==null`) → `available=false`, reden "Currently unavailable", gevlagd. `[CONFIRMED]` r.122-125.
**System action:** edge function `check-cart-prices` (READ-ONLY op orders; muteert alleen `products`-vlag) → bij changed: `update products set price_alert/hidden`.
**Tag:** `[CONFIRMED]`.

## 9. Betaling slaagt — happy path (instant checkout via saldo)
**Trigger:** prijscheck OK, klant tikt "Confirm & pay €X →".
**Flow:** `supabase.rpc("pay_cart", { p_items: requestList })`. Server-side, atomair in één transactie:
1. auth-check (`auth.uid()` niet null), mand niet leeg.
2. items-totaal server-side sommeren uit `products` (qty ≥1), onbekende producten tellen.
3. `v_fee = service_fee_for(total)`, `v_charge = total + fee`.
4. `select balance ... for update` (rij-lock) + check `balance ≥ charge`.
5. `update profiles set balance = balance - charge`.
6. groeps-id `SF-G-<ms>`; per item een `orders`-rij met `status='quote_accepted'` + een `transactions(-line,'order')`; tot slot één `transactions(-fee,'service_fee')`.
7. retour `{ok:true, fee, total, charged, group}`.
`[CONFIRMED]` — `pay-cart.sql` r.53-129.
Bij succes: `fetchOrders()`, `fetchBalance()`, sheet morpht naar "Order placed!" met de 4-stappen-tijdlijn (incl. "Taking quality-control photos"). `[CONFIRMED]` r.1199-1201, 700-728.
**Wie betaalt wat:** klant betaalt `items + één service fee` uit saldo. Verzending internationaal en (vermoedelijk) QC/DDP later. `[CONFIRMED]` voor items+fee; rest `[TO-VERIFY]`.
**Wat als het faalt:** zie scenario's 10-14 hieronder. Na succes vuurt de DB-trigger F3 (zie 15).
**System action:** RPC `pay_cart` → INSERT `orders(status=quote_accepted)` → trigger `place_bucky_order_ins_trg`.
**Tag:** `[CONFIRMED]`.

## 10. Onvoldoende saldo
**Trigger:** `balance < charge` op het moment van `pay_cart`.
**Flow:** RPC retourneert `{ok:false, error:'Insufficient balance', needed:charge}` (saldo wordt NIET afgeschreven; de `for update`-lock voorkomt race). `[CONFIRMED]` r.84-87. Client toont "Insufficient balance — top up to complete your order." + rode "Top up your balance →"-knop. `[CONFIRMED]` r.508, 522-530, 1192-1196.
**Wie betaalt wat:** niets afgeschreven.
**Wat als het faalt:** klant tikt top-up → scenario 17. Saldo verandert intussen via realtime-channel; de check is altijd server-side bij de daadwerkelijke RPC, dus een verouderd client-saldo kan nooit te veel afschrijven. `[CONFIRMED]` r.1217-1222, 84-87.
**System action:** geen mutatie; foutpad.
**Tag:** `[CONFIRMED]`.

## 11. Dubbel-klik / dubbele submit op "Confirm & pay"
**Trigger:** klant tikt 2× snel, of tikt opnieuw na trage respons.
**Flow:** client-guard: `if (!requestList.length || sendingList) return false` + `setSendingList(true)` en de knop is `disabled={sending}`. `[CONFIRMED]` r.1170-1172, 690-691. Voor de OrderRequest-directkoop: `loading`-state idem. `[CONFIRMED]` r.54-57.
**Wie betaalt wat:** in de praktijk één keer.
**Wat als het faalt (edge-laag):** als de eerste request al verstuurd is en de tweede tóch het netwerk in glipt (twee tabs / dubbele invoke vóór state-update), is `pay_cart` **NIET idempotent** — er is geen client-id/dedup-sleutel → de tweede call zou een tweede mand kunnen afrekenen (mits saldo). De `for update` serialiseert ze maar voorkomt geen dubbele logische order. `[CONFIRMED]` (geen idempotency-key in `pay_cart`). **Risico/aanbeveling:** `[TO-VERIFY]` — voeg een client-side request-id of korte dedup toe (vgl. `apply_top_up` dat wél idempotent is op `event_id`).
**System action:** RPC `pay_cart` (×1 verwacht); guard via `sendingList`/`disabled`.
**Tag:** `[CONFIRMED]` flow, `[TO-VERIFY]` dubbele-call-hardening.

## 12. RPC-fout / netwerk-timeout tijdens betaling
**Trigger:** `supabase.rpc("pay_cart")` gooit (`error`) of time-out.
**Flow:** `if (error) { setListError(error.message); return false }` → sheet blijft op checkout, geen "placed"-view. `[CONFIRMED]` r.1190, 511-514.
**Wie betaalt wat:** ambigu bij timeout — de transactie kán server-side commit zijn terwijl de client een timeout zag.
**Wat als het faalt (edge-laag):** klant ziet fout, tikt opnieuw → zie 11 (geen idempotentie) → mogelijk dubbele afschrijving als de eerste tóch slaagde. `[CONFIRMED]` risico. Vangnet: orders verschijnen via `fetchOrders`; een dubbele order is zichtbaar en handmatig te refunden (`refund_order`). `[CONFIRMED]` (refund bestaat), maar niet automatisch voor dit geval. `[TO-VERIFY]`.
**System action:** foutpad; geen view-switch.
**Tag:** `[CONFIRMED]` flow, `[TO-VERIFY]` timeout-dubbel.

## 13. Item "no longer available" bij afschrijven (server-side)
**Trigger:** een mand-item heeft geen `source_url` of geen match in `products` met `price is not null`.
**Flow:** `pay_cart` telt `v_unknown`; >0 → `{ok:false, error:'One or more products are no longer available'}`, **niets afgeschreven** (check vóór de update). `[CONFIRMED]` r.64-78. Client toont de generieke `data.error`. `[CONFIRMED]` r.1191-1196.
**Wie betaalt wat:** niets.
**Wat als het faalt:** klant weet niet wélk item — de melding is mand-breed (geen per-item-markering vanuit pay_cart; alleen de price-guard markeert per item). `[CONFIRMED]`. `[TO-VERIFY]` — wenselijk om pay_cart het/de schuldige `source_url`(s) te laten teruggeven.
**System action:** RPC foutpad.
**Tag:** `[CONFIRMED]`.

## 14. Race: prijs verandert tussen price-check en afschrijven
**Trigger:** product wordt gevlagd/duurder ná `check-cart-prices` maar vóór/tijdens `pay_cart`.
**Flow:** `pay_cart` herleest de prijs server-side op afschrijfmoment, dus de klant betaalt de op-dat-moment-geldige `products.price` (nooit een stale client-prijs). `[CONFIRMED]` r.97-99. De ¥→€ kant (BuckyDrop kan duurder zijn dan de in EUR opgeslagen `products.price`) wordt hier NIET herrekend → verschil komt later als BuckyDrop-supplement (PO orderStatus 4) of via post-pay refund. `[CONFIRMED]` dat pay_cart alleen `products.price` (EUR) gebruikt; `[ASSUMED]` voor de supplement-route (F3/F4-domein).
**Wie betaalt wat:** klant betaalt de EUR-`products.price`; ¥-afwijkingen verschuiven naar verzend/supplement-reconcile.
**Wat als het faalt:** als `products.price` net is bijgewerkt naar een hoger bedrag, betaalt de klant meer dan getoond op de checkout-kaart → cosmetische mismatch. `[ASSUMED]`. `[TO-VERIFY]` of de getoonde `charge` en de afgeschreven `charge` ooit kunnen afwijken (client toont client-prijs, server rekent server-prijs).
**System action:** RPC `pay_cart` met server-side herprijzing.
**Tag:** `[CONFIRMED]` mechanisme.

## 15. Na betaling: automatische BuckyDrop-plaatsing (overgang naar F3)
**Trigger:** elke nieuwe `orders`-rij met `status='quote_accepted'` (instant checkout) — óók de oude betaal-offerte-flow.
**Flow:** DB-trigger `place_bucky_order_ins_trg` (INSERT) / `place_bucky_order_trg` (UPDATE) doet `net.http_post` naar de edge function `place-bucky-order` (met `x-webhook-secret`). `[CONFIRMED]` — `place-bucky-order-trigger.sql`.
**Wie betaalt wat:** geld is al van het saldo; BuckyDrop-wallet (CNY, prepaid) wordt door Flowva belast — buiten de klant-flow.
**Wat als het faalt:** `pg_net` uit / webhook-secret nog placeholder (`PLAK_HIER_...`) → plaatsing vuurt niet of faalt; order blijft `quote_accepted` zonder BuckyDrop-PO. `[CONFIRMED]` placeholder in SQL r.18 → `[TO-VERIFY]` of de live trigger het echte secret heeft. BuckyDrop weigert (uitverkocht) → `place-bucky-order` roept `refund_order` aan: productprijs terug naar saldo + `transactions('refund')`, order op `cancelled`; bij hele-groep-annulering ook de fee één keer terug. `[CONFIRMED]` — `auto-refund.sql` r.13-40+.
**System action:** trigger → edge `place-bucky-order` → (faal) RPC `refund_order`.
**Tag:** `[CONFIRMED]` (grens naar F3-domein).

## 16. Mand verlaten / app sluiten zonder afrekenen
**Trigger:** klant sluit de sheet / app met items in de mand.
**Flow:** mand blijft bestaan in `localStorage("supplyflow_request_list")`; bij terugkomst toont het zwevende "Shopping cart · N items"-balkje. `[CONFIRMED]` r.1045-1050, 1928-1936.
**Wie betaalt wat:** niets.
**Wat als het faalt:** prijs/voorraad kan intussen gewijzigd zijn → bij heropenen leest de cart de `price_alert`-vlag en zet items "on hold"; en de checkout doet sowieso een verse `check-cart-prices`. `[CONFIRMED]` r.1142-1152, 1176-1187. Andere browser/device → mand niet gesynct (localStorage is per device). `[CONFIRMED]` (geen server-side cart).
**System action:** geen; persistente localStorage-mand.
**Tag:** `[CONFIRMED]`.

## 17. Saldo opladen (top-up) via Stripe iDEAL
**Trigger:** klant tikt "Top up" / kiest of typt een bedrag.
**Flow:** client-min €5 (`parseFloat < 5` → alert "Minimum top-up is €5"); `supabase.functions.invoke("create-checkout", { amount: cents, userId, email })` → Stripe Checkout-sessie (`payment_method_types:["ideal"]`, mode payment, EUR) → redirect naar Stripe; `success_url=/payment-success?session_id=...`, `cancel_url=/`. `[CONFIRMED]` — `supplyflow-app.jsx` r.1272-1276; `create-checkout/index.ts`.
**Wie betaalt wat:** klant laadt EUR-saldo (kaart/iDEAL-kosten draagt Flowva richting Stripe; niet doorbelast in deze flow). `[ASSUMED]`.
**Wat als het faalt:**
- bedrag < 500 cent → edge geeft 400 "Minimum storting is €5" (server-min, dubbele gordel). `[CONFIRMED]` create-checkout r.21-26.
- klant breekt af op Stripe → `cancel_url=/`, geen saldo, geen webhook. `[CONFIRMED]`.
- iDEAL-betaling faalt/pending → geen `checkout.session.completed` met `payment_status='paid'` → saldo ongewijzigd. `[CONFIRMED]` stripe-webhook r.46-53.
- alleen iDEAL beschikbaar → niet-NL-klanten (geen iDEAL) kunnen niet opladen. `[CONFIRMED]` (enkel `["ideal"]`). `[TO-VERIFY]` of kaart/SEPA moeten worden toegevoegd voor buitenlandse klanten.
**System action:** edge `create-checkout` → Stripe Checkout Session.
**Tag:** `[CONFIRMED]`.

## 18. Top-up bevestigd → saldo bijgeschreven (idempotent webhook)
**Trigger:** Stripe stuurt `checkout.session.completed`.
**Flow:** `stripe-webhook` verifieert de signature (`constructEventAsync`), eist `payment_status='paid'`, leest `userId`+`amount` uit metadata, roept `apply_top_up(event_id, session_id, user_id, euro)` aan (atomair + idempotent op `event_id`). `[CONFIRMED]` — `stripe-webhook/index.ts` r.24-90.
**Wie betaalt wat:** saldo +€bedrag; `transactions('top_up')`. `[ASSUMED]` op type-naam (UI heeft `top_up`-label r.848).
**Wat als het faalt:**
- ongeldige signature → 400 "Invalid signature", geen bijschrijving. `[CONFIRMED]` r.38-44.
- `payment_status≠paid` → 200 received, geen bijschrijving. `[CONFIRMED]` r.49-53.
- ontbrekende metadata → 400. `[CONFIRMED]` r.59-64.
- `apply_top_up` fout/`ok=false` → **500 teruggegeven zodat Stripe retryt** (storting verdwijnt niet stil). `[CONFIRMED]` r.77-83.
- **dubbel event** (Stripe retry) → `apply_top_up` no-op, `duplicate` gelogd, geen dubbele bijschrijving. `[CONFIRMED]` r.85-89.
- realtime: saldo-channel pusht de nieuwe `balance` naar de open app → knop "Insufficient" wordt vanzelf "betaalbaar". `[CONFIRMED]` r.1217-1222.
**System action:** edge `stripe-webhook` → RPC `apply_top_up`.
**Tag:** `[CONFIRMED]`.

## 19. Group-checkout (Flowva Friends) — instap & confirm
**Trigger:** klant shopt "voor een groep" (actieve groep), voegt items toe en tikt later "Confirm & pay" in de groep-cart.
**Flow:**
1. **Item toevoegen aan groep:** in OrderRequest tikt de klant "+ Add to <groep>" → `ffAddItem(group.id, item)` → RPC `ff_add_item` (group-rij `for update`, lidmaatschap/`gathering`-check; item in `flowva_group_items`; zet de eigen `ready=false`). `[CONFIRMED]` — `OrderRequest.jsx` r.92-107; `flowva-friends-money.sql` r.254-272.
2. **Delen zonder kopen:** "↗ Share to group" → `ffShareProduct` (groepschat). `[CONFIRMED]` r.110-122.
3. **Confirm & pay (READY):** `ff_set_ready(group_id)` — group-rij gelockt (serialiseert all-ready-check); prijs **server-side** uit `products`, vergrendeld op het item (`locked_price`); fee = `ff_member_fee(groeps­grootte, totaal)` (lager %/min naarmate de groep groeit; solo = 8%/€5); `charge` van saldo afgetrokken en **vastgehouden** (`held_amount`, tx `group_hold`). Zodra IEDEREEN ready → groep atomair op `placed`. `[CONFIRMED]` — `flowva-friends-money.sql` r.90-176.
**Wie betaalt wat:** elk lid betaalt zijn eigen items + zijn eigen (lagere) groeps-fee uit saldo; bedrag staat "vastgehouden" tot plaatsing.
**Wat als het faalt (edge-lagen):**
- **al ready** → idempotent, geen tweede afschrijving (`{ok:true, already:true}`). `[CONFIRMED]` r.116-119.
- **geen items** → "Add at least one item before you confirm". `[CONFIRMED]` r.121-123.
- **product weg / `price_alert`** → ready geweigerd, half-vergrendelde `locked_price` teruggedraaid. `[CONFIRMED]` r.127-143.
- **onvoldoende saldo** → `{ok:false,'Insufficient balance',needed}` vóór afschrijven. `[CONFIRMED]` r.150-153.
- **un-ready / lid voegt item toe / verlaat / wordt gekickt** → trigger A/B storten het vastgehouden bedrag terug (`group_hold_refund`), alleen tijdens `gathering` (nooit dubbel na `placed`). `[CONFIRMED]` r.45-87, 178-192.
- **groep al gesloten/cancelled** → "This group is already closed"; lid weg via OrderRequest-regex (`not a member|not found|closed|full`) → `onActiveGroupGone` stopt het "voor-deze-groep-shoppen". `[CONFIRMED]` r.102, 112, 188.
- **echte inkoop/BuckyDrop-consolidatie** zit NIET in fase 3 (puur het geld) → Fase 5. `[CONFIRMED]` r.14-16. `[TO-VERIFY]` (failure-flowchart nog te bouwen — zie memory Flowva Friends).
**System action:** RPC's `ff_add_item` / `ff_set_ready` / `ff_unready` / `ff_leave_group` / `ff_kick_member` (+ triggers `ff_unready_refund_trg`, `ff_leave_refund_trg`).
**Tag:** `[CONFIRMED]`.

## 20. Valuta / bedrag-weergave
**Trigger:** klant ziet prijzen/totalen.
**Flow:** klant-app rekent en betaalt volledig in **EUR**; `products.price` is EUR; ¥-prijzen tonen alleen ter context in de oude offerte-kaart (`≈ €` via ×0,13). `[CONFIRMED]` — pay-cart EUR, QuoteAcceptance r.436-437.
**Wie betaalt wat:** EUR uit saldo.
**Wat als het faalt:** ¥→€-koers (×0,13 hardcoded) is alleen cosmetisch en kan afwijken van de werkelijke wallet-koers → mag nooit de afschrijving raken (die is puur EUR). `[CONFIRMED]` (koers niet in pay_cart). `[TO-VERIFY]` of ergens een ¥-bedrag in de klant-checkout sluipt.
**System action:** geen.
**Tag:** `[CONFIRMED]`.

## 21. Fraude / misbruik-pogingen
**Trigger:** klant probeert het systeem te manipuleren.
**Flow & verdediging:**
- **prijs verlagen via client-JSON** (`price:0.01`) → genegeerd; pay_cart herprijst server-side uit `products`. `[CONFIRMED]` r.61-99.
- **niet ingelogd** → `auth.uid() null` → `{ok:false,'Not logged in'}`; `pay_cart` alleen `to authenticated`. `[CONFIRMED]` r.54-55, 133.
- **negatieve qty** → `greatest(coalesce(qty,1),1)` klemt op ≥1. `[CONFIRMED]` r.66, 96.
- **saldo-race / dubbel afschrijven van saldo** → `for update`-lock op de profile-rij. `[CONFIRMED]` r.84.
- **andermans order/cart aanraken** → orders/transacties op `user_id=auth.uid()`; RLS-afhankelijk. `[ASSUMED]`; `[TO-VERIFY]` exact RLS-beleid op `orders`/`transactions`/`profiles` (lees `security-hardening.sql`).
- **anonieme BuckyDrop-probe via price-check** → `check-cart-prices` eist ingelogde user (401) en geeft nooit rauwe ¥/skuCode terug. `[CONFIRMED]` r.146-151, 7-8.
- **chargeback / top-up storneren ná besteden** → saldo kan dan negatief/oninbaar worden; geen automatische clawback zichtbaar. `[TO-VERIFY]` — beleid bij iDEAL-chargeback/storno.
**Wie betaalt wat:** n.v.t. (poging geblokkeerd).
**Wat als het faalt:** zie de openstaande `[TO-VERIFY]`-punten (RLS, chargeback).
**System action:** server-side guards in `pay_cart` / edge functions.
**Tag:** `[CONFIRMED]` voor de gedekte vectoren.

## 22. Verplicht QC-pakket, BTW/DDP & 3DS bij checkout — STATUS
**Trigger:** kernmodel schrijft ¥6 QC per order + tax-inclusive DDP-lijnen voor; 3DS hoort bij kaartbetaling.
**Flow/observatie:**
- **QC-pakket (¥6/order):** `pay_cart` rekent alléén items + service fee; QC-kosten staan **niet** in de klant-afschrijving. De "Order placed"-tijdlijn belóóft wél QC-foto's. `[CONFIRMED]` (afwezig in pay-cart.sql) → `[TO-VERIFY]` waar de ¥6 QC-kosten landen (margemodel? service fee? aparte regel?).
- **BTW/DDP:** geen aparte BTW-regel of DDP-tax-inclusive-berekening in `pay_cart`/checkout-UI. `[CONFIRMED]` afwezig → `[TO-VERIFY]` of `products.price` BTW-inclusief is en waar 21% DDP wordt verrekend (memory: tax-inclusive lijnen, geen losse BTW).
- **3DS / SCA:** de klant betaalt nooit per kaart áf bij checkout (saldo-model). 3DS speelt alleen bij **top-up** via Stripe — daar handelt Stripe Checkout de SCA/3DS/iDEAL-redirect zelf af. `[CONFIRMED]` (geen kaart in pay_cart; Stripe Checkout in create-checkout).
- **declined / 3DS-fail bij top-up** → geen `paid`-event → saldo ongewijzigd → checkout blijft "Insufficient" tot een geslaagde top-up. `[CONFIRMED]` (afgeleid uit stripe-webhook).
**Wie betaalt wat:** items + fee nu; QC/DDP/verzending elders/later (`[TO-VERIFY]`).
**Wat als het faalt:** als QC/DDP nergens worden doorbelast, eet de marge ze op → kernmodel-risico. `[TO-VERIFY]`.
**System action:** n.v.t. (gap-analyse).
**Tag:** `[TO-VERIFY]`.
