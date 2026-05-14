-- Stage C4.1a Historical Market Engine foundations
-- Additive migration only: keeps the current C3.4 asset_prices latest-price model intact.
-- This migration prepares history/snapshot tables without changing UI, API routes or refresh logic.

create extension if not exists "uuid-ossp";

-- Asset-level metadata for future provider selection and refresh status.
alter table assets
  add column if not exists market_symbol text,
  add column if not exists price_source text not null default 'auto',
  add column if not exists auto_refresh_enabled boolean not null default true,
  add column if not exists last_price_refresh_at timestamptz,
  add column if not exists last_price_refresh_error text;

create table if not exists market_prices (
  id uuid primary key default uuid_generate_v4(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  source text not null,
  source_symbol text not null,
  price_date date not null,
  open_price numeric check (open_price is null or open_price >= 0),
  high_price numeric check (high_price is null or high_price >= 0),
  low_price numeric check (low_price is null or low_price >= 0),
  close_price numeric not null check (close_price >= 0),
  adjusted_close_price numeric check (adjusted_close_price is null or adjusted_close_price >= 0),
  source_currency text not null,
  base_currency text not null default 'PLN',
  fx_rate_to_base numeric check (fx_rate_to_base is null or fx_rate_to_base > 0),
  close_price_base numeric check (close_price_base is null or close_price_base >= 0),
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(asset_id, source, price_date)
);

create table if not exists fx_rates (
  id uuid primary key default uuid_generate_v4(),
  from_currency text not null,
  to_currency text not null default 'PLN',
  rate_date date not null,
  rate numeric not null check (rate > 0),
  source text not null default 'nbp',
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(from_currency, to_currency, rate_date, source)
);

create table if not exists portfolio_snapshots (
  id uuid primary key default uuid_generate_v4(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  snapshot_date date not null,
  base_currency text not null default 'PLN',
  total_value numeric not null default 0,
  positions_value numeric not null default 0,
  edo_value numeric not null default 0,
  cash_value numeric not null default 0,
  invested_cost numeric not null default 0,
  remaining_cost numeric not null default 0,
  realized_pnl numeric not null default 0,
  unrealized_pnl numeric not null default 0,
  total_pnl numeric not null default 0,
  net_cash_flow numeric not null default 0,
  contribution numeric not null default 0,
  source text not null default 'system',
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(portfolio_id, snapshot_date)
);

create table if not exists price_refresh_runs (
  id uuid primary key default uuid_generate_v4(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('manual','cron','backfill')),
  status text not null check (status in ('running','success','partial_success','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  requested_assets integer not null default 0 check (requested_assets >= 0),
  refreshed_assets integer not null default 0 check (refreshed_assets >= 0),
  failed_assets integer not null default 0 check (failed_assets >= 0),
  error text
);

create table if not exists price_refresh_run_items (
  id uuid primary key default uuid_generate_v4(),
  run_id uuid not null references price_refresh_runs(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  symbol text not null,
  source text,
  status text not null check (status in ('success','skipped','failed')),
  price_date date,
  price numeric check (price is null or price >= 0),
  currency text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists assets_auto_refresh_idx
  on assets(portfolio_id, auto_refresh_enabled, price_source);
create index if not exists market_prices_portfolio_date_idx
  on market_prices(portfolio_id, price_date desc);
create index if not exists market_prices_asset_date_idx
  on market_prices(asset_id, price_date desc);
create index if not exists market_prices_portfolio_asset_date_idx
  on market_prices(portfolio_id, asset_id, price_date desc);
create index if not exists fx_rates_pair_date_idx
  on fx_rates(from_currency, to_currency, rate_date desc);
create index if not exists portfolio_snapshots_portfolio_date_idx
  on portfolio_snapshots(portfolio_id, snapshot_date desc);
create index if not exists price_refresh_runs_portfolio_started_idx
  on price_refresh_runs(portfolio_id, started_at desc);
create index if not exists price_refresh_run_items_run_idx
  on price_refresh_run_items(run_id);
create index if not exists price_refresh_run_items_portfolio_asset_idx
  on price_refresh_run_items(portfolio_id, asset_id, created_at desc);

alter table market_prices enable row level security;
alter table fx_rates enable row level security;
alter table portfolio_snapshots enable row level security;
alter table price_refresh_runs enable row level security;
alter table price_refresh_run_items enable row level security;

drop policy if exists "own market prices" on market_prices;
create policy "own market prices" on market_prices
for all
using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
with check (
  portfolio_id in (select id from portfolios where user_id = auth.uid())
  and asset_id in (select id from assets where portfolio_id = market_prices.portfolio_id)
);

drop policy if exists "read fx rates" on fx_rates;
create policy "read fx rates" on fx_rates
for select
using (true);

drop policy if exists "own portfolio snapshots" on portfolio_snapshots;
create policy "own portfolio snapshots" on portfolio_snapshots
for all
using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
with check (portfolio_id in (select id from portfolios where user_id = auth.uid()));

drop policy if exists "own price refresh runs" on price_refresh_runs;
create policy "own price refresh runs" on price_refresh_runs
for all
using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
with check (portfolio_id in (select id from portfolios where user_id = auth.uid()));

drop policy if exists "own price refresh run items" on price_refresh_run_items;
create policy "own price refresh run items" on price_refresh_run_items
for all
using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
with check (
  portfolio_id in (select id from portfolios where user_id = auth.uid())
  and (
    asset_id is null
    or asset_id in (select id from assets where portfolio_id = price_refresh_run_items.portfolio_id)
  )
);

-- Seed one historical row per current latest-price row.
-- This is idempotent and does not alter asset_prices, so the current app behavior is preserved.
insert into market_prices (
  portfolio_id,
  asset_id,
  source,
  source_symbol,
  price_date,
  close_price,
  source_currency,
  base_currency,
  fx_rate_to_base,
  close_price_base,
  fetched_at
)
select
  ap.portfolio_id,
  ap.asset_id,
  'asset_prices_seed',
  coalesce(nullif(a.market_symbol, ''), a.symbol),
  coalesce(ap.priced_at::date, ap.updated_at::date, ap.created_at::date, current_date),
  ap.price,
  coalesce(nullif(ap.currency, ''), nullif(a.currency, ''), 'PLN'),
  coalesce(nullif(p.currency, ''), 'PLN'),
  case
    when coalesce(nullif(ap.currency, ''), nullif(a.currency, ''), 'PLN') = coalesce(nullif(p.currency, ''), 'PLN') then 1
    else null
  end,
  case
    when coalesce(nullif(ap.currency, ''), nullif(a.currency, ''), 'PLN') = coalesce(nullif(p.currency, ''), 'PLN') then ap.price
    else null
  end,
  coalesce(ap.priced_at, ap.updated_at, ap.created_at, now())
from asset_prices ap
join assets a on a.id = ap.asset_id and a.portfolio_id = ap.portfolio_id
join portfolios p on p.id = ap.portfolio_id
where ap.price is not null and ap.price >= 0
on conflict (asset_id, source, price_date) do update
set
  close_price = excluded.close_price,
  source_currency = excluded.source_currency,
  base_currency = excluded.base_currency,
  fx_rate_to_base = excluded.fx_rate_to_base,
  close_price_base = excluded.close_price_base,
  fetched_at = excluded.fetched_at;
