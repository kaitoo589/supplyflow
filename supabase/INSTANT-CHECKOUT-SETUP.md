# Flowva — instant checkout aanzetten

De offerte-stap is eruit: klanten betalen nu **direct** de bekende prijs + één
service fee (8%, min €5), en de bestelling gaat meteen naar BuckyDrop (via F3).

## 1) Betaal-RPC (VERPLICHT — anders werkt de koop-knop niet)
Supabase → **SQL Editor** → plak `supabase/pay-cart.sql` → **Run**.

## 2) F3 (automatisch bestellen bij BuckyDrop)
Als je dit nog niet deed:
1. `supabase/buckydrop-orders.sql` draaien (kolommen `shop_order_no`, `bd_error`).
2. `npx supabase functions deploy place-bucky-order`
3. `supabase/place-bucky-order-trigger.sql` draaien (met je echte WEBHOOK_SECRET).
   - **Belangrijk:** deze is bijgewerkt — hij vuurt nu óók op INSERT (nodig voor
     instant checkout). Draai 'm opnieuw als je een oudere versie had.

> Zonder stap 2 werkt kopen wél (klant wordt afgeschreven, order verschijnt),
> maar wordt de bestelling nog niet automatisch bij BuckyDrop geplaatst.

## 3) Auto-refund (veiligheidsvangnet)
Als BuckyDrop een bestelling weigert (bijv. uitverkocht) → klant wordt automatisch
terugbetaald, order op 'cancelled', en hij krijgt een melding.
1. `supabase/auto-refund.sql` draaien (functie `refund_order`).
2. `npx supabase functions deploy place-bucky-order` (opnieuw — roept nu refund_order aan).
3. `npx supabase functions deploy notify-order` (opnieuw — meldingen zijn nu Engels + "Order refunded").

## Testen
1. Zorg dat je saldo hebt (top-up in Profiel).
2. Voeg een BuckyDrop-product toe in de admin → zet 'm in een zichtbare categorie.
3. Koop het in de app via **"Buy now"** of leg meerdere in je mandje en **"Buy everything at once"**.
4. Saldo gaat eraf, order verschijnt in Orders (status `purchased` als F3 aanstaat,
   `shop_order_no` gevuld). Bij onvoldoende saldo krijg je een nette melding.
