# Flowva × BuckyDrop — F4: statusupdates terug ontvangen (webhook)

BuckyDrop stuurt automatisch een melding zodra een bestelling van status verandert
(gekocht, verzonden, in magazijn, bezorgd) of bij een defect (met inspectiefoto's).
Flowva verifieert de melding, werkt de order bij en stuurt de klant een push.

> Geen nieuwe secrets nodig — hergebruikt `BUCKY_APP_CODE` + `BUCKY_APP_SECRET`.

## 1) Log-tabel
Supabase → **SQL Editor** → plak `supabase/buckydrop-webhook.sql` → **Run**.
(Elke binnenkomende melding wordt rauw gelogd in `bucky_notifications` — handig om
de echte structuur te zien.)

## 2) Function deployen
Terminal in `C:\Users\Kaito\supplyflow`:
```powershell
npx supabase functions deploy buckydrop-webhook
```

## 3) De URL bij BuckyDrop invullen
Je webhook-adres is:
```
https://bjtpnuxjbazlbaoyflcx.supabase.co/functions/v1/buckydrop-webhook
```
BuckyDrop → **Control → Access Info → Address Configuration** (Test-tab) →
veld **"URL to receive notifications"** → plak het adres → **Submit**.

## Testen
Op de sandbox vindt geen echte fulfilment plaats, dus er komen niet vanzelf
meldingen. We testen met een **nagebootste melding**: ik stuur (na je deploy) een
correct ondertekende test-webhook naar de functie voor een bestaande order, en we
kijken of de status meeloopt (bijv. → `bought`). Daarna zie je 'm ook in
`bucky_notifications` staan.

## Status-vertaling
| BuckyDrop | → app-status |
|---|---|
| PO ordered (5) | bought |
| PO shipped out (6) | shipped_local |
| PO stock-in (9) | qc_pending |
| PO international (11) | shipped_international |
| PO fulfilled (12) / parcel delivered | delivered |
| PO cancelled (8) | cancelled + auto-refund |
| Po Pending (defect + foto's) | foto's op order + probleem gemeld |
| parcel shipped (pkgNormalStatus 2/3) | shipped_international |
