-- ============================================================
-- SupplyFlow — magazijn-opslagkosten + verbeuring (abandonment)
-- Reeds toegepast op de database (via migraties). Dit bestand is de
-- bron-van-waarheid; opnieuw draaien is veilig (idempotent).
--
-- Model:
--  * 30 dagen gratis opslag (bevestigd bij BuckyDrop).
--  * Daarna CNY 3 / 0,02 m³ per 30 dagen (BuckyDrop "Warehouse Storage
--    30 Days"), volume uit length/width/height_cm, min 0,02 m³, koers 7,8.
--    Wordt automatisch van het klant-saldo afgeschreven.
--  * Kan de klant het niet betalen → hold + waarschuwperiode (10 dagen) →
--    verbeurd (~dag 40). Harde grens: dag 90 → altijd verbeurd.
--  * Verbeurd (status 'forfeited'): klant heeft het product al betaald
--    (geen refund), goederen blijven in China → admin resale-lijst.
-- ============================================================

alter table public.orders add column if not exists arrived_at             timestamptz;
alter table public.orders add column if not exists storage_blocks_charged int not null default 0;
alter table public.orders add column if not exists storage_hold_since     timestamptz;
alter table public.orders add column if not exists forfeited_at           timestamptz;

-- Legacy items in het magazijn: klok start NU (geen kosten met terugwerkende kracht).
update public.orders set arrived_at = now()
 where status = 'qc_pending' and arrived_at is null;

create or replace function public.process_warehouse_storage()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_elapsed    int;
  v_blocks_due int;
  v_units      int;
  v_block_cost numeric;
  v_need       numeric;
  v_balance    numeric;
  c_koers      constant numeric := 7.8;
  c_free_days  constant int := 30;
  c_block_days constant int := 30;
  c_grace_days constant int := 10;
  c_hard_days  constant int := 90;
begin
  for r in
    select id, user_id, arrived_at, storage_blocks_charged, storage_hold_since,
           length_cm, width_cm, height_cm
      from orders
     where status = 'qc_pending' and arrived_at is not null
  loop
    v_elapsed := floor(extract(epoch from (now() - r.arrived_at)) / 86400)::int;

    if v_elapsed >= c_hard_days then
      update orders set status = 'forfeited', forfeited_at = now() where id = r.id;
      continue;
    end if;

    if v_elapsed < c_free_days then
      continue;
    end if;

    v_units := greatest(1, ceil(
      greatest(0.02, coalesce(r.length_cm,0)*coalesce(r.width_cm,0)*coalesce(r.height_cm,0) / 1000000.0) / 0.02
    )::int);
    v_block_cost := round((v_units * 3.0) / c_koers, 2);

    v_blocks_due := ceil((v_elapsed - c_free_days)::numeric / c_block_days)::int;

    if v_blocks_due > r.storage_blocks_charged then
      v_need := v_block_cost * (v_blocks_due - r.storage_blocks_charged);
      select coalesce(balance,0) into v_balance from profiles where id = r.user_id;

      if v_balance >= v_need then
        update profiles set balance = balance - v_need where id = r.user_id;
        insert into transactions (user_id, amount, type, order_id)
          values (r.user_id, -v_need, 'storage_fee', r.id::text);
        update orders set storage_blocks_charged = v_blocks_due, storage_hold_since = null where id = r.id;
      else
        if r.storage_hold_since is null then
          update orders set storage_hold_since = now() where id = r.id;
        elsif now() - r.storage_hold_since >= make_interval(days => c_grace_days) then
          update orders set status = 'forfeited', forfeited_at = now() where id = r.id;
        end if;
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function public.process_warehouse_storage() from public, anon, authenticated;

-- Dagelijkse run om 03:00 via pg_cron.
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('warehouse-storage-daily'); exception when others then null; end $$;
select cron.schedule('warehouse-storage-daily', '0 3 * * *', 'select public.process_warehouse_storage();');

-- Admin-lijst: vergeten / teruggewonnen voorraad (verbeurde items) voor resale.
create or replace function public.admin_list_reclaimed()
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'Alleen admins');
  end if;
  return json_build_object('ok', true, 'items', coalesce((
    select json_agg(json_build_object(
      'id', o.id,
      'product', coalesce(o.product_title, o.product),
      'image', o.variant_image,
      'qty', o.qty,
      'kleur', o.kleur,
      'arrived_at', o.arrived_at,
      'forfeited_at', o.forfeited_at
    ) order by o.forfeited_at desc)
    from orders o where o.status = 'forfeited'
  ), '[]'::json));
end;
$$;

grant execute on function public.admin_list_reclaimed() to authenticated;
