# Flowva × BuckyDrop — live verzendtarieven (haul-shipping)

Echte BuckyDrop-tarieven bij de pakket-checkout: de klant ziet de echte kanalen
(prijs + levertijd), kiest er één, en betaalt **exact** dat bedrag — geen schatting,
geen buffer, geen na-refund. Server-side getekend; de client stuurt nooit een prijs mee.

## Hoe het zich gedraagt
- **Sandbox** (`BUCKY_DOMAIN=dev.buckydrop.com`): geeft nep "test channels" → de functie
  meldt `isSandbox:true` en de app **valt terug op de schatting** (geen nep-prijzen zichtbaar).
- **Productie** (`bdopenapi.buckydrop.com` + Formal-creds): echte kanalen → kanaalkiezer
  verschijnt en er wordt exact afgerekend.

Dus dit nu deployen is veilig: tot de cutover blijft de schatting zichtbaar.

## 1) SQL draaien
Supabase → **SQL Editor** → plak `supabase/pay-shipping-exact.sql` → **Run**.
(Maakt de RPC `pay_shipping_exact` (alleen service-role) + extra kolommen op `hauls`/`products`.)

## 2) Function deployen
```powershell
npx supabase functions deploy haul-shipping
```
(Hergebruikt `BUCKY_APP_CODE` / `BUCKY_APP_SECRET` / `BUCKY_DOMAIN`.)

## 3) Bij de PRODUCTIE-cutover (echte tarieven aanzetten)
```powershell
npx supabase secrets set BUCKY_DOMAIN=https://bdopenapi.buckydrop.com
npx supabase secrets set BUCKY_APP_CODE=<PRODUCTIE_APPCODE> BUCKY_APP_SECRET=<PRODUCTIE_APPSECRET>
```
+ Supabase' egress-IP whitelisten op BuckyDrop **Production → Address Configuration**.

## ⚠️ Te valideren bij de cutover (nu nog defaults met TODO)
1. **Currency** — `totalPrice` wordt nu als CNY behandeld en omgerekend via `BUCKY_CNY_PER_EUR`
   (default 7.7, +3% marge). Bevestig de echte currency met een productie-call; zet evt. de env.
2. **categoryCode** — verplicht veld; nu default `"1"`. Sla de echte Category-Level-III-code op
   bij curatie (F2 → `products.bd_category_code`) en kopieer 'm naar de order bij `pay_cart`.
3. **Afmetingen** — nu standaarddoos 20×20×10 cm. Sla per product dims op bij curatie voor
   correcte volumetrische tarieven (alleen relevant voor lichte, bulky items).
4. **Provincie** — nu val ik terug op de stad. Verzamel provincie bij signup voor exacte tarieven.

Tot dit gevalideerd is, gebruikt productie de echte kanalen maar met deze defaults — controleer
één echte order vóór je breed live gaat.
