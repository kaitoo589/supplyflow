-- ============================================================
-- SupplyFlow — probleem-melding op aanvragen
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- ============================================================

-- Welk probleem de agent heeft gemeld (out_of_stock, variant_unavailable,
-- price_changed, link_broken). Leeg = geen probleem.
alter table public.orders add column if not exists problem_type text;
