# Flowva × BuckyDrop — F3: automatisch bestellen

Zodra een klant in de app betaalt (order → `quote_accepted`), plaatst Flowva
automatisch de bestelling bij BuckyDrop en slaat het `shopOrderNo` op.

> Geen nieuwe secrets nodig — F3 hergebruikt `BUCKY_APP_CODE`, `BUCKY_APP_SECRET`,
> `BUCKY_DOMAIN` en `WEBHOOK_SECRET` die je al hebt gezet.

## 1) Database-kolommen
Supabase → **SQL Editor** → plak `supabase/buckydrop-orders.sql` → **Run**.
(Voegt `shop_order_no` en `bd_error` toe aan orders.)

## 2) Function deployen
PowerShell in `C:\Users\Kaito\supplyflow`:
```powershell
npx supabase functions deploy place-bucky-order
```

## 3) Trigger aanzetten
1. Zorg dat extensie **`pg_net`** aanstaat (Supabase → Database → Extensions) — die heb je al voor de meldingen.
2. **SQL Editor** → open `supabase/place-bucky-order-trigger.sql`, vervang
   `PLAK_HIER_JE_WEBHOOK_SECRET` door je echte WEBHOOK_SECRET → **Run**.

## Testen (op de sandbox, dev.buckydrop.com)
1. Voeg in de admin een **BuckyDrop-product** toe (link plakken → ophalen → opslaan), in een categorie die in de feed zichtbaar is.
2. Bestel dat product als klant in de app → er ontstaat een order met status `requested`.
3. Stuur als **agent** een offerte (AgentPanel) → status `quote_sent`.
4. Betaal als klant de offerte → status `quote_accepted` → **F3 plaatst automatisch de BuckyDrop-bestelling**.
5. Controleer in Supabase de order: `shop_order_no` is gevuld en status = `purchased`. (Bij een fout staat de reden in `bd_error` en blijft de status `quote_accepted`.)

> Op de sandbox kost dit geen echt geld — het is een testbestelling. Pas bij de
> Formal-omgeving (productie) wordt er echt ingekocht.
