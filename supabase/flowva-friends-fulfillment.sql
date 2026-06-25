-- ============================================================================
-- FLOWVA FRIENDS — Fase 5: fulfillment + verzending (gewicht-split) + QC-refund
-- ============================================================================
-- Bouwt voort op flowva-friends.sql (Fase 1) + flowva-friends-money.sql (Fase 3).
--
-- Wat dit doet (money-correct, sluit aan op pay_cart/refund_order):
--  1) Zodra een groep op 'placed' gaat → een TRIGGER maakt de echte orders aan, één
--     per item, EIGENAAR = het lid, maar AFLEVERADRES = de host. De vastgehouden
--     'group_hold' wordt omgezet naar normale 'order'+'service_fee'-transacties
--     (per lid), zodat de bestaande auto-refund (refund_order) ook hier werkt.
--     De orders gaan op 'quote_accepted' → de bestaande BuckyDrop-trigger koopt ze in.
--  2) ff_pay_group_shipping: gewicht-gesplitste verzending — de groep deelt ÉÉN
--     first-weight-blok; elk lid betaalt z'n gewichtsaandeel (+ 21% DDP-BTW). Dit is
--     het tweede geldmoment (zoals solo). Goedkoper dan ieder een eigen pakket.
--  3) ff_cancel_group_order: een lid annuleert z'n EIGEN item tijdens QC → individuele
--     refund (de groep loopt door). Sluit aan op het failure-principe.
--
-- LET OP — afhankelijk van BuckyDrop-onderzoek (apart, zie docs):
--  • orders.weight_grams moet door BuckyDrop gevuld worden ná inkoop (gewicht-split
--    kan pas daarna). • De consolidatie naar één pakket + wie/wanneer 'verzend' drukt.
--  • De volledige failure-flowchart (factory-fout, QC-mismatch, defect) — diagram apart.
--
-- Tarief MOET gelijk blijven aan pay-shipping.sql / WarehouseAndHaul.jsx.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run. Idempotent.
-- ============================================================================

-- ── Nieuwe order-kolommen ────────────────────────────────────────────────────
alter table public.orders add column if not exists host_user_id        uuid;     -- groeps-order → bezorg naar de host
alter table public.orders add column if not exists ff_group_id         uuid;     -- koppelt alle orders van één groep (consolidatie/verzending)
alter table public.orders add column if not exists group_shipping_paid boolean default false;
create index if not exists orders_ff_group_idx on public.orders(ff_group_id);

-- ── Trigger: groep 'placed' → orders aanmaken (naar host) + holds omzetten ────
create or replace function public.ff_create_orders_on_placement()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_member       record;
  v_item         record;
  v_mgroup       text;       -- per-lid fee-eenheid (zodat refund_order de fee per lid teruggeeft)
  v_oid          text;
  v_first_oid    text;
  v_j            int;
  v_line         numeric;
  v_member_total numeric;
  v_member_fee   numeric;
begin
  if new.request_group_id is null then return new; end if;  -- veiligheid

  for v_member in select * from public.flowva_group_members where group_id = new.id loop
    v_member_total := 0; v_first_oid := null; v_j := 0;
    -- Volledige UUID (geen truncatie) → globaal unieke fee-eenheid, geen order-id-botsing.
    v_mgroup := new.request_group_id || '-' || replace(v_member.user_id::text, '-', '');
    -- Een geplaatst lid met items hoort geld vastgehouden te hebben; zo niet → afbreken
    -- (voorkomt gratis goederen + een onterechte fee-credit bij een toekomstig mis-plaatsingspad).
    if coalesce(v_member.held_amount, 0) <= 0
       and exists (select 1 from public.flowva_group_items where group_id = new.id and owner_id = v_member.user_id) then
      raise exception 'Flowva Friends: member % placed without a hold', v_member.user_id;
    end if;

    -- Maak een order per item van dit lid (eigenaar = lid, afleveradres = host).
    for v_item in select * from public.flowva_group_items where group_id = new.id and owner_id = v_member.user_id loop
      v_j := v_j + 1;
      v_line := coalesce(v_item.locked_price, v_item.price, 0) * greatest(coalesce(v_item.qty, 1), 1);
      v_member_total := v_member_total + v_line;
      v_oid := v_mgroup || '-' || v_j;
      if v_first_oid is null then v_first_oid := v_oid; end if;
      insert into public.orders (
        id, user_id, host_user_id, ff_group_id, product, product_title, source_url, platform,
        price, qty, kleur, variant_image, opmerking,
        status, request_group_id, quoted_total, quote_accepted_at, date
      ) values (
        v_oid, v_member.user_id, new.host_id, new.id,
        v_item.product_title, v_item.product_title, v_item.source_url, v_item.platform,
        v_line, greatest(coalesce(v_item.qty, 1), 1), v_item.kleur, v_item.variant_image, v_item.opmerking,
        'quote_accepted', v_mgroup, v_line, now(), to_char(now(), 'DD Mon')
      );
      insert into public.transactions (user_id, amount, type, order_id)
      values (v_member.user_id, -v_line, 'order', v_oid);
    end loop;

    -- Alleen omzetten als er écht orders zijn (geen lege-mand-lek).
    if v_first_oid is not null then
      -- Neutraliseer de eerder vastgehouden group_hold in het LOG (saldo al afgeschreven
      -- bij ready → netto 0): +held (release) - som(order-lines) - fee = 0.
      if coalesce(v_member.held_amount, 0) > 0 then
        insert into public.transactions (user_id, amount, type, order_id)
        values (v_member.user_id, v_member.held_amount, 'group_hold_release', new.id::text);
      end if;
      v_member_fee := round(coalesce(v_member.held_amount, 0) - v_member_total, 2);
      if v_member_fee <> 0 then
        insert into public.transactions (user_id, amount, type, order_id)
        values (v_member.user_id, -v_member_fee, 'service_fee', v_first_oid);
      end if;
    end if;
  end loop;

  return new;
end; $$;

drop trigger if exists ff_create_orders_trg on public.flowva_groups;
create trigger ff_create_orders_trg
  after update on public.flowva_groups
  for each row when (new.status = 'placed' and old.status is distinct from 'placed')
  execute function public.ff_create_orders_on_placement();

-- ── Gewicht-gesplitste verzending (tweede geldmoment) ────────────────────────
create or replace function public.ff_pay_group_shipping(p_group_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_total_weight numeric; v_my_weight numeric; v_my_goods numeric;
  v_my_count int; v_unpaid int; v_unweighed int;
  v_ship_combined numeric; v_my_ship numeric; v_my_ship_buffered numeric;
  v_vat numeric; v_total numeric; v_balance numeric;
  c_first_kg  constant numeric := 0.5;
  c_first_eur constant numeric := 9.0;
  c_per_kg    constant numeric := 8.5;
  c_buffer    constant numeric := 1.3;
  c_vat       constant numeric := 0.21;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;

  -- Gecombineerd gewicht van de HELE groep (de basis van de besparing).
  select coalesce(sum(weight_grams), 0) into v_total_weight
    from public.orders where ff_group_id = p_group_id and status <> 'cancelled';
  -- Mijn deel + of ik al betaald heb.
  select count(*), coalesce(sum(weight_grams), 0), coalesce(sum(price), 0),
         count(*) filter (where not coalesce(group_shipping_paid, false))
    into v_my_count, v_my_weight, v_my_goods, v_unpaid
    from public.orders where ff_group_id = p_group_id and user_id = v_uid and status <> 'cancelled';

  if v_my_count = 0 then return json_build_object('ok', false, 'error', 'No items in this group order'); end if;
  if v_unpaid = 0 then return json_build_object('ok', false, 'error', 'Shipping already paid'); end if;
  -- BELANGRIJK: pas betalen als de HELE groep gewogen is. Anders deelt iedereen door
  -- een ander (groeiend) totaalgewicht → het first-weight-blok wordt meermaals geteld
  -- en de besparing verdwijnt. Zo som(aandelen) = exact één gecombineerd blok.
  select count(*) into v_unweighed from public.orders
    where ff_group_id = p_group_id and status <> 'cancelled' and coalesce(weight_grams, 0) = 0;
  if v_unweighed > 0 then
    return json_build_object('ok', false, 'error', 'Shipping opens once every item in the group has reached the warehouse and been weighed'); end if;
  if v_total_weight <= 0 or v_my_weight <= 0 then
    return json_build_object('ok', false, 'error', 'Weights not known yet — check back when items reach the warehouse'); end if;

  -- ÉÉN gecombineerd first-weight-blok over het groepsgewicht, dan jouw gewichtsaandeel.
  v_ship_combined := c_first_eur + greatest(0, (v_total_weight / 1000.0) - c_first_kg) * c_per_kg;
  v_my_ship := v_ship_combined * (v_my_weight / v_total_weight);
  v_my_ship_buffered := round(v_my_ship * c_buffer, 2);
  v_vat := round((v_my_goods + v_my_ship) * c_vat, 2);   -- 21% over (jouw goederen + jouw verzendaandeel)
  v_total := v_my_ship_buffered + v_vat;

  select balance into v_balance from public.profiles where id = v_uid for update;
  -- #16 — TOCTOU dichten: de v_unpaid-check bovenaan gebeurde VÓÓR deze lock, dus twee snelle
  -- klikken konden er allebei langs (dubbele verzendafschrijving). Nu de profiel-lock dezelfde
  -- user serialiseert, opnieuw checken of de verzending intussen al betaald is.
  select count(*) filter (where not coalesce(group_shipping_paid, false)) into v_unpaid
    from public.orders where ff_group_id = p_group_id and user_id = v_uid and status <> 'cancelled';
  if v_unpaid = 0 then
    return json_build_object('ok', false, 'error', 'Shipping already paid'); end if;
  if coalesce(v_balance, 0) < v_total then
    return json_build_object('ok', false, 'error', 'Insufficient balance', 'needed', v_total); end if;
  update public.profiles set balance = balance - v_total where id = v_uid;
  insert into public.transactions (user_id, amount, type) values (v_uid, -v_total, 'shipping');
  update public.orders set group_shipping_paid = true where ff_group_id = p_group_id and user_id = v_uid;

  return json_build_object('ok', true, 'paid', v_total, 'shipping', v_my_ship_buffered, 'vat', v_vat,
    'my_weight', v_my_weight, 'total_weight', v_total_weight);
end; $$;

-- ── QC-poort: een lid annuleert z'n EIGEN item (individuele refund, groep loopt door)
create or replace function public.ff_cancel_group_order(p_order_id text)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_o public.orders%rowtype;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  select * into v_o from public.orders where id = p_order_id and user_id = v_uid;
  if v_o.id is null then return json_build_object('ok', false, 'error', 'Order not found'); end if;
  if v_o.ff_group_id is null then return json_build_object('ok', false, 'error', 'Not a group order'); end if;
  -- Alleen vóór internationale verzending (QC-poort) annuleerbaar.
  if v_o.status in ('shipped_international', 'delivered', 'cancelled') then
    return json_build_object('ok', false, 'error', 'Too late to cancel — it has already shipped'); end if;
  -- Niet meer annuleerbaar als de (gewicht-gesplitste) verzending al betaald is — anders
  -- zou de verzendkost niet teruggeboekt worden én verschuift het gewichtsaandeel van de
  -- anderen. Vanaf hier loopt het via support (refund verzending + herverdeling).
  if coalesce(v_o.group_shipping_paid, false) then
    return json_build_object('ok', false, 'error', 'Shipping is already paid for this item — contact support to cancel'); end if;
  perform public.refund_order(p_order_id, 'Member cancelled during QC');   -- individuele refund
  return json_build_object('ok', true);
end; $$;

grant execute on function public.ff_pay_group_shipping(uuid) to authenticated;
grant execute on function public.ff_cancel_group_order(text) to authenticated;

-- ── #15 — opruim: verlopen 'gathering'-groepen sluiten + holds vrijgeven ────────
-- Een groep die nooit voltallig-ready wordt blijft anders eeuwig in 'gathering' staan met
-- geld vastgehouden bij de leden. (Geen geldlek — leden kunnen zelf un-ready/leaven om hun
-- geld vrij te maken — maar wel netter.) Deze functie un-ready'd eerst alle leden met een
-- hold (triggert ff_refund_hold_on_unready → saldo terug, werkt alleen zolang 'gathering'),
-- en sluit daarna pas de groep. Alleen service_role/cron mag dit draaien, nooit de klant.
alter table public.flowva_groups add column if not exists updated_at timestamptz default now();

create or replace function public.ff_expire_stale_groups(p_max_age_hours int default 168)  -- default 7 dagen
returns json language plpgsql security definer set search_path = public as $$
declare v_g record; v_count int := 0;
begin
  for v_g in
    select g.id from public.flowva_groups g
    where g.status = 'gathering'
      and coalesce(g.updated_at, now()) < now() - make_interval(hours => p_max_age_hours)
      -- KRITIEK: nooit een groep sluiten waar al ECHT geld vastgehouden wordt (een lid is
      -- ready & heeft betaald en wacht op de rest). updated_at bumpt NIET bij ready/add-item,
      -- dus zonder deze guard zou een actieve, betalende groep na 7 dagen weggegooid worden.
      -- Alleen écht dode groepen (niemand heeft een hold) worden opgeruimd.
      and not exists (
        select 1 from public.flowva_group_members m
        where m.group_id = g.id and coalesce(m.held_amount, 0) > 0
      )
    for update skip locked
  loop
    -- Eerst holds vrijgeven (trigger refundt zolang status nog 'gathering' is) ...
    update public.flowva_group_members set ready = false
      where group_id = v_g.id and ready = true;
    -- ... dan pas de groep sluiten.
    update public.flowva_groups set status = 'cancelled', updated_at = now() where id = v_g.id;
    v_count := v_count + 1;
  end loop;
  return json_build_object('ok', true, 'expired', v_count);
end; $$;

-- NIET voor de klant: geen auth.uid()-check, raakt alle groepen → alleen service_role/cron.
revoke all on function public.ff_expire_stale_groups(int) from public, anon, authenticated;

-- Optioneel automatisch draaien (vereist de pg_cron-extensie; anders vanuit admin/cron-edge):
--   select cron.schedule('ff-expire-stale', '0 3 * * *', $$ select public.ff_expire_stale_groups(168) $$);
