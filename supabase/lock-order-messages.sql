-- ============================================================
-- Flowva — order_messages op slot
-- Was: "Anyone can read and write messages" (élke ingelogde gebruiker kon
-- ALLE order-chats lezen/schrijven). Nu: alleen de EIGENAAR van de order +
-- agent/admin. Voer uit in: Supabase → SQL Editor → New query → Run.
-- ============================================================

drop policy if exists "Anyone can read and write messages" on public.order_messages;

create policy "own_or_staff_messages" on public.order_messages
  for all
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_messages.order_id and o.user_id = auth.uid()
    )
    or coalesce((select role from public.profiles where id = auth.uid()), '') in ('agent', 'admin')
  )
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_messages.order_id and o.user_id = auth.uid()
    )
    or coalesce((select role from public.profiles where id = auth.uid()), '') in ('agent', 'admin')
  );
