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
