-- ============================================================
-- Flowva — admin handelt een door de KLANT gemelde retour/probleem af.
-- De klant meldt een probleem (dispute_status='pending' + beschrijving + bewijs-foto's,
-- via "Report a problem"). De admin (profiles.role='admin') ziet dit in de "Problemen"-tab:
--   • Goedkeuren -> (echt defect) klant krijgt NU z'n geld terug (transactie 'return_refund')
--                   + order geannuleerd, EN er wordt automatisch een retour bij de fabriek
--                   geopend (return_status='requested' -> request-return -> BuckyDrop apply-return)
--                   om JOUW kosten terug te halen. De klant-refund is sowieso (EU-recht bij defect).
--   • Afwijzen   -> standaardbericht naar de klant (order-chat) + de "Report a problem"-optie
--                   verdwijnt; het item gaat gewoon door naar verzending.
--
-- Voer uit in: Supabase -> SQL Editor -> New query -> plak -> Run.
-- ============================================================

alter table public.orders add column if not exists dispute_response text;
alter table public.orders add column if not exists dispute_requested_at timestamptz;

-- Lijst van openstaande klant-meldingen (alleen admin).
create or replace function public.admin_list_disputes()
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;
  return json_build_object('ok', true, 'disputes', coalesce((
    select jsonb_agg(to_jsonb(d)) from (
      select o.id, o.user_id, o.product, o.product_title, o.kleur, o.qty,
             coalesce(o.quoted_total, o.price, 0) as amount,
             o.status, o.dispute_status, o.dispute_description, o.dispute_images,
             o.qc_images, o.problem_type, o.date, o.dispute_requested_at
      from public.orders o
      where o.dispute_status = 'pending'
      order by o.dispute_requested_at desc nulls last, o.id desc
    ) d
  ), '[]'::jsonb));
end;
$$;

-- Admin keurt een melding goed (refund + item weg) of wijst af (bericht + door naar verzending).
create or replace function public.admin_resolve_dispute(p_order_id text, p_approve boolean, p_message text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_line numeric;
begin
  if (select role from public.profiles where id = auth.uid()) is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not admin');
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'order not found'); end if;
  if v_order.dispute_status is distinct from 'pending' then
    return json_build_object('ok', false, 'error', 'no pending dispute');
  end if;

  if p_approve then
    -- Retour geaccepteerd: productprijs terug naar saldo + transactie, order annuleren (verdwijnt uit de app).
    v_line := coalesce(v_order.quoted_total, v_order.price, 0);
    if v_line > 0 then
      update public.profiles set balance = balance + v_line where id = v_order.user_id;
      insert into public.transactions (user_id, amount, type, order_id)
      values (v_order.user_id, v_line, 'return_refund', p_order_id);
    end if;
    -- return_status='requested' triggert de bestaande request-return-pipeline: die opent
    -- een retour bij de fabriek (BuckyDrop apply-return) om JOUW kosten terug te halen.
    -- De klant is hierboven al terugbetaald (refund_order in die pipeline no-opt door de
    -- 'cancelled'-guard, dus geen dubbele refund).
    update public.orders
      set dispute_status = 'approved', dispute_response = null, status = 'cancelled',
          return_status = 'requested'
      where id = p_order_id;
    return json_build_object('ok', true, 'approved', true, 'refunded', v_line, 'factory_return', true);
  else
    -- Retour afgewezen: standaardbericht opslaan + in de order-chat plaatsen (klant ziet het + melding).
    -- Client haalt de "Report a problem"-optie weg zodra dispute_status gezet is; item blijft verzendbaar.
    update public.orders
      set dispute_status = 'rejected',
          dispute_response = p_message,
          last_message_sender = 'agent',
          last_message_read = false
      where id = p_order_id;
    insert into public.order_messages (order_id, sender, message)
    values (p_order_id, 'agent', coalesce(p_message, 'Your return request was declined.'));
    return json_build_object('ok', true, 'approved', false);
  end if;
end;
$$;

grant execute on function public.admin_list_disputes() to authenticated;
grant execute on function public.admin_resolve_dispute(text, boolean, text) to authenticated;
