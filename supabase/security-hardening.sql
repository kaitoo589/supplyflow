-- ============================================================
-- Flowva — beveiliging dichttimmeren. 1x draaien in:
-- Supabase → SQL Editor → New query → plak → Run.
-- Idempotent: veilig om (opnieuw) te draaien.
--
-- Sluit:
--  1) products       → alleen admin schrijft (oude regels vervangen)
--  2) order_messages → alleen eigenaar van de order + agent/admin
--  3) orders         → klant kan prijs/offerte/gewicht/probleem niet manipuleren
--                       (anders: minder betalen, gratis verzenden, of refund opblazen)
-- ============================================================

-- admin-check (idempotent)
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- 1) PRODUCTS — oude regels weg, schone regels erin
alter table public.products enable row level security;
drop policy if exists "Admin can insert products" on public.products;
drop policy if exists "Admin can update products" on public.products;
drop policy if exists "Admin can delete products" on public.products;
drop policy if exists "Producten zijn leesbaar voor iedereen" on public.products;
drop policy if exists products_select_all on public.products;
drop policy if exists products_admin_write on public.products;
create policy products_select_all on public.products for select using (true);
create policy products_admin_write on public.products
  for all using (is_admin()) with check (is_admin());

-- 2) ORDER_MESSAGES — alleen eigenaar van de order + agent/admin
drop policy if exists "Anyone can read and write messages" on public.order_messages;
drop policy if exists own_or_staff_messages on public.order_messages;
create policy own_or_staff_messages on public.order_messages
  for all
  using (
    exists (select 1 from public.orders o
            where o.id = order_messages.order_id and o.user_id = auth.uid())
    or coalesce((select role from public.profiles where id = auth.uid()), '') in ('agent', 'admin')
  )
  with check (
    exists (select 1 from public.orders o
            where o.id = order_messages.order_id and o.user_id = auth.uid())
    or coalesce((select role from public.profiles where id = auth.uid()), '') in ('agent', 'admin')
  );

-- 3) ORDERS — guard tegen prijs/offerte/gewicht/probleem-manipulatie door klanten.
--    Agent/admin mogen alles. De betaal-RPC's (pay_quote etc.) zetten price
--    gelijk aan quoted_total en raken de andere velden niet, dus die blijven werken.
create or replace function public.guard_order_customer_writes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if coalesce(v_role, '') in ('agent', 'admin') then
    return new;  -- personeel mag alles
  end if;

  -- offertebedragen + gewicht: klant mag deze NOOIT wijzigen
  if new.quoted_total is distinct from old.quoted_total
     or new.quoted_price is distinct from old.quoted_price
     or new.quoted_local_shipping is distinct from old.quoted_local_shipping
     or new.weight_grams is distinct from old.weight_grams then
    raise exception 'Niet toegestaan: offerte- of gewichtsvelden mogen niet door de klant gewijzigd worden';
  end if;

  -- price mag alleen gelijk aan quoted_total gezet worden (dat doet de betaal-RPC)
  if new.price is distinct from old.price and new.price is distinct from new.quoted_total then
    raise exception 'Niet toegestaan: je mag de prijs niet wijzigen';
  end if;

  -- klant mag een probleem alleen wegklikken (→ null), niet zelf zetten
  if new.problem_type is distinct from old.problem_type and new.problem_type is not null then
    raise exception 'Niet toegestaan: alleen je agent mag een probleem markeren';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_order_quote_trg on public.orders;
drop trigger if exists guard_order_customer_writes_trg on public.orders;
create trigger guard_order_customer_writes_trg
  before update on public.orders
  for each row execute function public.guard_order_customer_writes();
