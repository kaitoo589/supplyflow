-- ============================================================
-- SupplyFlow supportsysteem — kennisbank + klantvragen + escalatie
-- Uitvoeren in: Supabase dashboard → SQL Editor → New query → Run
-- ============================================================

-- Kennisbank: één rij per beantwoorde vraag(cluster)
create table if not exists support_kb (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  answer text not null,
  times_used int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Elke klantvraag uit de chatwidget
create table if not exists support_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  question text not null,
  page_context text,
  status text not null default 'pending'
    check (status in ('pending', 'answered', 'escalated', 'closed')),
  answer text,
  answered_by text check (answered_by in ('ai', 'admin')),
  kb_entry_id uuid references support_kb (id) on delete set null,
  xp_claimed boolean not null default false,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create index if not exists support_questions_status_idx on support_questions (status, created_at desc);
create index if not exists support_questions_user_idx on support_questions (user_id, created_at desc);

-- Helper: is de ingelogde gebruiker admin?
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- RLS
alter table support_kb enable row level security;
alter table support_questions enable row level security;

-- Kennisbank: alleen admin leest/schrijft via de client.
-- (De edge function gebruikt de service role en omzeilt RLS.)
drop policy if exists kb_admin_all on support_kb;
create policy kb_admin_all on support_kb
  for all using (is_admin()) with check (is_admin());

-- Vragen: klant mag eigen vragen aanmaken en lezen
drop policy if exists questions_insert_own on support_questions;
create policy questions_insert_own on support_questions
  for insert with check (auth.uid() = user_id);

drop policy if exists questions_select_own on support_questions;
create policy questions_select_own on support_questions
  for select using (auth.uid() = user_id or is_admin());

-- Alleen admin mag vragen bijwerken (beantwoorden/sluiten)
drop policy if exists questions_admin_update on support_questions;
create policy questions_admin_update on support_questions
  for update using (is_admin()) with check (is_admin());

-- Realtime: klant ziet het antwoord live binnenkomen in de widget
alter publication supabase_realtime add table support_questions;
