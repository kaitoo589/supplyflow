-- ============================================================
-- Voorbeeld-reviews voor de "low cortisol tee"
-- (zodat je de review-pagina gevuld ziet met sterren, foto's, filters).
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- Verwijder later gerust weer (Table Editor → reviews → rijen wissen).
-- ============================================================

with prod as (
  select id, image from public.products
  where title = 'low cortisol tee'
),
usr as (
  select id from auth.users where email = 'kledingbisnis123@gmail.com' limit 1
)
insert into public.reviews
  (product_id, user_id, username, rating, quality_score, body, variant, would_buy_again, photos)
select
  prod.id,
  usr.id,
  v.username, v.rating, v.quality, v.body, v.variant, v.again,
  case when v.withphoto then array[prod.image] else array[]::text[] end
from prod, usr, (values
  ('Lisa M.', 5, 5, 'Echt top kwaliteit, precies zoals op de foto! Snel geleverd.', 'Kleur: zwart · Maat: M',  true,  true),
  ('Sven K.', 4, 4, 'Mooie stof, valt iets kleiner uit. Toch erg blij mee.',        'Kleur: zwart · Maat: L',  true,  false),
  ('Amir T.', 5, 5, 'Beste aankoop in tijden. Zou zo weer bestellen!',              'Kleur: wit · Maat: M',    true,  true),
  ('Noa V.',  3, 3, 'Oke product, maar de print zat een beetje scheef.',            'Kleur: zwart · Maat: S',  false, false),
  ('Jay R.',  5, 4, 'Topkwaliteit voor de prijs, echte aanrader.',                  'Kleur: grijs · Maat: XL', true,  false)
) as v(username, rating, quality, body, variant, again, withphoto);
