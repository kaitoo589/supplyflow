-- ============================================================
-- Flowva — GELD-LOCKDOWN, laag 1: saldo + grootboek waterdicht
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- Idempotent: veilig om (opnieuw) te draaien.
--
-- WAAROM: uit de geld-pad-audit (2026-06-24) bleek dat de rol
-- 'authenticated' (elke ingelogde klant) directe INSERT/UPDATE/DELETE
-- rechten had op public.profiles (saldo) en public.transactions
-- (grootboek). Daardoor kon een klant met één API-call zijn eigen
-- balance op €999.999 zetten of een nep-storting boeken. Dit bestand
-- sluit die deur: schrijven kan voortaan ALLEEN via SECURITY DEFINER
-- functies (die als 'postgres' draaien, niet als 'authenticated').
--
-- De enige plek die saldo/grootboek nog rechtstreeks vanaf de client
-- schreef (de agent buffer-refund in AgentPanel) verhuist naar de
-- nieuwe RPC agent_settle_haul() hieronder.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Staf-check (agent of admin). SECURITY DEFINER → draait als
--    owner en omzeilt RLS, dus geen recursie als policies 'm gebruiken.
-- ------------------------------------------------------------
create or replace function public.is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('agent', 'admin')
  );
$$;

-- ------------------------------------------------------------
-- 1. Agent wikkelt een haul af: exacte verzendkosten invullen,
--    buffer-verschil terugstorten, haul + orders op 'verzonden'.
--    Vervangt de directe profiles/transactions-writes uit de
--    client (AgentPanel.markShipped). Server-side, atomair en
--    IDEMPOTENT (een al-verzonden haul wordt niet nog eens
--    terugbetaald → geen dubbele buffer-refund).
-- ------------------------------------------------------------
create or replace function public.agent_settle_haul(
  p_haul_id   text,
  p_exact_eur numeric,
  p_tracking  text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_haul   record;
  v_refund numeric;
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'error', 'Only staff');
  end if;
  if p_exact_eur is null or p_exact_eur < 0 then
    return json_build_object('ok', false, 'error', 'Invalid shipping amount');
  end if;

  select * into v_haul from public.hauls where id::text = p_haul_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Haul not found');
  end if;

  -- Idempotentie-slot: al verzonden → niets nogmaals afwikkelen.
  if v_haul.status = 'shipped' then
    return json_build_object('ok', true, 'duplicate', true);
  end if;

  v_refund := coalesce(v_haul.paid_eur, 0) - p_exact_eur;

  update public.hauls
     set status = 'shipped',
         exact_shipping_eur = p_exact_eur,
         tracking_number = p_tracking
   where id::text = p_haul_id;

  -- Buffer-verschil terug naar de klant (saldo + grootboekregel) —
  -- alleen als er teveel was gereserveerd.
  if v_refund > 0 then
    update public.profiles
       set balance = coalesce(balance, 0) + v_refund
     where id = v_haul.user_id;
    insert into public.transactions (user_id, amount, type)
    values (v_haul.user_id, v_refund, 'buffer_return');
  end if;

  -- Alle orders in dit pakket → internationaal verzonden.
  update public.orders
     set status = 'shipped_international',
         tracking_number = p_tracking
   where id in (
     select jsonb_array_elements_text(coalesce(v_haul.items, '[]'::jsonb))
   );

  return json_build_object('ok', true, 'refunded', greatest(v_refund, 0));
end;
$$;

revoke execute on function public.agent_settle_haul(text, numeric, text) from anon;
grant  execute on function public.agent_settle_haul(text, numeric, text) to authenticated;

-- ------------------------------------------------------------
-- 2. LEESPOLICIES eerst (zodat er geen leeg moment is zodra RLS
--    aangaat). Klant ziet alleen zijn eigen rij; staf ziet alles.
-- ------------------------------------------------------------
drop policy if exists profiles_select_self_or_staff on public.profiles;
create policy profiles_select_self_or_staff on public.profiles
  for select using (id = auth.uid() or public.is_staff());

drop policy if exists transactions_select_self_or_staff on public.transactions;
create policy transactions_select_self_or_staff on public.transactions
  for select using (user_id = auth.uid() or public.is_staff());

-- ------------------------------------------------------------
-- 3. RLS aan + ALLE directe schrijfrechten intrekken voor de
--    client-rollen. Schrijven kan nu uitsluitend via SECURITY
--    DEFINER functies (pay_cart, apply_top_up, refund_order,
--    agent_settle_haul, …) die als owner draaien en RLS omzeilen.
-- ------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.transactions enable row level security;

revoke insert, update, delete, truncate on public.profiles     from anon, authenticated;
revoke insert, update, delete, truncate on public.transactions from anon, authenticated;

-- Reconciliatie-controle achteraf (admin): som(balances) hoort gelijk
-- te zijn aan som(transactions). Draai admin_finance_overview() om te checken.
