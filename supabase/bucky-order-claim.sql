-- ============================================================
-- Flowva — #10: atomaire claim tegen dubbele BuckyDrop-bestelling.
-- place-bucky-order claimt de order (zet bd_claimed_at) vóór de BuckyDrop-call.
-- Een gelijktijdige pg_net-retry die de claim niet wint, plaatst NIETS.
-- Bij een tijdelijke fout zet de functie bd_claimed_at weer op null (herpoging mogelijk).
--
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run. Idempotent.
-- ============================================================
alter table public.orders add column if not exists bd_claimed_at timestamptz;
