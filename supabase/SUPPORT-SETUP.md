# Supportsysteem activeren — 3 stappen

Het supportsysteem (chatwidget → AI-antwoord → escalatie naar ops-hud) is gebouwd
maar heeft drie eenmalige acties van jou nodig.

## 1. Database-tabellen aanmaken

Supabase dashboard → SQL Editor → New query → plak de inhoud van
`supabase/support-schema.sql` → Run.

Dit maakt `support_kb` en `support_questions` aan, met RLS (klanten zien alleen
eigen vragen, admin alles) en realtime updates.

## 2. Edge function deployen

```sh
cd C:\Users\Kaito\supplyflow
supabase functions deploy support-answer
supabase secrets set ANTHROPIC_API_KEY=sk-ant-jouw-key-hier
```

Een Claude API-key maak je aan op https://platform.claude.com (Console → API keys).
Geen key ingesteld? Geen probleem: elke vraag wordt dan automatisch geëscaleerd
naar je command center — het systeem blijft werken, alleen zonder AI-antwoorden.

## 3. Testen

1. Open supplyflow als klant en stel een vraag via de oranje chatknop.
2. De kennisbank is leeg, dus de vraag escaleert → "we komen erop terug".
3. Open ops-hud (`npm run dev` in C:\Users\Kaito\ai-ops-hud, poort 5181),
   log in met je admin-account → de vraag staat als missie in je COMMANDER DECK.
4. Klik de missie, typ het antwoord, verstuur → +150 XP, en de klant ziet het
   antwoord live in de widget verschijnen (realtime).
5. Stel dezelfde vraag nogmaals als klant → nu antwoordt de AI direct uit de
   kennisbank, zonder jou.

## Let op

- De hud logt in met je bestaande admin-account (profiles.role = 'admin').
- Vergeet niet je eerder gelekte Supabase secret key te roteren (stond nog open).
