-- ============================================================
-- Flowva — automatische refund bij "out of stock"
-- ============================================================
-- Regel: zodra de agent een order op problem_type = 'out_of_stock' zet,
-- krijgt de klant DIRECT de itemprijs terug op z'n balance (geen keuze meer —
-- out of stock = gewoon refund). De order blijft staan met status
-- "Order placed" + out_of_stock, zodat de klant ziet wat er gebeurd is.
--
-- Geld-pad: balance += refund + transactie 'refund'. Zelfde conventie als
-- cancel_paid_order (refund-order.sql): bedrag = coalesce(price, quoted_total, 0).
-- Idempotent: nooit dubbel (checkt of er al een refund/return_refund voor de
-- order geboekt is). Vuurt alleen op de OVERGANG naar 'out_of_stock'.
-- Draai dit in de Supabase SQL editor.
-- ============================================================

create or replace function public.auto_refund_on_out_of_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_refund numeric;
begin
  -- alleen wanneer er nog geen refund/return_refund voor deze order bestaat
  if not exists (
    select 1 from public.transactions
    where order_id = new.id and type in ('refund', 'return_refund')
  ) then
    v_refund := coalesce(new.price, new.quoted_total, 0);
    if v_refund > 0 then
      update public.profiles set balance = balance + v_refund where id = new.user_id;
      insert into public.transactions (user_id, amount, type, order_id)
      values (new.user_id, v_refund, 'refund', new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists auto_refund_out_of_stock_trg on public.orders;
create trigger auto_refund_out_of_stock_trg
  after update on public.orders
  for each row
  when (new.problem_type = 'out_of_stock' and old.problem_type is distinct from 'out_of_stock')
  execute function public.auto_refund_on_out_of_stock();
