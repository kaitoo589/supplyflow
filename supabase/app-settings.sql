-- ============================================================
-- SupplyFlow — globale app-instellingen (app_settings)
-- Voer uit in: Supabase -> SQL Editor -> New query -> plak -> Run.
--
-- Eén rij met app-brede schakelaars. Nu: zichtbaarheid van de
-- support-chat. De admin (OPS-tab in het command center) zet 'm
-- aan/uit; de klant-app leest deze waarde bij het laden.
-- Standaard = false (verborgen) tot je 'm aanzet.
-- ============================================================

create table if not exists public.app_settings (
  id                  int primary key default 1 check (id = 1),
  support_bot_visible boolean not null default false,
  updated_at          timestamptz not null default now()
);

insert into public.app_settings (id, support_bot_visible)
values (1, false)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

-- Iedereen die is ingelogd mag de instelling LEZEN (klant-app heeft 'm nodig).
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select to authenticated using (true);

-- Schrijven kan ALLEEN via deze admin-RPC (geen directe write-policy).
create or replace function public.admin_set_support_bot(p_visible boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'Alleen admins');
  end if;

  update app_settings
     set support_bot_visible = coalesce(p_visible, false), updated_at = now()
   where id = 1;

  return json_build_object('ok', true, 'support_bot_visible', coalesce(p_visible, false));
end;
$$;

grant execute on function public.admin_set_support_bot(boolean) to authenticated;
