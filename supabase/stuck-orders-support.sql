-- ============================================================================
-- FASE 1: HANGENDE ORDERS + FLOWVA SUPPORT (2026-07-22, GEDRAAID via MCP)
-- Model (user): elke order die >5 dagen op de "Order placed"-groep blijft staan
-- verschijnt in de admin-tab HANGENDE ORDERS (rood). Admin zoekt 'm op in
-- BuckyDrop (Store Orders → ons ordernummer) en kiest: verlenging (max 2×,
-- vak wordt groen, rood weer bij dag 8/11), vertraagd-bericht, of refund mét
-- verplichte reden-template. Klant-communicatie = Flowva support-berichten in
-- het belletje (template_key → client vertaalt in 8 talen).
-- ============================================================================

alter table public.orders add column if not exists stuck_extensions int not null default 0;
alter table public.orders add column if not exists stuck_extended_at timestamptz;

create table if not exists public.support_messages (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id),
  order_id     text,
  product_title text,
  template_key text not null check (template_key in ('delay','never_shipped','unavailable','unknown_refund')),
  read         boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.support_messages enable row level security;
drop policy if exists "support read own" on public.support_messages;
create policy "support read own" on public.support_messages for select to authenticated using (user_id = auth.uid());
-- Geen insert/update-policies: schrijven kan alleen via de SECURITY DEFINER RPC's hieronder.

create or replace function public.support_mark_all_read()
returns json language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  update public.support_messages set read = true where user_id = auth.uid() and read = false;
  return json_build_object('ok', true);
end; $$;
revoke all on function public.support_mark_all_read() from public, anon;
grant execute on function public.support_mark_all_read() to authenticated;

create or replace function public.admin_list_stuck_orders()
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  return json_build_object('ok', true, 'stuck', coalesce((
    select json_agg(json_build_object(
      'id', o.id,
      'product_title', coalesce(o.product_title, o.product),
      'kleur', o.kleur, 'qty', o.qty, 'price', o.price,
      'status', o.status,
      'shop_order_no', o.shop_order_no,
      'bd_error', o.bd_error,
      'created_at', o.created_at,
      'days', floor(extract(epoch from (now() - o.created_at)) / 86400),
      'stuck_extensions', o.stuck_extensions,
      'delay_msgs', (select count(*) from public.support_messages sm where sm.order_id = o.id and sm.template_key = 'delay'),
      'is_group', o.ff_group_id is not null,
      'group_name', g.name,
      'group_admin_name', case when o.ff_group_id is not null then
        coalesce(nullif(trim(coalesce(h.raw_user_meta_data->>'voornaam','') || ' ' || coalesce(h.raw_user_meta_data->>'achternaam','')), ''), 'Onbekend') end,
      'group_admin_email', h.email,
      'customer_name', coalesce(nullif(trim(coalesce(u.raw_user_meta_data->>'voornaam','') || ' ' || coalesce(u.raw_user_meta_data->>'achternaam','')), ''), 'Onbekend'),
      'customer_email', u.email
    ) order by o.created_at asc)
    from public.orders o
    left join auth.users u on u.id = o.user_id
    left join auth.users h on h.id = o.host_user_id
    left join public.flowva_groups g on g.id = o.ff_group_id
    where o.status in ('quote_accepted','purchased','bought','shipped_local')
      and o.created_at < now() - interval '5 days'
  ), '[]'::json));
end; $$;
revoke all on function public.admin_list_stuck_orders() from public, anon;
grant execute on function public.admin_list_stuck_orders() to authenticated;

create or replace function public.admin_extend_stuck(p_order_id text)
returns json language plpgsql security definer set search_path = public as $$
declare v_ext int;
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  select stuck_extensions into v_ext from public.orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'order niet gevonden'); end if;
  if v_ext >= 2 then return json_build_object('ok', false, 'error', 'maximaal 2 verlengingen'); end if;
  update public.orders set stuck_extensions = v_ext + 1, stuck_extended_at = now() where id = p_order_id;
  return json_build_object('ok', true, 'extensions', v_ext + 1);
end; $$;
revoke all on function public.admin_extend_stuck(text) from public, anon;
grant execute on function public.admin_extend_stuck(text) to authenticated;

create or replace function public.admin_stuck_message(p_order_id text)
returns json language plpgsql security definer set search_path = public as $$
declare v_order record;
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found then return json_build_object('ok', false, 'error', 'order niet gevonden'); end if;
  insert into public.support_messages (user_id, order_id, product_title, template_key)
  values (v_order.user_id, v_order.id, coalesce(v_order.product_title, v_order.product), 'delay');
  return json_build_object('ok', true);
end; $$;
revoke all on function public.admin_stuck_message(text) from public, anon;
grant execute on function public.admin_stuck_message(text) to authenticated;

-- Refund + verplichte reden. Reason-prefix "Support refund" stuurt de klant-app:
-- grijze kaart + kaart-chip "Refunded — check your inbox", GEEN dubbele
-- belletje-regel (het support-bericht ís de melding).
create or replace function public.admin_refund_stuck(p_order_id text, p_template_key text)
returns json language plpgsql security definer set search_path = public as $$
declare v_order record; v_refund json;
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  if p_template_key not in ('never_shipped','unavailable','unknown_refund') then
    return json_build_object('ok', false, 'error', 'ongeldige template');
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'order niet gevonden'); end if;
  if v_order.status = 'cancelled' then return json_build_object('ok', true, 'already', true); end if;

  v_refund := public.refund_order(p_order_id, 'Support refund — ' || p_template_key);
  if coalesce((v_refund->>'ok')::boolean, false) is not true then
    return json_build_object('ok', false, 'error', coalesce(v_refund->>'error', 'refund mislukt'));
  end if;
  insert into public.support_messages (user_id, order_id, product_title, template_key)
  values (v_order.user_id, v_order.id, coalesce(v_order.product_title, v_order.product), p_template_key);
  return json_build_object('ok', true, 'refunded', true);
end; $$;
revoke all on function public.admin_refund_stuck(text, text) from public, anon;
grant execute on function public.admin_refund_stuck(text, text) to authenticated;

-- ============================================================================
-- ADDENDUM 2026-07-22 (GEDRAAID via MCP): modus-context op support-berichten.
-- group_name op support_messages (null = solo) + backfill; admin_stuck_message
-- en admin_refund_stuck vullen 'm voortaan mee. De klant-app toont onder elk
-- bericht: "Item ordered in Flowva Friends group: X — switch to ..." of de
-- solo-variant. Definities hieronder VERVANGEN die hierboven (create or replace).
-- ============================================================================
alter table public.support_messages add column if not exists group_name text;

update public.support_messages sm
   set group_name = g.name
  from public.orders o
  join public.flowva_groups g on g.id = o.ff_group_id
 where sm.order_id = o.id and sm.group_name is null;

create or replace function public.admin_stuck_message(p_order_id text)
returns json language plpgsql security definer set search_path = public as $$
declare v_order record; v_group text;
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found then return json_build_object('ok', false, 'error', 'order niet gevonden'); end if;
  select g.name into v_group from public.flowva_groups g where g.id = v_order.ff_group_id;
  insert into public.support_messages (user_id, order_id, product_title, template_key, group_name)
  values (v_order.user_id, v_order.id, coalesce(v_order.product_title, v_order.product), 'delay', v_group);
  return json_build_object('ok', true);
end; $$;
grant execute on function public.admin_stuck_message(text) to authenticated;

create or replace function public.admin_refund_stuck(p_order_id text, p_template_key text)
returns json language plpgsql security definer set search_path = public as $$
declare v_order record; v_refund json; v_group text;
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  if p_template_key not in ('never_shipped','unavailable','unknown_refund') then
    return json_build_object('ok', false, 'error', 'ongeldige template');
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'order niet gevonden'); end if;
  if v_order.status = 'cancelled' then return json_build_object('ok', true, 'already', true); end if;
  v_refund := public.refund_order(p_order_id, 'Support refund — ' || p_template_key);
  if coalesce((v_refund->>'ok')::boolean, false) is not true then
    return json_build_object('ok', false, 'error', coalesce(v_refund->>'error', 'refund mislukt'));
  end if;
  select g.name into v_group from public.flowva_groups g where g.id = v_order.ff_group_id;
  insert into public.support_messages (user_id, order_id, product_title, template_key, group_name)
  values (v_order.user_id, v_order.id, coalesce(v_order.product_title, v_order.product), p_template_key, v_group);
  return json_build_object('ok', true, 'refunded', true);
end; $$;
grant execute on function public.admin_refund_stuck(text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- ADDENDUM 2 (2026-07-21) — Fase 2 solo: refund-request afhandeling
-- Accept = volledige refund + inbox-bericht; fabrieksretour doet de admin
-- HANDMATIG in BuckyDrop (aparte lijst + stempel). Deny = 5 vaste
-- templates óf vrije tekst, altijd via de Flowva support-inbox.
-- (Al gedraaid via MCP — dit bestand is de administratie.)
-- ═══════════════════════════════════════════════════════════════════════

-- Vrije tekst voor 'custom'-berichten (deny met eigen tekst); client toont body 1-op-1.
alter table public.support_messages add column if not exists body text;

-- Template-keys uitbreiden met de fase-2-varianten.
alter table public.support_messages drop constraint if exists support_messages_template_key_check;
alter table public.support_messages add constraint support_messages_template_key_check
  check (template_key in ('delay','never_shipped','unavailable','unknown_refund',
    'refund_accepted','deny_ok_item','deny_change_mind','deny_size_match',
    'deny_minor_variation','deny_evidence','custom'));

-- Stempel: fabrieksretour in BuckyDrop handmatig gedaan.
alter table public.orders add column if not exists factory_return_done_at timestamptz;

-- Herdefinitie: approve = refund + inbox; GEEN auto-fabrieksretour meer
-- (return_status wordt niet meer gezet — retour doet de admin met de hand).
create or replace function public.admin_resolve_dispute(p_order_id text, p_approve boolean, p_message text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_order record; v_refund json; v_group text;
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'order not found'); end if;
  if v_order.dispute_status is distinct from 'pending' then
    return json_build_object('ok', false, 'error', 'no pending dispute');
  end if;
  select g.name into v_group from public.flowva_groups g where g.id = v_order.ff_group_id;

  if p_approve then
    update public.orders set dispute_status = 'approved', dispute_response = null where id = p_order_id;
    v_refund := public.refund_order(p_order_id, 'Support refund — refund_accepted');
    if coalesce((v_refund->>'ok')::boolean, false) is not true then
      return json_build_object('ok', false, 'error', coalesce(v_refund->>'error', 'refund mislukt'));
    end if;
    -- refund_order zet status='cancelled' en raakt dispute_status niet; markeer approved.
    update public.orders set dispute_status = 'approved' where id = p_order_id;
    insert into public.support_messages (user_id, order_id, product_title, template_key, group_name)
    values (v_order.user_id, v_order.id, coalesce(v_order.product_title, v_order.product), 'refund_accepted', v_group);
    return json_build_object('ok', true, 'approved', true);
  else
    update public.orders set dispute_status = 'rejected', dispute_response = p_message where id = p_order_id;
    insert into public.support_messages (user_id, order_id, product_title, template_key, group_name, body)
    values (v_order.user_id, v_order.id, coalesce(v_order.product_title, v_order.product), 'custom', v_group, p_message);
    return json_build_object('ok', true, 'rejected', true);
  end if;
end; $$;
revoke execute on function public.admin_resolve_dispute(text, boolean, text) from public, anon;
grant execute on function public.admin_resolve_dispute(text, boolean, text) to authenticated;

-- Deny met vaste template: EN-tekst als dispute_response + inbox-bericht met template_key
-- (client vertaalt per taal via support.tpl.*-keys).
create or replace function public.admin_deny_dispute(p_order_id text, p_template_key text)
returns json language plpgsql security definer set search_path = public as $$
declare v_order record; v_group text; v_en text;
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  if p_template_key not in ('deny_ok_item','deny_change_mind','deny_size_match','deny_minor_variation','deny_evidence') then
    return json_build_object('ok', false, 'error', 'ongeldige template');
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'order not found'); end if;
  if v_order.dispute_status is distinct from 'pending' then
    return json_build_object('ok', false, 'error', 'no pending dispute');
  end if;
  v_en := case p_template_key
    when 'deny_ok_item' then 'We reviewed the quality-control photos carefully — your item matches what you ordered and we found no defect. It will ship as normal.'
    when 'deny_change_mind' then 'The factory doesn''t accept change-of-mind returns at this stage. Your item will ship as normal — after it arrives you can still use our regular return policy.'
    when 'deny_size_match' then 'The size and variant match exactly what was selected at checkout, so we can''t treat this as a fault. Your item will ship as normal.'
    when 'deny_minor_variation' then 'Small variations in color or finish can occur and fall within normal production standards — this isn''t considered a defect. Your item will ship as normal.'
    else 'The evidence provided isn''t enough for us to confirm a defect. Send a new request with clearer photos if you''d like us to take another look — otherwise your item ships as normal.'
  end;
  select g.name into v_group from public.flowva_groups g where g.id = v_order.ff_group_id;
  update public.orders set dispute_status = 'rejected', dispute_response = v_en where id = p_order_id;
  insert into public.support_messages (user_id, order_id, product_title, template_key, group_name)
  values (v_order.user_id, v_order.id, coalesce(v_order.product_title, v_order.product), p_template_key, v_group);
  return json_build_object('ok', true, 'rejected', true);
end; $$;
revoke execute on function public.admin_deny_dispute(text, text) from public, anon;
grant execute on function public.admin_deny_dispute(text, text) to authenticated;

-- Werkbak: goedgekeurde refund-requests waarvoor de fabrieksretour in
-- BuckyDrop nog handmatig gedaan moet worden.
create or replace function public.admin_list_manual_returns()
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  return json_build_object('ok', true, 'returns', coalesce((
    select json_agg(json_build_object(
      'id', o.id, 'product_title', coalesce(o.product_title, o.product),
      'kleur', o.kleur, 'qty', o.qty, 'price', o.price,
      'shop_order_no', o.shop_order_no,
      'approved_at', o.dispute_requested_at,
      'is_group', o.ff_group_id is not null, 'group_name', g.name,
      'group_admin_email', h.email,
      'customer_name', coalesce(nullif(trim(coalesce(u.raw_user_meta_data->>'voornaam','') || ' ' || coalesce(u.raw_user_meta_data->>'achternaam','')), ''), 'Onbekend'),
      'customer_email', u.email
    ) order by o.dispute_requested_at desc)
    from public.orders o
    left join auth.users u on u.id = o.user_id
    left join auth.users h on h.id = o.host_user_id
    left join public.flowva_groups g on g.id = o.ff_group_id
    where o.dispute_status = 'approved' and o.factory_return_done_at is null
  ), '[]'::json));
end; $$;
revoke execute on function public.admin_list_manual_returns() from public, anon;
grant execute on function public.admin_list_manual_returns() to authenticated;

-- Stempel: retour is in BuckyDrop gedaan → rij verdwijnt uit de werkbak.
create or replace function public.admin_return_done(p_order_id text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  update public.orders set factory_return_done_at = now() where id = p_order_id and dispute_status = 'approved';
  if not found then return json_build_object('ok', false, 'error', 'order niet gevonden / niet approved'); end if;
  return json_build_object('ok', true);
end; $$;
revoke execute on function public.admin_return_done(text) from public, anon;
grant execute on function public.admin_return_done(text) to authenticated;
