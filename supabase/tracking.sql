-- ============================================================================
-- Flowva — LIVE TRACKING (poll-model)
-- Eén keer draaien in de Supabase SQL Editor. Additief + idempotent.
--
-- Wat dit doet:
--   1. Voegt tracking-kolommen toe aan `hauls` (het klant-pakket).
--   2. Pikt automatisch de BuckyDrop `packageCode` op uit elke parcel-notificatie
--      (die de webhook al rauw wegschrijft in bucky_notifications) en koppelt 'm
--      aan het juiste pakket — zónder de webhook-function te hoeven aanpassen.
--
-- De cron-functie `track-haul` (apart) pollt daarna logistics/query-info en vult
-- trace_status / trace_nodes / carrier. De klant-app leest dit uit de DB.
-- ============================================================================

alter table public.hauls add column if not exists package_code        text;
alter table public.hauls add column if not exists tracking_no          text;
alter table public.hauls add column if not exists carrier_name         text;
alter table public.hauls add column if not exists carrier_link         text;
alter table public.hauls add column if not exists trace_status         int;
alter table public.hauls add column if not exists trace_nodes          jsonb;
alter table public.hauls add column if not exists tracking_updated_at  timestamptz;
create index if not exists hauls_package_code_idx on public.hauls(package_code);

-- Auto-capture: zodra een parcel-notificatie met een packageCode binnenkomt,
-- koppel die aan het pakket (haul) via de order-ids in partnerOrderNoList.
create or replace function public.capture_package_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_pkg text;
  v_ids text[];
begin
  v_pkg := coalesce(
    NEW.payload->'notifyHeader'->>'packageCode',
    NEW.payload->'notifyBody'->>'packageCode'
  );
  if v_pkg is null or v_pkg = '' then
    return NEW;
  end if;

  select array(
    select jsonb_array_elements_text(
      coalesce(NEW.payload->'notifyBody'->'partnerOrderNoList', '[]'::jsonb)
    )
  ) into v_ids;
  if v_ids is null or array_length(v_ids, 1) is null then
    return NEW;
  end if;

  update hauls h
     set package_code = v_pkg
   where h.package_code is null
     and exists (
       select 1 from haul_items hi
        where hi.haul_id = h.id and hi.order_id::text = any(v_ids)
     );
  return NEW;
end;
$$;

drop trigger if exists trg_capture_package_code on public.bucky_notifications;
create trigger trg_capture_package_code
  after insert on public.bucky_notifications
  for each row execute function public.capture_package_code();
