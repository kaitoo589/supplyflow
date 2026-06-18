-- ============================================================
-- Flowva — instant checkout: reken de hele winkelmand in één keer af.
-- Vervangt de "aanvraag → offerte → betalen"-flow voor catalogus-producten:
-- de klant betaalt direct de bekende prijs + één service fee (8%, min €5),
-- en de orders gaan meteen op 'quote_accepted' → triggert F3 (BuckyDrop).
--
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- ============================================================

create or replace function public.pay_cart(p_items jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_total numeric := 0;
  v_fee numeric;
  v_charge numeric;
  v_balance numeric;
  v_group text;
  v_item jsonb;
  v_line numeric;
  v_qty int;
  v_id text;
  v_first_id text;
  v_i int := 0;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'Not logged in');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return json_build_object('ok', false, 'error', 'Cart is empty');
  end if;

  -- Totaal = som(prijs × aantal)
  select coalesce(sum( (e->>'price')::numeric * greatest(coalesce((e->>'qty')::int, 1), 1) ), 0)
    into v_total
  from jsonb_array_elements(p_items) e;

  v_fee := service_fee_for(v_total);   -- max(8%, €5)
  v_charge := v_total + v_fee;

  -- Saldo vergrendelen + controleren
  select balance into v_balance from profiles where id = v_uid for update;
  if coalesce(v_balance, 0) < v_charge then
    return json_build_object('ok', false, 'error', 'Insufficient balance', 'needed', v_charge);
  end if;

  update profiles set balance = balance - v_charge where id = v_uid;

  v_group := 'SF-G-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_i := v_i + 1;
    v_qty := greatest(coalesce((v_item->>'qty')::int, 1), 1);
    v_line := (v_item->>'price')::numeric * v_qty;
    v_id := 'SF-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || v_i;
    if v_i = 1 then v_first_id := v_id; end if;

    insert into orders (
      id, user_id, product, product_title, source_url, platform,
      price, qty, kleur, variant_image, opmerking,
      status, request_group_id, quoted_total, quote_accepted_at, date
    ) values (
      v_id, v_uid,
      coalesce(v_item->>'product', v_item->>'product_title'),
      v_item->>'product_title',
      v_item->>'source_url',
      v_item->>'platform',
      v_line, v_qty,
      v_item->>'kleur',
      v_item->>'variant_image',
      v_item->>'opmerking',
      'quote_accepted', v_group, v_line, now(),
      to_char(now(), 'DD Mon')
    );

    insert into transactions (user_id, amount, type, order_id)
    values (v_uid, -v_line, 'order', v_id);
  end loop;

  -- Eén service fee over de hele mand
  insert into transactions (user_id, amount, type, order_id)
  values (v_uid, -v_fee, 'service_fee', v_first_id);

  return json_build_object('ok', true, 'fee', v_fee, 'total', v_total, 'charged', v_charge, 'group', v_group);
end;
$$;

grant execute on function public.pay_cart(jsonb) to authenticated;
