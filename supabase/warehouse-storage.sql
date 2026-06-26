-- ============================================================
-- SupplyFlow — magazijn-opslag + verbeuring (abandonment)
-- Reeds toegepast op de database. Bron-van-waarheid; opnieuw draaien veilig.
--
-- Model (besloten met user, 2026-06-26):
--  * 30 dagen gratis opslag (bevestigd bij BuckyDrop).
--  * Opslag wordt NIET automatisch van het saldo afgeschreven. De admin krijgt
--    van BuckyDrop het werkelijke opslagbedrag en rekent dit bij VERZENDING af
--    via een quote (internationale verzending + opslag, "vandaag geldig").
--  * Op dag 30 krijgt de klant een in-app melding (afgeleid uit arrived_at,
--    in de klant-app — geen DB-trigger nodig).
--  * De klant heeft 90 dagen om te verzenden. Verzendt 'ie niet → na dag 90
--    automatisch verbeurd (deze functie, dagelijks via pg_cron).
--  * Betaalt de klant de opslag-quote niet → verzending gaat niet door en het
--    item wordt verbeurd (in de quote-flow, niet hier).
--  * Verbeurd (status 'forfeited'): klant heeft het product al betaald
--    (geen refund), goederen blijven in China → admin resale-lijst.
-- ============================================================

alter table public.orders add column if not exists arrived_at   timestamptz;
alter table public.orders add column if not exists forfeited_at timestamptz;
-- (storage_blocks_charged / storage_hold_since bestaan nog van de vorige opzet,
--  maar worden niet meer gebruikt nu opslag via een quote loopt.)

-- Legacy items in het magazijn: klok start NU (geen verbeuring met terugwerkende kracht).
update public.orders set arrived_at = now()
 where status = 'qc_pending' and arrived_at is null;

-- Dagelijkse motor: alleen verbeuring na 90 dagen (klant verstuurde niet).
create or replace function public.process_warehouse_storage()
returns void language plpgsql security definer set search_path = public as $$
begin
  update orders
     set status = 'forfeited', forfeited_at = now()
   where status = 'qc_pending'
     and arrived_at is not null
     and now() - arrived_at >= make_interval(days => 90);
end;
$$;

revoke execute on function public.process_warehouse_storage() from public, anon, authenticated;

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
