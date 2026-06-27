-- ════════════════════════════════════════════════════════════════════════════
-- Flowva Friends — "slot na betaling"
-- ════════════════════════════════════════════════════════════════════════════
-- Doel: zodra je in een groep ready bent (= je hold/betaling staat klaar), kun je
-- NIET meer stiekem doorwinkelen in die groep. Voorheen zette ff_add_item je stil
-- terug op "niet ready" (en stortte je hold terug) — verwarrend: het leek alsof je
-- gewoon kon blijven shoppen ná je betaling. Nu wordt toevoegen/verwijderen
-- GEWEIGERD met een duidelijke melding; wil je tóch je mand wijzigen, dan moet je
-- eerst bewust "un-ready" doen (dat stort je hold netjes terug).
--
-- Plus: ff_my_groups geeft nu je eigen betaal-status terug (my_ready) en hoeveel
-- groepsleden al betaald hebben (ready_count) zodat de app dat kan tonen.
--
-- Geld-pad-veilig: er verandert NIETS aan balances/holds in deze functies; het zijn
-- alleen extra guards + een read-uitbreiding. Draai dit in de Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Toevoegen aan de groepsmand: weiger als je al betaald (ready) bent ──────────
create or replace function public.ff_add_item(p_group_id uuid, p_item jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_g public.flowva_groups%rowtype; v_id uuid := gen_random_uuid(); v_ready boolean;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select * into v_g from public.flowva_groups where id = p_group_id for update;
  if v_g.id is null then return json_build_object('ok', false, 'error', 'Group not found'); end if;
  -- Lidmaatschap + eigen ready-status in één query (v_ready null = geen lid).
  select ready into v_ready from public.flowva_group_members where group_id = p_group_id and user_id = v_uid;
  if v_ready is null then return json_build_object('ok', false, 'error', 'Not a member'); end if;
  if v_g.status <> 'gathering' then return json_build_object('ok', false, 'error', 'This group is already closed'); end if;
  -- ★ Slot na betaling: betaalde leden kunnen niet doorwinkelen. Eerst un-ready.
  if v_ready then return json_build_object('ok', false, 'error', 'You already paid for this round — un-ready in the group first if you want to change your cart.'); end if;
  insert into public.flowva_group_items(id, group_id, owner_id, source_url, product_title, platform, price, qty, kleur, variant_image, opmerking)
  values (v_id, p_group_id, v_uid,
    p_item->>'source_url', p_item->>'product_title', p_item->>'platform',
    case when (p_item->>'price') ~ '^[0-9]+(\.[0-9]+)?$' then (p_item->>'price')::numeric else null end,
    case when (p_item->>'qty') ~ '^[0-9]+$' then greatest((p_item->>'qty')::int, 1) else 1 end,
    p_item->>'kleur', p_item->>'variant_image', p_item->>'opmerking');
  return json_build_object('ok', true, 'item_id', v_id);
end; $$;

-- 2) Verwijderen uit de groepsmand: zelfde slot ─────────────────────────────────
create or replace function public.ff_remove_item(p_item_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_gid uuid; v_status text; v_ready boolean;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select group_id into v_gid from public.flowva_group_items where id = p_item_id and owner_id = v_uid;
  if v_gid is null then return json_build_object('ok', false, 'error', 'Item not found'); end if;
  select status into v_status from public.flowva_groups where id = v_gid for update;
  if v_status <> 'gathering' then return json_build_object('ok', false, 'error', 'This group is already closed'); end if;
  select ready into v_ready from public.flowva_group_members where group_id = v_gid and user_id = v_uid;
  if v_ready then return json_build_object('ok', false, 'error', 'You already paid for this round — un-ready in the group first if you want to change your cart.'); end if;
  delete from public.flowva_group_items where id = p_item_id and owner_id = v_uid;
  return json_build_object('ok', true);
end; $$;

-- 3) Mijn groepen: geef eigen betaal-status (my_ready) + betaal-teller (ready_count)
create or replace function public.ff_my_groups()
returns json language plpgsql security definer set search_path = public stable as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  return json_build_object('ok', true, 'groups', coalesce((
    select json_agg(json_build_object(
      'group_id', g.id, 'name', g.name, 'role', m.role, 'status', g.status,
      'max_size', g.max_size, 'invite_code', g.invite_code,
      'member_count', (select count(*) from flowva_group_members mm where mm.group_id = g.id),
      'ready_count',  (select count(*) from flowva_group_members mm where mm.group_id = g.id and mm.ready),
      'my_ready', m.ready
    ) order by g.updated_at desc)
    from flowva_group_members m join flowva_groups g on g.id = m.group_id
    where m.user_id = v_uid
  ), '[]'::json));
end; $$;

grant execute on function public.ff_add_item(uuid, jsonb) to authenticated;
grant execute on function public.ff_remove_item(uuid)     to authenticated;
grant execute on function public.ff_my_groups()           to authenticated;
