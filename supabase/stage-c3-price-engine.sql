-- Stage C3 Position Engine migration
-- Wklej w Supabase SQL Editor i uruchom tylko raz.

create table if not exists asset_prices (
  id uuid primary key default uuid_generate_v4(),
  portfolio_id uuid references portfolios(id) on delete cascade not null,
  asset_id uuid references assets(id) on delete cascade not null,
  price numeric not null default 0,
  currency text default 'PLN',
  priced_at timestamp with time zone default now(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(portfolio_id, asset_id)
);

alter table asset_prices enable row level security;

drop policy if exists "user asset prices" on asset_prices;
create policy "user asset prices"
on asset_prices
for all
using (
  portfolio_id in (
    select id from portfolios
    where user_id = auth.uid()
  )
)
with check (
  portfolio_id in (
    select id from portfolios
    where user_id = auth.uid()
  )
);
