-- ============================================================================
-- FLOWVA FRIENDS — Fase 3: ready-up + betaling (HET GELD)
-- ============================================================================
-- Bouwt VOORT op flowva-friends.sql (Fase 1). Draai die eerst (of opnieuw).
--
-- Model (money-safe, zelfde DNA als pay_cart):
--  • READY = "Confirm & pay": prijs komt SERVER-SIDE uit public.products (nooit de
--    client-prijs), wordt op het item VERGRENDELD (locked_price), het bedrag gaat
--    van het saldo af en wordt VASTGEHOUDEN (held_amount). Eén tx 'group_hold'.
--  • Elke roster-/cart-wijziging zet ready=false (Fase 1 doet dat al) → een TRIGGER
--    stort het vastgehouden bedrag automatisch terug (saldo + tx 'group_hold_refund').
--    Een lid dat leavet/gekickt wordt (DELETE) → ook terug, via een tweede trigger.
--  • Zodra IEDEREEN ready is → de groep gaat ATOMAIR op 'placed' (op slot). Het geld
--    is dan definitief; latere refunds lopen via het herroepings-/QC-pad (Fase 5).
--  • GÉÉN orders/BuckyDrop hier. De echte inkoop + consolidatie naar de host is
--    Fase 5 (vereist de BuckyDrop-failure-flow). Fase 3 = puur het geld.
--
-- Veiligheidsnet: de refund-trigger keert ALLEEN uit zolang status = 'gathering',
-- dus na plaatsing kan geen dubbele refund ontstaan, ook niet bij een race.
--
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run. Idempotent.
-- ============================================================================

-- ── Nieuwe kolommen (idempotent) ─────────────────────────────────────────────
alter table public.flowva_group_items add column if not exists locked_price numeric;   -- prijs vergrendeld bij ready
alter table public.flowva_groups      add column if not exists placed_at    timestamptz; -- wanneer iedereen bevestigde
-- price_alert kan al bestaan via de price-guard; garandeer 'm zodat ff_set_ready niet faalt.
alter table public.products           add column if not exists price_alert  boolean default false;

-- ── Fee per persoon: lagere %-fee + lager minimum naarmate de groep groeit ────
-- Getallen VOORLOPIG — pas ze hier op één plek aan. Solo blijft 8% / €5 (service_fee_for).
create or replace function public.ff_member_fee(p_size int, p_total numeric)
returns numeric language sql immutable as $$
  select case
    when p_size >= 7 then greatest(round(coalesce(p_total, 0) * 0.025, 2), 2.50)
    when p_size  = 6 then greatest(round(coalesce(p_total, 0) * 0.030, 2), 2.50)
    when p_size  = 5 then greatest(round(coalesce(p_total, 0) * 0.030, 2), 3.00)
    when p_size  = 4 then greatest(round(coalesce(p_total, 0) * 0.035, 2), 3.00)
    when p_size  = 3 then greatest(round(coalesce(p_total, 0) * 0.040, 2), 3.50)
    when p_size  = 2 then greatest(round(coalesce(p_total, 0) * 0.050, 2), 4.00)
    else                  greatest(round(coalesce(p_total, 0) * 0.080, 2), 5.00)  -- 1 = solo-tarief
  end;
$$;

-- ── Trigger A: geld terug zodra een lid un-ready wordt (ready: true→false) ────
-- Vuurt op join/leave/kick/add-item/remove-item (Fase 1 zet die ready al op false).
-- Keert alleen uit tijdens 'gathering' — ná 'placed' is het geld definitief.
create or replace function public.ff_refund_hold_on_unready()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.held_amount, 0) > 0
     and (select status from public.flowva_groups where id = old.group_id) = 'gathering' then
    update public.profiles set balance = balance + old.held_amount where id = old.user_id;
    insert into public.transactions (user_id, amount, type, order_id)
    values (old.user_id, old.held_amount, 'group_hold_refund', old.group_id::text);
    update public.flowva_group_items set locked_price = null
      where group_id = old.group_id and owner_id = old.user_id;
    new.held_amount := 0;
  end if;
  return new;
end; $$;

drop trigger if exists ff_unready_refund_trg on public.flowva_group_members;
create trigger ff_unready_refund_trg
  before update on public.flowva_group_members
  for each row when (old.ready = true and new.ready = false)
  execute function public.ff_refund_hold_on_unready();

-- ── Trigger B: geld terug als een lid de groep verlaat/gekickt wordt (DELETE) ─
-- Zelfde 'gathering'-guard als trigger A: keer NOOIT uit na 'placed' (geld is dan
-- definitief), ook niet via een toekomstig delete-/cascade-pad (Fase 5, admin-tooling).
create or replace function public.ff_refund_hold_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.held_amount, 0) > 0
     and (select status from public.flowva_groups where id = old.group_id) = 'gathering' then
    update public.profiles set balance = balance + old.held_amount where id = old.user_id;
    insert into public.transactions (user_id, amount, type, order_id)
    values (old.user_id, old.held_amount, 'group_hold_refund', old.group_id::text);
  end if;
  return old;
end; $$;

drop trigger if exists ff_leave_refund_trg on public.flowva_group_members;
create trigger ff_leave_refund_trg
  before delete on public.flowva_group_members
  for each row execute function public.ff_refund_hold_on_leave();

-- ── READY = "Confirm & pay": prijs server-side, geld vasthouden, evt. plaatsen ─
create or replace function public.ff_set_ready(p_group_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid          uuid := auth.uid();
  v_g            public.flowva_groups%rowtype;
  v_size         int;
  v_total        numeric := 0;
  v_bad          text;
  v_fee          numeric;
  v_charge       numeric;
  v_balance      numeric;
  v_item         record;
  v_price        numeric;
  v_alert        boolean;
  v_ready_count  int;
  v_member_count int;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;

  -- Groep vergrendelen → serialiseert gelijktijdige ready-acties (atomaire all-ready-check).
  select * into v_g from public.flowva_groups where id = p_group_id for update;
  if v_g.id is null then return json_build_object('ok', false, 'error', 'Group not found'); end if;
  if v_g.status <> 'gathering' then return json_build_object('ok', false, 'error', 'This group is already closed'); end if;
  if not exists (select 1 from public.flowva_group_members where group_id = p_group_id and user_id = v_uid) then
    return json_build_object('ok', false, 'error', 'Not a member'); end if;

  -- Al ready? Niet nóg een keer afschrijven (idempotent).
  if exists (select 1 from public.flowva_group_members where group_id = p_group_id and user_id = v_uid and ready = true) then
    return json_build_object('ok', true, 'already', true);
  end if;

  if not exists (select 1 from public.flowva_group_items where group_id = p_group_id and owner_id = v_uid) then
    return json_build_object('ok', false, 'error', 'Add at least one item before you confirm');
  end if;

  -- BEVEILIGING: prijs SERVER-SIDE uit products (NOOIT de client-prijs vertrouwen);
  -- vergrendel 'm op het item; weiger onbekende of geflagde (prijs-gewijzigd) producten.
  for v_item in select * from public.flowva_group_items where group_id = p_group_id and owner_id = v_uid loop
    select pr.price, pr.price_alert into v_price, v_alert
      from public.products pr where pr.source_url = v_item.source_url and pr.price is not null limit 1;
    if v_price is null then
      v_bad := coalesce(nullif(v_item.product_title, ''), 'An item') || ' is no longer available'; exit;
    end if;
    if coalesce(v_alert, false) then
      v_bad := coalesce(nullif(v_item.product_title, ''), 'An item') || ': the price changed — review it'; exit;
    end if;
    update public.flowva_group_items set locked_price = v_price where id = v_item.id;
    v_total := v_total + v_price * greatest(coalesce(v_item.qty, 1), 1);
  end loop;
  if v_bad is not null then
    -- Geen half vergrendelde staat achterlaten als één item afvalt.
    update public.flowva_group_items set locked_price = null where group_id = p_group_id and owner_id = v_uid;
    return json_build_object('ok', false, 'error', v_bad);
  end if;

  select count(*) into v_size from public.flowva_group_members where group_id = p_group_id;
  v_fee    := public.ff_member_fee(v_size, v_total);
  v_charge := round(v_total + v_fee, 2);

  -- Saldo vergrendelen + afschrijven (vasthouden).
  select balance into v_balance from public.profiles where id = v_uid for update;
  if coalesce(v_balance, 0) < v_charge then
    return json_build_object('ok', false, 'error', 'Insufficient balance', 'needed', v_charge);
  end if;
  update public.profiles set balance = balance - v_charge where id = v_uid;
  insert into public.transactions (user_id, amount, type, order_id)
  values (v_uid, -v_charge, 'group_hold', p_group_id::text);

  update public.flowva_group_members
    set ready = true, held_amount = v_charge
    where group_id = p_group_id and user_id = v_uid;

  -- Iedereen ready? → atomair op slot ('placed'). Geld is dan definitief.
  select count(*) into v_member_count from public.flowva_group_members where group_id = p_group_id;
  select count(*) into v_ready_count  from public.flowva_group_members where group_id = p_group_id and ready = true;
  if v_ready_count = v_member_count then
    update public.flowva_groups
      set status = 'placed', placed_at = now(), updated_at = now(),
          request_group_id = coalesce(request_group_id,
            'FF-G-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint
            || '-' || substr(p_group_id::text, 1, 8))   -- globaal uniek (geen ms-botsing)
      where id = p_group_id;
  end if;

  return json_build_object('ok', true, 'charged', v_charge, 'fee', v_fee,
    'items_total', v_total, 'placed', (v_ready_count = v_member_count));
end; $$;

-- ── UNREADY: zet ready terug → trigger A stort het vastgehouden bedrag terug ──
create or replace function public.ff_unready(p_group_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_status text;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  -- FOR UPDATE: serialiseer met ff_set_ready zodat status-check + un-ready atomair zijn
  -- (anders kan un-ready net na 'placed' landen → geld blijft hangen).
  select status into v_status from public.flowva_groups where id = p_group_id for update;
  if v_status is null then return json_build_object('ok', false, 'error', 'Group not found'); end if;
  if v_status <> 'gathering' then return json_build_object('ok', false, 'error', 'This group is already closed'); end if;
  update public.flowva_group_members set ready = false
    where group_id = p_group_id and user_id = v_uid and ready = true;
  return json_build_object('ok', true);
end; $$;

-- ============================================================================
-- Fase-1-mutators OPNIEUW — nu met `for update` op de group-rij.
-- Reden: ff_set_ready plaatst de groep atomair zodra iedereen ready is. Dat is
-- alleen race-vrij als ELKE ready-/roster-mutatie eerst dezelfde group-rij
-- vergrendelt (anders kan een groep op 'placed' gaan terwijl een lid net z'n geld
-- terugkreeg → geld kwijt). Verder identiek aan flowva-friends.sql; enige extra:
-- ff_remove_item krijgt ook de 'gathering'-statuscheck (ontbrak in Fase 1).
-- Lock-volgorde overal: eerst group-rij, dan member-rijen → geen deadlock.
-- ============================================================================

create or replace function public.ff_leave_group(p_group_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_g public.flowva_groups%rowtype; v_remaining int; v_new_admin uuid;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select * into v_g from public.flowva_groups where id = p_group_id for update;
  if v_g.id is null then return json_build_object('ok', false, 'error', 'Group not found'); end if;
  if not exists (select 1 from public.flowva_group_members where group_id = p_group_id and user_id = v_uid) then
    return json_build_object('ok', false, 'error', 'Not a member'); end if;
  if v_g.status <> 'gathering' then return json_build_object('ok', false, 'error', 'This group is already closed'); end if;

  delete from public.flowva_group_items   where group_id = p_group_id and owner_id = v_uid;
  delete from public.flowva_group_members where group_id = p_group_id and user_id  = v_uid;

  select count(*) into v_remaining from public.flowva_group_members where group_id = p_group_id;
  if v_remaining = 0 then
    update public.flowva_groups set status = 'cancelled', updated_at = now() where id = p_group_id;
  else
    if v_g.admin_id = v_uid then
      select user_id into v_new_admin from public.flowva_group_members where group_id = p_group_id order by joined_at limit 1;
      update public.flowva_group_members set role = 'admin' where group_id = p_group_id and user_id = v_new_admin;
      update public.flowva_groups set admin_id = v_new_admin,
        host_id = case when host_id = v_uid then v_new_admin else host_id end, updated_at = now()
        where id = p_group_id;
    elsif v_g.host_id = v_uid then
      update public.flowva_groups set host_id = admin_id, updated_at = now() where id = p_group_id;
    end if;
    update public.flowva_group_members set ready = false where group_id = p_group_id;
    update public.flowva_groups set updated_at = now() where id = p_group_id;
  end if;
  return json_build_object('ok', true);
end; $$;

create or replace function public.ff_kick_member(p_group_id uuid, p_user_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_g public.flowva_groups%rowtype;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select * into v_g from public.flowva_groups where id = p_group_id for update;
  if v_g.id is null or v_g.admin_id <> v_uid then return json_build_object('ok', false, 'error', 'Admins only'); end if;
  if v_g.status <> 'gathering' then return json_build_object('ok', false, 'error', 'This group is already closed'); end if;
  if p_user_id = v_uid then return json_build_object('ok', false, 'error', 'Use leave instead'); end if;
  delete from public.flowva_group_items   where group_id = p_group_id and owner_id = p_user_id;
  delete from public.flowva_group_members where group_id = p_group_id and user_id  = p_user_id;
  if v_g.host_id = p_user_id then update public.flowva_groups set host_id = admin_id where id = p_group_id; end if;
  update public.flowva_group_members set ready = false where group_id = p_group_id;
  update public.flowva_groups set updated_at = now() where id = p_group_id;
  return json_build_object('ok', true);
end; $$;

create or replace function public.ff_add_item(p_group_id uuid, p_item jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_g public.flowva_groups%rowtype; v_id uuid := gen_random_uuid();
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select * into v_g from public.flowva_groups where id = p_group_id for update;
  if v_g.id is null then return json_build_object('ok', false, 'error', 'Group not found'); end if;
  if not exists (select 1 from public.flowva_group_members where group_id = p_group_id and user_id = v_uid) then
    return json_build_object('ok', false, 'error', 'Not a member'); end if;
  if v_g.status <> 'gathering' then return json_build_object('ok', false, 'error', 'This group is already closed'); end if;
  insert into public.flowva_group_items(id, group_id, owner_id, source_url, product_title, platform, price, qty, kleur, variant_image, opmerking)
  values (v_id, p_group_id, v_uid,
    p_item->>'source_url', p_item->>'product_title', p_item->>'platform',
    case when (p_item->>'price') ~ '^[0-9]+(\.[0-9]+)?$' then (p_item->>'price')::numeric else null end,
    case when (p_item->>'qty') ~ '^[0-9]+$' then greatest((p_item->>'qty')::int, 1) else 1 end,
    p_item->>'kleur', p_item->>'variant_image', p_item->>'opmerking');
  update public.flowva_group_members set ready = false where group_id = p_group_id and user_id = v_uid;
  return json_build_object('ok', true, 'item_id', v_id);
end; $$;

create or replace function public.ff_remove_item(p_item_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_gid uuid; v_status text;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select group_id into v_gid from public.flowva_group_items where id = p_item_id and owner_id = v_uid;
  if v_gid is null then return json_build_object('ok', false, 'error', 'Item not found'); end if;
  select status into v_status from public.flowva_groups where id = v_gid for update;
  if v_status <> 'gathering' then return json_build_object('ok', false, 'error', 'This group is already closed'); end if;
  delete from public.flowva_group_items where id = p_item_id and owner_id = v_uid;
  update public.flowva_group_members set ready = false where group_id = v_gid and user_id = v_uid;
  return json_build_object('ok', true);
end; $$;

-- ── Rechten ──────────────────────────────────────────────────────────────────
grant execute on function public.ff_member_fee(int, numeric) to authenticated;
grant execute on function public.ff_set_ready(uuid)          to authenticated;
grant execute on function public.ff_unready(uuid)            to authenticated;
grant execute on function public.ff_leave_group(uuid)        to authenticated;
grant execute on function public.ff_kick_member(uuid, uuid)  to authenticated;
grant execute on function public.ff_add_item(uuid, jsonb)    to authenticated;
grant execute on function public.ff_remove_item(uuid)        to authenticated;
