-- ============================================================
-- Flowva — RETOUR-OVERZICHT: volg of de fabriek (via BuckyDrop) de retour accepteert
-- en of je je geld terugkrijgt. Vult de "Lopende retouren"-sectie in de admin.
-- De live status komt uit BuckyDrop's return/get (via de buckydrop-gateway, action 'return-get').
-- Voer uit in: Supabase -> SQL Editor -> New query -> plak -> Run.
-- ============================================================

alter table public.orders add column if not exists return_refund_status int;   -- 1 niet / 2 bezig / 3 terugbetaald / 4 mislukt (BuckyDrop refundStatus)
alter table public.orders add column if not exists return_get_status int;       -- BuckyDrop return/get top-level status
alter table public.orders add column if not exists return_refund_amount numeric;
alter table public.orders add column if not exists return_checked_at timestamptz;

-- Lijst van alle retouren die we openden (alleen admin).
create or replace function public.admin_list_returns()
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  return json_build_object('ok', true, 'returns', coalesce((
    select jsonb_agg(to_jsonb(d)) from (
      select o.id, o.product, o.product_title,
             coalesce(o.quoted_total, o.price, 0) as amount,
             o.return_reason, o.return_status, o.return_flow_code, o.return_requested_at,
             o.return_refund_status, o.return_get_status, o.return_refund_amount, o.return_checked_at
      from public.orders o
      where o.return_status is not null
      order by o.return_requested_at desc nulls last, o.id desc
    ) d
  ), '[]'::jsonb));
end;
$$;

-- Bewaar de bij BuckyDrop opgehaalde retour-status op de order (alleen admin).
create or replace function public.admin_save_return_status(p_order_id text, p_refund_status int, p_get_status int, p_refund_amount numeric)
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  update public.orders
    set return_refund_status = p_refund_status,
        return_get_status = p_get_status,
        return_refund_amount = p_refund_amount,
        return_checked_at = now()
    where id = p_order_id;
  return json_build_object('ok', true);
end;
$$;

grant execute on function public.admin_list_returns() to authenticated;
grant execute on function public.admin_save_return_status(text, int, int, numeric) to authenticated;
