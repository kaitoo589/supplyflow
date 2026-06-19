-- Flowva — product-vlaggen: doelgroep (gender) + verborgen (tijdelijk delisten).
-- gender = ["Men" | "Women" | "Unisex", ...] → klant ziet dit op de productpagina.
-- hidden = true → product is tijdelijk gedelist: niet zichtbaar in de klant-feed,
--                 in de admin staat de titel dan rood.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
alter table public.products add column if not exists gender jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists hidden boolean not null default false;
