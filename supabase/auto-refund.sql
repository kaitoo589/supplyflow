-- ============================================================
-- Flowva — automatische refund als BuckyDrop een bestelling weigert
-- (bijv. uitverkocht). Wordt server-side aangeroepen door de edge function
-- place-bucky-order (service role). NIET door klanten aanroepbaar.
--
-- Refundt de productprijs naar het saldo + transactie-log, zet de order op
-- 'cancelled'. Als de hele aanvraaggroep geannuleerd is, gaat ook de
-- service fee één keer terug.
--
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- ============================================================

create or replace function public.refund_order(p_order_id text, p_reason text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_line numeric;
  v_group text;
  v_remaining int;
  v_fee record;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'order not found'); end if;
  if v_order.status = 'cancelled' then return json_build_object('ok', true, 'already', true); end if;

  v_line := coalesce(v_order.quoted_total, v_order.price, 0);

  -- 1) Productprijs terug naar de klant.
  if v_line > 0 then
    update profiles set balance = balance + v_line where id = v_order.user_id;
    insert into transactions (user_id, amount, type, order_id)
    values (v_order.user_id, v_line, 'refund', p_order_id);
  end if;

  -- 2) Order annuleren + reden vastleggen.
  update orders set status = 'cancelled', bd_error = p_reason where id = p_order_id;

  -- 3) Is de hele aanvraaggroep nu geannuleerd? Dan ook de service fee terug (één keer).
  v_group := v_order.request_group_id;
  if v_group is not null then
    select count(*) into v_remaining from orders
      where request_group_id = v_group and status <> 'cancelled';
    if v_remaining = 0 then
      select t.* into v_fee from transactions t
        join orders o on o.id = t.order_id
        where t.type = 'service_fee' and o.request_group_id = v_group
        limit 1;
      if found and not exists (
        select 1 from transactions where type = 'fee_refund' and order_id = v_fee.order_id
      ) then
        update profiles set balance = balance + abs(v_fee.amount) where id = v_order.user_id;
        insert into transactions (user_id, amount, type, order_id)
        values (v_order.user_id, abs(v_fee.amount), 'fee_refund', v_fee.order_id);
      end if;
    end if;
  end if;

  return json_build_object('ok', true, 'refunded', v_line);
end;
$$;

-- Alleen server-side (edge function via service role) — niet door klanten.
revoke all on function public.refund_order(text, text) from public;
grant execute on function public.refund_order(text, text) to service_role;
