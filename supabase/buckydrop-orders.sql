-- ============================================================
-- Flowva × BuckyDrop — F3: automatische bestelling.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- ============================================================

-- Het BuckyDrop-ordernummer (shopOrderNo) na automatisch plaatsen.
alter table public.orders add column if not exists shop_order_no text;

-- Laatste fout bij automatisch plaatsen (leeg = gelukt). Voor diagnose/agent.
alter table public.orders add column if not exists bd_error text;
