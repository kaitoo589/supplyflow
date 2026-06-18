-- ============================================================
-- Flowva × BuckyDrop — F3: trigger die automatisch een bestelling plaatst
-- zodra een klant betaalt (orders.status → 'quote_accepted').
--
-- VEREIST: extensie pg_net aan (Supabase → Database → Extensions → pg_net).
-- Voer daarna uit in: Supabase → SQL Editor → New query → Run.
-- Vervang PLAK_HIER_JE_WEBHOOK_SECRET door dezelfde waarde als de
-- WEBHOOK_SECRET-secret van je edge functions.
-- ============================================================

create or replace function public.trigger_place_bucky_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://bjtpnuxjbazlbaoyflcx.supabase.co/functions/v1/place-bucky-order',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', 'PLAK_HIER_JE_WEBHOOK_SECRET'
    ),
    body := jsonb_build_object('type', 'UPDATE', 'record', to_jsonb(new), 'old_record', to_jsonb(old))
  );
  return new;
end;
$$;

drop trigger if exists place_bucky_order_trg on public.orders;
create trigger place_bucky_order_trg
  after update on public.orders
  for each row
  when (new.status = 'quote_accepted' and old.status is distinct from 'quote_accepted')
  execute function public.trigger_place_bucky_order();
