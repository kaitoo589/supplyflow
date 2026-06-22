-- ============================================================
-- Flowva × BuckyDrop — RETURN BIJ DE FABRIEK (na QC).
-- Als na de verplichte QC blijkt dat een item defect/fout/niet-als-beschreven is,
-- vraagt de klant (of host) een return aan. Dat zet return_status → 'requested',
-- de trigger vuurt de edge function `request-return`, die BuckyDrop's apply-return
-- aanroept (per PO-orderCode) en de klant terugbetaalt (defect = niet hun schuld).
--
-- VEREIST: extensie pg_net aan. Vervang PLAK_HIER_JE_WEBHOOK_SECRET door dezelfde
-- waarde als de WEBHOOK_SECRET-secret van je edge functions.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- ============================================================

-- Kolommen voor de return-afhandeling (idempotent).
alter table public.orders add column if not exists return_flow_code text;       -- BuckyDrop returnFlowCode
alter table public.orders add column if not exists return_status text;          -- requested | submitted | failed
alter table public.orders add column if not exists return_reason text;
alter table public.orders add column if not exists return_requested_at timestamptz;

-- Defect-/QC-kolommen waar de webhook al naar schrijft (zeker stellen dat ze bestaan).
alter table public.orders add column if not exists dispute_status text;         -- pending bij BuckyDrop-defect
alter table public.orders add column if not exists problem_type text;           -- confirmType uit Po Pending
alter table public.orders add column if not exists qc_images jsonb;             -- inspectie-/defect-foto's

-- ---------------------------------------------------------------
-- RPC: klant/host vraagt een return aan voor een item met een probleem.
-- Alleen toegestaan in de QC-fase (status 'qc_pending') of bij een door BuckyDrop
-- gemeld defect (dispute_status = 'pending'). Markeert de order; de trigger doet de rest.
-- ---------------------------------------------------------------
create or replace function public.request_item_return(p_order_id text, p_reason text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order record;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'Not logged in');
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'order not found');
  end if;

  -- Eigenaarschap: de besteller óf de host (bij een Flowva Friends-groeps-order).
  if not (v_order.user_id = v_uid or v_order.host_user_id = v_uid) then
    return json_build_object('ok', false, 'error', 'not allowed');
  end if;

  -- Moet bij BuckyDrop geplaatst zijn en niet al afgehandeld.
  if v_order.shop_order_no is null then
    return json_build_object('ok', false, 'error', 'order not placed yet');
  end if;
  if v_order.status = 'cancelled' then
    return json_build_object('ok', false, 'error', 'order already cancelled');
  end if;
  if v_order.return_status is not null then
    return json_build_object('ok', true, 'already', true, 'return_status', v_order.return_status);
  end if;

  -- Alleen in de QC-fase of bij een gemeld defect.
  if not (v_order.status = 'qc_pending' or v_order.dispute_status = 'pending') then
    return json_build_object('ok', false, 'error', 'Return is only available at the QC stage');
  end if;

  update orders
    set return_status = 'requested',
        return_reason = coalesce(nullif(trim(p_reason), ''), 'Item not as described / defective'),
        return_requested_at = now()
    where id = p_order_id;

  return json_build_object('ok', true, 'return_status', 'requested');
end;
$$;

grant execute on function public.request_item_return(text, text) to authenticated;

-- ---------------------------------------------------------------
-- Trigger: zodra return_status → 'requested', vuur de request-return edge function.
-- ---------------------------------------------------------------
create or replace function public.trigger_request_return()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://bjtpnuxjbazlbaoyflcx.supabase.co/functions/v1/request-return',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', 'PLAK_HIER_JE_WEBHOOK_SECRET'
    ),
    body := jsonb_build_object('record', to_jsonb(new))
  );
  return new;
end;
$$;

drop trigger if exists request_return_trg on public.orders;
create trigger request_return_trg
  after update on public.orders
  for each row
  when (new.return_status = 'requested' and old.return_status is distinct from 'requested')
  execute function public.trigger_request_return();
