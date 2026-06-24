-- ============================================================================
-- Flowva — FABRIEKEN (factory-first feed)
-- Eén keer draaien in de Supabase SQL Editor. Volledig additief + idempotent:
-- je bestaande producten en feed blijven gewoon werken terwijl je migreert.
--
-- Wat dit doet:
--   1. Maakt een echte `factories`-tabel (rang = diamanten 1-4, 4 = hoogste,
--      plus de klant-zichtbare stats + optioneel logo).
--   2. Koppelt producten aan een fabriek via products.factory_id.
--   3. Migreert je bestaande fabrieken: per unieke leverancier-naam maakt het
--      één factory aan (met de stats van het nieuwste product) en linkt de
--      producten. Diamanten staan dan op 1 — die zet je daarna per fabriek goed.
-- ============================================================================

-- 1) De factories-tabel ------------------------------------------------------
create table if not exists public.factories (
  id          bigint generated always as identity primary key,
  name        text not null,
  diamonds    int  not null default 0 check (diamonds between 0 and 4),  -- 1688-stijl rang, 0 = geen rang, 4 = hoogste
  logo        text,            -- publieke storage-URL van het fabriekslogo/-foto (mag leeg)
  repurchase  text,            -- vrije tekst, zoals de bestaande factory_stats ('32%')
  service     text,            -- '4.8'
  ontime      text,            -- '98%'
  reviews     text,            -- '96%'
  notes       text,            -- interne notitie (klant ziet dit niet)
  created_at  timestamptz not null default now()
);

-- is_admin(): zelfde security-definer helper als lock-products.sql (idempotent)
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

alter table public.factories enable row level security;

-- Iedereen mag fabrieken lezen (de klant-feed heeft dit nodig).
drop policy if exists factories_select_all on public.factories;
create policy factories_select_all on public.factories for select using (true);

-- Alleen admins mogen fabrieken toevoegen/wijzigen/verwijderen.
drop policy if exists factories_admin_write on public.factories;
create policy factories_admin_write on public.factories
  for all using (is_admin()) with check (is_admin());

-- 2) Koppeling product -> fabriek -------------------------------------------
-- factory_id is nullable + "on delete set null": een fabriek verwijderen wist
-- NOOIT stilletjes je producten — ze vallen terug op de supplier-naam tot je ze
-- opnieuw koppelt.
alter table public.products
  add column if not exists factory_id bigint references public.factories(id) on delete set null;
create index if not exists products_factory_id_idx on public.products(factory_id);

-- 3) Migratie van bestaande fabrieken (idempotent — veilig opnieuw te draaien) -
-- 3a) Eén factory per unieke échte leverancier (platform-namen overslaan: die
--     zijn de fallback wanneer er geen echte fabriek is ingevuld).
insert into public.factories (name, diamonds, repurchase, service, ontime, reviews)
select distinct on (p.supplier)
       p.supplier,
       1,
       p.factory_stats->>'repurchase',
       p.factory_stats->>'service',
       p.factory_stats->>'ontime',
       p.factory_stats->>'reviews'
from public.products p
where p.supplier is not null
  and p.supplier not in ('1688', 'Taobao', 'Weidian', 'Alibaba')
  and not exists (select 1 from public.factories f where f.name = p.supplier)
order by p.supplier, p.id desc;   -- nieuwste product met die supplier wint (zoals findFactoryStats)

-- 3b) Link producten aan hun fabriek op exacte naam-match (alleen nog-niet-gekoppelde).
update public.products p
set factory_id = f.id
from public.factories f
where p.factory_id is null and p.supplier = f.name;

-- Klaar. Open daarna de 🏭 FABRIEKEN-tab in je admin en zet per fabriek het
-- juiste aantal diamanten (1-4). Producten zonder fabriek blijven onzichtbaar in
-- de feed tot je ze (via 'bewerk') aan een fabriek koppelt.
