-- ============================================================
-- SupplyFlow — productvelden voor beschrijving & variant-foto's
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- (Geen RLS-melding verwacht: dit voegt alleen kolommen toe.)
-- ============================================================

alter table public.products add column if not exists description text;
alter table public.products add column if not exists variant_images jsonb not null default '{}'::jsonb;
