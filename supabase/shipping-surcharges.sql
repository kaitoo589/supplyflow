-- Fulfilment-toeslagen ingebouwd in pay_shipping_buffered (server-side, nooit vanaf de client).
-- Toegepast op de DB via Supabase-migratie: pay_shipping_buffered_fulfilment_surcharges (2026-06-30).
--
-- Twee toeslagen op het pakket (zoals op de "How Flowva works"-pagina):
--   • >5 stuks  -> +¥2 per extra stuk
--   • >2 kg     -> +¥1,5 per kg boven 2 kg (facturabel gewicht naar boven afgerond op hele kg)
-- ¥->€ via /7,8 (zelfde koers als de fulfilment-fee). Vaste kost: NIET gebufferd, NIET terugbetaald
-- bij de settle (alleen de freight in shipping_eur wordt verrekend). paid_eur bevat de toeslag.

CREATE OR REPLACE FUNCTION public.pay_shipping_buffered(p_uid uuid, p_order_ids text[], p_estimate numeric, p_vat numeric, p_service_code text, p_service_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count int;
  v_pieces int;
  v_weight_g numeric;
  v_billable_kg int;
  v_surcharge_cny numeric;
  v_surcharge numeric;
  v_balance numeric;
  v_haul_id hauls.id%type;
  v_buffer constant numeric := 1.25;
  v_ship_buffered numeric;
  v_vat numeric;
  v_fulfil numeric;
  v_charge numeric;
begin
  if p_uid is null then return json_build_object('ok', false, 'error', 'No user'); end if;
  if coalesce(p_estimate, 0) <= 0 then return json_build_object('ok', false, 'error', 'Invalid estimate'); end if;

  -- Tel stuks + gewicht SERVER-SIDE (nooit vanaf de client) voor de fulfilment-toeslagen.
  select count(*), coalesce(sum(coalesce(qty,1)),0), coalesce(sum(coalesce(weight_grams,0)),0)
    into v_count, v_pieces, v_weight_g
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

  v_charge := round(v_ship_buffered + v_vat + v_fulfil + v_surcharge, 2);

  select balance into v_balance from profiles where id = p_uid for update;
  if coalesce(v_balance, 0) < v_charge then
    return json_build_object('ok', false, 'error', 'Insufficient balance', 'needed', v_charge);
  end if;

  update profiles set balance = balance - v_charge where id = p_uid;

  insert into hauls (user_id, status, estimate_eur, shipping_eur, vat_eur, paid_eur, items, service_code, service_name)
  values (p_uid, 'confirmed', round(p_estimate, 2), v_ship_buffered, v_vat, v_charge, to_jsonb(p_order_ids), p_service_code, p_service_name)
  returning id into v_haul_id;

  insert into haul_items (haul_id, order_id) select v_haul_id, unnest(p_order_ids);

  -- Freight+VAT = de gebufferde/te-verrekenen kant; fulfilment+toeslag = vaste kosten (niet gerefund).
  insert into transactions (user_id, amount, type) values (p_uid, -(v_ship_buffered + v_vat), 'shipping');
  insert into transactions (user_id, amount, type) values (p_uid, -(v_fulfil + v_surcharge), 'fulfillment');

  update orders set status = 'shipped_international' where id = any(p_order_ids) and user_id = p_uid;

  return json_build_object('ok', true, 'paid', v_charge, 'shipping', v_ship_buffered, 'vat', v_vat, 'fulfillment', v_fulfil, 'surcharge', v_surcharge, 'haul_id', v_haul_id);
end; $function$;
