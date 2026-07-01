-- ============================================================
-- Wallet-tracking — BuckyDrop-wallet telt automatisch af
-- ------------------------------------------------------------
-- Saldo blijft in € (voorkeur). Getoond saldo =
--   balance_eur  −  besteed sinds de laatste opwaardering
-- waarbij "besteed sinds" =
--   (som ¥-inkoopkosten + ¥9,9 fulfilment per order) ÷ koers
--   + afgehandelde verzendkosten (solo hauls + Friends-groepen).
-- Opwaarderen "bankt" de huidige echte stand + jouw storting en
-- reset de klok. De Alipay-fee komt er bovenop (aparte kostenteller).
-- ============================================================

-- 1) ¥-inkoopkost per order — gevuld door place-bucky-order bij een gelukte order.
alter table public.orders add column if not exists cost_cny        numeric;
alter table public.orders add column if not exists cost_charged_at timestamptz;

-- 2) Config + Alipay-fee-teller op de wallet-state.
alter table public.wise_buffer_state add column if not exists cny_per_eur     numeric not null default 7.7;
alter table public.wise_buffer_state add column if not exists alipay_fees_eur numeric not null default 0;

-- 3) "Besteed sinds de laatste opwaardering" in € (orders + verzendkosten).
create or replace function public.wallet_spent_since_eur()
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since  timestamptz;
  v_rate   numeric;
  v_orders numeric := 0;
  v_ship   numeric := 0;
begin
  select updated_at, coalesce(cny_per_eur, 7.7) into v_since, v_rate
    from wise_buffer_state where id = 1;
  if v_since is null then v_since := 'epoch'::timestamptz; end if;
  if v_rate is null or v_rate <= 0 then v_rate := 7.7; end if;

  -- ¥-inkoopkosten (incl. ¥9,9 fulfilment, zit al in cost_cny) sinds de opwaardering
  select coalesce(sum(cost_cny), 0) into v_orders
    from orders
   where cost_cny is not null
     and cost_charged_at is not null
     and cost_charged_at > v_since;

  -- Afgehandelde verzendkosten (solo hauls) sinds de opwaardering
  begin
    select coalesce(sum(exact_shipping_eur), 0) into v_ship
      from hauls
     where settled_at is not null and settled_at > v_since;
  exception when undefined_table then v_ship := 0;
  end;

  -- Friends-groepsverzendingen tellen ook mee (aparte tabel)
  begin
    v_ship := v_ship + (
      select coalesce(sum(exact_shipping_eur), 0)
        from ff_group_shipments
       where settled_at is not null and settled_at > v_since
    );
  exception when undefined_table then null;
  end;

  return round(coalesce(v_orders, 0) / v_rate + coalesce(v_ship, 0), 2);
end;
$$;
grant execute on function public.wallet_spent_since_eur() to authenticated;

-- 4) Opwaarderen: bank de huidige echte stand + storting, reset de klok,
--    tel de Alipay-fee bij de kostenteller, en leg de koers vast.
create or replace function public.admin_wallet_topup(
  p_topup_eur numeric,
  p_alipay_fee_eur numeric default 0,
  p_rate numeric default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bal   numeric;
  v_spent numeric;
  v_real  numeric;
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'Alleen admins');
  end if;
  if p_topup_eur is null or p_topup_eur < 0 then
    return json_build_object('ok', false, 'error', 'Ongeldig bedrag');
  end if;

  if p_rate is not null and p_rate > 0 then
    update wise_buffer_state set cny_per_eur = p_rate where id = 1;
  end if;

  v_spent := public.wallet_spent_since_eur();          -- eerst afronden op de OUDE klok
  select balance_eur into v_bal from wise_buffer_state where id = 1;
  v_real := coalesce(v_bal, 0) - coalesce(v_spent, 0); -- huidige echte stand

  update wise_buffer_state
     set balance_eur     = round(v_real + p_topup_eur, 2),
         alipay_fees_eur  = coalesce(alipay_fees_eur, 0) + coalesce(p_alipay_fee_eur, 0),
         updated_at       = now()                       -- klok reset → besteed-sinds = 0
   where id = 1;

  return json_build_object('ok', true, 'balance', round(v_real + p_topup_eur, 2));
end;
$$;
grant execute on function public.admin_wallet_topup(numeric, numeric, numeric) to authenticated;

-- 5) Financieel overzicht uitbreiden met de wallet-berekening.
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
  v_spent        numeric;
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

  select balance_eur,
         updated_at,
         coalesce(cny_per_eur, 7.7)     as cny_per_eur,
         coalesce(alipay_fees_eur, 0)   as alipay_fees_eur
    into v_buffer
    from wise_buffer_state where id = 1;

  v_spent := public.wallet_spent_since_eur();

  return json_build_object(
    'ok', true,
    'sum_balances', round(v_sum_balances, 2),
    'sum_transactions', round(v_sum_tx, 2),
    'mismatch', round(v_sum_balances - v_sum_tx, 2),
    'per_type', v_per_type,
    'customers', v_customers,
    'buffer_eur', coalesce(v_buffer.balance_eur, 0),
    'buffer_updated_at', v_buffer.updated_at,
    'spent_since_eur', coalesce(v_spent, 0),
    'wallet_balance_eur', round(coalesce(v_buffer.balance_eur, 0) - coalesce(v_spent, 0), 2),
    'cny_per_eur', v_buffer.cny_per_eur,
    'alipay_fees_eur', v_buffer.alipay_fees_eur
  );
end;
$$;
grant execute on function public.admin_finance_overview() to authenticated;
