-- ============================================================
-- Flowva × BuckyDrop — productvelden voor de API-koppeling.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- (Voegt alleen kolommen toe; geen RLS-wijziging.)
-- ============================================================

-- BuckyDrop SPU (product-niveau identifier), bv. "581854187133".
alter table public.products add column if not exists spu_code text;

-- BuckyDrop platform-code voor het bestellen: TB (Taobao) / TMALL / ALIBABA (1688).
alter table public.products add column if not exists bd_platform text;

-- De varianten zoals BuckyDrop ze kent: één regel per koopbare SKU.
-- Vorm: [{ "skuCode": "...", "priceYuan": 15.39, "stock": 999,
--         "img": "https://…", "props": [{ "name": "Size", "value": "M" }] }]
-- Gebruikt straks bij het plaatsen van een bestelling (F3) om de gekozen
-- variant aan de juiste skuCode te koppelen.
alter table public.products add column if not exists bd_skus jsonb not null default '[]'::jsonb;
