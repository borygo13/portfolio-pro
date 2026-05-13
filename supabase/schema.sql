-- Portfolio PRO schema for Supabase/Postgres
create extension if not exists "uuid-ossp";

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  base_currency text not null default 'PLN',
  created_at timestamptz not null default now()
);

create table if not exists accounts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  provider text,
  account_type text not null check (account_type in ('broker','bank','crypto','cash','other')),
  currency text not null default 'PLN',
  created_at timestamptz not null default now()
);

create table if not exists assets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  name text not null,
  asset_type text not null check (asset_type in ('etf','stock','bond','cash','crypto','cfd')),
  currency text not null default 'PLN',
  exchange text,
  created_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  tx_type text not null check (tx_type in ('buy','sell','dividend','deposit','withdrawal','fee','tax','interest')),
  quantity numeric,
  price numeric,
  amount numeric not null,
  fee numeric not null default 0,
  currency text not null default 'PLN',
  executed_at timestamptz not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists bonds_edo (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  series text not null,
  purchase_date date not null,
  units integer not null,
  unit_price numeric not null default 100,
  first_year_rate numeric not null,
  margin_after_first_year numeric not null default 0.015,
  belka_tax numeric not null default 0.19,
  early_redemption_fee numeric not null default 2,
  created_at timestamptz not null default now()
);

create table if not exists inflation_rates (
  id uuid primary key default uuid_generate_v4(),
  year integer not null,
  month integer not null,
  rate numeric not null,
  unique(year, month)
);

create table if not exists trades_cfd (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  opened_at timestamptz not null,
  closed_at timestamptz,
  instrument text not null,
  direction text not null check (direction in ('long','short')),
  size numeric not null,
  entry_price numeric not null,
  exit_price numeric,
  gross_pl numeric not null default 0,
  fees numeric not null default 0,
  swap numeric not null default 0,
  net_pl numeric generated always as (gross_pl - fees - swap) stored,
  strategy text,
  note text,
  screenshot_url text,
  created_at timestamptz not null default now()
);

create table if not exists portfolio_snapshots (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  module text not null check (module in ('global','long_term','trading','crypto','cash')),
  contribution numeric not null default 0,
  value numeric not null default 0,
  benchmark_value numeric,
  created_at timestamptz not null default now(),
  unique(user_id, snapshot_date, module)
);

alter table profiles enable row level security;
alter table accounts enable row level security;
alter table assets enable row level security;
alter table transactions enable row level security;
alter table bonds_edo enable row level security;
alter table trades_cfd enable row level security;
alter table portfolio_snapshots enable row level security;

create policy "own profiles" on profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own accounts" on accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own assets" on assets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own transactions" on transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own bonds" on bonds_edo for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own trades" on trades_cfd for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own snapshots" on portfolio_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
