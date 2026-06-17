-- ============================================================
-- SupplyFlow wise_transfers — één rij per Wise-transfer naar de agent
-- Uitvoeren in: Supabase dashboard → SQL Editor → New query → Run
-- Het Treasury-tabblad in het OPS-HUD leest deze tabel automatisch.
-- ============================================================

create table if not exists wise_transfers (
  id uuid primary key default gen_random_uuid(),
  order_id text references orders (id) on delete set null,
  amount_eur numeric not null check (amount_eur >= 0),
  amount_cny numeric,
  wise_id text,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wise_transfers_status_idx on wise_transfers (status, created_at desc);
create index if not exists wise_transfers_order_idx on wise_transfers (order_id);

-- RLS: alleen admin leest/schrijft via de client.
-- (De edge function die straks de Wise API aanroept gebruikt de service role en omzeilt RLS.)
alter table wise_transfers enable row level security;

drop policy if exists wise_transfers_admin_all on wise_transfers;
create policy wise_transfers_admin_all on wise_transfers
  for all using (is_admin()) with check (is_admin());
