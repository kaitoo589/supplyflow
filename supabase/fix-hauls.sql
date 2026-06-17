-- ============================================================
-- Fix: de hauls-tabel mist de kolom "items" (lijst van order-nummers
-- in het pakket). Daardoor faalde "Confirm & pay" bij verzending.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- ============================================================

alter table public.hauls add column if not exists items jsonb not null default '[]'::jsonb;
