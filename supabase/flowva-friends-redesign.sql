-- ============================================================================
-- FLOWVA FRIENDS — Redesign-laag: privé-groep, admin-overdracht, product delen
-- ============================================================================
-- Bouwt voort op flowva-friends.sql (+ money/social). Idempotent.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- ============================================================================

alter table public.flowva_groups          add column if not exists is_private boolean not null default false;
alter table public.flowva_group_messages  add column if not exists product jsonb;   -- gedeeld feed-product (snapshot)

-- ── Admin overdragen aan een ander lid (jij wordt 'member') ──────────────────
create or replace function public.ff_set_admin(p_group_id uuid, p_user_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_g public.flowva_groups%rowtype;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select * into v_g from public.flowva_groups where id = p_group_id for update;
  if v_g.id is null or v_g.admin_id <> v_uid then return json_build_object('ok', false, 'error', 'Admins only'); end if;
  if v_g.status <> 'gathering' then return json_build_object('ok', false, 'error', 'This group is already closed'); end if;
  if not exists (select 1 from public.flowva_group_members where group_id = p_group_id and user_id = p_user_id) then
    return json_build_object('ok', false, 'error', 'That person is not in the group'); end if;
  if p_user_id = v_uid then return json_build_object('ok', true); end if;
  update public.flowva_group_members set role = 'admin'  where group_id = p_group_id and user_id = p_user_id;
  update public.flowva_group_members set role = 'member' where group_id = p_group_id and user_id = v_uid;
  update public.flowva_groups set admin_id = p_user_id, updated_at = now() where id = p_group_id;
  return json_build_object('ok', true);
end; $$;

-- ── Privé aan/uit (admin). Privé = niemand kan nog joinen ────────────────────
create or replace function public.ff_set_private(p_group_id uuid, p_private boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_g public.flowva_groups%rowtype;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select * into v_g from public.flowva_groups where id = p_group_id for update;
  if v_g.id is null or v_g.admin_id <> v_uid then return json_build_object('ok', false, 'error', 'Admins only'); end if;
  if v_g.status <> 'gathering' then return json_build_object('ok', false, 'error', 'This group is already closed'); end if;
  update public.flowva_groups set is_private = coalesce(p_private, false), updated_at = now() where id = p_group_id;
  return json_build_object('ok', true, 'is_private', coalesce(p_private, false));
end; $$;

-- ── Product uit de feed delen in de chat (zonder 'm zelf aan je mand toe te voegen)
create or replace function public.ff_share_product(p_group_id uuid, p_product jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid := gen_random_uuid();
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  if not public.ff_is_member(p_group_id) then return json_build_object('ok', false, 'error', 'Not a member'); end if;
  if p_product is null or (p_product->>'source_url') is null then return json_build_object('ok', false, 'error', 'Nothing to share'); end if;
  insert into public.flowva_group_messages(id, group_id, user_id, kind, product)
  values (v_id, p_group_id, v_uid, 'share', jsonb_build_object(
    'source_url',    p_product->>'source_url',
    'product_title', p_product->>'product_title',
    'platform',      p_product->>'platform',
    'price',         p_product->>'price',
    'variant_image', p_product->>'variant_image',
    'kleur',         p_product->>'kleur'
  ));
  return json_build_object('ok', true, 'id', v_id);
end; $$;

-- ── ff_join_group: weiger een privé-groep (herdefinitie mét for update) ───────
create or replace function public.ff_join_group(p_invite_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_g public.flowva_groups%rowtype; v_count int; v_meta jsonb; v_name text;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select * into v_g from public.flowva_groups where invite_code = upper(trim(p_invite_code)) for update;
  if v_g.id is null then return json_build_object('ok', false, 'error', 'Group not found'); end if;
  if v_g.status <> 'gathering' then return json_build_object('ok', false, 'error', 'This group is already closed'); end if;
  if exists (select 1 from public.flowva_group_members where group_id = v_g.id and user_id = v_uid) then
    return json_build_object('ok', true, 'group_id', v_g.id); end if;
  if v_g.is_private then return json_build_object('ok', false, 'error', 'This group is private — ask the admin to make it open'); end if;
  select count(*) into v_count from public.flowva_group_members where group_id = v_g.id;
  if v_count >= v_g.max_size then return json_build_object('ok', false, 'error', 'This group is full'); end if;
  select raw_user_meta_data into v_meta from auth.users where id = v_uid;
  v_name := nullif(trim(coalesce(v_meta->>'voornaam', '') || ' ' || coalesce(v_meta->>'achternaam', '')), '');
  insert into public.flowva_group_members(group_id, user_id, role, display_name, avatar_url)
  values (v_g.id, v_uid, 'member', v_name, v_meta->>'avatar_url');
  update public.flowva_group_members set ready = false where group_id = v_g.id;
  update public.flowva_groups set updated_at = now() where id = v_g.id;
  return json_build_object('ok', true, 'group_id', v_g.id);
end; $$;

-- ── ff_group_preview: meld of de groep privé is ──────────────────────────────
create or replace function public.ff_group_preview(p_invite_code text)
returns json language plpgsql security definer set search_path = public stable as $$
declare v_g public.flowva_groups%rowtype; v_count int;
begin
  select * into v_g from public.flowva_groups where invite_code = upper(trim(p_invite_code));
  if v_g.id is null then return json_build_object('ok', false, 'error', 'Group not found'); end if;
  select count(*) into v_count from public.flowva_group_members where group_id = v_g.id;
  return json_build_object('ok', true, 'name', v_g.name, 'member_count', v_count,
    'max_size', v_g.max_size, 'is_full', v_count >= v_g.max_size, 'status', v_g.status, 'is_private', v_g.is_private);
end; $$;

grant execute on function public.ff_set_admin(uuid, uuid)      to authenticated;
grant execute on function public.ff_set_private(uuid, boolean)  to authenticated;
grant execute on function public.ff_share_product(uuid, jsonb)  to authenticated;
grant execute on function public.ff_join_group(text)            to authenticated;
grant execute on function public.ff_group_preview(text)         to authenticated;
