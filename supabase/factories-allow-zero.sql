-- Sta 0 diamanten toe: een fabriek kan "geen rang" hebben. Eén keer draaien.
alter table public.factories drop constraint if exists factories_diamonds_check;
alter table public.factories add constraint factories_diamonds_check check (diamonds between 0 and 4);
alter table public.factories alter column diamonds set default 0;
