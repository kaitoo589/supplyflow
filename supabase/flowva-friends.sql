-- ============================================================================
-- FLOWVA FRIENDS — Fase 1: datamodel + backend-functies (group/social buying)
-- ============================================================================
-- Veilig patroon (zoals pay_cart): de client mag ALLEEN lezen binnen z'n eigen
-- groepen (RLS SELECT). Elke MUTATIE loopt via een SECURITY DEFINER-functie die
-- de regels afdwingt. Geen directe insert/update/delete vanaf de client.
-- Geld/ready-up komt in Fase 3 — dit fundament is "inert": de live app raakt het
-- pas zodra we de Friends-UI aankoppelen.

-- ── Tabellen ────────────────────────────────────────────────────────────────
create table if not exists public.flowva_groups (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default 'Squad',
  admin_id      uuid not null references auth.users(id),     -- maker = admin (zet settings)
  host_id       uuid not null references auth.users(id),     -- bezorg-adres-ontvanger (apart van admin)
  max_size      int  not null default 5,                     -- 2..7
  join_mode     text not null default 'open' check (join_mode in ('open','approve')),
  status        text not null default 'gathering' check (status in ('gathering','placed','shipped','arrived','closed','cancelled','expired')),
  invite_code   text not null unique,                        -- korte deelbare code (link)
  request_group_id text,                                     -- koppelt aan orders zodra geplaatst (Fase 3)
  fill_deadline timestamptz,                                 -- timer om vol te lopen
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.flowva_group_members (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.flowva_groups(id) on delete cascade,
  user_id     uuid not null references auth.users(id),
  role        text not null default 'member' check (role in ('admin','member')),
  ready       boolean not null default false,                -- Fase 3: ready-up
  held_amount numeric not null default 0,                    -- Fase 3: vastgehouden bedrag
  joined_at   timestamptz not null default now(),
  unique (group_id, user_id)
);

create table if not exists public.flowva_group_items (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.flowva_groups(id) on delete cascade,
  owner_id      uuid not null references auth.users(id),      -- van wie is dit item
  source_url    text,
  product_title text,
  platform      text,
  price         numeric,                                     -- indicatief; pay_cart leidt server-side af
  qty           int not null default 1,
  kleur         text,
  variant_image text,
  opmerking     text,
  created_at    timestamptz not null default now()
);

create index if not exists ff_members_group_idx on public.flowva_group_members(group_id);
create index if not exists ff_members_user_idx  on public.flowva_group_members(user_id);
create index if not exists ff_items_group_idx   on public.flowva_group_items(group_id);

-- ── Lidmaatschap-helper (SECURITY DEFINER → voorkomt RLS-recursie) ───────────
create or replace function public.ff_is_member(p_group uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.flowva_group_members m
    where m.group_id = p_group and m.user_id = auth.uid()
  );
$$;

-- ── RLS: alleen LEZEN binnen je eigen groepen; schrijven kan enkel via RPC's ──
alter table public.flowva_groups        enable row level security;
alter table public.flowva_group_members enable row level security;
alter table public.flowva_group_items   enable row level security;

drop policy if exists ff_groups_read   on public.flowva_groups;
drop policy if exists ff_members_read   on public.flowva_group_members;
drop policy if exists ff_items_read     on public.flowva_group_items;

create policy ff_groups_read  on public.flowva_groups
  for select to authenticated using (public.ff_is_member(id));
create policy ff_members_read on public.flowva_group_members
  for select to authenticated using (public.ff_is_member(group_id));
create policy ff_items_read   on public.flowva_group_items
  for select to authenticated using (public.ff_is_member(group_id));
-- (geen insert/update/delete-policies → RLS weigert directe writes; RPC's bypassen RLS)

-- ============================================================================
-- RPC's (alle SECURITY DEFINER, dwingen de regels af)
-- ============================================================================

-- Maak een groep. Maker = admin, en standaard ook host (aanpasbaar). Genereert code.
create or replace function public.ff_create_group(
  p_name text default 'Squad', p_max_size int default 5, p_join_mode text default 'open')
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid := gen_random_uuid(); v_code text; v_size int;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  v_size := least(greatest(coalesce(p_max_size, 5), 2), 7);
  loop
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from flowva_groups where invite_code = v_code);
  end loop;
  insert into flowva_groups(id, name, admin_id, host_id, max_size, join_mode, status, invite_code, fill_deadline)
  values (v_id, coalesce(nullif(trim(p_name), ''), 'Squad'), v_uid, v_uid, v_size,
          case when p_join_mode in ('open', 'approve') then p_join_mode else 'open' end,
          'gathering', v_code, now() + interval '48 hours');
  insert into flowva_group_members(group_id, user_id, role) values (v_id, v_uid, 'admin');
  return json_build_object('ok', true, 'group_id', v_id, 'invite_code', v_code);
end; $$;

-- Join via invite-code. Checkt: bestaat, nog 'gathering', niet vol, niet al lid.
-- Roster wijzigt → ready van iedereen reset (fee-tier verandert).
create or replace function public.ff_join_group(p_invite_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_g flowva_groups%rowtype; v_count int;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select * into v_g from flowva_groups where invite_code = upper(trim(p_invite_code)) for update;
  if v_g.id is null then return json_build_object('ok', false, 'error', 'Group not found'); end if;
  if v_g.status <> 'gathering' then return json_build_object('ok', false, 'error', 'This group is already closed'); end if;
  if exists (select 1 from flowva_group_members where group_id = v_g.id and user_id = v_uid) then
    return json_build_object('ok', true, 'group_id', v_g.id);  -- al lid → idempotent
  end if;
  select count(*) into v_count from flowva_group_members where group_id = v_g.id;
  if v_count >= v_g.max_size then return json_build_object('ok', false, 'error', 'This group is full'); end if;
  insert into flowva_group_members(group_id, user_id, role) values (v_g.id, v_uid, 'member');
  update flowva_group_members set ready = false where group_id = v_g.id;  -- roster-reset
  update flowva_groups set updated_at = now() where id = v_g.id;
  return json_build_object('ok', true, 'group_id', v_g.id);
end; $$;

-- Verlaat een groep. Admin weg → overdracht aan oudste lid; host weg → terug naar admin;
-- laatste lid weg → groep cancelled. Roster wijzigt → ready-reset.
create or replace function public.ff_leave_group(p_group_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_g flowva_groups%rowtype; v_remaining int; v_new_admin uuid;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select * into v_g from flowva_groups where id = p_group_id;
  if v_g.id is null then return json_build_object('ok', false, 'error', 'Group not found'); end if;
  if not exists (select 1 from flowva_group_members where group_id = p_group_id and user_id = v_uid) then
    return json_build_object('ok', false, 'error', 'Not a member'); end if;
  if v_g.status <> 'gathering' then return json_build_object('ok', false, 'error', 'This group is already closed'); end if;

  delete from flowva_group_items   where group_id = p_group_id and owner_id = v_uid;
  delete from flowva_group_members where group_id = p_group_id and user_id  = v_uid;

  select count(*) into v_remaining from flowva_group_members where group_id = p_group_id;
  if v_remaining = 0 then
    update flowva_groups set status = 'cancelled', updated_at = now() where id = p_group_id;
  else
    if v_g.admin_id = v_uid then
      select user_id into v_new_admin from flowva_group_members where group_id = p_group_id order by joined_at limit 1;
      update flowva_group_members set role = 'admin' where group_id = p_group_id and user_id = v_new_admin;
      update flowva_groups set admin_id = v_new_admin,
        host_id = case when host_id = v_uid then v_new_admin else host_id end, updated_at = now()
        where id = p_group_id;
    elsif v_g.host_id = v_uid then
      update flowva_groups set host_id = admin_id, updated_at = now() where id = p_group_id;
    end if;
    update flowva_group_members set ready = false where group_id = p_group_id;  -- roster-reset
    update flowva_groups set updated_at = now() where id = p_group_id;
  end if;
  return json_build_object('ok', true);
end; $$;

-- Admin kickt een lid (niet zichzelf). Roster wijzigt → ready-reset.
create or replace function public.ff_kick_member(p_group_id uuid, p_user_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_g flowva_groups%rowtype;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select * into v_g from flowva_groups where id = p_group_id;
  if v_g.id is null or v_g.admin_id <> v_uid then return json_build_object('ok', false, 'error', 'Admins only'); end if;
  if v_g.status <> 'gathering' then return json_build_object('ok', false, 'error', 'This group is already closed'); end if;
  if p_user_id = v_uid then return json_build_object('ok', false, 'error', 'Use leave instead'); end if;
  delete from flowva_group_items   where group_id = p_group_id and owner_id = p_user_id;
  delete from flowva_group_members where group_id = p_group_id and user_id  = p_user_id;
  if v_g.host_id = p_user_id then update flowva_groups set host_id = admin_id where id = p_group_id; end if;
  update flowva_group_members set ready = false where group_id = p_group_id;
  update flowva_groups set updated_at = now() where id = p_group_id;
  return json_build_object('ok', true);
end; $$;

-- Admin wijst een ander lid aan als bezorg-host.
create or replace function public.ff_set_host(p_group_id uuid, p_user_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_g flowva_groups%rowtype;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select * into v_g from flowva_groups where id = p_group_id;
  if v_g.id is null or v_g.admin_id <> v_uid then return json_build_object('ok', false, 'error', 'Admins only'); end if;
  if not exists (select 1 from flowva_group_members where group_id = p_group_id and user_id = p_user_id) then
    return json_build_object('ok', false, 'error', 'That person is not in the group'); end if;
  update flowva_groups set host_id = p_user_id, updated_at = now() where id = p_group_id;
  return json_build_object('ok', true);
end; $$;

-- Admin past instellingen aan (naam / max grootte / join-modus). max niet onder huidig aantal.
create or replace function public.ff_update_settings(
  p_group_id uuid, p_name text default null, p_max_size int default null, p_join_mode text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_g flowva_groups%rowtype; v_count int; v_new_max int;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select * into v_g from flowva_groups where id = p_group_id;
  if v_g.id is null or v_g.admin_id <> v_uid then return json_build_object('ok', false, 'error', 'Admins only'); end if;
  select count(*) into v_count from flowva_group_members where group_id = p_group_id;
  v_new_max := least(greatest(coalesce(p_max_size, v_g.max_size), 2), 7);
  if v_new_max < v_count then v_new_max := v_count; end if;  -- niet onder huidig aantal leden
  update flowva_groups set
    name      = coalesce(nullif(trim(p_name), ''), name),
    max_size  = v_new_max,
    join_mode = case when p_join_mode in ('open', 'approve') then p_join_mode else join_mode end,
    updated_at = now()
  where id = p_group_id;
  return json_build_object('ok', true);
end; $$;

-- Voeg een item toe aan de gedeelde mand (eigenaar = jij). Alleen tijdens 'gathering'.
-- Cart van JOU wijzigt → enkel JOUW ready reset (anderen betalen eigen items; size onveranderd).
create or replace function public.ff_add_item(p_group_id uuid, p_item jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_g flowva_groups%rowtype; v_id uuid := gen_random_uuid();
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select * into v_g from flowva_groups where id = p_group_id;
  if v_g.id is null then return json_build_object('ok', false, 'error', 'Group not found'); end if;
  if not exists (select 1 from flowva_group_members where group_id = p_group_id and user_id = v_uid) then
    return json_build_object('ok', false, 'error', 'Not a member'); end if;
  if v_g.status <> 'gathering' then return json_build_object('ok', false, 'error', 'This group is already closed'); end if;
  insert into flowva_group_items(id, group_id, owner_id, source_url, product_title, platform, price, qty, kleur, variant_image, opmerking)
  values (v_id, p_group_id, v_uid,
    p_item->>'source_url', p_item->>'product_title', p_item->>'platform',
    case when (p_item->>'price') ~ '^[0-9]+(\.[0-9]+)?$' then (p_item->>'price')::numeric else null end,
    case when (p_item->>'qty') ~ '^[0-9]+$' then greatest((p_item->>'qty')::int, 1) else 1 end,
    p_item->>'kleur', p_item->>'variant_image', p_item->>'opmerking');
  update flowva_group_members set ready = false where group_id = p_group_id and user_id = v_uid;
  return json_build_object('ok', true, 'item_id', v_id);
end; $$;

-- Verwijder een eigen item uit de gedeelde mand. Enkel je eigen ready reset.
create or replace function public.ff_remove_item(p_item_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_gid uuid;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select group_id into v_gid from flowva_group_items where id = p_item_id and owner_id = v_uid;
  if v_gid is null then return json_build_object('ok', false, 'error', 'Item not found'); end if;
  delete from flowva_group_items where id = p_item_id and owner_id = v_uid;
  update flowva_group_members set ready = false where group_id = v_gid and user_id = v_uid;
  return json_build_object('ok', true);
end; $$;

-- Veilige preview vóór joinen: toon naam + grootte zónder lid te hoeven zijn.
-- Geeft GEEN gevoelige velden terug (geen admin_id/host_id/request_group_id).
create or replace function public.ff_group_preview(p_invite_code text)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_g flowva_groups%rowtype; v_count int;
begin
  select * into v_g from flowva_groups where invite_code = upper(trim(p_invite_code));
  if v_g.id is null then return json_build_object('ok', false, 'error', 'Group not found'); end if;
  select count(*) into v_count from flowva_group_members where group_id = v_g.id;
  return json_build_object('ok', true, 'name', v_g.name, 'member_count', v_count,
    'max_size', v_g.max_size, 'is_full', v_count >= v_g.max_size, 'status', v_g.status);
end; $$;

-- Lijst van groepen waar ik in zit (voor de Friends-lobby), in één call.
create or replace function public.ff_my_groups()
returns json language plpgsql security definer set search_path = public stable as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  return json_build_object('ok', true, 'groups', coalesce((
    select json_agg(json_build_object(
      'group_id', g.id, 'name', g.name, 'role', m.role, 'status', g.status,
      'max_size', g.max_size, 'invite_code', g.invite_code,
      'member_count', (select count(*) from flowva_group_members mm where mm.group_id = g.id)
    ) order by g.updated_at desc)
    from flowva_group_members m join flowva_groups g on g.id = m.group_id
    where m.user_id = v_uid
  ), '[]'::json));
end; $$;

-- ── Rechten ──────────────────────────────────────────────────────────────────
grant execute on function public.ff_is_member(uuid)                       to authenticated;
grant execute on function public.ff_create_group(text, int, text)         to authenticated;
grant execute on function public.ff_join_group(text)                      to authenticated;
grant execute on function public.ff_leave_group(uuid)                     to authenticated;
grant execute on function public.ff_kick_member(uuid, uuid)               to authenticated;
grant execute on function public.ff_set_host(uuid, uuid)                  to authenticated;
grant execute on function public.ff_update_settings(uuid, text, int, text) to authenticated;
grant execute on function public.ff_add_item(uuid, jsonb)                 to authenticated;
grant execute on function public.ff_remove_item(uuid)                     to authenticated;
grant execute on function public.ff_group_preview(text)                   to authenticated;
grant execute on function public.ff_my_groups()                           to authenticated;
