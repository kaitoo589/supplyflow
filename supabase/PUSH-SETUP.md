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

## 4) Trigger op statuswijziging
De dashboard "Database Webhook" kan falen met *"schema supabase_functions does not
exist"*. Gebruik daarom een trigger met pg_net (betrouwbaarder):
1. Supabase → **Database → Extensions** → zet **`pg_net`** aan.
2. **SQL Editor** → draai `supabase/notify-order-trigger.sql` (URL + secret staan er al in).

## Testen
1. Installeer Flowva (iPhone: Safari → Deel → Zet op beginscherm · Android: Chrome → Installeren).
2. Open de app → **Profiel** → **"Meldingen aanzetten"** → toestemming geven.
3. Laat een agent (of jij in het dashboard) een orderstatus wijzigen → je krijgt een melding op je telefoon. 🔔

## VAPID publieke sleutel
Zit al in de code (`src/push.js`):
`BNNZ7qxywezu_W7Rr65gaGuDglmNJQPDddQ05MZt67oy1MBqlXw96uA_OajJwZhRSP-Dja8J6k8WnLFT6diQOXg`
