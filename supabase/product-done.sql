-- Flowva — "helemaal af"-markering voor producten (interne QA-vinkje).
-- Eén keer draaien in de Supabase SQL Editor.
-- Puur intern: bepaalt NIET of een product in de feed staat (dat blijft `hidden`);
-- het is een stempel om bij te houden welke producten helemaal klaar zijn.
alter table public.products add column if not exists done boolean not null default false;
