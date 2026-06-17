-- ============================================================
-- SupplyFlow — automatische chat-vertaling
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
--
-- Bewaart naast het originele bericht ook de vertaling, zodat
-- klant (Engels) en agent (Chinees) elkaar kunnen lezen.
-- ============================================================

alter table public.order_messages add column if not exists message_translated text;
