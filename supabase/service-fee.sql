-- ============================================================
-- SupplyFlow — service fee (8%, min €5) + aanvraaggroepen
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
--
-- Regels (afgesproken 2026-06):
--  * Fee wordt gerekend op het betaalmoment van de offerte.
--  * Eén aanvraaggroep (request_group_id) = één fee over het
--    totaal van alle offertes in die groep.
--  * Losse aanvraag = eigen groep van 1 = eigen fee.
--  * Fee = greatest(8% van offertetotaal, €5,00).
--  * Fee wordt gelogd als transactie type 'service_fee' zodat
--    de reconciliatie blijft kloppen en het OPS-HUD winstpaneel
--    de omzet kan optellen.
-- ============================================================

-- 1) Aanvraaggroep: items die samen in één keer zijn aangevraagd
alter table public.orders add column if not exists request_group_id text;
create index if not exists orders_request_group_idx on public.orders (request_group_id);

-- 2) Fee-formule op één plek
create or replace function public.service_fee_for(p_total numeric)
returns numeric
language sql
immutable
as $$
  select greatest(round(p_total * 0.08, 2), 5.00);
$$;

-- 3) Losse offerte betalen — nu mét service fee
create or replace function public.pay_quote(p_order_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order record;
  v_balance numeric;
  v_fee numeric;
  v_total numeric;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'Niet ingelogd');
  end if;

  select * into v_order from orders where id = p_order_id and user_id = v_uid;
  if not found then
    return json_build_object('ok', false, 'error', 'Order niet gevonden');
  end if;

  if v_order.status <> 'quote_sent' then
    return json_build_object('ok', false, 'error', 'Deze offerte is niet (meer) open');
  end if;

  if v_order.quoted_total is null or v_order.quoted_total <= 0 then
    return json_build_object('ok', false, 'error', 'Offertebedrag ontbreekt');
  end if;

  v_fee := service_fee_for(v_order.quoted_total);
  v_total := v_order.quoted_total + v_fee;

  -- Lock de profielrij zodat dubbel betalen onmogelijk is
  select balance into v_balance from profiles where id = v_uid for update;

  if coalesce(v_balance, 0) < v_total then
    return json_build_object('ok', false, 'error', 'Onvoldoende balance');
  end if;

  update profiles set balance = balance - v_total where id = v_uid;

  insert into transactions (user_id, amount, type, order_id)
  values (v_uid, -v_order.quoted_total, 'order', p_order_id);

  insert into transactions (user_id, amount, type, order_id)
  values (v_uid, -v_fee, 'service_fee', p_order_id);

  update orders set
    status = 'quote_accepted',
    quote_accepted_at = now(),
    price = v_order.quoted_total
  where id = p_order_id;

  return json_build_object('ok', true, 'fee', v_fee, 'total', v_total);
end;
$$;

grant execute on function public.pay_quote(text) to authenticated;

-- 4) Hele aanvraaggroep in één keer betalen — één fee over het totaal.
--    Kan pas als álle items van de groep een offerte hebben
--    (geannuleerde items tellen niet mee).
create or replace function public.pay_quote_group(p_group_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_waiting int;
  v_quoted int;
  v_sum numeric;
  v_fee numeric;
  v_total numeric;
  v_balance numeric;
  v_first_order text;
  r record;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'Niet ingelogd');
  end if;

  select
    count(*) filter (where status = 'requested'),
    count(*) filter (where status = 'quote_sent'),
    coalesce(sum(quoted_total) filter (where status = 'quote_sent'), 0),
    min(id) filter (where status = 'quote_sent')
  into v_waiting, v_quoted, v_sum, v_first_order
  from orders
  where request_group_id = p_group_id
    and user_id = v_uid
    and status in ('requested', 'quote_sent');

  if v_quoted = 0 then
    return json_build_object('ok', false, 'error', 'Geen open offertes in deze aanvraag');
  end if;

  if v_waiting > 0 then
    return json_build_object('ok', false, 'error', 'Nog niet alle offertes zijn binnen');
  end if;

  if v_sum <= 0 then
    return json_build_object('ok', false, 'error', 'Offertebedrag ontbreekt');
  end if;

  v_fee := service_fee_for(v_sum);
  v_total := v_sum + v_fee;

  select balance into v_balance from profiles where id = v_uid for update;

  if coalesce(v_balance, 0) < v_total then
    return json_build_object('ok', false, 'error', 'Onvoldoende balance');
  end if;

  update profiles set balance = balance - v_total where id = v_uid;

  for r in
    select id, quoted_total from orders
    where request_group_id = p_group_id and user_id = v_uid and status = 'quote_sent'
  loop
    insert into transactions (user_id, amount, type, order_id)
    values (v_uid, -r.quoted_total, 'order', r.id);
  end loop;

  insert into transactions (user_id, amount, type, order_id)
  values (v_uid, -v_fee, 'service_fee', v_first_order);

  update orders set
    status = 'quote_accepted',
    quote_accepted_at = now(),
    price = quoted_total
  where request_group_id = p_group_id and user_id = v_uid and status = 'quote_sent';

  return json_build_object('ok', true, 'fee', v_fee, 'total', v_total, 'items', v_quoted);
end;
$$;

grant execute on function public.pay_quote_group(text) to authenticated;
