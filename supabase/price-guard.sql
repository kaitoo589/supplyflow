-- Prijswijzigings-alert per product (price-guard).
-- price_alert + hidden worden gezet zodra een live BuckyDrop-prijscheck bij checkout
-- een te grote ¥-stijging (of uitverkocht) ziet, of als de admin het handmatig markeert.
-- De admin haalt de data opnieuw op en reactiveert (clear flag + unhide) — zie de
-- "re-fetch & reactivate"-knop in de admin.
alter table public.products add column if not exists price_alert boolean not null default false;
alter table public.products add column if not exists alert_reason text;
alter table public.products add column if not exists price_alert_at timestamptz;
