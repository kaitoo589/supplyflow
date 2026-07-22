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

-- ═══════════════════════════════════════════════════════════════════════
-- ADDENDUM (2026-07-22) — NIEUW OPSLAGMODEL: vaste fee i.p.v. quote
-- (Al toegepast via MCP — dit bestand is de administratie.)
--
-- User-beslissing: de opslag-quote-flow (storage_quotes + StorageQuoteFlow)
-- is VERVALLEN. Nieuw model:
--   * 0-30 dagen  : gratis (teller in de app, ongewijzigd).
--   * 31-60 dagen : €2 per stuk, als vaste regel "Extended storage" bij verzenden.
--   * 61-90 dagen : €4 per stuk.
--   * Dag 80      : eenmalige Flowva support-waarschuwing ("verzend nu").
--   * Dag 90      : automatisch verbeurd (ongewijzigd, cron hieronder).
-- Dekt de BuckyDrop-verlenging (¥3/stuk per 30 dagen) + marge. LET OP voor de
-- admin: BuckyDrop laat een pakket met een verlopen item pas verzenden nadat
-- je in hun dashboard de Extend Storage Period (¥3) hebt gekocht.
-- storage_quotes-tabel + RPC's + OPSLAG-tab blijven bestaan maar zijn dood.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.support_messages drop constraint if exists support_messages_template_key_check;
alter table public.support_messages add constraint support_messages_template_key_check
  check (template_key in ('delay','never_shipped','unavailable','unknown_refund',
    'refund_accepted','deny_ok_item','deny_change_mind','deny_size_match',
    'deny_minor_variation','deny_evidence','custom','storage_warning'));

-- pay_shipping_buffered: + extended-storage fee, server-side uit arrived_at
-- (eigen transactietype 'storage_fee' = marge, wordt nooit mee-gerefund met de
-- verzendverrekening; telt NIET mee in de 3%-valutabasis). Volledige definitie
-- staat live; wijziging t.o.v. fee-move-fase1.sql:
--   v_storage_fee := som per item ( >60d → €4 · >30d → €2 · anders €0 ) × qty
--   v_charge      := ... + v_storage_fee
--   insert transactions ('storage_fee') als v_storage_fee > 0
--   json-resultaat bevat 'storage_fee'

-- Dagelijkse motor: dag-80-waarschuwing + dag-90-verbeuring.
create or replace function public.process_warehouse_storage()
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Waarschuwing (user 2026-07-22): 80+ dagen in het magazijn en nog niet verzonden →
  -- één Flowva support-bericht ("verzend nu, anders verbeurd op dag 90").
  insert into support_messages (user_id, order_id, product_title, template_key, group_name)
  select o.user_id, o.id, coalesce(o.product_title, o.product), 'storage_warning', g.name
    from orders o
    left join flowva_groups g on g.id = o.ff_group_id
   where o.status = 'qc_pending'
     and o.arrived_at is not null
     and now() - o.arrived_at >= make_interval(days => 80)
     and not exists (select 1 from support_messages sm where sm.order_id = o.id and sm.template_key = 'storage_warning');

  -- Verbeuring na 90 dagen (ongewijzigd).
  update orders
     set status = 'forfeited', forfeited_at = now()
   where status = 'qc_pending'
     and arrived_at is not null
     and now() - arrived_at >= make_interval(days => 90);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- ADDENDUM 2 (2026-07-22) — NL-KALENDERDAGEN + dag-60/90/verbeurd-berichten
-- (Al toegepast via MCP — dit bestand is de administratie.)
--
-- User-regels: de opslag-dag telt in KALENDERDAGEN op NL-tijd — de dag van
-- aankomst in het magazijn is dag 1 (ongeacht het tijdstip), en elke NL-
-- middernacht telt er één bij. Dag 30 is nog een volle gratis dag.
--   dag 1-30  : gratis
--   dag 31-60 : €2/stuk (Extended storage, bij verzenden)
--   dag 60    : Flowva support-bericht 'storage_month_left' (nog één maand)
--   dag 61-90 : €4/stuk
--   dag 90    : Flowva support-bericht 'storage_warning' (LAATSTE dag)
--   dag 91    : verbeurd + Flowva support-bericht 'storage_forfeited';
--               item blijft grijs zichtbaar in orderlijst + pakket ("Item
--               forfeited"), telt nergens mee, Confirm & ship werkt gewoon.
-- De oude opslag-belmeldingen in de app zijn VERVANGEN door deze support-
-- berichten. Fees per persoon, óók in Friends (ff_pay_group_shipping).
--
-- Live gewijzigd:
--  * nieuwe helper public.storage_day(timestamptz) → NL-dag (aankomst = 1)
--  * pay_shipping_buffered + ff_pay_group_shipping + ff_group_shipping_state:
--    staffel op storage_day (>=31 → €2, >=61 → €4) i.p.v. 24-uurs-intervallen
--  * support_messages-constraint + 'storage_month_left' / 'storage_forfeited'
--  * process_warehouse_storage(): drie insert-stappen (dag 60 / dag 90 /
--    verbeurd-bericht) + forfeit op storage_day >= 91
--  * cron 'warehouse-storage-daily' verplaatst naar 22:10 UTC (= 00:10 NL
--    in de zomer, vlak na de dag-flip; in de winter 23:10 — dan loopt de
--    verwerking max. een dag-deel achter, nooit voor).
-- ═══════════════════════════════════════════════════════════════════════
