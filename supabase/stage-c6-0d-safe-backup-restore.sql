-- Stage C6.0d Safe Backup Restore Flow
-- Additive RPC only. Restores core user-entered data into the authenticated
-- user's current portfolio with transaction semantics and without service role.

create extension if not exists "uuid-ossp" with schema extensions;

create or replace function restore_portfolio_core_backup(
  p_portfolio_id uuid,
  p_backup jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_data jsonb;
  v_deleted jsonb := '{}'::jsonb;
  v_inserted jsonb := '{}'::jsonb;
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Brak aktywnej sesji użytkownika.' using errcode = '42501';
  end if;

  if p_backup is null or jsonb_typeof(p_backup) <> 'object' then
    raise exception 'Backup musi być obiektem JSON.' using errcode = '22000';
  end if;

  if coalesce(p_backup #>> '{metadata,app}', '') <> 'portfolio-pro' then
    raise exception 'Nieprawidłowy backup: metadata.app musi być portfolio-pro.' using errcode = '22000';
  end if;

  if coalesce(p_backup #>> '{metadata,export_version}', '') <> 'c6.0a' then
    raise exception 'Nieobsługiwana wersja backupu. C6.0d obsługuje tylko c6.0a.' using errcode = '22000';
  end if;

  v_data := p_backup -> 'data';
  if v_data is null or jsonb_typeof(v_data) <> 'object' then
    raise exception 'Backup nie zawiera poprawnej sekcji data.' using errcode = '22000';
  end if;

  if not exists (
    select 1 from portfolios
    where id = p_portfolio_id
      and user_id = v_user_id
  ) then
    raise exception 'Brak dostępu do portfolio.' using errcode = '42501';
  end if;

  if jsonb_typeof(v_data -> 'assets') is distinct from 'array'
    or jsonb_typeof(v_data -> 'transactions') is distinct from 'array'
    or jsonb_typeof(v_data -> 'income_events') is distinct from 'array'
    or jsonb_typeof(v_data -> 'cash_ledger_entries') is distinct from 'array'
    or jsonb_typeof(v_data -> 'edo_bonds') is distinct from 'array'
  then
    raise exception 'Backup nie ma wymaganych tablic core: assets, transactions, income_events, cash_ledger_entries, edo_bonds.' using errcode = '22000';
  end if;

  if v_data ? 'asset_prices' and jsonb_typeof(v_data -> 'asset_prices') <> 'array' then
    raise exception 'data.asset_prices musi być tablicą.' using errcode = '22000';
  end if;

  if v_data ? 'portfolio_benchmarks' and jsonb_typeof(v_data -> 'portfolio_benchmarks') <> 'array' then
    raise exception 'data.portfolio_benchmarks musi być tablicą.' using errcode = '22000';
  end if;

  if v_data ? 'legacy_dividends' and jsonb_typeof(v_data -> 'legacy_dividends') <> 'array' then
    raise exception 'data.legacy_dividends musi być tablicą.' using errcode = '22000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('restore-core:' || p_portfolio_id::text, 0));

  drop table if exists pg_temp.restore_asset_map;
  create temporary table restore_asset_map (
    old_id uuid primary key,
    new_id uuid not null default extensions.uuid_generate_v4()
  ) on commit drop;

  insert into restore_asset_map (old_id)
  select distinct (asset_row.row_data ->> 'id')::uuid
  from jsonb_array_elements(v_data -> 'assets') as asset_row(row_data)
  where nullif(asset_row.row_data ->> 'id', '') is not null;

  if (select count(*) from restore_asset_map) <> jsonb_array_length(v_data -> 'assets') then
    raise exception 'Każde aktywo w backupie musi mieć unikalne uuid id.' using errcode = '22000';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_data -> 'transactions') as tx(row_data)
    left join restore_asset_map m on m.old_id = nullif(tx.row_data ->> 'asset_id', '')::uuid
    where nullif(tx.row_data ->> 'asset_id', '') is null
      or m.new_id is null
  ) then
    raise exception 'Backup zawiera transakcje bez poprawnego asset_id z assets.' using errcode = '22000';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_data -> 'asset_prices', '[]'::jsonb)) as price_row(row_data)
    left join restore_asset_map m on m.old_id = nullif(price_row.row_data ->> 'asset_id', '')::uuid
    where nullif(price_row.row_data ->> 'asset_id', '') is null
      or m.new_id is null
  ) then
    raise exception 'Backup zawiera asset_prices bez poprawnego asset_id z assets.' using errcode = '22000';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_data -> 'income_events') as income_row(row_data)
    left join restore_asset_map m on m.old_id = nullif(income_row.row_data ->> 'asset_id', '')::uuid
    where nullif(income_row.row_data ->> 'asset_id', '') is not null
      and m.new_id is null
  ) then
    raise exception 'Backup zawiera income_events z asset_id, którego nie ma w assets.' using errcode = '22000';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_data -> 'legacy_dividends', '[]'::jsonb)) as dividend_row(row_data)
    left join restore_asset_map m on m.old_id = nullif(dividend_row.row_data ->> 'asset_id', '')::uuid
    where nullif(dividend_row.row_data ->> 'asset_id', '') is null
      or m.new_id is null
  ) then
    raise exception 'Backup zawiera legacy_dividends bez poprawnego asset_id z assets.' using errcode = '22000';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_data -> 'portfolio_benchmarks', '[]'::jsonb)) as benchmark_row(row_data)
    left join restore_asset_map m on m.old_id = nullif(benchmark_row.row_data ->> 'benchmark_asset_id', '')::uuid
    where nullif(benchmark_row.row_data ->> 'benchmark_asset_id', '') is not null
      and m.new_id is null
  ) then
    raise exception 'Backup zawiera benchmark_asset_id, którego nie ma w assets.' using errcode = '22000';
  end if;

  v_deleted := jsonb_build_object(
    'transactions', (select count(*) from transactions where portfolio_id = p_portfolio_id),
    'income_events', (select count(*) from income_events where portfolio_id = p_portfolio_id),
    'cash_ledger_entries', (select count(*) from cash_ledger_entries where portfolio_id = p_portfolio_id),
    'edo_bonds', (select count(*) from edo_bonds where portfolio_id = p_portfolio_id),
    'asset_prices', (select count(*) from asset_prices where portfolio_id = p_portfolio_id),
    'portfolio_benchmarks', (select count(*) from portfolio_benchmarks where portfolio_id = p_portfolio_id),
    'legacy_dividends', (select count(*) from dividends where portfolio_id = p_portfolio_id),
    'assets', (select count(*) from assets where portfolio_id = p_portfolio_id)
  );

  delete from transactions where portfolio_id = p_portfolio_id and transaction_type = 'SELL';
  delete from transactions where portfolio_id = p_portfolio_id;
  delete from income_events where portfolio_id = p_portfolio_id;
  delete from cash_ledger_entries where portfolio_id = p_portfolio_id;
  delete from edo_bonds where portfolio_id = p_portfolio_id;
  delete from asset_prices where portfolio_id = p_portfolio_id;
  delete from portfolio_benchmarks where portfolio_id = p_portfolio_id;
  delete from dividends where portfolio_id = p_portfolio_id;
  delete from assets where portfolio_id = p_portfolio_id;

  insert into assets (
    id,
    portfolio_id,
    symbol,
    name,
    asset_type,
    currency,
    target_allocation,
    market_symbol,
    price_source,
    auto_refresh_enabled
  )
  select
    m.new_id,
    p_portfolio_id,
    nullif(trim(asset_row.row_data ->> 'symbol'), ''),
    coalesce(nullif(trim(asset_row.row_data ->> 'name'), ''), nullif(trim(asset_row.row_data ->> 'symbol'), '')),
    nullif(trim(asset_row.row_data ->> 'asset_type'), ''),
    coalesce(nullif(upper(trim(asset_row.row_data ->> 'currency')), ''), 'PLN'),
    coalesce(nullif(asset_row.row_data ->> 'target_allocation', '')::numeric, 0),
    nullif(trim(asset_row.row_data ->> 'market_symbol'), ''),
    coalesce(nullif(trim(asset_row.row_data ->> 'price_source'), ''), 'manual'),
    coalesce(nullif(asset_row.row_data ->> 'auto_refresh_enabled', '')::boolean, true)
  from jsonb_array_elements(v_data -> 'assets') as asset_row(row_data)
  join restore_asset_map m on m.old_id = (asset_row.row_data ->> 'id')::uuid;
  get diagnostics v_count = row_count;
  v_inserted := jsonb_set(v_inserted, '{assets}', to_jsonb(v_count), true);

  insert into portfolio_benchmarks (
    portfolio_id,
    benchmark_asset_id
  )
  select
    p_portfolio_id,
    m.new_id
  from jsonb_array_elements(coalesce(v_data -> 'portfolio_benchmarks', '[]'::jsonb)) with ordinality as benchmark_row(row_data, ord)
  left join restore_asset_map m on m.old_id = nullif(benchmark_row.row_data ->> 'benchmark_asset_id', '')::uuid
  order by benchmark_row.ord
  limit 1;
  get diagnostics v_count = row_count;
  v_inserted := jsonb_set(v_inserted, '{portfolio_benchmarks}', to_jsonb(v_count), true);

  insert into asset_prices (
    id,
    portfolio_id,
    asset_id,
    price,
    currency,
    priced_at
  )
  select
    extensions.uuid_generate_v4(),
    p_portfolio_id,
    m.new_id,
    coalesce(nullif(price_row.row_data ->> 'price', '')::numeric, 0),
    coalesce(nullif(upper(trim(price_row.row_data ->> 'currency')), ''), 'PLN'),
    coalesce(nullif(price_row.row_data ->> 'priced_at', '')::timestamptz, now())
  from jsonb_array_elements(coalesce(v_data -> 'asset_prices', '[]'::jsonb)) as price_row(row_data)
  join restore_asset_map m on m.old_id = nullif(price_row.row_data ->> 'asset_id', '')::uuid
  on conflict (portfolio_id, asset_id) do update set
    price = excluded.price,
    currency = excluded.currency,
    priced_at = excluded.priced_at,
    updated_at = now();
  get diagnostics v_count = row_count;
  v_inserted := jsonb_set(v_inserted, '{asset_prices}', to_jsonb(v_count), true);

  insert into transactions (
    portfolio_id,
    asset_id,
    transaction_type,
    quantity,
    price,
    fees,
    source_currency,
    price_source,
    fees_source,
    fx_rate_to_base,
    base_currency,
    price_base,
    fees_base,
    gross_amount_source,
    gross_amount_base,
    fx_rate_date,
    fx_rate_source,
    transaction_date,
    notes
  )
  select
    p_portfolio_id,
    m.new_id,
    tx.row_data ->> 'transaction_type',
    nullif(tx.row_data ->> 'quantity', '')::numeric,
    coalesce(nullif(tx.row_data ->> 'price', '')::numeric, nullif(tx.row_data ->> 'price_base', '')::numeric, nullif(tx.row_data ->> 'price_source', '')::numeric),
    coalesce(nullif(tx.row_data ->> 'fees', '')::numeric, nullif(tx.row_data ->> 'fees_base', '')::numeric, nullif(tx.row_data ->> 'fees_source', '')::numeric, 0),
    nullif(upper(trim(tx.row_data ->> 'source_currency')), ''),
    nullif(tx.row_data ->> 'price_source', '')::numeric,
    nullif(tx.row_data ->> 'fees_source', '')::numeric,
    nullif(tx.row_data ->> 'fx_rate_to_base', '')::numeric,
    nullif(upper(trim(tx.row_data ->> 'base_currency')), ''),
    nullif(tx.row_data ->> 'price_base', '')::numeric,
    nullif(tx.row_data ->> 'fees_base', '')::numeric,
    nullif(tx.row_data ->> 'gross_amount_source', '')::numeric,
    nullif(tx.row_data ->> 'gross_amount_base', '')::numeric,
    nullif(tx.row_data ->> 'fx_rate_date', '')::date,
    nullif(trim(tx.row_data ->> 'fx_rate_source'), ''),
    nullif(tx.row_data ->> 'transaction_date', '')::date,
    nullif(trim(tx.row_data ->> 'notes'), '')
  from jsonb_array_elements(v_data -> 'transactions') with ordinality as tx(row_data, ord)
  join restore_asset_map m on m.old_id = nullif(tx.row_data ->> 'asset_id', '')::uuid
  order by
    case when upper(coalesce(tx.row_data ->> 'transaction_type', '')) = 'BUY' then 0 else 1 end,
    nullif(tx.row_data ->> 'transaction_date', '')::date nulls last,
    tx.ord;
  get diagnostics v_count = row_count;
  v_inserted := jsonb_set(v_inserted, '{transactions}', to_jsonb(v_count), true);

  insert into income_events (
    user_id,
    portfolio_id,
    asset_id,
    income_type,
    broker,
    source,
    currency,
    gross_amount,
    withholding_tax,
    local_tax,
    other_fees,
    net_amount,
    fx_rate_to_base,
    fx_rate_date,
    fx_rate_source,
    base_currency,
    gross_amount_base,
    withholding_tax_base,
    local_tax_base,
    other_fees_base,
    net_amount_base,
    payment_date,
    ex_date,
    record_date,
    notes
  )
  select
    v_user_id,
    p_portfolio_id,
    m.new_id,
    coalesce(nullif(trim(income_row.row_data ->> 'income_type'), ''), 'DIVIDEND'),
    nullif(trim(income_row.row_data ->> 'broker'), ''),
    nullif(trim(income_row.row_data ->> 'source'), ''),
    coalesce(nullif(upper(trim(income_row.row_data ->> 'currency')), ''), 'PLN'),
    nullif(income_row.row_data ->> 'gross_amount', '')::numeric,
    coalesce(nullif(income_row.row_data ->> 'withholding_tax', '')::numeric, 0),
    coalesce(nullif(income_row.row_data ->> 'local_tax', '')::numeric, 0),
    coalesce(nullif(income_row.row_data ->> 'other_fees', '')::numeric, 0),
    coalesce(
      nullif(income_row.row_data ->> 'net_amount', '')::numeric,
      nullif(income_row.row_data ->> 'gross_amount', '')::numeric
        - coalesce(nullif(income_row.row_data ->> 'withholding_tax', '')::numeric, 0)
        - coalesce(nullif(income_row.row_data ->> 'local_tax', '')::numeric, 0)
        - coalesce(nullif(income_row.row_data ->> 'other_fees', '')::numeric, 0)
    ),
    nullif(income_row.row_data ->> 'fx_rate_to_base', '')::numeric,
    nullif(income_row.row_data ->> 'fx_rate_date', '')::date,
    nullif(trim(income_row.row_data ->> 'fx_rate_source'), ''),
    coalesce(nullif(upper(trim(income_row.row_data ->> 'base_currency')), ''), 'PLN'),
    nullif(income_row.row_data ->> 'gross_amount_base', '')::numeric,
    nullif(income_row.row_data ->> 'withholding_tax_base', '')::numeric,
    nullif(income_row.row_data ->> 'local_tax_base', '')::numeric,
    nullif(income_row.row_data ->> 'other_fees_base', '')::numeric,
    nullif(income_row.row_data ->> 'net_amount_base', '')::numeric,
    nullif(income_row.row_data ->> 'payment_date', '')::date,
    nullif(income_row.row_data ->> 'ex_date', '')::date,
    nullif(income_row.row_data ->> 'record_date', '')::date,
    nullif(trim(income_row.row_data ->> 'notes'), '')
  from jsonb_array_elements(v_data -> 'income_events') as income_row(row_data)
  left join restore_asset_map m on m.old_id = nullif(income_row.row_data ->> 'asset_id', '')::uuid;
  get diagnostics v_count = row_count;
  v_inserted := jsonb_set(v_inserted, '{income_events}', to_jsonb(v_count), true);

  insert into cash_ledger_entries (
    portfolio_id,
    entry_type,
    amount,
    currency,
    entry_date,
    note
  )
  select
    p_portfolio_id,
    cash_row.row_data ->> 'entry_type',
    nullif(cash_row.row_data ->> 'amount', '')::numeric,
    coalesce(nullif(upper(trim(cash_row.row_data ->> 'currency')), ''), 'PLN'),
    nullif(cash_row.row_data ->> 'entry_date', '')::date,
    nullif(trim(cash_row.row_data ->> 'note'), '')
  from jsonb_array_elements(v_data -> 'cash_ledger_entries') as cash_row(row_data);
  get diagnostics v_count = row_count;
  v_inserted := jsonb_set(v_inserted, '{cash_ledger_entries}', to_jsonb(v_count), true);

  insert into edo_bonds (
    portfolio_id,
    series,
    quantity,
    purchase_price,
    purchase_date,
    interest_first_year,
    inflation_margin,
    maturity_date
  )
  select
    p_portfolio_id,
    nullif(trim(edo_row.row_data ->> 'series'), ''),
    nullif(edo_row.row_data ->> 'quantity', '')::numeric,
    coalesce(nullif(edo_row.row_data ->> 'purchase_price', '')::numeric, 100),
    nullif(edo_row.row_data ->> 'purchase_date', '')::date,
    coalesce(nullif(edo_row.row_data ->> 'interest_first_year', '')::numeric, 0),
    coalesce(nullif(edo_row.row_data ->> 'inflation_margin', '')::numeric, 0),
    nullif(edo_row.row_data ->> 'maturity_date', '')::date
  from jsonb_array_elements(v_data -> 'edo_bonds') as edo_row(row_data);
  get diagnostics v_count = row_count;
  v_inserted := jsonb_set(v_inserted, '{edo_bonds}', to_jsonb(v_count), true);

  insert into dividends (
    portfolio_id,
    asset_id,
    payment_date,
    gross_amount,
    tax_amount,
    net_amount,
    currency,
    note
  )
  select
    p_portfolio_id,
    m.new_id,
    nullif(dividend_row.row_data ->> 'payment_date', '')::date,
    nullif(dividend_row.row_data ->> 'gross_amount', '')::numeric,
    coalesce(nullif(dividend_row.row_data ->> 'tax_amount', '')::numeric, 0),
    nullif(dividend_row.row_data ->> 'net_amount', '')::numeric,
    coalesce(nullif(upper(trim(dividend_row.row_data ->> 'currency')), ''), 'PLN'),
    nullif(trim(dividend_row.row_data ->> 'note'), '')
  from jsonb_array_elements(coalesce(v_data -> 'legacy_dividends', '[]'::jsonb)) as dividend_row(row_data)
  join restore_asset_map m on m.old_id = nullif(dividend_row.row_data ->> 'asset_id', '')::uuid;
  get diagnostics v_count = row_count;
  v_inserted := jsonb_set(v_inserted, '{legacy_dividends}', to_jsonb(v_count), true);

  return jsonb_build_object(
    'status', 'success',
    'portfolio_id', p_portfolio_id,
    'deleted', v_deleted,
    'inserted', v_inserted,
    'ignored_tables', jsonb_build_array(
      'market_prices',
      'portfolio_snapshots',
      'price_refresh_runs',
      'price_refresh_run_items'
    ),
    'message', 'Core portfolio backup restored. Derived market history, snapshots and refresh logs were not restored.'
  );
end;
$$;

grant execute on function restore_portfolio_core_backup(uuid, jsonb) to authenticated;
