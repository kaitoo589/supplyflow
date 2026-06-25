-- ============================================================
-- Flowva — KLANT KIEST bij een door BuckyDrop gemeld QC-defect: RETOUR of ACCEPTEREN.
-- De buckydrop-webhook zet dispute_status = 'bucky_flagged' (i.p.v. 'pending') zodra
-- BuckyDrop's inspectie een defect meldt (confirmType). De klant ziet dan in de app de
-- foto's + twee knoppen:
--   - Retour      -> request_item_return  (bestaande flow: apply-return bij fabriek + refund)
--   - Accepteren  -> accept_qc_result     (vlag weg, item gaat gewoon door naar verzending)
-- Voer uit in: Supabase -> SQL Editor -> New query -> plak -> Run.
-- Raakt GEEN secrets en GEEN triggers (alleen twee RPC's, create-or-replace = veilig).
-- ============================================================

-- 1) RETOUR mag nu ook bij een BuckyDrop-defect ('bucky_flagged'), niet alleen qc_pending/pending.
create or replace function public.request_item_return(p_order_id text, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_order record;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'order not found'); end if;

  -- Eigenaarschap: de besteller of de host (Flowva Friends-groeps-order).
  if not (v_order.user_id = v_uid or v_order.host_user_id = v_uid) then
    return json_build_object('ok', false, 'error', 'not allowed');
  end if;

  if v_order.shop_order_no is null then
    return json_build_object('ok', false, 'error', 'order not placed yet');
  end if;
  if v_order.status = 'cancelled' then
    return json_build_object('ok', false, 'error', 'order already cancelled');
  end if;
  if v_order.return_status is not null then
    return json_build_object('ok', true, 'already', true, 'return_status', v_order.return_status);
  end if;

  -- Alleen in de QC-fase of bij een gemeld defect (klant-melding of BuckyDrop-melding).
  if not (v_order.status = 'qc_pending'
          or v_order.dispute_status = 'pending'
          or v_order.dispute_status = 'bucky_flagged') then
    return json_build_object('ok', false, 'error', 'Return is only available at the quality-control stage');
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

-- 2) ACCEPTEREN: de klant houdt het item ondanks het gemelde defect -> vlag weg, gaat door.
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

  -- Alleen zinvol bij een door BuckyDrop gemeld defect; anders niets te accepteren.
  if v_order.dispute_status is distinct from 'bucky_flagged' then
    return json_build_object('ok', true, 'already', true);
  end if;

  update orders set dispute_status = null, problem_type = null where id = p_order_id;
  return json_build_object('ok', true, 'accepted', true);
end;
$$;
grant execute on function public.accept_qc_result(text) to authenticated;
