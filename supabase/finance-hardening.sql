-- ============================================================
-- SupplyFlow — financiën waterdicht maken
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
--
-- Dit bestand regelt drie dingen:
--  1. Idempotente Stripe webhooks: elk event wordt maar één
--     keer verwerkt, ook als Stripe hetzelfde event twee keer
--     stuurt (dat doen ze bij twijfel standaard!).
--  2. Atomische balance-opboeking: lezen+schrijven in één
--     transactie met rij-lock, dus geen race conditions.
--  3. Wise-buffer stand + financieel overzicht voor de admin
--     (reconciliatie: kloppen alle balances met de transacties?)
-- ============================================================

-- ------------------------------------------------------------
-- 1a. Verwerkte Stripe events. RLS aan zonder policies:
--     alleen de service role (webhook) kan erbij.
-- ------------------------------------------------------------
create table if not exists public.stripe_events (
  id           text primary key,          -- Stripe event id (evt_...)
  type         text,
  processed_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

-- ------------------------------------------------------------
-- 1b. Extra slot op de deur: een top-up transactie per
--     checkout-sessie. Als er nu al dubbele in staan, slaan we
--     de index over met een melding (dan eerst opschonen).
-- ------------------------------------------------------------
do $$
begin
  create unique index if not exists transactions_topup_session_uniq
    on public.transactions (stripe_session_id)
    where type = 'top_up' and stripe_session_id is not null;
exception when others then
  raise notice 'Unieke index overgeslagen (bestaan er al dubbele top-ups?): %', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 2. Idempotente + atomische top-up. De webhook roept deze
--    functie aan in plaats van los lezen/schrijven.
--    Retourneert ok=true (verwerkt) of duplicate=true (al gehad).
-- ------------------------------------------------------------
create or replace function public.apply_top_up(
  p_event_id   text,
  p_session_id text,
  p_user_id    uuid,
  p_amount     numeric
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

  return json_build_object('ok', true, 'credited', p_amount);
end;
$$;

-- Alleen de service role (webhook) mag dit aanroepen — klanten niet.
revoke execute on function public.apply_top_up(text, text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.apply_top_up(text, text, uuid, numeric) to service_role;

-- ------------------------------------------------------------
-- 3a. Wise-buffer stand (één rij). Jij vult de stand handmatig
--     in na je wekelijkse overboeking; de admin-app toont hem
--     en waarschuwt onder de €200.
-- ------------------------------------------------------------
create table if not exists public.wise_buffer_state (
  id          int primary key default 1 check (id = 1),
  balance_eur numeric not null default 0,
  updated_at  timestamptz not null default now()
);

alter table public.wise_buffer_state enable row level security;

insert into public.wise_buffer_state (id, balance_eur)
values (1, 0)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 3b. Buffer bijwerken — alleen voor admins.
-- ------------------------------------------------------------
create or replace function public.admin_set_wise_buffer(p_balance numeric)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'Alleen admins');
  end if;

  if p_balance is null or p_balance < 0 then
    return json_build_object('ok', false, 'error', 'Ongeldig bedrag');
  end if;

  update wise_buffer_state
     set balance_eur = p_balance, updated_at = now()
   where id = 1;

  return json_build_object('ok', true, 'balance', p_balance);
end;
$$;

grant execute on function public.admin_set_wise_buffer(numeric) to authenticated;

-- ------------------------------------------------------------
-- 3c. Financieel overzicht — alleen voor admins.
--     Kernvraag van reconciliatie: som van alle klantbalances
--     moet gelijk zijn aan de som van alle transacties. Wijkt
--     dat af, dan is ergens balance aangepast zonder logregel
--     (of andersom) en wil je dat meteen zien.
-- ------------------------------------------------------------
create or replace function public.admin_finance_overview()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sum_balances numeric;
  v_sum_tx       numeric;
  v_per_type     json;
  v_buffer       record;
  v_customers    int;
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'Alleen admins');
  end if;

  select coalesce(sum(balance), 0), count(*)
    into v_sum_balances, v_customers
    from profiles;

  select coalesce(sum(amount), 0) into v_sum_tx from transactions;

  select coalesce(json_object_agg(t.type, t.total), '{}'::json)
    into v_per_type
    from (
      select type, round(sum(amount), 2) as total
        from transactions
       group by type
    ) t;

  select balance_eur, updated_at into v_buffer
    from wise_buffer_state where id = 1;

  return json_build_object(
    'ok', true,
    'sum_balances', round(v_sum_balances, 2),
    'sum_transactions', round(v_sum_tx, 2),
    'mismatch', round(v_sum_balances - v_sum_tx, 2),
    'per_type', v_per_type,
    'customers', v_customers,
    'buffer_eur', coalesce(v_buffer.balance_eur, 0),
    'buffer_updated_at', v_buffer.updated_at
  );
end;
$$;

grant execute on function public.admin_finance_overview() to authenticated;
