-- ============================================================
-- Flowva — QC-sync (edge function `fetch-weight`, v36+)
--
-- Vult automatisch uit BuckyDrop order-detail (queryPoServiceResult=true):
--   • orders.weight_grams + length/width/height_cm  (skuWeight/skuLong/skuWide/skuHeight)
--   • orders.qc_images            (QC-/productfoto's, gerehost naar eigen storage qc/{order}/)
--   • orders.measurement_images   (Garment Measurement Service-foto's)
--   • order-status vooruit        (PO-status 5/6/9/11/12 → bought/shipped_local/qc_pending/…)
--   • defect-vlag                 (dispute_status='bucky_flagged' bij fail-status MÉT foto's
--                                  of PO-confirmType; geannuleerde taken (CANCEL/REJECT bij een
--                                  retour) zijn GEEN defect — geleerd van echte data 2026-07-10)
--
-- Drie aanroepen (allemaal met x-webhook-secret):
--   1. pg_net-trigger hieronder ({record})  — vuurt bij status → qc_pending
--   2. pg_cron 'qc-sync-sweep' ({sweep})    — elk kwartier vangnet (migratie qc_sync_sweep_cron;
--      het secret wordt daar server-side uit trigger_fetch_weight gelezen)
--   3. handmatig ({order_id, debug})        — test/inspectie
--
-- VEREIST: pg_net + pg_cron aan. Vervang PLAK_HIER_JE_WEBHOOK_SECRET door DEZELFDE waarde
-- als de WEBHOOK_SECRET-secret van je edge functions.
-- ============================================================

create or replace function public.trigger_fetch_weight()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://bjtpnuxjbazlbaoyflcx.supabase.co/functions/v1/fetch-weight',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', 'PLAK_HIER_JE_WEBHOOK_SECRET'
    ),
    body := jsonb_build_object('record', to_jsonb(new))
  );
  return new;
end;
$$;

drop trigger if exists fetch_weight_trg on public.orders;
create trigger fetch_weight_trg
  after update on public.orders
  for each row
  when (new.status = 'qc_pending' and old.status is distinct from 'qc_pending' and new.weight_grams is null)
  execute function public.trigger_fetch_weight();

-- Kwartier-sweep (staat live als migratie qc_sync_sweep_cron; hier ter referentie):
-- do $$
-- declare s text; cmd text;
-- begin
--   select substring(prosrc from '''x-webhook-secret'',\s*''([^'']+)''') into s
--   from pg_proc where proname = 'trigger_fetch_weight' limit 1;
--   perform cron.unschedule(jobid) from cron.job where jobname = 'qc-sync-sweep';
--   cmd := format($f$select net.http_post(
--     url := 'https://bjtpnuxjbazlbaoyflcx.supabase.co/functions/v1/fetch-weight',
--     headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', %L),
--     body := '{"sweep":true}'::jsonb);$f$, s);
--   perform cron.schedule('qc-sync-sweep', '*/15 * * * *', cmd);
-- end $$;
