-- ============================================================
-- Fix: transactions.order_id was uuid, maar ordernummers zijn
-- tekst (SF-...). Zet de kolom om zodat betalingen werken.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- ============================================================

alter table public.transactions
  alter column order_id type text
  using order_id::text;
