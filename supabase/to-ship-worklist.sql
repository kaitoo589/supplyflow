-- ============================================================
-- Flowva — TE VERZENDEN-werklijst voor de admin (2026-07-22, reeds toegepast via MCP)
-- ============================================================
-- Probleem: "Confirm & ship" rekent alleen af (pay_shipping_buffered) — het échte
-- mergen + verzenden doet de admin HANDMATIG in het BuckyDrop-dashboard (Orders →
-- Awaiting Merging → Consolidate Orders). Maar admin toonde nergens WELKE
-- BuckyDrop-orders (CO-nummers) samen één pakket vormen — gevaarlijk zodra één
-- account solo én Friends tegelijk doet (mag NOOIT samen gemerged worden).
--
-- Oplossing: admin_list_to_ship() geeft per fysiek pakket een kaart:
--   solo    = hauls (status confirmed, nog niet gemerged/verrekend)
--   friends = ff_group_shipments (all_paid, nog niet gemerged/verrekend)
-- met CO-nummers, klant-/host-mail (BuckyDrop-zoeksleutel), bezorgadres en items.
-- admin_mark_merged() stempelt merged_at zodra de merge in BuckyDrop is gedaan.
-- ============================================================

alter table public.hauls add column if not exists merged_at timestamptz;
alter table public.ff_group_shipments add column if not exists merged_at timestamptz;

create or replace function public.admin_list_to_ship()
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  return json_build_object('ok', true,
    -- SOLO: betaalde hauls die nog niet in BuckyDrop gemerged/verzonden zijn.
    'solo', coalesce((
      select json_agg(json_build_object(
        'haul_id', h.id, 'created_at', h.created_at,
        'customer_email', u.email,
        'customer_name', coalesce(nullif(trim(coalesce(u.raw_user_meta_data->>'voornaam','') || ' ' || coalesce(u.raw_user_meta_data->>'achternaam','')), ''), 'Onbekend'),
        'service_name', h.service_name,
        'address', (
          select coalesce(o2.ship_address, u.raw_user_meta_data->>'adres') || ', '
              || coalesce(o2.ship_postcode, u.raw_user_meta_data->>'postcode') || ' '
              || coalesce(o2.ship_city, u.raw_user_meta_data->>'stad') || ', '
              || coalesce(o2.ship_country, u.raw_user_meta_data->>'land')
          from public.orders o2 where o2.id in (select jsonb_array_elements_text(h.items)) limit 1
        ),
        'items', (
          select coalesce(json_agg(json_build_object(
            'order_id', o.id, 'title', coalesce(o.product_title, o.product), 'kleur', o.kleur,
            'qty', o.qty, 'weight_g', o.weight_grams, 'shop_order_no', o.shop_order_no
          ) order by o.created_at), '[]'::json)
          from public.orders o where o.id in (select jsonb_array_elements_text(h.items))
        )
      ) order by h.created_at)
      from public.hauls h left join auth.users u on u.id = h.user_id
      where h.status = 'confirmed' and h.merged_at is null and h.settled_at is null
    ), '[]'::json),
    -- FRIENDS: groep-zendingen waar iedereen betaald heeft, nog niet gemerged.
    'friends', coalesce((
      select json_agg(json_build_object(
        'group_id', s.group_id, 'group_name', g.name, 'all_paid_at', s.all_paid_at,
        'service_name', s.service_name, 'total_weight_g', s.total_weight_g,
        'host_email', hu.email,
        'host_name', coalesce(nullif(trim(coalesce(hu.raw_user_meta_data->>'voornaam','') || ' ' || coalesce(hu.raw_user_meta_data->>'achternaam','')), ''), 'Onbekend'),
        'host_address', coalesce(hu.raw_user_meta_data->>'adres','?') || ', '
          || coalesce(hu.raw_user_meta_data->>'postcode','') || ' '
          || coalesce(hu.raw_user_meta_data->>'stad','') || ', '
          || coalesce(hu.raw_user_meta_data->>'land',''),
        'items', (
          select coalesce(json_agg(json_build_object(
            'order_id', o.id, 'title', coalesce(o.product_title, o.product), 'kleur', o.kleur,
            'qty', o.qty, 'weight_g', o.weight_grams, 'shop_order_no', o.shop_order_no,
            'member_email', mu.email
          ) order by o.user_id, o.created_at), '[]'::json)
          from public.orders o left join auth.users mu on mu.id = o.user_id
          where o.ff_group_id = s.group_id and coalesce(o.group_shipping_paid, false)
            and o.status not in ('cancelled')
        )
      ) order by s.all_paid_at)
      from public.ff_group_shipments s
      join public.flowva_groups g on g.id = s.group_id
      left join auth.users hu on hu.id = g.host_id
      where s.all_paid_at is not null and s.merged_at is null and s.settled_at is null
    ), '[]'::json));
end; $$;
revoke execute on function public.admin_list_to_ship() from public, anon;
grant execute on function public.admin_list_to_ship() to authenticated;

-- Afvinken: gemerged + verzonden in BuckyDrop gedaan.
create or replace function public.admin_mark_merged(p_kind text, p_id text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  if p_kind = 'solo' then
    update public.hauls set merged_at = now() where id = p_id::uuid and merged_at is null;
  elsif p_kind = 'friends' then
    update public.ff_group_shipments set merged_at = now() where group_id = p_id::uuid and merged_at is null;
  else
    return json_build_object('ok', false, 'error', 'onbekend type');
  end if;
  if not found then return json_build_object('ok', false, 'error', 'niet gevonden / al afgevinkt'); end if;
  return json_build_object('ok', true);
end; $$;
revoke execute on function public.admin_mark_merged(text, text) from public, anon;
grant execute on function public.admin_mark_merged(text, text) to authenticated;
