-- ============================================================
-- Flowva Friends — leden mét LIVE naam + foto (reeds toegepast op de DB).
--
-- Probleem: de naam/foto van een lid werd als momentopname op de member-rij
-- bewaard (ff_sync_profile fris dat alleen op als dat lid zélf de groep opent).
-- Daardoor zagen anderen een verouderde naam ("claud code" i.p.v. "tom").
--
-- Oplossing: deze RPC leest naam + avatar LIVE uit auth.users (security definer),
-- met de momentopname als fallback. De client laadt de leden hiermee i.p.v. een
-- directe tabel-select, dus een naam-/fotowijziging klopt meteen voor iedereen.
-- ============================================================

create or replace function public.ff_group_members(p_group_id uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from flowva_group_members where group_id = p_group_id and user_id = auth.uid()) then
    return json_build_object('ok', false, 'error', 'Not a member');
  end if;
  return json_build_object('ok', true, 'members', coalesce((
    select json_agg(
      (to_jsonb(m) || jsonb_build_object(
        'display_name', coalesce(nullif(left(trim(coalesce(u.raw_user_meta_data->>'voornaam','') || ' ' || coalesce(u.raw_user_meta_data->>'achternaam','')), 60), ''), m.display_name),
        'avatar_url',   coalesce(nullif(u.raw_user_meta_data->>'avatar_url', ''), m.avatar_url)
      )) order by m.joined_at)
    from flowva_group_members m
    left join auth.users u on u.id = m.user_id
    where m.group_id = p_group_id
  ), '[]'::json));
end; $$;

grant execute on function public.ff_group_members(uuid) to authenticated;
