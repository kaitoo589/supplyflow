-- ============================================================
-- Flowva — vult automatisch orders.weight_grams uit BuckyDrop order-detail (skuWeight)
-- zodra een item in het magazijn aankomt (status -> qc_pending). Zo hoeft de admin het
-- gewicht niet meer handmatig in te typen en kan de klant meteen verzending afrekenen.
--
-- VEREIST: extensie pg_net aan. Vervang PLAK_HIER_JE_WEBHOOK_SECRET door DEZELFDE waarde
-- als de WEBHOOK_SECRET-secret van je edge functions (zelfde als in returns.sql).
-- Voer uit in: Supabase -> SQL Editor -> New query -> plak -> Run.
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
