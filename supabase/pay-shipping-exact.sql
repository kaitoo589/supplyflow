-- ============================================================
-- Flowva — pay_shipping_exact: rekent een pakket af tegen het EXACTE BuckyDrop-tarief
-- (geen schatting, geen buffer, geen na-refund). Wordt ALLEEN door de edge function
-- `haul-shipping` (service-role) aangeroepen, nadat die het bedrag server-side uit
-- channel-carriage-list heeft afgeleid. De klant kan deze functie NIET zelf aanroepen.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- ============================================================

-- Extra kolommen (idempotent).
alter table public.hauls add column if not exists service_code text;
alter table public.hauls add column if not exists service_name text;
alter table public.hauls add column if not exists shipping_eur numeric;
alter table public.hauls add column if not exists vat_eur numeric;
-- BuckyDrop Category-Level-III code per product (voor de tarief-call). Nu nog leeg →
-- de edge function valt terug op een default. TODO: vullen bij product-curatie (F2).
alter table public.products add column if not exists bd_category_code text;
alter table public.orders   add column if not exists bd_category_code text;

create or replace function public.pay_shipping_exact(
  p_uid          uuid,
  p_order_ids    text[],
  p_amount       numeric,
  p_shipping     numeric,
  p_vat          numeric,
  p_service_code text,
  p_service_name text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count   int;
  v_balance numeric;
  v_haul_id hauls.id%type;
  v_fulfil numeric;
  v_charge numeric;
begin
  if p_uid is null then
    return json_build_object('ok', false, 'error', 'No user');
  end if;

  -- Alleen eigen producten die klaar staan voor verzending (qc_pending) tellen mee.
  select count(*) into v_count
    from orders
   where id = any(p_order_ids) and user_id = p_uid and status = 'qc_pending';
  if v_count = 0 or v_count <> coalesce(array_length(p_order_ids, 1), 0) then
    return json_build_object('ok', false, 'error', 'Items not available for shipping');
  end if;
  if coalesce(p_amount, 0) <= 0 then
    return json_build_object('ok', false, 'error', 'Invalid amount');
  end if;

  v_fulfil := round(9.9 / 7.8, 2);   -- fulfilment ¥9,9 per pakket
  v_charge := p_amount + v_fulfil;

  -- Saldo vergrendelen + controleren.
  select balance into v_balance from profiles where id = p_uid for update;
  if coalesce(v_balance, 0) < v_charge then
    return json_build_object('ok', false, 'error', 'Insufficient balance', 'needed', v_charge);
  end if;

  update profiles set balance = balance - v_charge where id = p_uid;

  insert into hauls (user_id, status, estimate_eur, paid_eur, items, service_code, service_name, shipping_eur, vat_eur)
  values (p_uid, 'confirmed', p_shipping, v_charge, to_jsonb(p_order_ids), p_service_code, p_service_name, p_shipping, p_vat)
  returning id into v_haul_id;

  insert into haul_items (haul_id, order_id)
  select v_haul_id, unnest(p_order_ids);

  insert into transactions (user_id, amount, type)
  values (p_uid, -p_amount, 'shipping');
  insert into transactions (user_id, amount, type)
  values (p_uid, -v_fulfil, 'fulfillment');

  -- Pakket betaald → orders naar "verzonden".
  update orders set status = 'shipped_international'
   where id = any(p_order_ids) and user_id = p_uid;

  return json_build_object('ok', true, 'paid', v_charge, 'shipping', p_shipping, 'vat', p_vat, 'fulfillment', v_fulfil, 'haul_id', v_haul_id);
end;
$$;

-- Alleen de service-role (de edge function) mag dit aanroepen — NOOIT de klant direct.
revoke all on function public.pay_shipping_exact(uuid, text[], numeric, numeric, numeric, text, text) from public;
revoke all on function public.pay_shipping_exact(uuid, text[], numeric, numeric, numeric, text, text) from authenticated;
grant execute on function public.pay_shipping_exact(uuid, text[], numeric, numeric, numeric, text, text) to service_role;
