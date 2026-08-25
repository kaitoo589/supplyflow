-- ============================================================
-- Flowva — Trustpilot-review-mail (25-08): één mail per bezorgd pakket.
-- GEDEPLOYED via migration review_mail_cron_v2 — dit bestand is de administratie.
--
-- Werking: hauls.review_mailed_at = stempel/claim. De cron (elk uur op :25)
-- roept de edge function review-mail aan; die pakt hauls met trace_status 3
-- (delivered) zonder stempel, mailt de klant via Resend (neutraal, "good or
-- bad", nooit een beloning — Trustpilot-regels) en stempelt. Interne accounts
-- (profiles.is_intern) krijgen alleen de stempel, geen mail. Mislukt Resend,
-- dan gaat de stempel terug en probeert de volgende run het opnieuw.
--
-- VEREIST (secrets van de edge functions): RESEND_API_KEY (+ optioneel
-- RESEND_FROM, standaard "Flowva <noreply@flowva.app>") en WEBHOOK_SECRET
-- (bestond al, zelfde als notify-order).
--
-- Het webhook-geheim in de cron-opdracht is bij het aanmaken IN de database
-- gekopieerd uit notify_order_status_change (regexp op pg_get_functiondef) —
-- het heeft de database nooit verlaten.
-- ============================================================

alter table public.hauls add column if not exists review_mailed_at timestamptz;

-- Al-bezorgde pakketten van vóór de feature: markeren als afgehandeld,
-- zodat niemand met terugwerkende kracht een mail krijgt.
update public.hauls set review_mailed_at = now() where trace_status = 3 and review_mailed_at is null;

do $$
declare geheim text;
begin
  select (regexp_match(pg_get_functiondef('public.notify_order_status_change()'::regprocedure),
    '''x-webhook-secret'',\s*''([^'']+)'''))[1] into geheim;
  if geheim is null or geheim like 'PLAK_HIER%' then
    raise exception 'Geen bruikbaar webhook-geheim gevonden in notify_order_status_change';
  end if;
  begin
    perform cron.unschedule('review-mail-hourly');
  exception when others then null;
  end;
  perform cron.schedule('review-mail-hourly', '25 * * * *', format(
    $c$select net.http_post(
      url := 'https://bjtpnuxjbazlbaoyflcx.supabase.co/functions/v1/review-mail',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', %L),
      body := '{}'::jsonb
    );$c$, geheim));
end $$;
