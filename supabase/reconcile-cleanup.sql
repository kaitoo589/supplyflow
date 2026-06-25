-- ============================================================
-- SupplyFlow — reconciliatie opschonen (DRIFT → € 0)
-- Voer uit in: Supabase -> SQL Editor -> New query -> plak -> Run.
--
-- Het admin-paneel toont "DRIFT": de som van alle klant-saldi is
-- niet gelijk aan de som van alle transacties. Oorzaak: tijdens
-- het testen is er saldo op accounts gezet zonder dat daar een
-- storting (top_up) bij in de transactielog is geschreven.
--
-- !!! DOE EERST ALLEEN STAP 1. Die verandert NIETS, alleen kijken.
--     Stuur de uitkomst terug; dan krijg je de exacte fix.
--     STAP 2 staat klaar maar is uitgezet (commentaar) tot we
--     samen hebben gezien om welke accounts het gaat.
-- ============================================================


-- ------------------------------------------------------------
-- STAP 1 — DIAGNOSE (read-only, verandert niets). Run dit eerst.
-- ------------------------------------------------------------

-- 1a. De headline-cijfers (exact wat het admin-paneel toont).
select
  (select coalesce(sum(balance), 0) from profiles)     as werkelijk_saldo,
  (select coalesce(sum(amount),  0) from transactions) as verwacht_saldo,
  (select coalesce(sum(balance), 0) from profiles)
    - (select coalesce(sum(amount), 0) from transactions) as drift;

-- 1b. Per account: saldo nu vs. de optelsom van zijn transacties.
--     Elke rij die hier verschijnt heeft "onverklaard" saldo.
--     -> dit is de lijst die de drift veroorzaakt.
select
  p.id,
  u.email,
  p.role,
  p.balance                                 as saldo_nu,
  coalesce(sum(t.amount), 0)                as volgens_log,
  p.balance - coalesce(sum(t.amount), 0)    as drift,
  count(t.id)                               as aantal_transacties
from profiles p
left join auth.users  u on u.id = p.id
left join transactions t on t.user_id = p.id
group by p.id, u.email, p.role, p.balance
having p.balance - coalesce(sum(t.amount), 0) <> 0
order by abs(p.balance - coalesce(sum(t.amount), 0)) desc;

-- 1c. Veiligheidscheck: transacties die bij GEEN account horen
--     (verweesd). Horen er normaal niet te zijn; als hier rijen
--     uitkomen tellen die ook mee in de drift.
select t.*
from transactions t
left join profiles p on p.id = t.user_id
where p.id is null;


-- ============================================================
-- STAP 2 — DE FIX (bevestigd: 1 testaccount veroorzaakt de drift)
--   tobiasdenhartog07@gmail.com / a7b39f27-3bd9-474a-9de2-a18678c864c9
--
-- Selecteer dit hele blok (de 3 statements hieronder) en Run.
-- ------------------------------------------------------------

-- 2a. Back-up van alle saldi -> altijd terug te draaien.
create table if not exists profiles_balance_backup as
  select id, balance, now() as backed_up_at from profiles;

-- 2b. Spookgeld weghalen: testaccount op 0 (er is nooit echt voor
--     betaald, dus dit hoort niet als besteedbaar saldo live te staan).
update profiles
   set balance = 0
 where id = 'a7b39f27-3bd9-474a-9de2-a18678c864c9';

-- 2c. Boeken kloppend maken: 1 correctie-regel zodat de log van dit
--     account exact op 0 uitkomt (= het nieuwe saldo). Dynamisch
--     berekend, dus altijd precies, geen afrondingsrestje.
insert into transactions (user_id, amount, type)
select 'a7b39f27-3bd9-474a-9de2-a18678c864c9'::uuid,
       -coalesce(sum(amount), 0),
       'adjustment'
from transactions
where user_id = 'a7b39f27-3bd9-474a-9de2-a18678c864c9';

-- ------------------------------------------------------------
-- 2d. CONTROLE: drift hoort nu 0,00 te zijn. Run los na 2a-2c.
-- ------------------------------------------------------------
select
  (select coalesce(sum(balance), 0) from profiles)     as werkelijk_saldo,
  (select coalesce(sum(amount),  0) from transactions) as verwacht_saldo,
  (select coalesce(sum(balance), 0) from profiles)
    - (select coalesce(sum(amount), 0) from transactions) as drift;
-- ============================================================


-- ------------------------------------------------------------
-- ALTERNATIEF (NIET draaien als je 2b/2c al deed): saldo van
-- €953,45 behouden en alleen de boeken kloppend maken. Dan klopt
-- de reconciliatie ook, maar het spookgeld blijft besteedbaar.
--   insert into transactions (user_id, amount, type)
--   select 'a7b39f27-3bd9-474a-9de2-a18678c864c9'::uuid,
--          953.45 - coalesce(sum(amount), 0),
--          'adjustment'
--   from transactions
--   where user_id = 'a7b39f27-3bd9-474a-9de2-a18678c864c9';
-- ------------------------------------------------------------
