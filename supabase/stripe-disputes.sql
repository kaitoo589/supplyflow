-- ============================================================
-- Flowva — Stripe chargebacks (charge.dispute.created / .closed)
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
--
-- Achtergrond / waarom dit nodig is:
--  • Een Stripe-charge bij Flowva is ALTIJD een top-up (balance opladen),
--    nooit een losse order — orders worden intern uit de balance betaald
--    (zie pay_cart). Een chargeback bij de bank raakt dus een payment_intent
--    (= een top-up van één user), niet rechtstreeks één order.
--  • Tot nu toe sloeg de webhook alleen het Stripe SESSION-id op (via
--    apply_top_up → transactions.stripe_session_id). Een dispuut komt binnen
--    op het PAYMENT_INTENT / charge-id, dus konden we het niet terugkoppelen.
--    Daarom: stripe_payments mapt payment_intent → user/top-up.
--  • orders.dispute_status is NIET vrij: die wordt al gebruikt voor het
--    QC/defect-dispuut (BuckyDrop-webhook, klant-UI). Een Stripe-chargeback
--    is een andere as → eigen kolom orders.chargeback_status + eigen tabellen.
-- ============================================================

-- ------------------------------------------------------------
-- 1. payment_intent → user/top-up, plus de dispuut-levenscyclus.
--    RLS aan zonder policies: alleen de service role (webhook) erbij.
-- ------------------------------------------------------------
create table if not exists public.stripe_payments (
  payment_intent     text primary key,        -- Stripe PaymentIntent id (pi_...) — of charge-id als fallback
  charge_id          text,                     -- ch_...
  session_id         text,                     -- cs_... (checkout session)
  user_id            uuid references public.profiles(id),
  amount_eur         numeric,                  -- betaald bedrag (top-up) in euro
  event_id           text,                     -- het checkout.session.completed-event dat de rij maakte

  -- dispuut-velden (leeg zolang er geen chargeback is)
  dispute_id         text,
  dispute_status     text,                     -- needs_response | under_review | won | lost | warning_* ...
  dispute_reason     text,                     -- fraudulent | product_not_received | ...
  dispute_amount     numeric,                  -- betwist bedrag in euro
  disputed_at        timestamptz,              -- moment van charge.dispute.created
  dispute_due_by     timestamptz,              -- deadline om bewijs in te dienen (Stripe evidence_details.due_by)
  dispute_closed_at  timestamptz,              -- moment van charge.dispute.closed

  created_at         timestamptz not null default now()
);

alter table public.stripe_payments enable row level security;

create index if not exists stripe_payments_user_idx on public.stripe_payments (user_id);
create index if not exists stripe_payments_charge_idx on public.stripe_payments (charge_id);

-- ------------------------------------------------------------
-- 2. Durable admin-alerts. De webhook/RPC schrijft hierin (service role);
--    admins lezen het in de command center / AgentPanel. Dit is het
--    BLIJVENDE alert-record — een eventuele e-mail is best-effort extra.
-- ------------------------------------------------------------
create table if not exists public.admin_alerts (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  type           text not null,               -- chargeback_created | chargeback_closed
  severity       text not null default 'high',
  title          text not null,
  body           text,
  user_id        uuid,
  payment_intent text,
  dispute_id     text,
  amount_eur     numeric,
  due_by         timestamptz,
  meta           jsonb,                        -- o.a. candidate_orders met qc_images
  resolved_at    timestamptz
);

alter table public.admin_alerts enable row level security;

-- Alleen admins mogen alerts lezen/afhandelen. Service role (webhook) omzeilt RLS.
drop policy if exists admin_alerts_read on public.admin_alerts;
create policy admin_alerts_read on public.admin_alerts
  for select to authenticated
  using ((select role from public.profiles where id = auth.uid()) = 'admin');

drop policy if exists admin_alerts_update on public.admin_alerts;
create policy admin_alerts_update on public.admin_alerts
  for update to authenticated
  using ((select role from public.profiles where id = auth.uid()) = 'admin')
  with check ((select role from public.profiles where id = auth.uid()) = 'admin');

-- ------------------------------------------------------------
-- 3. Kolommen op orders (idempotent, los van het QC-dispuut).
--    • chargeback_status: aparte as voor Stripe-chargebacks (NIET dispute_status).
--    • qc_images: defensief aanmaken — de BuckyDrop-webhook schrijft hier al
--      naartoe maar er bestaat nog geen migratie; we lezen het hieronder als bewijs.
-- ------------------------------------------------------------
alter table public.orders add column if not exists chargeback_status text;
alter table public.orders add column if not exists qc_images jsonb;

-- ------------------------------------------------------------
-- 4. apply_top_up uitbreiden met payment_intent zodat een latere chargeback
--    terug te koppelen is. Idempotentie + atomiciteit blijven exact gelijk:
--    het event wordt geclaimd in stripe_events, daarna pas balance + transactie.
--    Signatuur wijzigt (extra param) → eerst droppen, dan opnieuw aanmaken.
-- ------------------------------------------------------------
drop function if exists public.apply_top_up(text, text, uuid, numeric);

create or replace function public.apply_top_up(
  p_event_id       text,
  p_session_id     text,
  p_user_id        uuid,
  p_amount         numeric,
  p_payment_intent text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then
    return json_build_object('ok', false, 'error', 'Ongeldig bedrag');
  end if;

  -- Idempotentie: claim het event. Bestaat het al → klaar.
  insert into stripe_events (id, type)
  values (p_event_id, 'checkout.session.completed')
  on conflict (id) do nothing;

  if not found then
    return json_build_object('ok', true, 'duplicate', true);
  end if;

  -- Rij-lock + update in één statement: atomisch, geen race.
  update profiles
     set balance = coalesce(balance, 0) + p_amount
   where id = p_user_id;

  if not found then
    -- Exception (geen return): zo rolt ook de event-claim terug
    -- en kan Stripe het later opnieuw proberen.
    raise exception 'Profiel % niet gevonden', p_user_id;
  end if;

  insert into transactions (user_id, amount, type, stripe_session_id)
  values (p_user_id, p_amount, 'top_up', p_session_id);

  -- payment_intent → user/top-up vastleggen voor een eventuele latere chargeback.
  -- Mocht een dispuut deze rij al hebben aangemaakt (orphan), dan vullen we hier
  -- alleen de top-up-velden in en laten de dispuut-velden ongemoeid.
  if p_payment_intent is not null then
    insert into stripe_payments (payment_intent, session_id, user_id, amount_eur, event_id)
    values (p_payment_intent, p_session_id, p_user_id, p_amount, p_event_id)
    on conflict (payment_intent) do update
      set session_id = coalesce(stripe_payments.session_id, excluded.session_id),
          user_id    = coalesce(stripe_payments.user_id, excluded.user_id),
          amount_eur = coalesce(stripe_payments.amount_eur, excluded.amount_eur),
          event_id   = coalesce(stripe_payments.event_id, excluded.event_id);
  end if;

  return json_build_object('ok', true, 'credited', p_amount);
end;
$$;

-- Alleen de service role (webhook) mag dit aanroepen — klanten niet.
revoke execute on function public.apply_top_up(text, text, uuid, numeric, text) from public, anon, authenticated;
grant  execute on function public.apply_top_up(text, text, uuid, numeric, text) to service_role;

-- ------------------------------------------------------------
-- 5. Dispuut verwerken. Idempotent via de stripe_events-claim (zelfde slot
--    als de top-up). Schrijft de dispuut-status op stripe_payments, verzamelt
--    de orders van de user (met qc_images als bewijs) en legt een admin-alert
--    vast. Eén transactie, dus exact-once per Stripe-event.
-- ------------------------------------------------------------
create or replace function public.record_stripe_dispute(
  p_event_id       text,
  p_event_type     text,        -- charge.dispute.created | charge.dispute.closed
  p_dispute_id     text,
  p_payment_intent text,
  p_charge_id      text,
  p_status         text,        -- dispute.status
  p_reason         text,        -- dispute.reason
  p_amount         numeric,     -- betwist bedrag in euro
  p_due_by         bigint       -- evidence_details.due_by (unix seconden) of null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_closed boolean := (p_event_type = 'charge.dispute.closed') or (p_status in ('won', 'lost'));
  v_user_id   uuid;
  v_orders    jsonb := '[]'::jsonb;
  v_due       timestamptz := case when p_due_by is not null then to_timestamp(p_due_by) else null end;
  v_title     text;
  v_body      text;
begin
  if p_payment_intent is null then
    return json_build_object('ok', false, 'error', 'Geen payment_intent/charge-id');
  end if;

  -- Idempotentie: claim het event (created en closed hebben elk een eigen event-id).
  insert into stripe_events (id, type)
  values (p_event_id, p_event_type)
  on conflict (id) do nothing;

  if not found then
    return json_build_object('ok', true, 'duplicate', true);
  end if;

  -- Dispuut op de payment-rij zetten. Bestaat de rij nog niet (top-up zonder
  -- payment_intent uit de oude flow, of race), dan maken we 'm aan zonder user.
  insert into stripe_payments (
    payment_intent, charge_id, dispute_id, dispute_status, dispute_reason,
    dispute_amount, disputed_at, dispute_due_by, dispute_closed_at
  ) values (
    p_payment_intent, p_charge_id, p_dispute_id, p_status, p_reason,
    p_amount,
    case when v_is_closed then null else now() end,
    v_due,
    case when v_is_closed then now() else null end
  )
  on conflict (payment_intent) do update set
    charge_id         = coalesce(stripe_payments.charge_id, excluded.charge_id),
    dispute_id        = coalesce(excluded.dispute_id, stripe_payments.dispute_id),
    dispute_status    = excluded.dispute_status,
    dispute_reason    = coalesce(excluded.dispute_reason, stripe_payments.dispute_reason),
    dispute_amount    = coalesce(excluded.dispute_amount, stripe_payments.dispute_amount),
    disputed_at       = coalesce(stripe_payments.disputed_at, excluded.disputed_at),
    dispute_due_by    = coalesce(excluded.dispute_due_by, stripe_payments.dispute_due_by),
    dispute_closed_at = coalesce(excluded.dispute_closed_at, stripe_payments.dispute_closed_at)
  returning user_id into v_user_id;

  -- Kandidaat-orders van deze user (recentste eerst) zodat de admin meteen
  -- QC-foto's, meetrapport en tracking als Stripe-bewijs kan samenstellen.
  if v_user_id is not null then
    select coalesce(jsonb_agg(j), '[]'::jsonb) into v_orders
    from (
      select jsonb_build_object(
        'id', o.id,
        'product_title', o.product_title,
        'status', o.status,
        'shop_order_no', o.shop_order_no,
        'price', o.price,
        'date', o.date,
        'source_url', o.source_url,
        'has_qc_images', (o.qc_images is not null),
        'qc_images', to_jsonb(o.qc_images)
      ) as j
      from orders o
      where o.user_id = v_user_id
      order by o.quote_accepted_at desc nulls last
      limit 25
    ) s;
  end if;

  -- Alert opstellen.
  if v_is_closed then
    v_title := format('Chargeback %s — €%s',
      case when p_status = 'won' then 'GEWONNEN' when p_status = 'lost' then 'VERLOREN' else upper(coalesce(p_status, '?')) end,
      coalesce(round(p_amount, 2)::text, '?'));
    v_body := format('Dispuut %s afgesloten als "%s". %s',
      p_dispute_id, coalesce(p_status, '?'),
      case when p_status = 'lost' then 'Bedrag + dispuutkosten zijn teruggevorderd.' else 'Bedrag blijft behouden.' end);
  else
    v_title := format('⚠️ Chargeback geopend — €%s (%s)',
      coalesce(round(p_amount, 2)::text, '?'), coalesce(p_reason, 'onbekend'));
    v_body := format('Bank-chargeback op payment_intent %s%s. Dien bewijs in vóór %s: QC-foto''s (qc_images), meetrapport en delivery-tracking.',
      p_payment_intent,
      case when v_user_id is null then ' (GEEN top-up gevonden — handmatig matchen)' else '' end,
      coalesce(to_char(v_due, 'YYYY-MM-DD HH24:MI'), 'z.s.m. (geen deadline meegegeven)'));
  end if;

  insert into admin_alerts (type, severity, title, body, user_id, payment_intent, dispute_id, amount_eur, due_by, meta)
  values (
    case when v_is_closed then 'chargeback_closed' else 'chargeback_created' end,
    case when v_is_closed and p_status = 'won' then 'normal' else 'high' end,
    v_title, v_body, v_user_id, p_payment_intent, p_dispute_id, p_amount, v_due,
    jsonb_build_object(
      'reason', p_reason,
      'dispute_status', p_status,
      'charge_id', p_charge_id,
      'event_type', p_event_type,
      'matched', v_user_id is not null,
      'candidate_orders', v_orders
    )
  );

  return json_build_object(
    'ok', true,
    'duplicate', false,
    'matched', v_user_id is not null,
    'user_id', v_user_id,
    'closed', v_is_closed,
    'dispute_status', p_status,
    'candidate_orders', jsonb_array_length(v_orders)
  );
end;
$$;

revoke execute on function public.record_stripe_dispute(text, text, text, text, text, text, text, numeric, bigint) from public, anon, authenticated;
grant  execute on function public.record_stripe_dispute(text, text, text, text, text, text, text, numeric, bigint) to service_role;

-- ------------------------------------------------------------
-- 6. Admin koppelt een chargeback handmatig aan een specifieke order
--    (auto-mappen kan niet — een top-up financiert meerdere orders).
--    Zet orders.chargeback_status zodat de UI de betrokken order kan markeren.
-- ------------------------------------------------------------
create or replace function public.admin_link_chargeback_order(
  p_order_id text,
  p_linked   boolean default true
) returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'Alleen admins');
  end if;

  update orders
     set chargeback_status = case when p_linked then 'active' else null end
   where id = p_order_id;

  if not found then
    return json_build_object('ok', false, 'error', 'Order niet gevonden');
  end if;

  return json_build_object('ok', true, 'order_id', p_order_id, 'linked', p_linked);
end;
$$;

grant execute on function public.admin_link_chargeback_order(text, boolean) to authenticated;
