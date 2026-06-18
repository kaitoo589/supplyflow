-- ============================================================
-- Flowva × BuckyDrop — F4: tabel die elke binnenkomende notificatie rauw logt.
-- Handig om de échte payload-structuur te zien zodra BuckyDrop live meldt.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- ============================================================

create table if not exists public.bucky_notifications (
  id          bigint generated always as identity primary key,
  received_at timestamptz default now(),
  notify_type text,
  matched     text,        -- welke order(s) gematcht
  action      text,        -- wat we ermee deden
  sign_ok     boolean,     -- handtekening geldig?
  payload     jsonb        -- de volledige melding
);

-- Alleen de edge function (service role) schrijft; geen publieke toegang.
alter table public.bucky_notifications enable row level security;
