-- Flowva — herroepings-/annuleringsverzoeken (EU-herroepingsknop, zonder login).
-- De publieke edge function `withdrawal-request` schrijft hierin (service role);
-- admins mogen lezen.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
create table if not exists public.withdrawal_requests (
  id           bigint generated always as identity primary key,
  created_at   timestamptz default now(),
  name         text not null,
  order_number text not null,
  email        text not null,
  message      text,
  status       text default 'new'
);
alter table public.withdrawal_requests enable row level security;

drop policy if exists "admins read withdrawals" on public.withdrawal_requests;
create policy "admins read withdrawals" on public.withdrawal_requests
  for select using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
