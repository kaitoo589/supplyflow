-- ============================================================
-- Flowva — trigger die push-meldingen aanzwengelt bij statuswijziging.
-- Alternatief voor de dashboard "Database Webhook" (die de supabase_functions-
-- schema nodig heeft). Dit gebruikt pg_net direct.
--
-- VEREIST: extensie pg_net aan (Supabase → Database → Extensions → pg_net).
-- Voer daarna uit in: Supabase → SQL Editor → New query → Run.
-- ============================================================

create or replace function public.notify_order_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://bjtpnuxjbazlbaoyflcx.supabase.co/functions/v1/notify-order',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', 'PLAK_HIER_JE_WEBHOOK_SECRET'  -- zelfde waarde als de WEBHOOK_SECRET-secret
    ),
    body := jsonb_build_object('type', 'UPDATE', 'record', to_jsonb(new), 'old_record', to_jsonb(old))
  );
  return new;
end;
$$;

drop trigger if exists notify_order_status_trg on public.orders;
create trigger notify_order_status_trg
  after update on public.orders
  for each row when (old.status is distinct from new.status)
  execute function public.notify_order_status_change();
