-- ============================================================
-- Flowva Friends — alle orders van een groep (alleen-lezen) (reeds toegepast).
--
-- Voor het tonen van IEDERS status in de Orders-weergave wanneer je een groep
-- "volgt". Een lid mag normaal andermans orders niet lezen (RLS), dus dit gaat
-- via een security-definer RPC. Puur lezen — geen meldingen (die blijven via je
-- eigen orders) en geen mutaties.
-- ============================================================

-- ADDENDUM (2026-07-21): + host_id/admin_id, box_staged_at/return_status/group_shipping_paid,
-- qc/measurement + gewicht, én dispute_status/problem_type/defect_detected_at zodat de group
-- parcel per lid kan tonen dat er iets mis is (defect / lopend refund-verzoek).
create or replace function public.ff_group_orders(p_group_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_admin uuid; v_host uuid;
begin
  if not exists (select 1 from flowva_group_members where group_id = p_group_id and user_id = auth.uid()) then
    return json_build_object('ok', false, 'error', 'Not a member');
  end if;
  select admin_id, host_id into v_admin, v_host from flowva_groups where id = p_group_id;
  return json_build_object('ok', true, 'admin_id', v_admin, 'host_id', v_host, 'orders', coalesce((
    select json_agg(json_build_object(
      'id', o.id, 'user_id', o.user_id,
      'product_title', coalesce(o.product_title, o.product),
      'status', o.status, 'kleur', o.kleur, 'variant_image', o.variant_image, 'qty', o.qty,
      'qc_images', o.qc_images, 'measurement_images', o.measurement_images, 'weight_grams', o.weight_grams,
      'box_staged_at', o.box_staged_at, 'return_status', o.return_status, 'group_shipping_paid', o.group_shipping_paid,
      'dispute_status', o.dispute_status, 'problem_type', o.problem_type, 'defect_detected_at', o.defect_detected_at,
      'member', coalesce(nullif(left(trim(coalesce(u.raw_user_meta_data->>'voornaam','') || ' ' || coalesce(u.raw_user_meta_data->>'achternaam','')), 40), ''), 'Friend'),
      'avatar_url', nullif(u.raw_user_meta_data->>'avatar_url', '')
    ) order by o.user_id, o.created_at)
    from orders o left join auth.users u on u.id = o.user_id
    where o.ff_group_id = p_group_id and o.status <> 'cancelled'
  ), '[]'::json));
end; $$;

grant execute on function public.ff_group_orders(uuid) to authenticated;
