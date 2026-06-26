-- ============================================================
-- Flowva — verzending als SCHATTING + buffer + handmatige refund.
--
-- Vera (BuckyDrop) bevestigt: er is GEEN API voor de eindprijs van de verzending.
-- De echte verzendkosten komen ~1 week NA verzending handmatig in BuckyDrop
-- (als "Supplement of refund"). Daarom dit model:
--   * Bij verzenden betaalt de klant de LIVE quote × 1,25 (buffer, zodat de
--     winkelier nooit te kort komt) + fulfilment ¥9,9. Tax-inclusive (DDP) lijn → geen losse BTW.
--   * De admin vult ~1 week later de ECHTE verzendprijs in (admin_settle_parcel) →
--     de klant krijgt het verschil terug. Balance-mutatie ALTIJD gekoppeld aan een
--     transactie (reconciliatie-invariant) — type 'shipping_refund' (positief).
--
-- ÉÉN refund-bron: admin_settle_parcel én de (legacy) agent_settle_haul gebruiken nu
-- DEZELFDE formule en sluiten elkaar wederzijds uit (status='shipped' ÉN settled_at) →
-- een pakket kan NOOIT twee keer terugbetaald worden.
--
-- LET OP: LIVE_BUFFER (1.25) moet gelijk blijven aan src/WarehouseAndHaul.jsx.
-- ============================================================

alter table public.hauls add column if not exists refund_eur numeric;
alter table public.hauls add column if not exists settled_at timestamptz;
alter table public.hauls add column if not exists exact_shipping_eur numeric;  -- echte freight (door admin/agent ingevuld)
alter table public.hauls add column if not exists settle_proof_url text;       -- bewijs: screenshot van de echte BuckyDrop-factuurregel (openbaar zichtbaar voor de klant)

-- ------------------------------------------------------------
-- 1) Buffered verzendbetaling — ALLEEN door de edge function `haul-shipping`
--    (service-role). De client stuurt NOOIT een prijs; de edge fn levert de RAW
--    live-quote (p_estimate) aan, deze functie zet de buffer erop.
--    estimate_eur = ruwe quote · shipping_eur = wat de klant voor verzending betaalde (buffered).
-- ------------------------------------------------------------
create or replace function public.pay_shipping_buffered(
  p_uid          uuid,
  p_order_ids    text[],
  p_estimate     numeric,   -- ruwe live freight (EUR), vóór buffer
  p_vat          numeric,   -- 0 voor tax-inclusive/DDP, anders 21% van de quote
  p_service_code text,
  p_service_name text
)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_balance numeric;
  v_haul_id hauls.id%type;
  v_buffer constant numeric := 1.25;
  v_ship_buffered numeric;
  v_vat numeric;
  v_fulfil numeric;
  v_charge numeric;
begin
  if p_uid is null then return json_build_object('ok', false, 'error', 'No user'); end if;
  if coalesce(p_estimate, 0) <= 0 then return json_build_object('ok', false, 'error', 'Invalid estimate'); end if;

  select count(*) into v_count
    from orders where id = any(p_order_ids) and user_id = p_uid and status = 'qc_pending';
  if v_count = 0 or v_count <> coalesce(array_length(p_order_ids, 1), 0) then
    return json_build_object('ok', false, 'error', 'Items not available for shipping');
  end if;

  v_ship_buffered := round(p_estimate * v_buffer, 2);
  v_vat := round(coalesce(p_vat, 0), 2);
  v_fulfil := round(9.9 / 7.8, 2);          -- fulfilment ¥9,9 per pakket
  v_charge := round(v_ship_buffered + v_vat + v_fulfil, 2);

  select balance into v_balance from profiles where id = p_uid for update;
  if coalesce(v_balance, 0) < v_charge then
    return json_build_object('ok', false, 'error', 'Insufficient balance', 'needed', v_charge);
  end if;

  update profiles set balance = balance - v_charge where id = p_uid;

  insert into hauls (user_id, status, estimate_eur, shipping_eur, vat_eur, paid_eur, items, service_code, service_name)
  values (p_uid, 'confirmed', round(p_estimate, 2), v_ship_buffered, v_vat, v_charge, to_jsonb(p_order_ids), p_service_code, p_service_name)
  returning id into v_haul_id;

  insert into haul_items (haul_id, order_id) select v_haul_id, unnest(p_order_ids);

  insert into transactions (user_id, amount, type) values (p_uid, -(v_ship_buffered + v_vat), 'shipping');
  insert into transactions (user_id, amount, type) values (p_uid, -v_fulfil, 'fulfillment');

  update orders set status = 'shipped_international' where id = any(p_order_ids) and user_id = p_uid;

  return json_build_object('ok', true, 'paid', v_charge, 'shipping', v_ship_buffered, 'vat', v_vat, 'fulfillment', v_fulfil, 'haul_id', v_haul_id);
end; $$;

revoke all on function public.pay_shipping_buffered(uuid, text[], numeric, numeric, text, text) from public;
revoke all on function public.pay_shipping_buffered(uuid, text[], numeric, numeric, text, text) from authenticated;
grant execute on function public.pay_shipping_buffered(uuid, text[], numeric, numeric, text, text) to service_role;

-- ------------------------------------------------------------
-- 2) Admin vult de ECHTE verzendprijs in → klant krijgt het verschil terug.
--    FOR UPDATE (race-veilig) + cross-guard met agent_settle_haul (status='shipped').
--    refund = wat de klant voor verzending betaalde (shipping_eur, buffered) − echte prijs.
-- ------------------------------------------------------------
drop function if exists public.admin_settle_parcel(uuid, numeric);
create or replace function public.admin_settle_parcel(p_haul_id uuid, p_actual_eur numeric, p_proof_url text default null)
returns json language plpgsql security definer set search_path = public as $$
declare h record; v_actual numeric; v_refund numeric;
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'Alleen admins');
  end if;
  if p_actual_eur is null or p_actual_eur < 0 then
    return json_build_object('ok', false, 'error', 'Ongeldige prijs');
  end if;
  select * into h from hauls where id = p_haul_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Parcel niet gevonden'); end if;
  if h.settled_at is not null or h.status = 'shipped' then
    return json_build_object('ok', false, 'error', 'Al afgehandeld');
  end if;

  v_actual := round(p_actual_eur, 2);
  v_refund := greatest(0, round(coalesce(h.shipping_eur, 0) - v_actual, 2));

  update hauls set exact_shipping_eur = v_actual, refund_eur = v_refund,
                   settle_proof_url = nullif(trim(coalesce(p_proof_url, '')), ''),
                   settled_at = now(), status = 'shipped'
   where id = p_haul_id;

  if v_refund > 0 then
    update profiles set balance = balance + v_refund where id = h.user_id;
    insert into transactions (user_id, amount, type) values (h.user_id, v_refund, 'shipping_refund');
  end if;

  return json_build_object('ok', true, 'refund', v_refund, 'actual', v_actual);
end; $$;
grant execute on function public.admin_settle_parcel(uuid, numeric, text) to authenticated;

-- ------------------------------------------------------------
-- 3) Legacy AgentPanel-afwikkeling — GELIJKGETROKKEN met admin_settle_parcel zodat
--    beide paden exact dezelfde refund geven (shipping_eur − echt, gevloerd op 0) en
--    elkaar wederzijds uitsluiten (geen dubbele refund). Zet ook settled_at.
-- ------------------------------------------------------------
create or replace function public.agent_settle_haul(p_haul_id text, p_exact_eur numeric, p_tracking text)
returns json language plpgsql security definer set search_path = public as $$
declare v_haul record; v_actual numeric; v_refund numeric;
begin
  if not public.is_staff() then return json_build_object('ok', false, 'error', 'Only staff'); end if;
  if p_exact_eur is null or p_exact_eur < 0 then return json_build_object('ok', false, 'error', 'Invalid shipping amount'); end if;
  select * into v_haul from public.hauls where id::text = p_haul_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Haul not found'); end if;
  if v_haul.status = 'shipped' or v_haul.settled_at is not null then
    return json_build_object('ok', true, 'duplicate', true);
  end if;

  v_actual := round(p_exact_eur, 2);
  v_refund := greatest(0, round(coalesce(v_haul.shipping_eur, 0) - v_actual, 2));

  update public.hauls
     set status = 'shipped', exact_shipping_eur = v_actual, refund_eur = v_refund,
         settled_at = now(), tracking_number = p_tracking
   where id::text = p_haul_id;

  if v_refund > 0 then
    update public.profiles set balance = coalesce(balance, 0) + v_refund where id = v_haul.user_id;
    insert into public.transactions (user_id, amount, type) values (v_haul.user_id, v_refund, 'shipping_refund');
  end if;

  update public.orders set status = 'shipped_international', tracking_number = p_tracking
   where id in (select jsonb_array_elements_text(coalesce(v_haul.items, '[]'::jsonb)));

  return json_build_object('ok', true, 'refunded', v_refund);
end; $$;
revoke execute on function public.agent_settle_haul(text, numeric, text) from anon;
grant  execute on function public.agent_settle_haul(text, numeric, text) to authenticated;

-- ------------------------------------------------------------
-- 4) Admin-lijst: alle pakketten (open = nog niet afgehandeld eerst), met wat de
--    klant betaalde + de productnamen, zodat de admin ~1 week later de echte prijs invult.
-- ------------------------------------------------------------
create or replace function public.admin_list_parcels()
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'Alleen admins');
  end if;
  return json_build_object('ok', true, 'parcels', coalesce((
    select json_agg(json_build_object(
      'id', h.id, 'user_id', h.user_id, 'email', u.email,
      'created_at', h.created_at, 'status', h.status,
      'estimate_eur', h.estimate_eur, 'shipping_eur', h.shipping_eur, 'paid_eur', h.paid_eur,
      'exact_shipping_eur', h.exact_shipping_eur, 'refund_eur', h.refund_eur, 'settled_at', h.settled_at,
      'service_name', h.service_name, 'carrier_name', h.carrier_name, 'tracking_no', h.tracking_no,
      'item_count', coalesce(jsonb_array_length(h.items), 0),
      'products', (
        select coalesce(json_agg(coalesce(o.product_title, o.product)), '[]'::json)
        from orders o where o.id in (select jsonb_array_elements_text(h.items))
      )
    ) order by (h.settled_at is not null), h.created_at desc)
    from hauls h left join auth.users u on u.id = h.user_id
  ), '[]'::json));
end; $$;
grant execute on function public.admin_list_parcels() to authenticated;

-- ------------------------------------------------------------
-- 5) De ×1,3-noodvariant pay_shipping(text[]) is vervangen door pay_shipping_buffered
--    (via de edge function). Hij was nog client-callable (authenticated) → exposure
--    (klant kon directe debit met een verouderd model). Intrekken + verwijderen.
--    NB: verwijder/heractiveer de oude definities in pay-shipping.sql en
--    money-lockdown-2-orders.sql NIET opnieuw.
-- ------------------------------------------------------------
drop function if exists public.pay_shipping(text[]);
