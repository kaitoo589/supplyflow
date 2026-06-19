-- Flowva — fotogalerij per product (de hoofdfoto-galerij die de klant doorswipet).
-- De admin-fetch vult deze automatisch met alle 1688/Taobao-productfoto's
-- (productImageList). preview_images blijft voor de eigen QC-foto's van de admin.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
alter table public.products add column if not exists gallery jsonb not null default '[]'::jsonb;
