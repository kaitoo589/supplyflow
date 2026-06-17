-- ============================================================
-- Flowva — products-tabel op slot
-- Iedereen mag LEZEN (anders werkt de klant-feed niet), maar
-- TOEVOEGEN / WIJZIGEN / VERWIJDEREN mag ALLEEN een admin.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- ============================================================

-- 1) Zorg dat de admin-check bestaat (idempotent — geen kwaad als hij er al is)
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- 2) Row-Level Security aanzetten op products
alter table public.products enable row level security;

-- 3) Lezen mag voor iedereen (klant-feed + admin)
drop policy if exists products_select_all on public.products;
create policy products_select_all on public.products
  for select using (true);

-- 4) Schrijven (insert/update/delete) ALLEEN voor admins
drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products
  for all using (is_admin()) with check (is_admin());

-- Klaar. Test: log als customer in op het dashboard en probeer een product te
-- bewerken → de database weigert het nu ("row-level security policy").
