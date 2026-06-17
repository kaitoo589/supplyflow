-- ============================================================
-- SupplyFlow — database-uitbreiding
-- Voer dit uit in: Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Subcategorie-kolom op producten (voor het categorie-systeem)
--    De feed filtert op products.category ("Clothes") + products.subcategory.
-- ------------------------------------------------------------
alter table public.products add column if not exists subcategory text;


-- ------------------------------------------------------------
-- 2) Reviews-tabel
--    LET OP: product_id is hier 'bigint' omdat products.id waarschijnlijk
--    int8/bigint is. Is jouw products.id een ander type (uuid of text)?
--    Pas dan 'product_id bigint' aan naar dat type.
-- ------------------------------------------------------------
create table if not exists public.reviews (
  id              uuid primary key default gen_random_uuid(),
  product_id      bigint not null references public.products(id) on delete cascade,
  user_id         uuid   not null references auth.users(id) on delete cascade,
  username        text,                                    -- weergavenaam reviewer
  rating          int    not null check (rating between 1 and 5),
  quality_score   int            check (quality_score between 1 and 5),
  body            text,                                    -- tekstreview
  variant         text,                                    -- bv. "Kleur: zwart, Maat: M"
  photos          text[] not null default '{}',            -- url's van geüploade foto's
  would_buy_again boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists reviews_product_id_idx on public.reviews (product_id);
create index if not exists reviews_created_at_idx on public.reviews (created_at desc);

-- Row Level Security
alter table public.reviews enable row level security;

-- Iedereen mag reviews lezen
drop policy if exists "reviews viewable by everyone" on public.reviews;
create policy "reviews viewable by everyone"
  on public.reviews for select using (true);

-- Een gebruiker mag alleen zijn eigen review toevoegen
drop policy if exists "users insert own review" on public.reviews;
create policy "users insert own review"
  on public.reviews for insert with check (auth.uid() = user_id);

-- Een gebruiker mag alleen zijn eigen review wijzigen
drop policy if exists "users update own review" on public.reviews;
create policy "users update own review"
  on public.reviews for update using (auth.uid() = user_id);

-- Een gebruiker mag alleen zijn eigen review verwijderen
drop policy if exists "users delete own review" on public.reviews;
create policy "users delete own review"
  on public.reviews for delete using (auth.uid() = user_id);
