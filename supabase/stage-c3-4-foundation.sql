-- Portfolio PRO Stage C3.4 canonical schema
-- This file matches the tables and columns used by the current Next.js app.
-- Legacy C1/C2 shapes such as accounts, bonds_edo, tx_type/amount/fee and
-- user_id-based assets are intentionally not part of this active schema.

create extension if not exists "uuid-ossp";

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  base_currency text not null default 'PLN',
  created_at timestamptz not null default now()
);

create table if not exists portfolios (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Portfel osobisty',
  currency text not null default 'PLN',
  created_at timestamptz not null default now()
);

create table if not exists assets (
  id uuid primary key default uuid_generate_v4(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  symbol text not null,
  name text not null,
  asset_type text not null check (asset_type in ('ETF','Akcje','Obligacje','Gotówka','Crypto','CFD','Inne')),
  currency text not null default 'PLN',
  target_allocation numeric not null default 0 check (target_allocation >= 0 and target_allocation <= 100),
  created_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid primary key default uuid_generate_v4(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('BUY','SELL')),
  quantity numeric not null check (quantity > 0),
  price numeric not null check (price > 0),
  fees numeric not null default 0 check (fees >= 0),
  transaction_date date not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists asset_prices (
  id uuid primary key default uuid_generate_v4(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  price numeric not null default 0 check (price >= 0),
  currency text default 'PLN',
  priced_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(portfolio_id, asset_id)
);

create table if not exists edo_bonds (
  id uuid primary key default uuid_generate_v4(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  series text,
  quantity numeric not null check (quantity > 0),
  purchase_price numeric not null default 100 check (purchase_price > 0),
  purchase_date date not null,
  interest_first_year numeric not null check (interest_first_year >= 0),
  inflation_margin numeric not null default 0 check (inflation_margin >= 0),
  maturity_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists portfolios_user_id_idx on portfolios(user_id);
create index if not exists assets_portfolio_id_idx on assets(portfolio_id);
create index if not exists transactions_portfolio_asset_idx on transactions(portfolio_id, asset_id);
create index if not exists transactions_transaction_date_idx on transactions(transaction_date desc);
create index if not exists edo_bonds_portfolio_id_idx on edo_bonds(portfolio_id);

alter table profiles enable row level security;
alter table portfolios enable row level security;
alter table assets enable row level security;
alter table transactions enable row level security;
alter table asset_prices enable row level security;
alter table edo_bonds enable row level security;

drop policy if exists "own profiles" on profiles;
create policy "own profiles" on profiles
for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own portfolios" on portfolios;
create policy "own portfolios" on portfolios
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own assets" on assets;
create policy "own assets" on assets
for all
using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
with check (portfolio_id in (select id from portfolios where user_id = auth.uid()));

drop policy if exists "own transactions" on transactions;
create policy "own transactions" on transactions
for all
using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
with check (
  portfolio_id in (select id from portfolios where user_id = auth.uid())
  and asset_id in (select id from assets where portfolio_id = transactions.portfolio_id)
);

drop policy if exists "user asset prices" on asset_prices;
create policy "user asset prices" on asset_prices
for all
using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
with check (
  portfolio_id in (select id from portfolios where user_id = auth.uid())
  and asset_id in (select id from assets where portfolio_id = asset_prices.portfolio_id)
);

drop policy if exists "own edo bonds" on edo_bonds;
create policy "own edo bonds" on edo_bonds
for all
using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
with check (portfolio_id in (select id from portfolios where user_id = auth.uid()));

create or replace function assert_non_negative_asset_quantity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  checked_portfolio_id uuid := coalesce(new.portfolio_id, old.portfolio_id);
  checked_asset_id uuid := coalesce(new.asset_id, old.asset_id);
  available_quantity numeric;
begin
  select coalesce(sum(case when transaction_type = 'BUY' then quantity else -quantity end), 0)
  into available_quantity
  from transactions
  where portfolio_id = checked_portfolio_id and asset_id = checked_asset_id;

  if available_quantity < -0.00000001 then
    raise exception 'Operacja zostawiłaby ujemną ilość aktywa.' using errcode = '22000';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists transactions_non_negative_quantity on transactions;
create trigger transactions_non_negative_quantity
after insert or update or delete on transactions
for each row execute function assert_non_negative_asset_quantity();

create or replace function create_transaction_checked(
  p_portfolio_id uuid,
  p_asset_id uuid,
  p_transaction_type text,
  p_quantity numeric,
  p_price numeric,
  p_fees numeric,
  p_transaction_date date,
  p_notes text default null
)
returns transactions
language plpgsql
security invoker
set search_path = public
as $$
declare
  available_quantity numeric;
  inserted_transaction transactions;
begin
  if p_transaction_type not in ('BUY', 'SELL') then
    raise exception 'Nieprawidłowy typ transakcji.' using errcode = '22000';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Liczba jednostek musi być większa od zera.' using errcode = '22000';
  end if;

  if p_price is null or p_price <= 0 then
    raise exception 'Cena musi być większa od zera.' using errcode = '22000';
  end if;

  if coalesce(p_fees, 0) < 0 then
    raise exception 'Opłaty nie mogą być ujemne.' using errcode = '22000';
  end if;

  if not exists (select 1 from portfolios where id = p_portfolio_id and user_id = auth.uid()) then
    raise exception 'Brak dostępu do portfolio.' using errcode = '42501';
  end if;

  if not exists (select 1 from assets where id = p_asset_id and portfolio_id = p_portfolio_id) then
    raise exception 'Aktywo nie należy do wybranego portfolio.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_portfolio_id::text || ':' || p_asset_id::text, 0));

  select coalesce(sum(case when transaction_type = 'BUY' then quantity else -quantity end), 0)
  into available_quantity
  from transactions
  where portfolio_id = p_portfolio_id and asset_id = p_asset_id;

  if p_transaction_type = 'SELL' and p_quantity > available_quantity + 0.00000001 then
    raise exception 'Nie możesz sprzedać % szt., bo aktualnie posiadasz tylko % szt.', p_quantity, available_quantity
      using errcode = '22000';
  end if;

  insert into transactions (
    portfolio_id,
    asset_id,
    transaction_type,
    quantity,
    price,
    fees,
    transaction_date,
    notes
  ) values (
    p_portfolio_id,
    p_asset_id,
    p_transaction_type,
    p_quantity,
    p_price,
    coalesce(p_fees, 0),
    p_transaction_date,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning * into inserted_transaction;

  return inserted_transaction;
end;
$$;

grant execute on function create_transaction_checked(uuid, uuid, text, numeric, numeric, numeric, date, text) to authenticated;
