-- ============================================================
-- FLOWVA — PRIJS PER VARIANT (2026-07-27)
-- ------------------------------------------------------------
-- Probleem: een product met varianten die bij de bron verschillend geprijsd
-- zijn (bv. ¥269 top / ¥299 rok) werd in de app én bij het afrekenen op ÉÉN
-- prijs gezet: products.price. Die stond telkens gelijk aan de goedkoopste
-- variant, dus op elke duurdere variant liep je marge mis — bij één product
-- tot €7,57 per stuk.
--
-- Oplossing in drie stappen:
--   1. Elke SKU krijgt een euro-prijs (priceEur) naast de bestaande priceYuan.
--   2. Een opzoek-functie vertaalt de variantkeuze van de klant naar die prijs.
--   3. pay_cart en ff_cart_checkout rekenen dáármee, met products.price als
--      terugval. De prijs blijft dus volledig server-side bepaald.
--
-- Waarom priceEur opslaan en niet ¥ omrekenen bij het afrekenen: de client
-- rekent met /7,8 en de server met /7,7. Zou ik live omrekenen, dan wijkt wat
-- de klant ziet af van wat hij betaalt. Eén opgeslagen euro-bedrag = beide
-- kanten lezen exact hetzelfde getal.
-- ============================================================

begin;

-- ── 1. BACKFILL ────────────────────────────────────────────────────────────
-- Koers per product afleiden uit wat er al staat: products.price hoort bij de
-- GOEDKOOPSTE variant (zo is hij ooit geïmporteerd). Met die koers krijgt de
-- goedkoopste variant exact z'n huidige prijs terug — er verandert dus niets
-- aan wat klanten vandaag zien — en worden alleen de duurdere varianten
-- rechtgetrokken. Geen willekeurige dagkoers die alles overhoop gooit.
with basis as (
  select p.id, p.price,
         (select min((s->>'priceYuan')::numeric)
            from jsonb_array_elements(p.bd_skus) s
           where s->>'priceYuan' is not null) as laagste_yuan
  from public.products p
  where jsonb_typeof(p.bd_skus) = 'array' and jsonb_array_length(p.bd_skus) > 0
),
koers as (
  select id, price / nullif(laagste_yuan, 0) as rate from basis
  where price is not null and laagste_yuan is not null and laagste_yuan > 0
)
update public.products p
set bd_skus = (
  select jsonb_agg(
    case when s->>'priceYuan' is null then s
         else s || jsonb_build_object('priceEur',
                round((s->>'priceYuan')::numeric * k.rate, 2))
    end
    order by ord)
  from jsonb_array_elements(p.bd_skus) with ordinality as t(s, ord)
)
from koers k
where k.id = p.id;

-- ── 2. OPZOEK-FUNCTIE ──────────────────────────────────────────────────────
-- De klant kiest bv. {size: M, Color: Blue-gray skirt}; de app slaat dat op als
-- "size: M, Color: Blue-gray skirt". Die string matchen we op de props van elke
-- SKU (set-vergelijking, niet op volgorde — de app bouwt de string in de
-- volgorde waarin de klant klikt).
--
-- Geen match (product zonder varianten, hernoemde optie, oud mand-item) →
-- terugval op products.price. Nooit null, nooit gratis.
create or replace function public.sku_price_eur(p_source_url text, p_kleur text)
  returns numeric
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select coalesce(
    (select (s->>'priceEur')::numeric
       from public.products pr,
            jsonb_array_elements(pr.bd_skus) s
      where pr.source_url = p_source_url
        and jsonb_typeof(pr.bd_skus) = 'array'
        and s->>'priceEur' is not null
        and coalesce(p_kleur, '') <> ''
        and (
          select coalesce(bool_and(
                   btrim(seg) = any (select btrim(x) from unnest(string_to_array(p_kleur, ',')) x)
                 ), false)
          from (
            select (pp->>'name') || ': ' || (pp->>'value') as seg
            from jsonb_array_elements(s->'props') pp
          ) q
        )
      order by pr.id
      limit 1),
    (select pr.price
       from public.products pr
      where pr.source_url = p_source_url and pr.price is not null
      order by pr.id
      limit 1)
  );
$function$;

revoke execute on function public.sku_price_eur(text, text) from public, anon;

commit;

-- ── 3. DE TWEE GELD-RPC'S ──────────────────────────────────────────────────
-- pay_cart (solo) en ff_cart_checkout (Friends) zijn LIVE bijgewerkt: overal
-- waar ze eerst products.price opzochten, roepen ze nu sku_price_eur(source_url,
-- kleur) aan. Verder is er niets aan die functies veranderd — zelfde saldo-lock,
-- zelfde idempotentie, zelfde fees. De volledige bodies staan niet in dit
-- bestand omdat ze honderden regels beslaan; haal ze op met:
--   select pg_get_functiondef(oid) from pg_proc where proname = 'pay_cart';
--
-- Let op bij toekomstige `create or replace` op deze functies: dat zet de
-- EXECUTE-rechten terug op de standaard. Voor pay_cart/ff_cart_checkout is dat
-- prima (de klant roept ze zelf aan; anon krijgt direct "Not logged in" omdat
-- auth.uid() leeg is), maar voor refund_order en pay_shipping_* is het juist de
-- valkuil die in de audit van 2026-07-12 naar boven kwam.

-- ============================================================
-- CONTROLE — draai dit ná de commit.
-- ============================================================

-- a) Krijgt elke variant nu z'n eigen prijs? (verwacht: 2 verschillende voor 155)
select p.id, left(p.title, 34) as titel,
       s->'props'->1->>'value' as kleur,
       s->>'priceYuan' as yuan,
       s->>'priceEur'  as euro
from public.products p, jsonb_array_elements(p.bd_skus) s
where p.id = 155
order by (s->>'priceEur')::numeric, s->'props'->0->>'value';

-- b) Doet de opzoek-functie het? (verwacht: verschillende bedragen)
select public.sku_price_eur(
         (select source_url from public.products where id = 155),
         'size: M, Color: Blue-gray top') as top_prijs,
       public.sku_price_eur(
         (select source_url from public.products where id = 155),
         'size: M, Color: Blue-gray skirt') as rok_prijs,
       public.sku_price_eur(
         (select source_url from public.products where id = 155),
         'onzin: bestaat niet') as terugval;
