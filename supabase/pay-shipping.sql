-- ============================================================
-- SupplyFlow — veilige pakket-/verzendbetaling (haul)
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
--
-- LET OP: het tarief hieronder (€10/kg en buffer ×1.5) moet gelijk
-- blijven aan SHIPPING_RATE_PER_KG en BUFFER_MULTIPLIER in
-- src/WarehouseAndHaul.jsx.
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
  v_weight numeric;
  v_total numeric;
  v_balance numeric;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'Niet ingelogd');
  end if;

  -- Alleen eigen producten die in het warehouse liggen tellen mee.
  select count(*), coalesce(sum(weight_grams), 0)
    into v_count, v_weight
    from orders
   where id = any(p_order_ids) and user_id = v_uid;

  if v_count = 0 or v_count <> coalesce(array_length(p_order_ids, 1), 0) then
    return json_build_object('ok', false, 'error', 'Eén of meer producten zijn niet gevonden');
  end if;

  -- Bedrag wordt hier (server-side) berekend, niet in de browser.
  v_total := round((v_weight / 1000.0) * 10 * 1.5, 2);

  if v_total <= 0 then
    return json_build_object('ok', false, 'error', 'Gewicht ontbreekt — verzendkosten onbekend');
  end if;

  -- Lock de profielrij zodat dubbel betalen onmogelijk is.
  select balance into v_balance from profiles where id = v_uid for update;

  if coalesce(v_balance, 0) < v_total then
    return json_build_object('ok', false, 'error', 'Onvoldoende balance');
  end if;

  update profiles set balance = balance - v_total where id = v_uid;

  insert into transactions (user_id, amount, type)
  values (v_uid, -v_total, 'shipping');

  return json_build_object('ok', true, 'paid', v_total);
end;
$$;

grant execute on function public.pay_shipping(text[]) to authenticated;
