-- ============================================================
-- SupplyFlow — opslag-quotes met historie (reeds toegepast op de DB).
--
-- Flow: bij verzenden van item(s) die >30 dagen in het magazijn lagen maakt de
-- klant een VERZOEK. De admin krijgt dat te zien ("Extra opslagkosten"), vult het
-- werkelijke opslagbedrag in (van BuckyDrop) en stuurt een QUOTE: internationale
-- verzending + opslag, totaal, "vandaag geldig". Betaalt de klant niet diezelfde
-- dag → de quote verloopt; bij een nieuw verzoek maakt de admin een nieuwe quote
-- (historie groeit) — dit gaat door tot dag 90. Na dag 90 verbeurd (zie
-- warehouse-storage.sql).
-- ============================================================

create table if not exists public.storage_quotes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  order_ids    text[] not null,
  storage_days int,
  shipping_eur numeric,
  storage_eur  numeric,
  total_eur    numeric,
  status       text not null default 'requested',  -- requested | sent | paid | expired
  valid_date   date,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  paid_at      timestamptz
);

alter table public.storage_quotes enable row level security;
drop policy if exists sq_read_own on public.storage_quotes;
create policy sq_read_own on public.storage_quotes
  for select to authenticated using (user_id = auth.uid());

-- 1) Klant vraagt een quote aan (bij confirmen met >30-dagen-items).
create or replace function public.request_storage_quote(p_order_ids text[])
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_days int;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  if not exists (select 1 from orders where id = any(p_order_ids) and user_id = v_uid) then
    return json_build_object('ok', false, 'error', 'No items');
  end if;
  update storage_quotes set status = 'expired'
   where user_id = v_uid and status in ('requested', 'sent') and order_ids = p_order_ids;
  select max(floor(extract(epoch from (now() - arrived_at)) / 86400))::int into v_days
    from orders where id = any(p_order_ids) and user_id = v_uid;
  insert into storage_quotes (user_id, order_ids, storage_days, status)
    values (v_uid, p_order_ids, v_days, 'requested') returning id into v_id;
  return json_build_object('ok', true, 'quote_id', v_id);
end; $$;
grant execute on function public.request_storage_quote(text[]) to authenticated;

-- 2) Admin stuurt de quote (verzending server-side berekend, opslag ingevuld). Vandaag geldig.
create or replace function public.admin_send_storage_quote(p_quote_id uuid, p_storage_eur numeric)
returns json language plpgsql security definer set search_path = public as $$
declare q record; v_weight numeric; v_goods numeric; v_ship numeric; v_ship_buf numeric; v_vat numeric; v_ship_total numeric; v_total numeric;
  c_first_kg constant numeric := 0.5; c_first_eur constant numeric := 9.0; c_per_kg constant numeric := 8.5; c_buffer constant numeric := 1.3; c_vat constant numeric := 0.21;
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then return json_build_object('ok', false, 'error', 'Alleen admins'); end if;
  if p_storage_eur is null or p_storage_eur < 0 then return json_build_object('ok', false, 'error', 'Ongeldig opslagbedrag'); end if;
  select * into q from storage_quotes where id = p_quote_id;
  if not found then return json_build_object('ok', false, 'error', 'Quote niet gevonden'); end if;
  select coalesce(sum(weight_grams), 0), coalesce(sum(price), 0) into v_weight, v_goods from orders where id = any(q.order_ids);
  v_ship := c_first_eur + greatest(0, (v_weight / 1000.0) - c_first_kg) * c_per_kg;
  v_ship_buf := round(v_ship * c_buffer, 2);
  v_vat := round((v_goods + v_ship) * c_vat, 2);
  v_ship_total := round(v_ship_buf + v_vat, 2);
  v_total := round(v_ship_total + p_storage_eur, 2);
  update storage_quotes set shipping_eur = v_ship_total, storage_eur = round(p_storage_eur, 2),
    total_eur = v_total, status = 'sent', valid_date = current_date, sent_at = now()
   where id = p_quote_id;
  return json_build_object('ok', true, 'shipping', v_ship_total, 'storage', round(p_storage_eur, 2), 'total', v_total);
end; $$;
grant execute on function public.admin_send_storage_quote(uuid, numeric) to authenticated;

-- 3) Klant betaalt de quote → verzending verwerkt (haul + orders shipped).
create or replace function public.pay_storage_quote(p_quote_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); q record; v_balance numeric;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select * into q from storage_quotes where id = p_quote_id and user_id = v_uid;
  if not found then return json_build_object('ok', false, 'error', 'Quote niet gevonden'); end if;
  if q.status <> 'sent' then return json_build_object('ok', false, 'error', 'Quote niet (meer) geldig'); end if;
  if q.valid_date <> current_date then
    update storage_quotes set status = 'expired' where id = p_quote_id;
    return json_build_object('ok', false, 'error', 'Quote verlopen — vraag een nieuwe aan');
  end if;
  select balance into v_balance from profiles where id = v_uid for update;
  if coalesce(v_balance, 0) < q.total_eur then
    return json_build_object('ok', false, 'error', 'Insufficient balance', 'needed', q.total_eur);
  end if;
  update profiles set balance = balance - q.total_eur where id = v_uid;
  insert into transactions (user_id, amount, type) values (v_uid, -q.shipping_eur, 'shipping');
  insert into transactions (user_id, amount, type) values (v_uid, -q.storage_eur, 'storage_fee');
  update orders set status = 'shipped_international' where id = any(q.order_ids) and user_id = v_uid;
  insert into hauls (user_id, status, paid_eur, shipping_eur, items)
    values (v_uid, 'confirmed', q.total_eur, q.shipping_eur, to_jsonb(q.order_ids));
  update storage_quotes set status = 'paid', paid_at = now() where id = p_quote_id;
  return json_build_object('ok', true, 'paid', q.total_eur);
end; $$;
grant execute on function public.pay_storage_quote(uuid) to authenticated;

-- 4) Admin-lijst: alle quotes (open verzoeken + historie), nieuwste eerst.
create or replace function public.admin_list_storage_quotes()
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then return json_build_object('ok', false, 'error', 'Alleen admins'); end if;
  return json_build_object('ok', true, 'quotes', coalesce((
    select json_agg(json_build_object(
      'id', sq.id, 'user_id', sq.user_id, 'email', u.email, 'order_ids', sq.order_ids,
      'storage_days', sq.storage_days, 'shipping_eur', sq.shipping_eur, 'storage_eur', sq.storage_eur,
      'total_eur', sq.total_eur, 'status', sq.status, 'valid_date', sq.valid_date, 'created_at', sq.created_at
    ) order by sq.created_at desc)
    from storage_quotes sq left join auth.users u on u.id = sq.user_id
  ), '[]'::json));
end; $$;
grant execute on function public.admin_list_storage_quotes() to authenticated;
