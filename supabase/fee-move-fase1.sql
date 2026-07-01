-- ============================================================================
-- FASE 1 — service fee van CHECKOUT naar VERZENDEN (solo).  LIVE toegepast 2026-07-01.
--
-- Dit bestand is de GEZAGHEBBENDE bron voor de fee-verplaatsing en weerspiegelt
-- exact de draaiende DB (migraties move_service_fee_checkout_to_shipping +
-- add_service_fee_to_storage_quote_path). Idempotent (create or replace / add column if not exists).
--
-- LET OP: dit SUPERSEDEERT de fee-logica in pay-cart.sql en shipping-surcharges.sql.
--   - pay-cart.sql: NIET meer draaien (heft de fee nog bij checkout → zou de move terugdraaien).
--   - shipping-surcharges.sql: verouderde pay_shipping_buffered zónder service fee.
-- Draai voor de fee-logica ALTIJD dit bestand.
--
-- Model: 8% van de bundel-productwaarde (sum orders.price), min EUR5, EENMALIG bij verzenden,
--        server-side afgeleid, eigen transactie-type 'service_fee' (NIET mee-gerefund met shipping).
--        Domestic-shipping (¥5/stuk) + QC (¥6/stuk) blijven bij checkout (echte inkoopkosten).
--        Groep-fee blijft voorlopig bij ready-up (Fase 2).
-- ============================================================================

-- 1) CHECKOUT: pay_cart heft GEEN service fee meer -------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_cart(p_items jsonb, p_idem text DEFAULT NULL::text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_prior jsonb; v_result json;
  v_total numeric := 0; v_units int := 0; v_domestic numeric := 0; v_qc numeric := 0;
  v_fee numeric; v_charge numeric; v_balance numeric; v_group text;
  v_item jsonb; v_line numeric; v_price numeric; v_unknown int; v_qty int;
  v_id text; v_first_id text; v_i int := 0; v_meta jsonb;
  v_ship_name text; v_ship_phone text; v_ship_addr text; v_ship_post text; v_ship_city text; v_ship_country text;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return json_build_object('ok', false, 'error', 'Cart is empty');
  end if;

  if p_idem is not null then
    begin
      insert into public.cart_idempotency (idem_key, user_id) values (p_idem, v_uid);
    exception when unique_violation then
      select result into v_prior from public.cart_idempotency where idem_key = p_idem;
      if v_prior is not null then return v_prior::json; end if;
      return json_build_object('ok', false, 'error', 'This order is already being processed — please try again.', 'retry', true);
    end;
  end if;

  select raw_user_meta_data into v_meta from auth.users where id = v_uid;
  v_ship_addr := nullif(trim(coalesce(v_meta->>'adres', '')), '');
  v_ship_city := nullif(trim(coalesce(v_meta->>'stad', '')), '');
  if v_ship_addr is null or v_ship_city is null then
    return json_build_object('ok', false, 'error', 'Please add your shipping address first');
  end if;
  v_ship_name    := nullif(trim(coalesce(v_meta->>'voornaam', '') || ' ' || coalesce(v_meta->>'achternaam', '')), '');
  v_ship_phone   := v_meta->>'telefoon';
  v_ship_post    := v_meta->>'postcode';
  v_ship_country := coalesce(nullif(trim(coalesce(v_meta->>'land', '')), ''), 'Netherlands');

  select
    coalesce(sum(
      (select pr.price from public.products pr where pr.source_url = (e->>'source_url') and pr.price is not null order by pr.id limit 1)
      * greatest(coalesce((e->>'qty')::int, 1), 1)), 0),
    count(*) filter (where (e->>'source_url') is null
       or not exists (select 1 from public.products pr where pr.source_url = (e->>'source_url') and pr.price is not null)),
    coalesce(sum(greatest(coalesce((e->>'qty')::int, 1), 1)), 0)
    into v_total, v_unknown, v_units
  from jsonb_array_elements(p_items) e;

  if v_unknown > 0 then return json_build_object('ok', false, 'error', 'One or more products are no longer available'); end if;

  v_fee := 0;                                     -- service fee VERHUISD naar verzenden (pay_shipping_buffered)
  v_domestic := round(v_units * 5.0 / 7.8, 2);    -- China domestic shipping: 5 CNY/stuk
  v_qc := round(v_units * 6.0 / 7.8, 2);          -- Quality-control: 6 CNY/stuk
  v_charge := v_total + v_domestic + v_qc;        -- GEEN service fee meer bij checkout

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
    select pr.price into v_price from public.products pr where pr.source_url = (v_item->>'source_url') and pr.price is not null order by pr.id limit 1;
    v_line := v_price * v_qty;
    v_id := 'SF-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || v_i;
    if v_i = 1 then v_first_id := v_id; end if;

    insert into orders (
      id, user_id, product, product_title, source_url, platform,
      price, qty, kleur, variant_image, opmerking,
      status, request_group_id, quoted_total, quote_accepted_at, date,
      ship_name, ship_phone, ship_address, ship_postcode, ship_city, ship_country
    ) values (
      v_id, v_uid, coalesce(v_item->>'product', v_item->>'product_title'), v_item->>'product_title',
      v_item->>'source_url', v_item->>'platform', v_line, v_qty, v_item->>'kleur', v_item->>'variant_image', v_item->>'opmerking',
      'quote_accepted', v_group, v_line, now(), to_char(now(), 'DD Mon'),
      v_ship_name, v_ship_phone, v_ship_addr, v_ship_post, v_ship_city, v_ship_country
    );
    insert into transactions (user_id, amount, type, order_id) values (v_uid, -v_line, 'order', v_id);
  end loop;

  if v_domestic > 0 then insert into transactions (user_id, amount, type, order_id) values (v_uid, -v_domestic, 'domestic_shipping', v_first_id); end if;
  if v_qc > 0 then insert into transactions (user_id, amount, type, order_id) values (v_uid, -v_qc, 'qc_fee', v_first_id); end if;

  v_result := json_build_object('ok', true, 'fee', v_fee, 'domestic', v_domestic, 'qc', v_qc, 'total', v_total, 'charged', v_charge, 'group', v_group);
  if p_idem is not null then update public.cart_idempotency set result = v_result::jsonb where idem_key = p_idem; end if;
  return v_result;
end;
$function$;

-- 2) VERZENDEN (hoofdpad): pay_shipping_buffered heft de service fee -------------------------------
CREATE OR REPLACE FUNCTION public.pay_shipping_buffered(p_uid uuid, p_order_ids text[], p_estimate numeric, p_vat numeric, p_service_code text, p_service_name text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_count int; v_pieces int; v_weight_g numeric; v_prod_value numeric; v_service_fee numeric;
  v_billable_kg int; v_surcharge_cny numeric; v_surcharge numeric; v_balance numeric;
  v_haul_id hauls.id%type; v_buffer constant numeric := 1.25;
  v_ship_buffered numeric; v_vat numeric; v_fulfil numeric; v_charge numeric;
begin
  if p_uid is null then return json_build_object('ok', false, 'error', 'No user'); end if;
  if coalesce(p_estimate, 0) <= 0 then return json_build_object('ok', false, 'error', 'Invalid estimate'); end if;

  select count(*), coalesce(sum(coalesce(qty,1)),0), coalesce(sum(coalesce(weight_grams,0)),0), coalesce(sum(coalesce(price,0)),0)
    into v_count, v_pieces, v_weight_g, v_prod_value
    from orders where id = any(p_order_ids) and user_id = p_uid and status = 'qc_pending';
  if v_count = 0 or v_count <> coalesce(array_length(p_order_ids, 1), 0) then
    return json_build_object('ok', false, 'error', 'Items not available for shipping');
  end if;

  v_ship_buffered := round(p_estimate * v_buffer, 2);
  v_vat := round(coalesce(p_vat, 0), 2);
  v_fulfil := round(9.9 / 7.8, 2);
  v_billable_kg := ceil(v_weight_g / 1000.0);
  v_surcharge_cny := greatest(0, v_pieces - 5) * 2.0 + greatest(0, v_billable_kg - 2) * 1.5;
  v_surcharge := round(v_surcharge_cny / 7.8, 2);
  -- Service fee (Flowva-marge): 8% van bundel-productwaarde, min EUR5. Eigen type → niet mee-gerefund.
  v_service_fee := greatest(round(v_prod_value * 0.08, 2), 5.00);
  v_charge := round(v_ship_buffered + v_vat + v_fulfil + v_surcharge + v_service_fee, 2);

  select balance into v_balance from profiles where id = p_uid for update;
  if coalesce(v_balance, 0) < v_charge then return json_build_object('ok', false, 'error', 'Insufficient balance', 'needed', v_charge); end if;
  update profiles set balance = balance - v_charge where id = p_uid;

  insert into hauls (user_id, status, estimate_eur, shipping_eur, vat_eur, paid_eur, items, service_code, service_name)
  values (p_uid, 'confirmed', round(p_estimate, 2), v_ship_buffered, v_vat, v_charge, to_jsonb(p_order_ids), p_service_code, p_service_name)
  returning id into v_haul_id;
  insert into haul_items (haul_id, order_id) select v_haul_id, unnest(p_order_ids);

  insert into transactions (user_id, amount, type) values (p_uid, -(v_ship_buffered + v_vat), 'shipping');
  insert into transactions (user_id, amount, type) values (p_uid, -(v_fulfil + v_surcharge), 'fulfillment');
  insert into transactions (user_id, amount, type) values (p_uid, -v_service_fee, 'service_fee');

  update orders set status = 'shipped_international' where id = any(p_order_ids) and user_id = p_uid;
  return json_build_object('ok', true, 'paid', v_charge, 'shipping', v_ship_buffered, 'vat', v_vat, 'fulfillment', v_fulfil, 'surcharge', v_surcharge, 'service_fee', v_service_fee, 'haul_id', v_haul_id);
end;
$function$;

-- 3) VERZENDEN (>30-dagen opslag-quote-pad): ook de service fee (anders fee-ontwijking) ------------
alter table public.storage_quotes add column if not exists service_fee_eur numeric not null default 0;

CREATE OR REPLACE FUNCTION public.admin_send_storage_quote(p_quote_id uuid, p_storage_eur numeric)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare q record; v_weight numeric; v_goods numeric; v_ship numeric; v_ship_buf numeric; v_vat numeric; v_fulfil numeric; v_ship_total numeric; v_service_fee numeric; v_total numeric;
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
  v_fulfil := round(9.9 / 7.8, 2);
  v_ship_total := round(v_ship_buf + v_vat + v_fulfil, 2);
  v_service_fee := greatest(round(v_goods * 0.08, 2), 5.00);
  v_total := round(v_ship_total + v_service_fee + p_storage_eur, 2);
  update storage_quotes set shipping_eur = v_ship_total, storage_eur = round(p_storage_eur, 2),
    service_fee_eur = v_service_fee, total_eur = v_total, status = 'sent', valid_date = current_date, sent_at = now()
   where id = p_quote_id;
  return json_build_object('ok', true, 'shipping', v_ship_total, 'service_fee', v_service_fee, 'storage', round(p_storage_eur, 2), 'total', v_total);
end; $function$;

CREATE OR REPLACE FUNCTION public.pay_storage_quote(p_quote_id uuid)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
  if coalesce(v_balance, 0) < q.total_eur then return json_build_object('ok', false, 'error', 'Insufficient balance', 'needed', q.total_eur); end if;
  update profiles set balance = balance - q.total_eur where id = v_uid;
  insert into transactions (user_id, amount, type) values (v_uid, -q.shipping_eur, 'shipping');
  if coalesce(q.service_fee_eur, 0) > 0 then
    insert into transactions (user_id, amount, type) values (v_uid, -q.service_fee_eur, 'service_fee');
  end if;
  insert into transactions (user_id, amount, type) values (v_uid, -q.storage_eur, 'storage_fee');
  update orders set status = 'shipped_international' where id = any(q.order_ids) and user_id = v_uid;
  insert into hauls (user_id, status, paid_eur, shipping_eur, items)
    values (v_uid, 'confirmed', q.total_eur, q.shipping_eur, to_jsonb(q.order_ids));
  update storage_quotes set status = 'paid', paid_at = now() where id = p_quote_id;
  return json_build_object('ok', true, 'paid', q.total_eur);
end; $function$;
