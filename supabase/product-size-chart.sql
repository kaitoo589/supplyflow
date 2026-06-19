-- Flowva — maattabel per product (de "Size guide" die de klant ziet).
-- size_chart = { measures: ["Taille",...], sizes: ["XS",...], rows: {"XS":["63",...]}, sketch: <url> }
-- De metingen krijgen vaste kleuren (taille=rood, heup=groen, lengte=geel, binnenbeen=blauw, …);
-- de klant matcht de gekleurde getallen met de gekleurde lijnen in de zelfgemaakte sketch.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
alter table public.products add column if not exists size_chart jsonb default null;
