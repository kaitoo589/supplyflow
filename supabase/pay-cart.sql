-- ============================================================
-- Flowva — instant checkout: reken de hele winkelmand in één keer af.
-- Vervangt de "aanvraag → offerte → betalen"-flow voor catalogus-producten:
-- de klant betaalt direct de bekende prijs + één service fee (8%, min €5),
-- en de orders gaan meteen op 'quote_accepted' → triggert F3 (BuckyDrop).
--
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- ============================================================

-- Zorg dat alle kolommen die pay_cart gebruikt bestaan (idempotent).
alter table public.orders add column if not exists product text;
alter table public.orders add column if not exists product_title text;
alter table public.orders add column if not exists source_url text;
alter table public.orders add column if not exists platform text;
alter table public.orders add column if not exists price numeric;
alter table public.orders add column if not exists qty integer;
alter table public.orders add column if not exists kleur text;
alter table public.orders add column if not exists opmerking text;
alter table public.orders add column if not exists variant_image text;
alter table public.orders add column if not exists date text;
alter table public.orders add column if not exists request_group_id text;
alter table public.orders add column if not exists quoted_total numeric;
alter table public.orders add column if not exists quote_accepted_at timestamptz;
-- Bevroren bezorgadres-snapshot (anti-fraude: bewijs van wat de klant opgaf bij checkout).
alter table public.orders add column if not exists ship_name text;
alter table public.orders add column if not exists ship_phone text;
alter table public.orders add column if not exists ship_address text;
alter table public.orders add column if not exists ship_postcode text;
alter table public.orders add column if not exists ship_city text;
alter table public.orders add column if not exists ship_country text;

-- #12 — IDEMPOTENTIE: elke checkout-poging draagt een uniek token (p_idem). Een retry of
-- dubbele submit met hetzelfde token wordt een no-op die het eerdere SUCCES teruggeeft,
-- zodat er nooit dubbele orders + dubbele afschrijving ontstaan.
create table if not exists public.cart_idempotency (
  idem_key   text primary key,
  user_id    uuid not null,
  result     jsonb,
  created_at timestamptz not null default now()
);
alter table public.cart_idempotency enable row level security;
-- Geen client-toegang: alleen de security-definer pay_cart (service-context) raakt deze tabel.
revoke all on public.cart_idempotency from anon, authenticated;

-- Oude 1-arg variant droppen, anders wordt pay_cart(jsonb) vs pay_cart(jsonb,text) ambigu
-- voor PostgREST en faalt de aanroep met "could not choose best candidate function".
drop function if exists public.pay_cart(jsonb);

-- Service fee = 8% van het totaal, minimaal €5. Hier meegeleverd zodat
-- pay-cart.sql op zichzelf werkt (ook als service-fee.sql nog niet is gedraaid).
create or replace function public.service_fee_for(p_total numeric)
returns numeric language sql immutable as $$
  select greatest(round(p_total * 0.08, 2), 5.00);
$$;

create or replace function public.pay_cart(p_items jsonb, p_idem text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prior jsonb;
  v_result json;
  v_total numeric := 0;
  v_units int := 0;
  v_domestic numeric := 0;
  v_qc numeric := 0;
  v_fee numeric;
  v_charge numeric;
  v_balance numeric;
  v_group text;
  v_item jsonb;
  v_line numeric;
  v_price numeric;
  v_unknown int;
  v_qty int;
  v_id text;
  v_first_id text;
  v_i int := 0;
  v_meta jsonb;
  v_ship_name text;
  v_ship_phone text;
  v_ship_addr text;
  v_ship_post text;
  v_ship_city text;
  v_ship_country text;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'Not logged in');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return json_build_object('ok', false, 'error', 'Cart is empty');
  end if;

  -- #12 — idempotentie-claim. Zelfde token al gezien:
  --  • resultaat ingevuld  → eerdere SUCCESVOLLE afronding, geef die exact terug (geen dubbele order);
  --  • resultaat nog leeg   → vorige poging liep nog/faalde, vraag de klant het opnieuw te proberen
  --    (de client roteert het token na elk ontvangen antwoord, dus dit blokkeert niet).
  -- De unieke index serialiseert gelijktijdige calls: de 2e wacht tot de 1e commit en valt
  -- dan in de unique_violation-tak. p_idem null (oude client) = idempotentie uit, gedrag ongewijzigd.
  if p_idem is not null then
    begin
      insert into public.cart_idempotency (idem_key, user_id) values (p_idem, v_uid);
    exception when unique_violation then
      select result into v_prior from public.cart_idempotency where idem_key = p_idem;
      if v_prior is not null then
        return v_prior::json;
      end if;
      return json_build_object('ok', false, 'error', 'This order is already being processed — please try again.', 'retry', true);
    end;
  end if;

  -- Bezorgadres uit het profiel lezen + straks BEVRIEZEN op elke order (anti-fraude:
  -- bewijs van wat de klant opgaf). Harde server-side gate: geen adres → geen checkout.
  select raw_user_meta_data into v_meta from auth.users where id = v_uid;
  v_ship_addr := nullif(trim(coalesce(v_meta->>'adres', '')), '');
  v_ship_city := nullif(trim(coalesce(v_meta->>'stad', '')), '');
  if v_ship_addr is null or v_ship_city is null then
    return json_build_object('ok', false, 'error', 'Please add your shipping address first');
  end if;
  v_ship_name    := nullif(trim(coalesce(v_meta->>'voornaam', '') || ' ' || coalesce(v_meta->>'achternaam', '')), '');
  v_ship_phone   := v_meta->>'telefoon';
  v_ship_post    := v_meta->>'postcode';
  v_ship_country := coalesce(nullif(trim(coalesce(v_meta->>'land', '')), ''), 'Netherlands');

  -- BEVEILIGING: de prijs komt SERVER-SIDE uit public.products (match op source_url),
  -- NOOIT uit de client-JSON — anders kan een klant pay_cart aanroepen met price=0.01
  -- en elk product bijna gratis kopen. Onbekend product / ontbrekende source_url = weigeren.
  select
    coalesce(sum(
      (select pr.price from public.products pr where pr.source_url = (e->>'source_url') and pr.price is not null order by pr.id limit 1)
      * greatest(coalesce((e->>'qty')::int, 1), 1)
    ), 0),
    count(*) filter (
      where (e->>'source_url') is null
         or not exists (select 1 from public.products pr where pr.source_url = (e->>'source_url') and pr.price is not null)
    ),
    coalesce(sum(greatest(coalesce((e->>'qty')::int, 1), 1)), 0)
    into v_total, v_unknown, v_units
  from jsonb_array_elements(p_items) e;

  if v_unknown > 0 then
    return json_build_object('ok', false, 'error', 'One or more products are no longer available');
  end if;

  v_fee := service_fee_for(v_total);              -- max(8%, €5), alleen over de fabrieksprijs
  v_domestic := round(v_units * 5.0 / 7.8, 2);    -- China domestic shipping: ¥5/stuk → EUR (koers 7,8)
  v_qc := round(v_units * 6.0 / 7.8, 2);          -- Quality-control (¥2 foto + ¥4 measurement = ¥6/stuk)
  v_charge := v_total + v_domestic + v_qc + v_fee;

  -- Saldo vergrendelen + controleren
  select balance into v_balance from profiles where id = v_uid for update;
  if coalesce(v_balance, 0) < v_charge then
    return json_build_object('ok', false, 'error', 'Insufficient balance', 'needed', v_charge);
  end if;

  update profiles set balance = balance - v_charge where id = v_uid;

  v_group := 'SF-G-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_i := v_i + 1;
    v_qty := greatest(coalesce((v_item->>'qty')::int, 1), 1);
    -- Prijs server-side uit products (NOOIT de client-prijs vertrouwen).
    select pr.price into v_price from public.products pr where pr.source_url = (v_item->>'source_url') and pr.price is not null order by pr.id limit 1;
    v_line := v_price * v_qty;
    v_id := 'SF-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || v_i;
    if v_i = 1 then v_first_id := v_id; end if;

    insert into orders (
      id, user_id, product, product_title, source_url, platform,
      price, qty, kleur, variant_image, opmerking,
      status, request_group_id, quoted_total, quote_accepted_at, date,
      ship_name, ship_phone, ship_address, ship_postcode, ship_city, ship_country
    ) values (
      v_id, v_uid,
      coalesce(v_item->>'product', v_item->>'product_title'),
      v_item->>'product_title',
      v_item->>'source_url',
      v_item->>'platform',
      v_line, v_qty,
      v_item->>'kleur',
      v_item->>'variant_image',
      v_item->>'opmerking',
      'quote_accepted', v_group, v_line, now(),
      to_char(now(), 'DD Mon'),
      v_ship_name, v_ship_phone, v_ship_addr, v_ship_post, v_ship_city, v_ship_country
    );

    insert into transactions (user_id, amount, type, order_id)
    values (v_uid, -v_line, 'order', v_id);
  end loop;

  -- Eén service fee over de hele mand
  insert into transactions (user_id, amount, type, order_id)
  values (v_uid, -v_fee, 'service_fee', v_first_id);

  -- China domestic shipping (¥5/stuk) als aparte regel
  if v_domestic > 0 then
    insert into transactions (user_id, amount, type, order_id)
    values (v_uid, -v_domestic, 'domestic_shipping', v_first_id);
  end if;

  -- Quality-control (¥6/stuk) als aparte regel
  if v_qc > 0 then
    insert into transactions (user_id, amount, type, order_id)
    values (v_uid, -v_qc, 'qc_fee', v_first_id);
  end if;

  v_result := json_build_object('ok', true, 'fee', v_fee, 'domestic', v_domestic, 'qc', v_qc, 'total', v_total, 'charged', v_charge, 'group', v_group);
  -- Resultaat vastleggen onder het token: een latere retry met hetzelfde token krijgt
  -- exact dit succes terug i.p.v. een tweede afschrijving.
  if p_idem is not null then
    update public.cart_idempotency set result = v_result::jsonb where idem_key = p_idem;
  end if;
  return v_result;
end;
$$;

grant execute on function public.pay_cart(jsonb, text) to authenticated;
