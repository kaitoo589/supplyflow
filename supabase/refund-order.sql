-- ============================================================
-- SupplyFlow — annuleren ná betaling, met automatische refund
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
--
-- Veiligheidsregels:
--  • alleen de eigenaar van de order kan annuleren
--  • alleen in de fase "quote_accepted" (betaald, nog niet gekocht)
--  • alleen als de agent een probleem heeft gemeld (problem_type)
--  • het betaalde bedrag gaat terug naar de balance + transactie-log
-- ============================================================

create or replace function public.cancel_paid_order(p_order_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order record;
  v_refund numeric;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'Niet ingelogd');
  end if;

  select * into v_order from orders where id = p_order_id and user_id = v_uid;
  if not found then
    return json_build_object('ok', false, 'error', 'Order niet gevonden');
  end if;

  if v_order.status <> 'quote_accepted' then
    return json_build_object('ok', false, 'error', 'Annuleren met terugbetaling kan alleen na betaling, vóórdat het product is gekocht');
  end if;

  if v_order.problem_type is null then
    return json_build_object('ok', false, 'error', 'Annuleren kan alleen als je agent een probleem heeft gemeld');
  end if;

  v_refund := coalesce(v_order.price, v_order.quoted_total, 0);

  if v_refund > 0 then
    update profiles set balance = balance + v_refund where id = v_uid;
    insert into transactions (user_id, amount, type, order_id)
    values (v_uid, v_refund, 'refund', p_order_id);
  end if;

  update orders set status = 'cancelled', problem_type = null where id = p_order_id;

  return json_build_object('ok', true, 'refunded', v_refund);
end;
$$;

grant execute on function public.cancel_paid_order(text) to authenticated;
