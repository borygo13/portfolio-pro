-- Stage C5.9 Dividend / Income Engine
-- Additive migration only. Existing dividends and cash ledger tables remain intact.

create extension if not exists "uuid-ossp";

create table if not exists income_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  income_type text not null default 'DIVIDEND' check (income_type in ('DIVIDEND','BOND_INTEREST','CASH_INTEREST','STAKING','OTHER')),
  broker text,
  source text,
  currency text not null check (currency in ('PLN','EUR','USD','GBP','CHF')),
  gross_amount numeric not null check (gross_amount >= 0),
  withholding_tax numeric not null default 0 check (withholding_tax >= 0),
  local_tax numeric not null default 0 check (local_tax >= 0),
  other_fees numeric not null default 0 check (other_fees >= 0),
  net_amount numeric not null check (net_amount >= 0),
  fx_rate_to_base numeric check (fx_rate_to_base is null or fx_rate_to_base > 0),
  fx_rate_date date,
  fx_rate_source text,
  base_currency text not null default 'PLN' check (base_currency in ('PLN','EUR','USD','GBP','CHF')),
  gross_amount_base numeric check (gross_amount_base is null or gross_amount_base >= 0),
  withholding_tax_base numeric check (withholding_tax_base is null or withholding_tax_base >= 0),
  local_tax_base numeric check (local_tax_base is null or local_tax_base >= 0),
  other_fees_base numeric check (other_fees_base is null or other_fees_base >= 0),
  net_amount_base numeric check (net_amount_base is null or net_amount_base >= 0),
  payment_date date not null,
  ex_date date,
  record_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (net_amount = gross_amount - withholding_tax - local_tax - other_fees)
);

alter table income_events
  add column if not exists id uuid default uuid_generate_v4(),
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists portfolio_id uuid references portfolios(id) on delete cascade,
  add column if not exists asset_id uuid references assets(id) on delete set null,
  add column if not exists income_type text default 'DIVIDEND',
  add column if not exists broker text,
  add column if not exists source text,
  add column if not exists currency text default 'PLN',
  add column if not exists gross_amount numeric,
  add column if not exists withholding_tax numeric default 0,
  add column if not exists local_tax numeric default 0,
  add column if not exists other_fees numeric default 0,
  add column if not exists net_amount numeric,
  add column if not exists fx_rate_to_base numeric,
  add column if not exists fx_rate_date date,
  add column if not exists fx_rate_source text,
  add column if not exists base_currency text default 'PLN',
  add column if not exists gross_amount_base numeric,
  add column if not exists withholding_tax_base numeric,
  add column if not exists local_tax_base numeric,
  add column if not exists other_fees_base numeric,
  add column if not exists net_amount_base numeric,
  add column if not exists payment_date date,
  add column if not exists ex_date date,
  add column if not exists record_date date,
  add column if not exists notes text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.income_events'::regclass
      and conname = 'income_events_income_type_chk'
  ) then
    alter table income_events
      add constraint income_events_income_type_chk
      check (income_type in ('DIVIDEND','BOND_INTEREST','CASH_INTEREST','STAKING','OTHER')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.income_events'::regclass
      and conname = 'income_events_currency_chk'
  ) then
    alter table income_events
      add constraint income_events_currency_chk
      check (currency in ('PLN','EUR','USD','GBP','CHF')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.income_events'::regclass
      and conname = 'income_events_base_currency_chk'
  ) then
    alter table income_events
      add constraint income_events_base_currency_chk
      check (base_currency in ('PLN','EUR','USD','GBP','CHF')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.income_events'::regclass
      and conname = 'income_events_nonnegative_amounts_chk'
  ) then
    alter table income_events
      add constraint income_events_nonnegative_amounts_chk
      check (
        gross_amount >= 0
        and withholding_tax >= 0
        and local_tax >= 0
        and other_fees >= 0
        and net_amount >= 0
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.income_events'::regclass
      and conname = 'income_events_net_amount_math_chk'
  ) then
    alter table income_events
      add constraint income_events_net_amount_math_chk
      check (net_amount = gross_amount - withholding_tax - local_tax - other_fees) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.income_events'::regclass
      and conname = 'income_events_fx_rate_positive_chk'
  ) then
    alter table income_events
      add constraint income_events_fx_rate_positive_chk
      check (fx_rate_to_base is null or fx_rate_to_base > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.income_events'::regclass
      and conname = 'income_events_base_amounts_nonnegative_chk'
  ) then
    alter table income_events
      add constraint income_events_base_amounts_nonnegative_chk
      check (
        (gross_amount_base is null or gross_amount_base >= 0)
        and (withholding_tax_base is null or withholding_tax_base >= 0)
        and (local_tax_base is null or local_tax_base >= 0)
        and (other_fees_base is null or other_fees_base >= 0)
        and (net_amount_base is null or net_amount_base >= 0)
      ) not valid;
  end if;
end $$;

update income_events
set
  income_type = coalesce(income_type, 'DIVIDEND'),
  currency = coalesce(nullif(currency, ''), 'PLN'),
  base_currency = coalesce(nullif(base_currency, ''), 'PLN'),
  withholding_tax = coalesce(withholding_tax, 0),
  local_tax = coalesce(local_tax, 0),
  other_fees = coalesce(other_fees, 0),
  net_amount = coalesce(net_amount, gross_amount - coalesce(withholding_tax, 0) - coalesce(local_tax, 0) - coalesce(other_fees, 0)),
  updated_at = coalesce(updated_at, now())
where income_type is null
  or currency is null
  or base_currency is null
  or withholding_tax is null
  or local_tax is null
  or other_fees is null
  or net_amount is null
  or updated_at is null;

create index if not exists income_events_user_payment_date_idx
  on income_events(user_id, payment_date desc);
create index if not exists income_events_portfolio_payment_date_idx
  on income_events(portfolio_id, payment_date desc);
create index if not exists income_events_asset_payment_date_idx
  on income_events(asset_id, payment_date desc);
create index if not exists income_events_portfolio_type_date_idx
  on income_events(portfolio_id, income_type, payment_date desc);

alter table income_events enable row level security;

drop policy if exists "own income events" on income_events;
create policy "own income events" on income_events
for all
using (
  user_id = auth.uid()
  and portfolio_id in (select id from portfolios where user_id = auth.uid())
)
with check (
  user_id = auth.uid()
  and portfolio_id in (select id from portfolios where user_id = auth.uid())
  and (
    asset_id is null
    or asset_id in (select id from assets where portfolio_id = income_events.portfolio_id)
  )
);

grant select, insert, update, delete on table income_events to authenticated;
