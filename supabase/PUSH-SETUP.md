# Flowva — push-notificaties aanzetten

De code is gebouwd. Deze stappen zet jij eenmalig in Supabase. Daarna krijgen
klanten die de app **installeren** en **meldingen aanzetten** automatisch een
melding bij elke orderstatus-wijziging (QC-foto's klaar, verzonden, bezorgd…).

> De geheime waarden (VAPID privé-sleutel + WEBHOOK_SECRET) krijg je apart in de
> chat. Zet ze NIET in dit bestand en niet in git.

## 1) Tabel aanmaken
Supabase → **SQL Editor** → plak `supabase/push-subscriptions.sql` → **Run**.

## 2) Secrets zetten (voor de edge function)
PowerShell, in de map `C:\Users\Kaito\supplyflow`:
```powershell
npx supabase secrets set VAPID_PUBLIC_KEY=<publiek> VAPID_PRIVATE_KEY=<prive> VAPID_SUBJECT=mailto:contact@vable.store WEBHOOK_SECRET=<geheim>
```
(Of via Dashboard → Edge Functions → Secrets.)

## 3) Function deployen
```powershell
npx supabase functions deploy notify-order
```

## 4) Database Webhook instellen
Supabase → **Database → Webhooks → Create a new hook**:
- **Name:** notify-order
- **Table:** `public.orders` · **Events:** Update
- **Type:** Supabase Edge Functions → kies `notify-order`
- **HTTP Headers:** voeg toe `x-webhook-secret` = *(hetzelfde geheim als WEBHOOK_SECRET)*
- **Create**.

(Als je "HTTP Request" kiest i.p.v. de edge-function-optie, is de URL:
`https://bjtpnuxjbazlbaoyflcx.supabase.co/functions/v1/notify-order`, methode POST.)

## Testen
1. Installeer Flowva (iPhone: Safari → Deel → Zet op beginscherm · Android: Chrome → Installeren).
2. Open de app → **Profiel** → **"Meldingen aanzetten"** → toestemming geven.
3. Laat een agent (of jij in het dashboard) een orderstatus wijzigen → je krijgt een melding op je telefoon. 🔔

## VAPID publieke sleutel
Zit al in de code (`src/push.js`):
`BNNZ7qxywezu_W7Rr65gaGuDglmNJQPDddQ05MZt67oy1MBqlXw96uA_OajJwZhRSP-Dja8J6k8WnLFT6diQOXg`
