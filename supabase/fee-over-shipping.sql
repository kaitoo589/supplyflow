-- ============================================================================
-- SERVICE FEE OVER PRODUCT + GESCHATTE INTERNATIONALE VERZENDING
-- (wijziging gevraagd door Kaito, 2026-07-23)
--
-- WAS : fee = max(8% van de kale productwaarde, EUR5)
-- WORDT: fee = max(8% van (kale productwaarde + geschatte internationale verzending), EUR5)
--
-- Grondslag = de KALE schatting (p_estimate / v_ship), dus ZONDER de +25% buffer:
-- die buffer is een waarborg die na de echte vrachtfactuur terugkomt, daar hoort
-- geen fee over. Ook NIET over BTW, fulfilment, toeslagen, opslag of valuta.
--
-- ⚠ BELANGRIJK: deze functies zijn LETTERLIJK overgenomen uit de DRAAIENDE database
-- (pg_get_functiondef op 2026-07-23), NIET uit fee-move-fase1.sql — die was verouderd
-- (miste de opslag- en valutakosten in pay_shipping_buffered). Alleen de fee-regel is
-- gewijzigd; al het andere is 1:1 gelijk gehouden.
--   1) pay_shipping_buffered     — hoofdpad (solo verzenden)
--   2) admin_send_storage_quote  — >30-dagen opslag-quote-pad
--
-- LET OP (groep / Flowva Friends): de groeps-fee wordt geheven bij READY-UP
-- (ff_member_fee in flowva-friends-money.sql). Op dat moment is er nog GEEN
-- verzendschatting, dus daar kan de verzending niet in de grondslag. Die blijft
-- dus over de productwaarde. Wil je dat ook wijzigen, dan moet de groeps-fee
-- eerst naar het verzendmoment verhuizen (Fase 2).
--
-- Idempotent: CREATE OR REPLACE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pay_shipping_buffered(p_uid uuid, p_order_ids text[], p_estimate numeric, p_vat numeric, p_service_code text, p_service_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count int; v_pieces int; v_weight_g numeric; v_prod_value numeric;
  v_service_fee numeric; v_storage_fee numeric; v_billable_kg int;
  v_surcharge_cny numeric; v_surcharge numeric; v_balance numeric;
  v_haul_id hauls.id%type; v_buffer constant numeric := 1.25;
  v_ship_buffered numeric; v_vat numeric; v_fulfil numeric;
  v_domestic numeric; v_qc numeric; v_currency_base numeric; v_currency numeric; v_charge numeric;
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

  -- Service fee (Flowva-marge): 8% van (bundel-productwaarde + GESCHATTE internationale
  -- verzending), min EUR5. Bewust over p_estimate en NIET over v_ship_buffered: die +25%
  -- is een waarborg die terugkomt. Niet over BTW/fulfilment/toeslag/opslag/valuta.
  v_service_fee := greatest(round((v_prod_value + coalesce(p_estimate, 0)) * 0.08, 2), 5.00);

  select coalesce(sum(
    case when public.storage_day(arrived_at) is null then 0
         when public.storage_day(arrived_at) >= 61 then 4.00
         when public.storage_day(arrived_at) >= 31 then 2.00
         else 0 end * coalesce(qty, 1)), 0)
    into v_storage_fee
    from orders where id = any(p_order_ids) and user_id = p_uid;
  v_storage_fee := round(v_storage_fee, 2);

  v_domestic := round(v_pieces * 5.0 / 7.8, 2);
  v_qc := round(v_pieces * 6.0 / 7.8, 2);
  v_currency_base := v_prod_value + v_domestic + v_qc + v_fulfil + v_ship_buffered + v_surcharge;
  v_currency := round(v_currency_base * 0.03, 2);

  v_charge := round(v_ship_buffered + v_vat + v_fulfil + v_surcharge + v_service_fee + v_storage_fee + v_currency, 2);

  select balance into v_balance from profiles where id = p_uid for update;
  if coalesce(v_balance, 0) < v_charge then
    return json_build_object('ok', false, 'error', 'Insufficient balance', 'needed', v_charge);
  end if;

  update profiles set balance = balance - v_charge where id = p_uid;

  insert into hauls (user_id, status, estimate_eur, shipping_eur, vat_eur, paid_eur, items, service_code, service_name)
  values (p_uid, 'confirmed', round(p_estimate, 2), v_ship_buffered, v_vat, v_charge, to_jsonb(p_order_ids), p_service_code, p_service_name)
  returning id into v_haul_id;

  insert into haul_items (haul_id, order_id) select v_haul_id, unnest(p_order_ids);

  insert into transactions (user_id, amount, type) values (p_uid, -(v_ship_buffered + v_vat), 'shipping');
  insert into transactions (user_id, amount, type) values (p_uid, -(v_fulfil + v_surcharge), 'fulfillment');
  insert into transactions (user_id, amount, type) values (p_uid, -v_service_fee, 'service_fee');
  if v_storage_fee > 0 then
    insert into transactions (user_id, amount, type) values (p_uid, -v_storage_fee, 'storage_fee');
  end if;
  insert into transactions (user_id, amount, type) values (p_uid, -v_currency, 'currency_fee');

  update orders set status = 'shipped_international' where id = any(p_order_ids) and user_id = p_uid;

  return json_build_object('ok', true, 'paid', v_charge, 'shipping', v_ship_buffered, 'vat', v_vat, 'fulfillment', v_fulfil, 'surcharge', v_surcharge, 'service_fee', v_service_fee, 'storage_fee', v_storage_fee, 'currency', v_currency, 'haul_id', v_haul_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_send_storage_quote(p_quote_id uuid, p_storage_eur numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  v_fulfil := round(9.9 / 7.8, 2);   -- fulfilment 9,9 CNY per pakket
  v_ship_total := round(v_ship_buf + v_vat + v_fulfil, 2);
  -- Service fee (Flowva-marge): 8% van (productwaarde + kale verzendschatting), min EUR5
  -- — identiek aan pay_shipping_buffered. v_ship = zonder buffer.
  v_service_fee := greatest(round((v_goods + v_ship) * 0.08, 2), 5.00);
  v_total := round(v_ship_total + v_service_fee + p_storage_eur, 2);
  update storage_quotes set shipping_eur = v_ship_total, storage_eur = round(p_storage_eur, 2),
    service_fee_eur = v_service_fee, total_eur = v_total, status = 'sent', valid_date = current_date, sent_at = now()
   where id = p_quote_id;
  return json_build_object('ok', true, 'shipping', v_ship_total, 'service_fee', v_service_fee, 'storage', round(p_storage_eur, 2), 'total', v_total);
end; $function$;
