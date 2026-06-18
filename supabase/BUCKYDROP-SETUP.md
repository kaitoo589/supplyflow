# Flowva × BuckyDrop — koppeling aanzetten (F1 + F2)

De code is gebouwd. Deze stappen zet jij eenmalig. Daarna kun je in de admin een
1688/Taobao-link plakken en haalt Flowva automatisch het product op.

> De APPsecret is geheim — die staat NIET in git en niet in dit bestand. Je krijgt
> de waarden apart in de chat.

## 1) Database: kolommen toevoegen
Supabase → **SQL Editor** → plak `supabase/buckydrop-products.sql` → **Run**.

## 2) Secrets zetten (test-omgeving)
PowerShell, in de map `C:\Users\Kaito\supplyflow`:
```powershell
npx supabase secrets set BUCKY_APP_CODE=<test-appcode> BUCKY_APP_SECRET=<test-appsecret> BUCKY_DOMAIN=https://dev.buckydrop.com
```
(De Test-waarden staan op BuckyDrop → Control → Access Info → **Test Access Info**.)

## 3) Function deployen
```powershell
npx supabase functions deploy buckydrop
```

## 4) Testen
1. Open de admin (OPS-HUD) → tab **PRODUCTS** → **+ nieuw product**.
2. Plak een 1688/Taobao-link in **bron-link** → klik **⤓ ophalen**.
3. Naam, ¥/€-prijs, foto's en varianten worden ingevuld. Stel je verkoopprijs (€) in → **opslaan**.

## ⚠️ Over het IP-adres (belangrijk)
De function draait op de servers van Supabase, dus de BuckyDrop-aanroep komt van
een **ander IP** dan je thuis-pc. BuckyDrop heeft een IP-whitelist (Address
Configuration). Twee mogelijke uitkomsten bij de eerste test:

- **Werkt meteen** → mooi, de test-omgeving is soepel met IP's.
- **"insufficient permissions" / geblokkeerd** → dan moeten we het IP van Supabase
  whitelisten of een vast-IP-proxy gebruiken. Dat is het productie-IP-stuk van F1;
  we lossen het samen op zodra we de foutmelding zien.

## Naar productie (later)
Zet dan de **Formal** APPcode/APPsecret + `BUCKY_DOMAIN=https://bdopenapi.buckydrop.com`
via `npx supabase secrets set …` en deploy opnieuw.
