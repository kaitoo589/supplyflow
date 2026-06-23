-- ============================================================
-- Flowva — echte productafmetingen (cm) per order, gevuld door fetch-weight uit
-- BuckyDrop order-detail (skuLong/skuWide/skuHeight). Samen met weight_grams geeft dit
-- een nauwkeurige internationale verzendquote (i.p.v. de verzonnen 20x20x10-doos).
-- Voer uit in: Supabase -> SQL Editor -> New query -> plak -> Run.
-- ============================================================

alter table public.orders add column if not exists length_cm numeric;
alter table public.orders add column if not exists width_cm numeric;
alter table public.orders add column if not exists height_cm numeric;
