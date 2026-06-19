-- ============================================================
-- Flowva — veilige pakket-/verzendbetaling (haul) met first-weight-model + invoer-BTW.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
--
-- LET OP: dit tarief MOET gelijk blijven aan de constanten in
-- src/WarehouseAndHaul.jsx:
--   SHIP_FIRST_KG = 0.5 · SHIP_FIRST_EUR = 9.0 · SHIP_PER_KG = 8.5
--   BUFFER_MULTIPLIER = 1.3 · IMPORT_VAT = 0.21
-- Model: verzending = first-weight-blok (eerste 0,5 kg) + per extra kg, dan ×buffer
-- (verschil komt later terug), plus 21% NL invoer-BTW over (goederen + verzending) — DDP.
-- ============================================================

create or replace function public.pay_shipping(p_order_ids text[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
  v_weight numeric;       -- totaal gewicht (gram)
  v_goods numeric;        -- goederenwaarde (som van order.price) voor BTW
  v_ship numeric;         -- verzending vóór buffer
  v_ship_buffered numeric;
  v_vat numeric;
  v_total numeric;
  v_balance numeric;
  c_first_kg  constant numeric := 0.5;
  c_first_eur constant numeric := 9.0;
  c_per_kg    constant numeric := 8.5;
  c_buffer    constant numeric := 1.3;
  c_vat       constant numeric := 0.21;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'Not logged in');
  end if;

  -- Alleen eigen producten die in het warehouse liggen tellen mee.
  select count(*), coalesce(sum(weight_grams), 0), coalesce(sum(price), 0)
    into v_count, v_weight, v_goods
    from orders
   where id = any(p_order_ids) and user_id = v_uid;

  if v_count = 0 or v_count <> coalesce(array_length(p_order_ids, 1), 0) then
    return json_build_object('ok', false, 'error', 'One or more products not found');
  end if;
  if v_weight <= 0 then
    return json_build_object('ok', false, 'error', 'Weight missing — shipping unknown');
  end if;

  -- Bedrag wordt hier (server-side) berekend, niet in de browser.
  v_ship := c_first_eur + greatest(0, (v_weight / 1000.0) - c_first_kg) * c_per_kg;
  v_ship_buffered := round(v_ship * c_buffer, 2);
  v_vat := round((v_goods + v_ship) * c_vat, 2);   -- 21% over goederen + verzending (DDP)
  v_total := v_ship_buffered + v_vat;

  -- Lock de profielrij zodat dubbel betalen onmogelijk is.
  select balance into v_balance from profiles where id = v_uid for update;

  if coalesce(v_balance, 0) < v_total then
    return json_build_object('ok', false, 'error', 'Insufficient balance', 'needed', v_total);
  end if;

  update profiles set balance = balance - v_total where id = v_uid;

  -- Eén verzend-transactie (verzending + BTW samen, type bewust 'shipping' om
  -- bestaande type-constraints niet te raken). Het volledige bedrag staat in 'amount'.
  insert into transactions (user_id, amount, type)
  values (v_uid, -v_total, 'shipping');

  return json_build_object('ok', true, 'paid', v_total, 'shipping', v_ship_buffered, 'vat', v_vat);
end;
$$;

grant execute on function public.pay_shipping(text[]) to authenticated;
