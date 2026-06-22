# Return bij de fabriek (na QC) — setup & uitleg

Wanneer na de verplichte QC blijkt dat een item **defect / verkeerde maat / niet als beschreven** is,
vraagt de klant (of host) een **return bij de fabriek** aan. Alleen dát item wordt afgehandeld —
de rest van de bestelling loopt door (elke order-regel is een eigen order + eigen BuckyDrop-shop-order).

## Wat er is gebouwd
- **`returns.sql`** — kolommen op `orders` (`return_flow_code`, `return_status`, `return_reason`,
  `return_requested_at`, + zekerstellen van `dispute_status`/`problem_type`/`qc_images`), de RPC
  **`request_item_return(p_order_id, p_reason)`** (klant/host, alleen in de QC-fase of bij een gemeld
  defect), en een **pg_net-trigger** die de edge function vuurt.
- **`functions/request-return/index.ts`** — haalt de **PO-`orderCode`** op via order-detail, bepaalt de
  juiste SKU, roept BuckyDrop **`apply-return`** aan (`/order/apply-return`), slaat de `returnFlowCode`
  op (`return_status = 'submitted'`) en **betaalt de klant terug** (`refund_order`). Mislukt de aanvraag,
  dan wordt de klant tóch terugbetaald (bevestigd defect) en de return als `failed` geflagd voor
  handmatige afhandeling.
- **`config.toml`** — `request-return` geregistreerd (`verify_jwt = false`, secret-beschermd).

## Stappen om het live te zetten
1. **SQL draaien:** Supabase → SQL Editor → plak `returns.sql` → **Run**.
   - In `returns.sql` staat `PLAK_HIER_JE_WEBHOOK_SECRET` — vervang dat door **dezelfde** waarde als de
     `WEBHOOK_SECRET`-secret van je edge functions (net als bij `place-bucky-order-trigger.sql`).
   - Vereist: extensie **pg_net** aan (Database → Extensions).
2. **Edge function deployen:** `npx supabase functions deploy request-return`
3. **Testen** (sandbox): zet een testorder op `qc_pending`, roep `request_item_return('<order-id>',
   'wrong size')` aan → controleer dat `return_flow_code` gevuld wordt, de order op `cancelled` komt en
   het saldo terug is. Bekijk de respons; pas de `applySource`-waarde aan als BuckyDrop die afkeurt.

## Hoe het wordt aangeroepen (UI — nog te bedraden)
De backend is klaar; de **knop** moet nog in de app:
- Op de **QC-poort** (order op `qc_pending`, of `dispute_status = 'pending'`): een knop
  **"Probleem melden / retour aanvragen"** die `supabase.rpc('request_item_return', { p_order_id, p_reason })`
  aanroept. `p_reason` = de reden (defect / verkeerde maat / niet als beschreven).
- Toon ook de `qc_images` (defect-foto's) zodat de klant kan beslissen.

## Belangrijke aandachtspunten ([TO-VERIFY] / bewust)
- **Refund-bestemming:** `refund_order` boekt naar **in-app saldo**, niet naar de originele
  Stripe-methode. Dat is de bekende launch-blocker (geldt ook hier) — wettelijk moet de refund naar de
  originele betaalmethode.
- **`applySource`:** op `1` gezet (zoals het doc-voorbeeld). De docs noemen alleen `3 = BuckyDrop`;
  bevestig in de sandbox of `1` (partner) wordt geaccepteerd, anders aanpassen.
- **Dit is de DEFECT-flow** (item-fout → klant direct terugbetaald, return = jouw recovery). De
  **no-reason-retour** (klant bedacht zich → wachten op de fabriek vóór refund) is een **aparte** flow,
  nog niet gebouwd.
- **Multi-PO:** `findPO` pakt de eerste PO; Flowva-orders zijn single-item (één PO), dus dat klopt. Bij
  toekomstige multi-item-PO's moet je per SKU de juiste PO matchen.
- **Status van de return opvolgen:** BuckyDrop heeft `/order/return/get` (met `returnFlowCode`) om te zien
  of de fabriek de retour accepteert — nog niet ingebouwd (poll-cron of webhook), voor later.
