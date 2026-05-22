-- Stage C5.8 Multi-currency Transactions
-- Additive only: legacy price/fees remain intact and create_transaction_checked
-- keeps its existing signature/oversell protection.

alter table transactions
  add column if not exists source_currency text,
  add column if not exists price_source numeric,
  add column if not exists fees_source numeric,
  add column if not exists fx_rate_to_base numeric,
  add column if not exists base_currency text,
  add column if not exists price_base numeric,
  add column if not exists fees_base numeric,
  add column if not exists gross_amount_source numeric,
  add column if not exists gross_amount_base numeric,
  add column if not exists fx_rate_date date,
  add column if not exists fx_rate_source text;

-- Existing transactions were historically interpreted in portfolio/base
-- currency. Keep them usable as legacy PLN/base values instead of guessing
-- an instrument currency after the fact.
update transactions
set
  base_currency = coalesce(nullif(upper(trim(base_currency)), ''), 'PLN'),
  source_currency = coalesce(nullif(upper(trim(source_currency)), ''), coalesce(nullif(upper(trim(base_currency)), ''), 'PLN')),
  price_source = coalesce(price_source, price),
  fees_source = coalesce(fees_source, fees, 0),
  price_base = coalesce(
    price_base,
    case
      when coalesce(nullif(upper(trim(source_currency)), ''), coalesce(nullif(upper(trim(base_currency)), ''), 'PLN')) = coalesce(nullif(upper(trim(base_currency)), ''), 'PLN')
      then price
      else null
    end
  ),
  fees_base = coalesce(
    fees_base,
    case
      when coalesce(nullif(upper(trim(source_currency)), ''), coalesce(nullif(upper(trim(base_currency)), ''), 'PLN')) = coalesce(nullif(upper(trim(base_currency)), ''), 'PLN')
      then coalesce(fees, 0)
      else null
    end
  ),
  gross_amount_source = coalesce(gross_amount_source, quantity * coalesce(price_source, price)),
  gross_amount_base = coalesce(
    gross_amount_base,
    case
      when coalesce(nullif(upper(trim(source_currency)), ''), coalesce(nullif(upper(trim(base_currency)), ''), 'PLN')) = coalesce(nullif(upper(trim(base_currency)), ''), 'PLN')
      then quantity * coalesce(price_base, price)
      else null
    end
  ),
  fx_rate_to_base = coalesce(
    fx_rate_to_base,
    case
      when coalesce(nullif(upper(trim(source_currency)), ''), coalesce(nullif(upper(trim(base_currency)), ''), 'PLN')) = coalesce(nullif(upper(trim(base_currency)), ''), 'PLN')
      then 1
      else null
    end
  )
where
  base_currency is null
  or source_currency is null
  or price_source is null
  or fees_source is null
  or price_base is null
  or fees_base is null
  or gross_amount_source is null
  or gross_amount_base is null
  or fx_rate_to_base is null;

alter table transactions drop constraint if exists transactions_c5_8_amounts_nonnegative_chk;
alter table transactions drop constraint if exists transactions_c5_8_fx_positive_chk;
alter table transactions drop constraint if exists transactions_c5_8_currency_present_chk;

alter table transactions
  add constraint transactions_c5_8_amounts_nonnegative_chk check (
    (price_source is null or price_source > 0)
    and (fees_source is null or fees_source >= 0)
    and (price_base is null or price_base > 0)
    and (fees_base is null or fees_base >= 0)
    and (gross_amount_source is null or gross_amount_source >= 0)
    and (gross_amount_base is null or gross_amount_base >= 0)
  ),
  add constraint transactions_c5_8_fx_positive_chk check (
    fx_rate_to_base is null or fx_rate_to_base > 0
  ),
  add constraint transactions_c5_8_currency_present_chk check (
    (source_currency is null or trim(source_currency) <> '')
    and (base_currency is null or trim(base_currency) <> '')
  );

create index if not exists transactions_source_currency_idx
  on transactions(portfolio_id, source_currency);

comment on column transactions.source_currency is 'Instrument/trade currency entered by the user for C5.8 multi-currency transactions.';
comment on column transactions.price_source is 'Per-unit transaction price in source_currency. Legacy price remains for backward compatibility.';
comment on column transactions.fees_source is 'Transaction fees in source_currency. Legacy fees remains for backward compatibility.';
comment on column transactions.fx_rate_to_base is 'Historical or previous-available FX rate from source_currency to base_currency. Null means base conversion was unavailable.';
comment on column transactions.price_base is 'Per-unit transaction price converted to portfolio/base currency when FX is available.';
comment on column transactions.fees_base is 'Transaction fees converted to portfolio/base currency when FX is available.';
comment on column transactions.gross_amount_source is 'quantity * price_source in source_currency.';
comment on column transactions.gross_amount_base is 'quantity * price_base in base_currency when FX is available.';
comment on column transactions.fx_rate_date is 'Date of the FX rate used for conversion. May be earlier than transaction_date when safe previous-FX fallback is used.';
comment on column transactions.fx_rate_source is 'FX source label, e.g. NBP or NBP previous available.';
