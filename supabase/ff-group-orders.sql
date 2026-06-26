-- ============================================================
-- Flowva Friends — alle orders van een groep (alleen-lezen) (reeds toegepast).
--
-- Voor het tonen van IEDERS status in de Orders-weergave wanneer je een groep
-- "volgt". Een lid mag normaal andermans orders niet lezen (RLS), dus dit gaat
-- via een security-definer RPC. Puur lezen — geen meldingen (die blijven via je
-- eigen orders) en geen mutaties.
-- ============================================================

create or replace function public.ff_group_orders(p_group_id uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from flowva_group_members where group_id = p_group_id and user_id = auth.uid()) then
    return json_build_object('ok', false, 'error', 'Not a member');
  end if;
  return json_build_object('ok', true, 'orders', coalesce((
    select json_agg(json_build_object(
      'id', o.id, 'user_id', o.user_id,
      'product_title', coalesce(o.product_title, o.product),
      'status', o.status, 'kleur', o.kleur, 'variant_image', o.variant_image, 'qty', o.qty,
      'member', coalesce(nullif(left(trim(coalesce(u.raw_user_meta_data->>'voornaam','') || ' ' || coalesce(u.raw_user_meta_data->>'achternaam','')), 40), ''), 'Friend'),
      'avatar_url', nullif(u.raw_user_meta_data->>'avatar_url', '')
    ) order by o.user_id, o.created_at)
    from orders o left join auth.users u on u.id = o.user_id
    where o.ff_group_id = p_group_id and o.status <> 'cancelled'
  ), '[]'::json));
end; $$;

grant execute on function public.ff_group_orders(uuid) to authenticated;
