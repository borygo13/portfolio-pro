-- Stage C5 Portfolio Intelligence Engine
-- Additive migration only: cash ledger, dividends, benchmark selection, and
-- richer portfolio snapshot fields for analytics.

create extension if not exists "uuid-ossp";

create table if not exists cash_ledger_entries (
  id uuid primary key default uuid_generate_v4(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  entry_type text not null check (entry_type in ('deposit','withdrawal','fee','tax','adjustment')),
  amount numeric not null check (amount > 0),
  currency text not null check (currency in ('PLN','EUR','USD')),
  entry_date date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Some existing C3/C4 databases may already contain one of these tables with
-- a narrower shape. CREATE TABLE IF NOT EXISTS does not add missing columns, so
-- keep the C5 shape compatible by repairing columns additively before indexes.
alter table cash_ledger_entries
  add column if not exists id uuid default uuid_generate_v4(),
  add column if not exists portfolio_id uuid references portfolios(id) on delete cascade,
  add column if not exists entry_type text check (entry_type in ('deposit','withdrawal','fee','tax','adjustment')),
  add column if not exists amount numeric check (amount > 0),
  add column if not exists currency text default 'PLN' check (currency in ('PLN','EUR','USD')),
  add column if not exists entry_date date,
  add column if not exists note text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists dividends (
  id uuid primary key default uuid_generate_v4(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  received_date date not null,
  gross_amount numeric not null check (gross_amount >= 0),
  tax_amount numeric not null default 0 check (tax_amount >= 0),
  net_amount numeric not null check (net_amount >= 0),
  currency text not null check (currency in ('PLN','EUR','USD')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table dividends
  add column if not exists id uuid default uuid_generate_v4(),
  add column if not exists portfolio_id uuid references portfolios(id) on delete cascade,
  add column if not exists asset_id uuid references assets(id) on delete cascade,
  add column if not exists received_date date,
  add column if not exists gross_amount numeric check (gross_amount >= 0),
  add column if not exists tax_amount numeric default 0 check (tax_amount >= 0),
  add column if not exists net_amount numeric check (net_amount >= 0),
  add column if not exists currency text default 'PLN' check (currency in ('PLN','EUR','USD')),
  add column if not exists note text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dividends'
      and column_name = 'amount'
  ) then
    update dividends
    set
      gross_amount = coalesce(gross_amount, amount, 0),
      tax_amount = coalesce(tax_amount, 0),
      net_amount = coalesce(net_amount, greatest(coalesce(gross_amount, amount, 0) - coalesce(tax_amount, 0), 0))
    where gross_amount is null
      or tax_amount is null
      or net_amount is null;

    alter table dividends alter column amount drop not null;
    alter table dividends alter column amount drop default;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.dividends'::regclass
      and conname = 'dividends_gross_amount_nonnegative_chk'
  ) then
    alter table dividends
      add constraint dividends_gross_amount_nonnegative_chk check (gross_amount >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.dividends'::regclass
      and conname = 'dividends_tax_amount_nonnegative_chk'
  ) then
    alter table dividends
      add constraint dividends_tax_amount_nonnegative_chk check (tax_amount >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.dividends'::regclass
      and conname = 'dividends_net_amount_nonnegative_chk'
  ) then
    alter table dividends
      add constraint dividends_net_amount_nonnegative_chk check (net_amount >= 0) not valid;
  end if;
end $$;

update dividends d
set portfolio_id = a.portfolio_id
from assets a
where d.portfolio_id is null
  and d.asset_id = a.id;

create table if not exists portfolio_benchmarks (
  portfolio_id uuid primary key references portfolios(id) on delete cascade,
  benchmark_asset_id uuid references assets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table portfolio_benchmarks
  add column if not exists portfolio_id uuid references portfolios(id) on delete cascade,
  add column if not exists benchmark_asset_id uuid references assets(id) on delete set null,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table portfolio_snapshots
  add column if not exists dividends_value numeric not null default 0,
  add column if not exists fees_value numeric not null default 0,
  add column if not exists taxes_value numeric not null default 0,
  add column if not exists allocation_breakdown jsonb not null default '[]'::jsonb,
  add column if not exists benchmark_asset_id uuid references assets(id) on delete set null;

create index if not exists cash_ledger_entries_portfolio_date_idx
  on cash_ledger_entries(portfolio_id, entry_date desc);
create index if not exists dividends_portfolio_date_idx
  on dividends(portfolio_id, received_date desc);
create index if not exists dividends_asset_date_idx
  on dividends(asset_id, received_date desc);
create unique index if not exists portfolio_benchmarks_portfolio_id_uidx
  on portfolio_benchmarks(portfolio_id);
create index if not exists portfolio_snapshots_benchmark_idx
  on portfolio_snapshots(portfolio_id, benchmark_asset_id, snapshot_date desc);

alter table cash_ledger_entries enable row level security;
alter table dividends enable row level security;
alter table portfolio_benchmarks enable row level security;

drop policy if exists "own cash ledger entries" on cash_ledger_entries;
create policy "own cash ledger entries" on cash_ledger_entries
for all
using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
with check (portfolio_id in (select id from portfolios where user_id = auth.uid()));

drop policy if exists "own dividends" on dividends;
create policy "own dividends" on dividends
for all
using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
with check (
  portfolio_id in (select id from portfolios where user_id = auth.uid())
  and asset_id in (select id from assets where portfolio_id = dividends.portfolio_id)
);

drop policy if exists "own portfolio benchmark" on portfolio_benchmarks;
create policy "own portfolio benchmark" on portfolio_benchmarks
for all
using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
with check (
  portfolio_id in (select id from portfolios where user_id = auth.uid())
  and (
    benchmark_asset_id is null
    or benchmark_asset_id in (select id from assets where portfolio_id = portfolio_benchmarks.portfolio_id)
  )
);

grant select, insert, update, delete on table cash_ledger_entries to authenticated;
grant select, insert, update, delete on table dividends to authenticated;
grant select, insert, update, delete on table portfolio_benchmarks to authenticated;
