-- ============================================================
-- Flowva — GELD-LOCKDOWN, laag 2: orders-statusmachine afschermen
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- Idempotent: veilig om (opnieuw) te draaien.  (Draai eerst laag 1.)
--
-- WAAROM (uit de geld-pad-audit 2026-06-24):
--  #1 (kritiek)  klant zette zelf return_status='requested' op een geleverde
--                order → automatische volledige refund, product behouden.
--  #4 (hoog)     klant kon rechtstreeks een order INSERTen met status
--                'quote_accepted' + price 0 → gratis product + fabrieksbestelling.
--  #5 (hoog)     klant zette zelf status='shipped_international' zonder de
--                verzendkosten te betalen → gratis verzenden; + dubbel betalen.
--
-- AANPAK: de guard-trigger keurt voortaan ook status/return_status/
-- dispute_status, en laat ALLE niet-'authenticated' schrijvers door
-- (SECURITY DEFINER-RPC's draaien als owner, edge functions als service_role).
-- De legitieme klant-acties lopen via nieuwe/bestaande RPC's. Directe
-- order-INSERT door de client wordt volledig ingetrokken (alle orders
-- ontstaan server-side via pay_cart / pay_quote / friends).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Guard uitbreiden. Nieuw t.o.v. security-hardening.sql:
--    (a) current_user<>'authenticated' → vertrouwd (RPC owner / service_role).
--    (b) klant mag status / return_status / dispute_status NIET zelf zetten.
-- ------------------------------------------------------------
create or replace function public.guard_order_customer_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_role text;
begin
  -- Alleen DIRECTE writes door de PostgREST-rol 'authenticated' (echte klant/agent)
  -- worden gekeurd. SECURITY DEFINER-RPC's draaien als owner (postgres) en
  -- edge functions als service_role → current_user is dan niet 'authenticated'
  -- → vertrouwd, laat door (anders zouden cancel/return/shipping-RPC's hier sneuvelen).
  if current_user <> 'authenticated' then
    return new;
  end if;

  select role into v_role from public.profiles where id = auth.uid();
  if coalesce(v_role, '') in ('agent', 'admin') then
    return new;  -- personeel mag alles
  end if;

  -- KLANT: offerte- en gewichtsvelden NOOIT wijzigen.
  if new.quoted_total is distinct from old.quoted_total
     or new.quoted_price is distinct from old.quoted_price
     or new.quoted_local_shipping is distinct from old.quoted_local_shipping
     or new.weight_grams is distinct from old.weight_grams then
    raise exception 'Niet toegestaan: offerte- of gewichtsvelden';
  end if;

  -- price mag alleen gelijk aan quoted_total gezet worden (de betaal-RPC).
  if new.price is distinct from old.price and new.price is distinct from new.quoted_total then
    raise exception 'Niet toegestaan: je mag de prijs niet wijzigen';
  end if;

  -- probleem alleen wegklikken (→ null), niet zelf zetten.
  if new.problem_type is distinct from old.problem_type and new.problem_type is not null then
    raise exception 'Niet toegestaan: alleen je agent meldt een probleem';
  end if;

  -- NIEUW: status-machine + refund/retour-triggers lopen UITSLUITEND via RPC's
  -- (cancel_unpaid_request, cancel_paid_order, request_item_return, submit_dispute,
  -- pay_shipping). Die draaien als owner en passeren bovenstaande current_user-gate.
  if new.status is distinct from old.status then
    raise exception 'Niet toegestaan: de orderstatus verloopt via het systeem';
  end if;
  if new.return_status is distinct from old.return_status then
    raise exception 'Niet toegestaan: een retour verloopt via "Request a return"';
  end if;
  if new.dispute_status is distinct from old.dispute_status then
    raise exception 'Niet toegestaan: een probleem melden verloopt via de app-knop';
  end if;

  return new;
end;
$$;

-- Trigger opnieuw zekerstellen (idempotent).
drop trigger if exists guard_order_customer_writes_trg on public.orders;
create trigger guard_order_customer_writes_trg
  before update on public.orders
  for each row execute function public.guard_order_customer_writes();

-- ------------------------------------------------------------
-- 2. #4 dicht: de client maakt NOOIT zelf een order aan (pay_cart /
--    pay_quote / friends doen dat server-side via SECURITY DEFINER).
--    Trek directe INSERT op orders in voor de client-rollen.
-- ------------------------------------------------------------
revoke insert on public.orders from anon, authenticated;

-- ------------------------------------------------------------
-- 3. Klant annuleert een ONBETAALDE aanvraag. (Betaald → cancel_paid_order
--    met refund, bestaat al.) Vervangt de directe status='cancelled'-write.
-- ------------------------------------------------------------
create or replace function public.cancel_unpaid_request(p_order_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_order record;
begin
  select * into v_order from public.orders
   where id = p_order_id and user_id = auth.uid() for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Order not found');
  end if;

  -- Alleen ECHT onbetaalde aanvragen: als er een 'order'-afschrijving bestaat,
  -- is er geld mee gemoeid → moet via cancel_paid_order (met refund) lopen.
  if exists (select 1 from public.transactions where order_id = p_order_id and type = 'order') then
    return json_build_object('ok', false, 'error', 'Order already paid — use cancel & refund');
  end if;
  if v_order.status in ('purchased', 'shipped_international', 'arrived', 'cancelled') then
    return json_build_object('ok', false, 'error', 'Cannot cancel at this stage');
  end if;

  update public.orders set status = 'cancelled', problem_type = null where id = p_order_id;
  return json_build_object('ok', true);
end;
$$;

grant execute on function public.cancel_unpaid_request(text) to authenticated;

-- ------------------------------------------------------------
-- 4. Klant meldt een probleem (dispute). Vervangt de directe
--    dispute_status='pending'-write. Eigenaar-gescoped + idempotent.
-- ------------------------------------------------------------
create or replace function public.submit_dispute(
  p_order_id    text,
  p_description text,
  p_images      jsonb default '[]'::jsonb
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_order record;
begin
  select * into v_order from public.orders
   where id = p_order_id and user_id = auth.uid() for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Order not found');
  end if;
  if v_order.dispute_status is not null then
    return json_build_object('ok', true, 'already', true);  -- al een dispute open
  end if;

  update public.orders
     set dispute_status      = 'pending',
         dispute_description  = p_description,
         dispute_images       = coalesce(p_images, '[]'::jsonb),
         dispute_requested_at = now()
   where id = p_order_id;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.submit_dispute(text, text, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 5. #5 dicht: pay_shipping zet de status nu ZELF server-side (geen
--    losse client-write meer) + qc_pending-gate + per-item gewicht +
--    atomaire claim zodat dubbel betalen onmogelijk is.
-- ------------------------------------------------------------
create or replace function public.pay_shipping(p_order_ids text[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
  v_unweighed int;
  v_claimed int;
  v_weight numeric;
  v_goods numeric;
  v_ship numeric;
  v_ship_buffered numeric;
  v_vat numeric;
  v_total numeric;
  v_balance numeric;
  c_first_kg  constant numeric := 0.5;
  c_first_eur constant numeric := 9.0;
  c_per_kg    constant numeric := 8.5;
  c_buffer    constant numeric := 1.3;
  c_vat       constant numeric := 0.21;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'Not logged in');
  end if;

  -- Alleen eigen producten die KLAAR staan voor verzending (qc_pending).
  select count(*),
         count(*) filter (where coalesce(weight_grams, 0) = 0),
         coalesce(sum(weight_grams), 0),
         coalesce(sum(price), 0)
    into v_count, v_unweighed, v_weight, v_goods
    from orders
   where id = any(p_order_ids) and user_id = v_uid and status = 'qc_pending';

  if v_count = 0 or v_count <> coalesce(array_length(p_order_ids, 1), 0) then
    return json_build_object('ok', false, 'error', 'One or more products not available for shipping');
  end if;
  if v_unweighed > 0 then
    return json_build_object('ok', false, 'error', 'Some items are not weighed yet');
  end if;
  if v_weight <= 0 then
    return json_build_object('ok', false, 'error', 'Weight missing — shipping unknown');
  end if;

  -- Bedrag server-side (first-weight-blok + per kg, ×buffer, + 21% DDP-BTW).
  v_ship := c_first_eur + greatest(0, (v_weight / 1000.0) - c_first_kg) * c_per_kg;
  v_ship_buffered := round(v_ship * c_buffer, 2);
  v_vat := round((v_goods + v_ship) * c_vat, 2);
  v_total := v_ship_buffered + v_vat;

  -- Saldo vergrendelen (serialiseert gelijktijdige aanroepen van dezelfde klant).
  select balance into v_balance from profiles where id = v_uid for update;
  if coalesce(v_balance, 0) < v_total then
    return json_build_object('ok', false, 'error', 'Insufficient balance', 'needed', v_total);
  end if;

  -- ATOMAIRE CLAIM: flip qc_pending → shipped_international en tel hoeveel rijen
  -- we echt claimden. Een 2e (gelijktijdige of herhaalde) aanroep vindt 0
  -- qc_pending-rijen → v_claimed klopt niet → rollback → geen dubbele afschrijving.
  with claimed as (
    update orders set status = 'shipped_international'
     where id = any(p_order_ids) and user_id = v_uid and status = 'qc_pending'
     returning 1
  )
  select count(*) into v_claimed from claimed;

  if v_claimed <> coalesce(array_length(p_order_ids, 1), 0) then
    raise exception 'Items already shipped or unavailable';  -- rolt alles terug
  end if;

  -- Pas NA de geslaagde claim afschrijven + boeken.
  update profiles set balance = balance - v_total where id = v_uid;
  insert into transactions (user_id, amount, type) values (v_uid, -v_total, 'shipping');

  return json_build_object('ok', true, 'paid', v_total, 'shipping', v_ship_buffered, 'vat', v_vat);
end;
$$;

grant execute on function public.pay_shipping(text[]) to authenticated;
