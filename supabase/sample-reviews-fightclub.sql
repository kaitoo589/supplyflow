-- ============================================================
-- Voorbeeld-reviews voor de "Fight Club Graphic T-Shirt"
-- Zelfde opzet als sample-reviews.sql.
-- Voer uit in: Supabase → SQL Editor → New query → plak → Run.
-- Verwijder later gerust weer (Table Editor → reviews → rijen wissen).
-- ============================================================

with prod as (
  select id, image from public.products
  where title ilike '%fight club%'
  limit 1
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
  ('Thomas B.',  5, 5, 'Kwaliteit viel me echt mee voor deze prijs. Stevige stof, print zit strak en de pasvorm is precies goed.',           'Kleur: zwart · Maat: L',  true,  true),
  ('Marla S.',   4, 4, 'Stoere print, lekker dikke stof. Na drie keer wassen nog steeds strak. Valt wel iets ruimer uit.',                   'Kleur: zwart · Maat: S',  true,  false),
  ('Robert P.',  5, 5, 'Past perfect, ook met wat meer bouw. Print is haarscherp, echt bioscoopkwaliteit.',                                  'Kleur: zwart · Maat: XXL', true, true),
  ('Daan V.',    5, 4, 'Voor deze prijs verwacht je niks, maar dit voelt als een shirt van drie keer zo duur. Aanrader.',                     'Kleur: wit · Maat: M',    true,  false),
  ('Esra K.',    3, 3, 'Shirt zelf prima, maar de levering duurde langer dan verwacht. Print is wel mooi.',                                  'Kleur: zwart · Maat: M',  false, false),
  ('Nielsje',    4, 5, 'Gekocht voor een filmavond, niet meer uitgedaan. Kraag blijft goed in vorm.',                                        'Kleur: grijs · Maat: L',  true,  true),
  ('Sam de B.',  5, 5, 'Tweede keer besteld, eerste is "geleend" door mijn huisgenoot. Zegt genoeg.',                                        'Kleur: zwart · Maat: M',  true,  false),
  ('Jack''s vriend', 2, 2, 'Helaas net te klein besteld en de print kraakte na het strijken. Eigen schuld, maar toch.',                      'Kleur: wit · Maat: S',    false, false)
) as v(username, rating, quality, body, variant, again, withphoto);
