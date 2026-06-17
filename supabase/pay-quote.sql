-- ============================================================
-- SupplyFlow — veilige offerte-betaling + variant-foto op orders
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- ============================================================

-- 1) Onthoud de gekozen variant-foto bij de aankoop
alter table public.orders add column if not exists variant_image text;

-- 2) Betaalfunctie: checkt balance, trekt af, logt transactie en
--    zet de order op "quote_accepted" — alles in één veilige stap.
--    (security definer = draait met databaserechten, dus RLS kan de
--    balance-update niet meer stilletjes blokkeren.)
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

  -- Lock de profielrij zodat dubbel betalen onmogelijk is
  select balance into v_balance from profiles where id = v_uid for update;

  if coalesce(v_balance, 0) < v_order.quoted_total then
    return json_build_object('ok', false, 'error', 'Onvoldoende balance');
  end if;

  update profiles set balance = balance - v_order.quoted_total where id = v_uid;

  insert into transactions (user_id, amount, type, order_id)
  values (v_uid, -v_order.quoted_total, 'order', p_order_id);

  update orders set
    status = 'quote_accepted',
    quote_accepted_at = now(),
    price = v_order.quoted_total
  where id = p_order_id;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.pay_quote(text) to authenticated;
