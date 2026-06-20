-- Materiaal / samenstelling per product.
-- Array van { name, pct } — pct is optioneel (lege string toegestaan).
-- Bijv. [{"name":"Cotton","pct":"98"},{"name":"Elastane","pct":"2"}]
alter table products add column if not exists material jsonb default '[]'::jsonb;
