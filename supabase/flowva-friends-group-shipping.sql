-- ============================================================================
-- FLOWVA FRIENDS — gewicht-gesplitste GROEP-verzending (directe betaling)
-- ============================================================================
-- Model (besloten 2026-06-26, na ontwerp-ronde):
--   * De host BEVRIEST één gecombineerde live BuckyDrop-quote over alle groep-items
--     (edge function haul-shipping-group → ff_lock_group_shipping_quote). Vanaf dat
--     moment deelt iedereen door EXACT hetzelfde totaalgewicht (de besparing).
--   * Elk lid betaalt z'n eigen gewichtsaandeel RECHTSTREEKS aan Flowva (geen hold-pot,
--     geen tussenpersoon — juridisch: de host is geen wederverkoper). buffer ×1,25 zoals
--     solo; DDP/tax-inclusive → geen losse BTW; fulfilment ¥9,9 PER PAKKET (÷ members).
--   * Zodra het LAATSTE lid betaalt → administratief verzonden (orders → shipped_international,
--     status 'consolidating') + de admin krijgt het consolidatie-signaal
--     (admin_list_group_consolidations) en voegt de losse orders handmatig samen tot één
--     pakket naar de host (BuckyDrop heeft GEEN create-parcel/freight-API).
--   * ~1 week later vult de admin de ECHTE freight in (admin_settle_group_parcel) → het
--     verschil wordt teruggestort, GESPLITST op exact wat elk lid betaalde (ff_shipping_shares).
--   * Wanbetaler: na de deadline dropt de host 'm (ff_drop_unpaid_and_requote) → z'n items
--     uit de doos, quote void → host vergrendelt opnieuw over de rest. Reeds-betaalden
--     worden NOOIT teruggezet (anti-dubbel-charge); buffer + naverrekening vangen het verschil.
--
-- GELD-INVARIANTEN (zoals de rest van de codebase):
--   * NOOIT balance zetten zonder gekoppelde transactions-regel.
--   * profiles-rij FOR UPDATE + TOCTOU her-check ná de lock (geen dubbele afschrijving).
--   * Lock-volgorde: ff_group_shipments-rij → dan profiles-rij (consistent, geen deadlock).
--   * Refund gevloerd op 0 (de ×1,25-buffer dekt; geen bijbetaling). Restcent → laatste lid.
--   * buffer = 1.25 (gelijk aan pay_shipping_buffered) — NIET de oude 1.3.
--
-- Idempotent. Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- ============================================================================

-- ── Kolommen ────────────────────────────────────────────────────────────────
alter table public.orders add column if not exists box_staged_at timestamptz;      -- gedeelde-doos status (al live via MCP; hier voor repo-volledigheid)
alter table public.orders add column if not exists group_shipping_paid boolean default false;  -- bestaat al (fulfillment.sql); idempotent

-- ── Settlement-state: één rij per groep-verzending (de BEVROREN quote) ─────────
create table if not exists public.ff_group_shipments (
  group_id                uuid primary key references public.flowva_groups(id) on delete cascade,
  status                  text not null default 'quoted',   -- quoted | consolidating | shipped | void
  total_weight_g          numeric,                          -- BEVROREN gecombineerd gewicht (split-basis)
  estimate_eur            numeric,                          -- RAW live freight (vóór buffer)
  service_code            text,
  service_name            text,
  tax_inclusive           boolean default true,
  members_total           int,                              -- # leden met ≥1 meetellend item bij de lock
  locked_at               timestamptz default now(),
  pay_deadline            timestamptz,
  all_paid_at             timestamptz,
  consolidate_signaled_at timestamptz,
  settled_at              timestamptz,
  exact_shipping_eur      numeric,                          -- echte freight (admin)
  refund_total_eur        numeric,
  settle_proof_url        text,
  tracking_no             text,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

-- ── Wat elk lid feitelijk betaalde (refund-basis + members_paid-bron) ─────────
create table if not exists public.ff_shipping_shares (
  group_id          uuid not null references public.flowva_groups(id) on delete cascade,
  user_id           uuid not null,
  weight_g          numeric,
  ship_buffered_eur numeric,   -- gebufferde verzending die dit lid betaalde (refund splitst hierop)
  vat_eur           numeric,
  fulfil_eur        numeric,
  total_eur         numeric,   -- totaal afgeschreven
  paid_at           timestamptz default now(),
  primary key (group_id, user_id)
);

-- RPC-only tabellen: RLS aan, geen policies → alleen security-definer functies (owner) komen erbij.
alter table public.ff_group_shipments enable row level security;
alter table public.ff_shipping_shares enable row level security;

-- ── ff_stage_box: lid (de)staget z'n EIGEN groep-items in de gedeelde doos ─────
-- (al live via MCP; hier voor repo-volledigheid + de na-lock-guard toegevoegd.)
create or replace function public.ff_stage_box(p_order_ids text[], p_staged boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_n int;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  update public.orders o
     set box_staged_at = case when p_staged then now() else null end
   where o.id = any(p_order_ids)
     and o.user_id = v_uid
     and o.status = 'qc_pending'
     and o.ff_group_id is not null
     and exists (select 1 from public.flowva_group_members m where m.group_id = o.ff_group_id and m.user_id = v_uid)
     -- Na het vergrendelen van de quote mag je niet meer slepen (anders schuift de bevroren split).
     and not exists (select 1 from public.ff_group_shipments s
                      where s.group_id = o.ff_group_id and s.status in ('quoted','consolidating','shipped'))
     -- Een AL-BETAALD item mag je nooit uit de doos halen (anders zou het niet verzonden worden).
     and (p_staged or not coalesce(o.group_shipping_paid, false));
  get diagnostics v_n = row_count;
  return json_build_object('ok', true, 'updated', v_n);
end; $$;
grant execute on function public.ff_stage_box(text[], boolean) to authenticated;

-- ── ff_group_orders: alleen-lezen squad-overzicht (al live; repo-volledigheid) ─
create or replace function public.ff_group_orders(p_group_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_admin uuid; v_host uuid;
begin
  if not exists (select 1 from public.flowva_group_members where group_id = p_group_id and user_id = auth.uid()) then
    return json_build_object('ok', false, 'error', 'Not a member');
  end if;
  select admin_id, host_id into v_admin, v_host from public.flowva_groups where id = p_group_id;
  return json_build_object('ok', true, 'admin_id', v_admin, 'host_id', v_host, 'orders', coalesce((
    select json_agg(json_build_object(
      'id', o.id, 'user_id', o.user_id,
      'product_title', coalesce(o.product_title, o.product),
      'status', o.status, 'kleur', o.kleur, 'variant_image', o.variant_image, 'qty', o.qty,
      'qc_images', o.qc_images, 'measurement_images', o.measurement_images, 'weight_grams', o.weight_grams,
      'box_staged_at', o.box_staged_at, 'return_status', o.return_status, 'group_shipping_paid', o.group_shipping_paid,
      'member', coalesce(nullif(left(trim(coalesce(u.raw_user_meta_data->>'voornaam','') || ' ' || coalesce(u.raw_user_meta_data->>'achternaam','')), 40), ''), 'Friend'),
      'avatar_url', nullif(u.raw_user_meta_data->>'avatar_url', '')
    ) order by o.user_id, o.created_at)
    from public.orders o left join auth.users u on u.id = o.user_id
    where o.ff_group_id = p_group_id and o.status <> 'cancelled'
  ), '[]'::json));
end; $$;
grant execute on function public.ff_group_orders(uuid) to authenticated;

-- ── ff_try_finalize_group_shipment: laatste betaling → administratief verzenden (INTERN) ─
-- Staat vóór z'n aanroepers (ff_lock + ff_pay) zodat de create-time body-check niet struikelt.
create or replace function public.ff_try_finalize_group_shipment(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_s record; v_paid int;
begin
  select * into v_s from public.ff_group_shipments where group_id = p_group_id;
  if not found or v_s.status <> 'quoted' then return; end if;     -- idempotent: maar één keer finaliseren
  -- LIVE-gate (niet de bevroren members_total): finaliseer pas als er GEEN meetellend (gestaged,
  -- niet-geretourneerd) item meer ONBETAALD is, én er minstens één betaald item is (geen lege doos).
  select count(*) into v_paid from public.ff_shipping_shares where group_id = p_group_id;
  if v_paid = 0 then return; end if;
  if exists (
    select 1 from public.orders
     where ff_group_id = p_group_id and status = 'qc_pending'
       and coalesce(return_status, '') = '' and box_staged_at is not null
       and not coalesce(group_shipping_paid, false)
  ) then return; end if;

  -- Alleen BETAALDE, gestagede, niet-geretourneerde items administratief verzenden.
  update public.orders set status = 'shipped_international'
   where ff_group_id = p_group_id and status = 'qc_pending' and coalesce(return_status, '') = ''
     and box_staged_at is not null and coalesce(group_shipping_paid, false);
  update public.ff_group_shipments
     set status = 'consolidating', all_paid_at = now(), consolidate_signaled_at = now(), updated_at = now()
   where group_id = p_group_id;
end; $$;
revoke all on function public.ff_try_finalize_group_shipment(uuid) from public, anon, authenticated;

-- ── ff_lock_group_shipping_quote: bevriest de gecombineerde quote (SERVICE-ROLE) ─
-- Aangeroepen door de edge function haul-shipping-group (prijs server-side afgeleid).
create or replace function public.ff_lock_group_shipping_quote(
  p_group_id uuid, p_estimate numeric, p_total_weight_g numeric,
  p_service_code text, p_service_name text, p_tax_inclusive boolean
) returns json language plpgsql security definer set search_path = public as $$
declare v_members int; v_unstaged int; v_existing record;
begin
  if coalesce(p_estimate, 0) <= 0 or coalesce(p_total_weight_g, 0) <= 0 then
    return json_build_object('ok', false, 'error', 'Invalid quote'); end if;
  -- Serialiseer per groep zodat twee gelijktijdige EERSTE locks niet allebei langs de 'already'-guard glippen.
  perform pg_advisory_xact_lock(hashtext('ff_group_ship:' || p_group_id::text));

  -- Gate: élk meetellend (qc_pending, niet-geretourneerd) groep-item moet gestaged + gewogen zijn.
  select count(*) into v_unstaged from public.orders
   where ff_group_id = p_group_id and status = 'qc_pending' and coalesce(return_status, '') = ''
     and (box_staged_at is null or coalesce(weight_grams, 0) <= 0);
  if v_unstaged > 0 then
    return json_build_object('ok', false, 'error', 'All items must be in the box and weighed first'); end if;

  select count(distinct user_id) into v_members from public.orders
   where ff_group_id = p_group_id and status = 'qc_pending' and coalesce(return_status, '') = ''
     and box_staged_at is not null;
  if v_members = 0 then return json_build_object('ok', false, 'error', 'No items to ship'); end if;

  -- Idempotent: een al ACTIEVE quote niet overschrijven (anders schuift de split mid-betaling).
  select * into v_existing from public.ff_group_shipments where group_id = p_group_id for update;
  if found and v_existing.status in ('quoted', 'consolidating', 'shipped') then
    return json_build_object('ok', true, 'already', true, 'status', v_existing.status); end if;

  insert into public.ff_group_shipments
    (group_id, status, total_weight_g, estimate_eur, service_code, service_name, tax_inclusive, members_total, locked_at, pay_deadline, updated_at)
  values
    (p_group_id, 'quoted', round(p_total_weight_g), round(p_estimate, 2), p_service_code, p_service_name,
     coalesce(p_tax_inclusive, true), v_members, now(), now() + interval '72 hours', now())
  on conflict (group_id) do update set
    status = 'quoted', total_weight_g = round(p_total_weight_g), estimate_eur = round(p_estimate, 2),
    service_code = p_service_code, service_name = p_service_name, tax_inclusive = coalesce(p_tax_inclusive, true),
    members_total = v_members, locked_at = now(), pay_deadline = now() + interval '72 hours',
    all_paid_at = null, consolidate_signaled_at = null, updated_at = now();

  -- Re-lock-edge: viel alleen de wanbetaler weg en heeft de rest al betaald → meteen finaliseren.
  perform public.ff_try_finalize_group_shipment(p_group_id);
  return json_build_object('ok', true, 'members', v_members);
end; $$;
revoke all on function public.ff_lock_group_shipping_quote(uuid, numeric, numeric, text, text, boolean) from public, anon, authenticated;
grant execute on function public.ff_lock_group_shipping_quote(uuid, numeric, numeric, text, text, boolean) to service_role;

-- ── ff_pay_group_shipping: lid betaalt z'n gewichtsaandeel (DIRECT, geen hold) ──
-- HERSCHREVEN — vervangt de verouderde first-weight/×1,3-versie (zelfde signatuur).
create or replace function public.ff_pay_group_shipping(p_group_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_s record;
  v_my_weight numeric; v_my_count int; v_my_unpaid int;
  v_raw numeric; v_ship numeric; v_vat numeric; v_fulfil numeric; v_total numeric;
  v_balance numeric;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;

  -- 1) Shipment-rij locken (serialiseert alle betalers van deze groep).
  select * into v_s from public.ff_group_shipments where group_id = p_group_id for update;
  if not found then return json_build_object('ok', false, 'error', 'The host has not locked the shipping quote yet'); end if;
  if v_s.status <> 'quoted' then return json_build_object('ok', false, 'error', 'Shipping is no longer open for payment'); end if;
  if v_s.pay_deadline is not null and now() > v_s.pay_deadline then
    return json_build_object('ok', false, 'error', 'The payment window has closed — ask the host to re-open shipping'); end if;

  -- 2) Mijn meetellende items + gewicht + of ik al betaalde.
  select count(*), coalesce(sum(weight_grams), 0),
         count(*) filter (where not coalesce(group_shipping_paid, false))
    into v_my_count, v_my_weight, v_my_unpaid
    from public.orders
   where ff_group_id = p_group_id and user_id = v_uid and status = 'qc_pending' and coalesce(return_status, '') = '' and box_staged_at is not null;
  if v_my_count = 0 then return json_build_object('ok', false, 'error', 'You have no items in this shipment'); end if;
  if v_my_unpaid = 0 then return json_build_object('ok', false, 'error', 'You already paid your share'); end if;
  if v_my_weight <= 0 or coalesce(v_s.total_weight_g, 0) <= 0 then
    return json_build_object('ok', false, 'error', 'Weights not known yet'); end if;

  -- 3) Aandeel op het BEVROREN totaal (server-side afgeleid; klant stuurt nooit een prijs).
  v_raw    := v_s.estimate_eur * (v_my_weight / v_s.total_weight_g);
  v_ship   := round(v_raw * 1.25, 2);                                       -- buffer gelijk aan solo
  v_vat    := case when v_s.tax_inclusive then 0 else round(v_raw * 0.21, 2) end;
  v_fulfil := round((9.9 / 7.8) / greatest(coalesce(v_s.members_total, 1), 1), 2);  -- ¥9,9 PER PAKKET (som kan ~1ct afwijken door per-lid afronding; verwaarloosbaar)
  v_total  := round(v_ship + v_vat + v_fulfil, 2);

  -- 4) Saldo locken + TOCTOU her-check (dubbele klik → 'Already paid', geen dubbele afschrijving).
  select balance into v_balance from public.profiles where id = v_uid for update;
  select count(*) filter (where not coalesce(group_shipping_paid, false)) into v_my_unpaid
    from public.orders where ff_group_id = p_group_id and user_id = v_uid and status = 'qc_pending' and coalesce(return_status, '') = '' and box_staged_at is not null;
  if v_my_unpaid = 0 then return json_build_object('ok', false, 'error', 'You already paid your share'); end if;
  if coalesce(v_balance, 0) < v_total then
    return json_build_object('ok', false, 'error', 'Insufficient balance', 'needed', v_total); end if;

  -- 5) Afschrijven + loggen + markeren.
  update public.profiles set balance = balance - v_total where id = v_uid;
  insert into public.transactions (user_id, amount, type) values (v_uid, -(v_ship + v_vat), 'shipping');
  insert into public.transactions (user_id, amount, type) values (v_uid, -v_fulfil, 'fulfillment');
  update public.orders set group_shipping_paid = true
   where ff_group_id = p_group_id and user_id = v_uid and status = 'qc_pending' and coalesce(return_status, '') = '' and box_staged_at is not null;

  insert into public.ff_shipping_shares (group_id, user_id, weight_g, ship_buffered_eur, vat_eur, fulfil_eur, total_eur, paid_at)
  values (p_group_id, v_uid, v_my_weight, v_ship, v_vat, v_fulfil, v_total, now())
  on conflict (group_id, user_id) do update set
    weight_g = excluded.weight_g, ship_buffered_eur = excluded.ship_buffered_eur, vat_eur = excluded.vat_eur,
    fulfil_eur = excluded.fulfil_eur, total_eur = excluded.total_eur, paid_at = now();

  -- 6) Laatste betaler? → administratief verzenden (atomair onder de shipment-lock).
  perform public.ff_try_finalize_group_shipment(p_group_id);

  return json_build_object('ok', true, 'paid', v_total, 'shipping', v_ship, 'vat', v_vat, 'fulfillment', v_fulfil,
    'my_weight', v_my_weight, 'total_weight', v_s.total_weight_g);
end; $$;
grant execute on function public.ff_pay_group_shipping(uuid) to authenticated;

-- ── ff_drop_unpaid_and_requote: host dropt wanbetalers ná de deadline ──────────
create or replace function public.ff_drop_unpaid_and_requote(p_group_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_host uuid; v_s record; v_dropped int;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select host_id into v_host from public.flowva_groups where id = p_group_id;
  if v_host is distinct from v_uid then return json_build_object('ok', false, 'error', 'Only the host can do this'); end if;

  select * into v_s from public.ff_group_shipments where group_id = p_group_id for update;
  if not found or v_s.status <> 'quoted' then return json_build_object('ok', false, 'error', 'No open shipping to re-quote'); end if;
  if v_s.pay_deadline is not null and now() <= v_s.pay_deadline then
    return json_build_object('ok', false, 'error', 'Wait until the payment window closes before dropping members'); end if;

  -- Onbetaalde leden uit de doos → vallen uit de gate + de volgende quote. Reeds-betaalden ONAANGEROERD.
  update public.orders set box_staged_at = null
   where ff_group_id = p_group_id and status = 'qc_pending' and coalesce(return_status, '') = ''
     and not coalesce(group_shipping_paid, false);
  get diagnostics v_dropped = row_count;

  update public.ff_group_shipments set status = 'void', updated_at = now() where group_id = p_group_id;
  return json_build_object('ok', true, 'dropped', v_dropped);
end; $$;
grant execute on function public.ff_drop_unpaid_and_requote(uuid) to authenticated;

-- ── ff_group_shipping_state: alles wat de client nodig heeft (alleen-lezen) ────
create or replace function public.ff_group_shipping_state(p_group_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_s record; v_buffer constant numeric := 1.25;
begin
  if not exists (select 1 from public.flowva_group_members where group_id = p_group_id and user_id = v_uid) then
    return json_build_object('ok', false, 'error', 'Not a member'); end if;
  select * into v_s from public.ff_group_shipments where group_id = p_group_id;
  if not found or v_s.status = 'void' then
    return json_build_object('ok', true, 'shipment', null); end if;

  return json_build_object('ok', true, 'shipment', json_build_object(
    'status', v_s.status, 'total_weight_g', v_s.total_weight_g, 'estimate_eur', v_s.estimate_eur,
    'service_name', v_s.service_name, 'tax_inclusive', v_s.tax_inclusive,
    'members_total', v_s.members_total, 'pay_deadline', v_s.pay_deadline,
    'members_paid', (select count(*) from public.ff_shipping_shares where group_id = p_group_id),
    'members', (
      -- Per lid: gewicht + (live afgeleid) aandeel + betaald-ja/nee. NOOIT andermans goederenwaarde.
      select coalesce(json_agg(json_build_object(
        'user_id', m.user_id, 'member', m.member, 'weight_g', m.weight_g,
        'paid', sh.user_id is not null,
        'share_total', case
          when sh.user_id is not null then sh.total_eur      -- al betaald → toon EXACT wat is afgeschreven
          when coalesce(v_s.total_weight_g,0) > 0 then
            round(v_s.estimate_eur * (m.weight_g / v_s.total_weight_g) * v_buffer, 2)
            + case when v_s.tax_inclusive then 0 else round(v_s.estimate_eur * (m.weight_g / v_s.total_weight_g) * 0.21, 2) end
            + round((9.9/7.8) / greatest(v_s.members_total,1), 2)
          else 0 end
      ) order by m.member), '[]'::json)
      from (
        select o.user_id,
               coalesce(nullif(left(trim(coalesce(u.raw_user_meta_data->>'voornaam','') || ' ' || coalesce(u.raw_user_meta_data->>'achternaam','')), 40), ''), 'Friend') as member,
               sum(o.weight_grams) as weight_g
          from public.orders o left join auth.users u on u.id = o.user_id
         where o.ff_group_id = p_group_id and o.status = 'qc_pending' and coalesce(o.return_status,'') = '' and o.box_staged_at is not null
         group by o.user_id, u.raw_user_meta_data
      ) m
      left join public.ff_shipping_shares sh on sh.group_id = p_group_id and sh.user_id = m.user_id
    )
  ));
end; $$;
grant execute on function public.ff_group_shipping_state(uuid) to authenticated;

-- ── admin_settle_group_parcel: naverrekening → refund gesplitst per lid ────────
create or replace function public.admin_settle_group_parcel(
  p_group_id uuid, p_actual_eur numeric, p_proof_url text default null, p_tracking text default null
) returns json language plpgsql security definer set search_path = public as $$
declare v_s record; v_actual numeric; v_sum_buf numeric; v_refund numeric;
        v_share record; v_allocated numeric := 0; v_last uuid; v_part numeric;
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'Only admins'); end if;
  if p_actual_eur is null or p_actual_eur < 0 then return json_build_object('ok', false, 'error', 'Invalid price'); end if;

  select * into v_s from public.ff_group_shipments where group_id = p_group_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Shipment not found'); end if;
  if v_s.settled_at is not null or v_s.status = 'shipped' then return json_build_object('ok', false, 'error', 'Already settled'); end if;
  if v_s.status <> 'consolidating' then return json_build_object('ok', false, 'error', 'Not ready to settle'); end if;

  v_actual := round(p_actual_eur, 2);
  -- Alleen leden die DAADWERKELIJK in dit pakket verzonden zijn (een teruggestuurd lid hoort niet in de
  -- noemer noch in de uitkering — die liep via de return-pipeline). 'shipped_international' = mee in 't pakket.
  select coalesce(sum(sh.ship_buffered_eur), 0) into v_sum_buf
    from public.ff_shipping_shares sh
   where sh.group_id = p_group_id
     and exists (select 1 from public.orders o where o.ff_group_id = p_group_id and o.user_id = sh.user_id and o.status = 'shipped_international');
  v_refund := greatest(0, round(v_sum_buf - v_actual, 2));   -- gevloerd op 0 (buffer dekt), geen bijbetaling

  if v_refund > 0 and v_sum_buf > 0 then
    -- Het GROOTSTE aandeel draagt de restcent: zo blijft het residu nooit negatief (geen afschrijving
    -- tijdens een settle) én klopt sum(refunds) EXACT. v_last wordt gegarandeerd als laatste verwerkt.
    select sh.user_id into v_last
      from public.ff_shipping_shares sh
     where sh.group_id = p_group_id
       and exists (select 1 from public.orders o where o.ff_group_id = p_group_id and o.user_id = sh.user_id and o.status = 'shipped_international')
     order by sh.ship_buffered_eur desc, sh.user_id desc limit 1;
    for v_share in
      select sh.* from public.ff_shipping_shares sh
       where sh.group_id = p_group_id
         and exists (select 1 from public.orders o where o.ff_group_id = p_group_id and o.user_id = sh.user_id and o.status = 'shipped_international')
       order by (sh.user_id = v_last), sh.ship_buffered_eur, sh.user_id
    loop
      if v_share.user_id = v_last then
        v_part := greatest(0, round(v_refund - v_allocated, 2));
      else
        v_part := round(v_refund * (v_share.ship_buffered_eur / v_sum_buf), 2);
        v_allocated := v_allocated + v_part;
      end if;
      if v_part > 0 then   -- nooit een afschrijving tijdens een naverrekening
        update public.profiles set balance = balance + v_part where id = v_share.user_id;
        insert into public.transactions (user_id, amount, type) values (v_share.user_id, v_part, 'shipping_refund');
      end if;
    end loop;
  end if;

  update public.ff_group_shipments
     set status = 'shipped', settled_at = now(), exact_shipping_eur = v_actual, refund_total_eur = v_refund,
         settle_proof_url = nullif(trim(coalesce(p_proof_url, '')), ''), tracking_no = p_tracking, updated_at = now()
   where group_id = p_group_id;
  if p_tracking is not null then
    update public.orders set tracking_number = p_tracking where ff_group_id = p_group_id and status = 'shipped_international';
  end if;

  return json_build_object('ok', true, 'refund', v_refund, 'actual', v_actual);
end; $$;
grant execute on function public.admin_settle_group_parcel(uuid, numeric, text, text) to authenticated;

-- ── admin_list_group_consolidations: het admin-signaal om te consolideren ──────
create or replace function public.admin_list_group_consolidations()
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'Only admins'); end if;
  return json_build_object('ok', true, 'parcels', coalesce((
    select json_agg(json_build_object(
      'group_id', s.group_id, 'group_name', g.name, 'status', s.status,
      'host_id', g.host_id, 'host_email', hu.email,
      'total_weight_g', s.total_weight_g, 'service_name', s.service_name,
      'estimate_eur', s.estimate_eur, 'paid_buffered_eur', (select coalesce(sum(ship_buffered_eur),0) from public.ff_shipping_shares where group_id = s.group_id),
      'exact_shipping_eur', s.exact_shipping_eur, 'refund_total_eur', s.refund_total_eur, 'settled_at', s.settled_at,
      'all_paid_at', s.all_paid_at,
      'order_ids', (select coalesce(json_agg(o.id), '[]'::json) from public.orders o where o.ff_group_id = s.group_id and o.status = 'shipped_international'),
      'products', (select coalesce(json_agg(coalesce(o.product_title, o.product)), '[]'::json) from public.orders o where o.ff_group_id = s.group_id and o.status = 'shipped_international')
    ) order by (s.settled_at is not null), s.all_paid_at desc)
    from public.ff_group_shipments s
    join public.flowva_groups g on g.id = s.group_id
    left join auth.users hu on hu.id = g.host_id
    where s.status in ('consolidating', 'shipped')
  ), '[]'::json));
end; $$;
grant execute on function public.admin_list_group_consolidations() to authenticated;

-- ── ff_expire_stale_shipments: void quotes >7d die niet voltallig betaald zijn ─
-- Alleen de quote void't (NOOIT group_shipping_paid) → bij requote tellen betaalden als 'paid'.
create or replace function public.ff_expire_stale_shipments(p_max_age_hours int default 168)
returns json language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  with stale as (
    select s.group_id from public.ff_group_shipments s
     where s.status = 'quoted'
       and coalesce(s.locked_at, now()) < now() - make_interval(hours => p_max_age_hours)
       and (select count(*) from public.ff_shipping_shares sh where sh.group_id = s.group_id) < coalesce(s.members_total, 0)
    for update skip locked
  )
  update public.ff_group_shipments t set status = 'void', updated_at = now()
   from stale where t.group_id = stale.group_id;
  get diagnostics v_n = row_count;
  return json_build_object('ok', true, 'voided', v_n);
end; $$;
revoke all on function public.ff_expire_stale_shipments(int) from public, anon, authenticated;

-- Optioneel automatisch (vereist pg_cron):
--   select cron.schedule('ff-expire-ship', '0 4 * * *', $$ select public.ff_expire_stale_shipments(168) $$);

-- ── request_item_return: blokkeer self-service return zodra de groep-verzending vergrendeld/betaald is ──
-- Reproduceert qc-defect-choice.sql + een Flowva Friends-guard (anders verschuift de bevroren split of
-- lekt een verzend-refund bij pay-dan-return). create-or-replace = veilig. Zo'n geval loopt via support.
create or replace function public.request_item_return(p_order_id text, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_order record;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select * into v_order from orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'order not found'); end if;
  if not (v_order.user_id = v_uid or v_order.host_user_id = v_uid) then
    return json_build_object('ok', false, 'error', 'not allowed'); end if;
  if v_order.shop_order_no is null then return json_build_object('ok', false, 'error', 'order not placed yet'); end if;
  if v_order.status = 'cancelled' then return json_build_object('ok', false, 'error', 'order already cancelled'); end if;
  if v_order.return_status is not null then
    return json_build_object('ok', true, 'already', true, 'return_status', v_order.return_status); end if;
  if not (v_order.status = 'qc_pending' or v_order.dispute_status = 'pending' or v_order.dispute_status = 'bucky_flagged') then
    return json_build_object('ok', false, 'error', 'Return is only available at the quality-control stage'); end if;

  -- Flowva Friends: zodra de groep-verzending vergrendeld of al betaald is, niet meer zelf retourneren.
  if v_order.ff_group_id is not null and (
       coalesce(v_order.group_shipping_paid, false)
       or exists (select 1 from public.ff_group_shipments s
                   where s.group_id = v_order.ff_group_id and s.status in ('quoted','consolidating','shipped'))) then
    return json_build_object('ok', false, 'error', 'Shipping is locked for this group — contact support to return this item');
  end if;

  update orders set return_status = 'requested',
        return_reason = coalesce(nullif(trim(p_reason), ''), 'Item not as described / defective'),
        return_requested_at = now()
   where id = p_order_id;
  return json_build_object('ok', true, 'return_status', 'requested');
end; $$;
grant execute on function public.request_item_return(text, text) to authenticated;
