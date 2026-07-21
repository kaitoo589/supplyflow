-- ============================================================================
-- DEFECT-COCKPIT (2026-07-21) — handmatig-eerst model (user-keuze, variant A).
-- QC-defecten krijgen blijvende stempels zodat de admin (ai-ops-hud → Problems)
-- een "Gedetecteerde defecten"-vak kan tonen met klant-keuze + stopwatches.
--
-- Klant-kant:
--   Accept → accept_qc_result (bestond al; stempelt nu ook de keuze)
--   Return → defect_return_refund (NIEUW): DIRECTE volledige refund (variant A)
--            via refund_order; admin doet de fabrieks-retour daarna handmatig
--            in het BuckyDrop-dashboard.
-- Admin-kant: admin_list_defects + admin_resolve_defect (role='admin'-checked).
-- ============================================================================

-- 1) Blijvende stempels (accept wiste eerder alle sporen).
alter table public.orders add column if not exists defect_detected_at timestamptz;
alter table public.orders add column if not exists defect_choice text;
alter table public.orders add column if not exists defect_choice_at timestamptz;
alter table public.orders add column if not exists defect_resolved_at timestamptz;

-- 2) Accept: zelfde gedrag als altijd (vlag weg, item verzendbaar) + keuze-stempel.
create or replace function public.accept_qc_result(p_order_id text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_order record;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'order not found'); end if;

  if not (v_order.user_id = v_uid or v_order.host_user_id = v_uid) then
    return json_build_object('ok', false, 'error', 'not allowed');
  end if;

  if v_order.dispute_status is distinct from 'bucky_flagged' then
    return json_build_object('ok', true, 'already', true);
  end if;

  update orders
     set dispute_status = null, problem_type = null,
         defect_choice = 'accepted', defect_choice_at = now(),
         defect_detected_at = coalesce(defect_detected_at, now())
   where id = p_order_id;
  return json_build_object('ok', true, 'accepted', true);
end;
$$;

-- 3) Return bij een QC-defect = DIRECTE volledige refund (variant A).
--    refund_order (bestaand, bewezen) annuleert + stort product + domestic + QC terug.
--    Zelfde groep-vergrendel-guard als request_item_return: is de groep-verzending al
--    vergrendeld/betaald, dan géén self-service (split zou verschuiven) → via support.
create or replace function public.defect_return_refund(p_order_id text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_order record;
  v_refund json;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'order not found'); end if;
  if not (v_order.user_id = v_uid or v_order.host_user_id = v_uid) then
    return json_build_object('ok', false, 'error', 'not allowed');
  end if;
  if v_order.dispute_status is distinct from 'bucky_flagged' then
    return json_build_object('ok', false, 'error', 'No open defect on this order');
  end if;
  if v_order.status = 'cancelled' then return json_build_object('ok', true, 'already', true); end if;

  if v_order.ff_group_id is not null and (
       coalesce(v_order.group_shipping_paid, false)
       or exists (select 1 from public.ff_group_shipments s
                   where s.group_id = v_order.ff_group_id and s.status in ('quoted','consolidating','shipped'))) then
    return json_build_object('ok', false, 'error', 'Shipping is locked for this group — contact support to return this item');
  end if;

  -- Keuze-stempel VÓÓR de refund (refund_order zet status='cancelled' + bd_error).
  update orders
     set defect_choice = 'return', defect_choice_at = now(),
         defect_detected_at = coalesce(defect_detected_at, now())
   where id = p_order_id;

  -- Volledige refund, direct. bd_error-prefix "Factory defect" → eigen belletje-tekst.
  v_refund := public.refund_order(p_order_id, 'Factory defect — returned & fully refunded');
  if coalesce((v_refund->>'ok')::boolean, false) is not true then
    return json_build_object('ok', false, 'error', coalesce(v_refund->>'error', 'refund failed'));
  end if;

  return json_build_object('ok', true, 'refunded', true);
end;
$$;
grant execute on function public.defect_return_refund(text) to authenticated;

-- 4) Admin: lijst van gedetecteerde defecten (onopgeruimd) + opruim-knop.
--    Flowva Friends-context (2026-07-21): groepsnaam + de groep-ADMIN (=host) —
--    BuckyDrop bestelt naar het adres+mail van de admin, dus dát is de mail
--    die je in het cockpit-vak wil zien/kopiëren bij groep-orders.
create or replace function public.admin_list_defects()
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  return json_build_object('ok', true, 'defects', coalesce((
    select json_agg(json_build_object(
      'id', o.id,
      'product_title', coalesce(o.product_title, o.product),
      'kleur', o.kleur, 'qty', o.qty, 'price', o.price,
      'shop_order_no', o.shop_order_no,
      'problem_type', o.problem_type,
      'qc_images', o.qc_images,
      'status', o.status,
      'is_group', o.ff_group_id is not null,
      'group_name', g.name,
      'group_admin_name', case when o.ff_group_id is not null then
        coalesce(nullif(trim(coalesce(h.raw_user_meta_data->>'voornaam','') || ' ' || coalesce(h.raw_user_meta_data->>'achternaam','')), ''), 'Onbekend') end,
      'group_admin_email', h.email,
      'group_locked', o.ff_group_id is not null and (
        coalesce(o.group_shipping_paid, false)
        or exists (select 1 from public.ff_group_shipments s
                    where s.group_id = o.ff_group_id and s.status in ('quoted','consolidating','shipped'))),
      'defect_detected_at', o.defect_detected_at,
      'defect_choice', o.defect_choice,
      'defect_choice_at', o.defect_choice_at,
      'customer_name', coalesce(nullif(trim(coalesce(u.raw_user_meta_data->>'voornaam','') || ' ' || coalesce(u.raw_user_meta_data->>'achternaam','')), ''), 'Onbekend'),
      'customer_email', u.email
    ) order by o.defect_detected_at desc)
    from public.orders o
    left join auth.users u on u.id = o.user_id
    left join auth.users h on h.id = o.host_user_id
    left join public.flowva_groups g on g.id = o.ff_group_id
    where o.defect_detected_at is not null and o.defect_resolved_at is null
  ), '[]'::json));
end;
$$;
grant execute on function public.admin_list_defects() to authenticated;

create or replace function public.admin_resolve_defect(p_order_id text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  update public.orders set defect_resolved_at = now()
   where id = p_order_id and defect_detected_at is not null;
  if not found then return json_build_object('ok', false, 'error', 'order not found / no defect'); end if;
  return json_build_object('ok', true);
end;
$$;
grant execute on function public.admin_resolve_defect(text) to authenticated;
