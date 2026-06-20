-- ============================================================================
-- FLOWVA FRIENDS — Fase 4: social/realtime (chat, reacties, delen, realtime)
-- ============================================================================
-- Bouwt voort op flowva-friends.sql (Fase 1). Voegt een groepschat + reacties toe,
-- een "deel item in de chat"-kaart, en zet de FF-tabellen op de realtime-publicatie
-- zodat de lobby live update (vervangt de 4s-polling uit Fase 3b).
--
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run. Idempotent.
-- ============================================================================

-- ── Chatberichten ────────────────────────────────────────────────────────────
create table if not exists public.flowva_group_messages (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.flowva_groups(id) on delete cascade,
  user_id    uuid references auth.users(id),                 -- null = systeembericht
  kind       text not null default 'chat' check (kind in ('chat','system','share')),
  body       text,
  item_id    uuid,                                           -- bij 'share': verwijst naar een group-item
  reactions  jsonb not null default '{}'::jsonb,             -- { "🔥": ["uid",…], "❤️": […] }
  created_at timestamptz not null default now()
);
create index if not exists ff_msgs_group_idx on public.flowva_group_messages(group_id, created_at);

alter table public.flowva_group_messages enable row level security;
drop policy if exists ff_msgs_read on public.flowva_group_messages;
create policy ff_msgs_read on public.flowva_group_messages
  for select to authenticated using (public.ff_is_member(group_id));
-- (geen insert/update-policies → schrijven enkel via RPC's)

-- ── Bericht plaatsen ─────────────────────────────────────────────────────────
create or replace function public.ff_post_message(p_group_id uuid, p_body text)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid := gen_random_uuid(); v_body text;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  if not public.ff_is_member(p_group_id) then return json_build_object('ok', false, 'error', 'Not a member'); end if;
  v_body := nullif(btrim(p_body), '');
  if v_body is null then return json_build_object('ok', false, 'error', 'Empty message'); end if;
  if length(v_body) > 500 then v_body := left(v_body, 500); end if;
  insert into public.flowva_group_messages(id, group_id, user_id, kind, body)
  values (v_id, p_group_id, v_uid, 'chat', v_body);
  return json_build_object('ok', true, 'id', v_id);
end; $$;

-- ── Item delen in de chat (geeft een "+ voeg toe aan mijn mand"-kaart) ────────
create or replace function public.ff_share_item(p_group_id uuid, p_item_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid := gen_random_uuid();
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  if not public.ff_is_member(p_group_id) then return json_build_object('ok', false, 'error', 'Not a member'); end if;
  if not exists (select 1 from public.flowva_group_items where id = p_item_id and group_id = p_group_id) then
    return json_build_object('ok', false, 'error', 'Item not found'); end if;
  insert into public.flowva_group_messages(id, group_id, user_id, kind, item_id)
  values (v_id, p_group_id, v_uid, 'share', p_item_id);
  return json_build_object('ok', true, 'id', v_id);
end; $$;

-- ── Reactie togglen (één emoji aan/uit per persoon) ──────────────────────────
create or replace function public.ff_react(p_message_id uuid, p_emoji text)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_gid uuid; v_reacts jsonb; v_arr jsonb; v_emoji text;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  v_emoji := left(coalesce(p_emoji, ''), 8);
  if v_emoji = '' then return json_build_object('ok', false, 'error', 'No emoji'); end if;
  select group_id, reactions into v_gid, v_reacts from public.flowva_group_messages where id = p_message_id for update;  -- lock → geen lost-update bij gelijktijdige reacties
  if v_gid is null then return json_build_object('ok', false, 'error', 'Message not found'); end if;
  if not public.ff_is_member(v_gid) then return json_build_object('ok', false, 'error', 'Not a member'); end if;
  v_reacts := coalesce(v_reacts, '{}'::jsonb);
  v_arr := coalesce(v_reacts -> v_emoji, '[]'::jsonb);
  if v_arr @> to_jsonb(v_uid::text) then   -- al gereageerd → eraf
    v_arr := (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements_text(v_arr) e where e <> v_uid::text);
  else
    v_arr := v_arr || to_jsonb(v_uid::text);
  end if;
  if jsonb_array_length(v_arr) = 0 then v_reacts := v_reacts - v_emoji;
  else v_reacts := jsonb_set(v_reacts, array[v_emoji], v_arr); end if;
  update public.flowva_group_messages set reactions = v_reacts where id = p_message_id;
  return json_build_object('ok', true);
end; $$;

-- ── Realtime: zet de FF-tabellen op de publicatie (idempotent + veilig op een
--    DB zonder de publicatie) ─────────────────────────────────────────────────
-- BEWUST GEEN `replica identity full`: bij postgres_changes past Realtime GEEN RLS
-- toe op DELETE-events, dus een full old-row zou velden (held_amount, prijzen, PII)
-- naar een ex-lid kunnen lekken. Met de standaard replica identity draagt een DELETE
-- alleen de PK → niets gevoeligs. De client ververst toch via de begeleidende
-- INSERT/UPDATE-events (RLS-gefilterd) + de 15s-fallback, dus DELETE hoeven we niet.
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='flowva_groups') then
    alter publication supabase_realtime add table public.flowva_groups; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='flowva_group_members') then
    alter publication supabase_realtime add table public.flowva_group_members; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='flowva_group_items') then
    alter publication supabase_realtime add table public.flowva_group_items; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='flowva_group_messages') then
    alter publication supabase_realtime add table public.flowva_group_messages; end if;
end $$;

-- ── Nudge-rate-limit (server-side, tegen push-spam) ──────────────────────────
-- Alleen de ff-nudge edge function (service role) leest/schrijft dit. RLS aan, geen
-- policies → de client kan er niet bij.
create table if not exists public.ff_nudge_log (
  id         uuid primary key default gen_random_uuid(),
  caller_id  uuid not null,
  target_id  uuid not null,
  group_id   uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists ff_nudge_log_idx on public.ff_nudge_log(caller_id, target_id, group_id, created_at);
alter table public.ff_nudge_log enable row level security;

-- ── Rechten ──────────────────────────────────────────────────────────────────
grant execute on function public.ff_post_message(uuid, text) to authenticated;
grant execute on function public.ff_share_item(uuid, uuid)   to authenticated;
grant execute on function public.ff_react(uuid, text)        to authenticated;
