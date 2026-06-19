-- Flowva — fabrieks-stats per product (klant ziet ze als vertrouwens-cijfers).
-- factory_stats = { repurchase, service, ontime, reviews } (vrije tekst, bv. "32%", "4.8").
-- De factory-naam zelf zit al in products.supplier.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
alter table public.products add column if not exists factory_stats jsonb default null;
