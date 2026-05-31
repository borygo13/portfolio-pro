import type { User } from '@supabase/supabase-js'
import type { BackupExportOptions, PortfolioBackupData } from '@/lib/backup/export'
import { supabase } from './client'
import { getDefaultPortfolio, type Portfolio } from './portfolio'

export const BACKUP_EXPORT_LIMITS = {
  coreRows: 20000,
  snapshots: 10000,
  marketPrices: 50000,
  priceRefreshRuns: 5000,
  priceRefreshRunItems: 10000,
}

export type BackupCounts = {
  assets: number
  transactions: number
  income_events: number
  cash_ledger_entries: number
  edo_bonds: number
  asset_prices: number
  portfolio_benchmarks: number
  legacy_dividends: number
  portfolio_snapshots: number
  market_prices: number
  price_refresh_runs: number
  price_refresh_run_items: number
}

export type BackupContext = {
  portfolio: Portfolio
  counts: BackupCounts
}

const SELECTS = {
  assets: 'id,portfolio_id,symbol,name,asset_type,currency,target_allocation,market_symbol,price_source,auto_refresh_enabled,created_at',
  transactions: 'id,portfolio_id,asset_id,transaction_type,quantity,price,fees,source_currency,price_source,fees_source,fx_rate_to_base,base_currency,price_base,fees_base,gross_amount_source,gross_amount_base,fx_rate_date,fx_rate_source,transaction_date,notes,created_at',
  income_events: 'id,user_id,portfolio_id,asset_id,income_type,broker,source,currency,gross_amount,withholding_tax,local_tax,other_fees,net_amount,fx_rate_to_base,fx_rate_date,fx_rate_source,base_currency,gross_amount_base,withholding_tax_base,local_tax_base,other_fees_base,net_amount_base,payment_date,ex_date,record_date,notes,created_at,updated_at',
  cash_ledger_entries: 'id,portfolio_id,entry_type,amount,currency,entry_date,note,created_at,updated_at',
  edo_bonds: 'id,portfolio_id,series,quantity,purchase_price,purchase_date,interest_first_year,inflation_margin,maturity_date,created_at',
  asset_prices: 'id,portfolio_id,asset_id,price,currency,priced_at,created_at,updated_at',
  portfolio_benchmarks: 'portfolio_id,benchmark_asset_id,created_at,updated_at',
  legacy_dividends: 'id,portfolio_id,asset_id,payment_date,gross_amount,tax_amount,net_amount,currency,note,created_at,updated_at',
  portfolio_snapshots: 'id,portfolio_id,snapshot_date,base_currency,total_value,positions_value,edo_value,cash_value,invested_cost,remaining_cost,realized_pnl,unrealized_pnl,total_pnl,net_cash_flow,contribution,dividends_value,fees_value,taxes_value,allocation_breakdown,benchmark_asset_id,source,calculated_at,created_at',
  market_prices: 'id,portfolio_id,asset_id,source,source_symbol,price_date,open_price,high_price,low_price,close_price,adjusted_close_price,source_currency,base_currency,fx_rate_to_base,close_price_base,fetched_at,created_at',
  price_refresh_runs: 'id,portfolio_id,trigger_type,status,started_at,finished_at,requested_assets,refreshed_assets,failed_assets,error',
  price_refresh_run_items: 'id,run_id,portfolio_id,asset_id,symbol,source,status,price_date,price,currency,error,created_at',
}

function normalizeRows<T = Record<string, unknown>>(rows: unknown): T[] {
  return Array.isArray(rows) ? rows as T[] : []
}

async function countRows(table: string, portfolioId: string) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('portfolio_id', portfolioId)

  if (error) throw new Error(`Nie udało się policzyć ${table}: ${error.message}`)
  return count ?? 0
}

async function fetchRows(table: string, select: string, portfolioId: string, limit: number, order?: { column: string; ascending?: boolean }) {
  let query = supabase
    .from(table)
    .select(select)
    .eq('portfolio_id', portfolioId)
    .limit(limit)

  if (order) query = query.order(order.column, { ascending: order.ascending ?? true })
  const { data, error } = await query
  if (error) throw new Error(`Nie udało się wyeksportować ${table}: ${error.message}`)
  return normalizeRows<Record<string, unknown>>(data)
}

export async function getBackupContext(user: User): Promise<BackupContext> {
  const portfolio = await getDefaultPortfolio(user)
  const [
    assets,
    transactions,
    incomeEvents,
    cashLedgerEntries,
    edoBonds,
    assetPrices,
    portfolioBenchmarks,
    legacyDividends,
    portfolioSnapshots,
    marketPrices,
    priceRefreshRuns,
    priceRefreshRunItems,
  ] = await Promise.all([
    countRows('assets', portfolio.id),
    countRows('transactions', portfolio.id),
    countRows('income_events', portfolio.id),
    countRows('cash_ledger_entries', portfolio.id),
    countRows('edo_bonds', portfolio.id),
    countRows('asset_prices', portfolio.id),
    countRows('portfolio_benchmarks', portfolio.id),
    countRows('dividends', portfolio.id),
    countRows('portfolio_snapshots', portfolio.id),
    countRows('market_prices', portfolio.id),
    countRows('price_refresh_runs', portfolio.id),
    countRows('price_refresh_run_items', portfolio.id),
  ])

  return {
    portfolio,
    counts: {
      assets,
      transactions,
      income_events: incomeEvents,
      cash_ledger_entries: cashLedgerEntries,
      edo_bonds: edoBonds,
      asset_prices: assetPrices,
      portfolio_benchmarks: portfolioBenchmarks,
      legacy_dividends: legacyDividends,
      portfolio_snapshots: portfolioSnapshots,
      market_prices: marketPrices,
      price_refresh_runs: priceRefreshRuns,
      price_refresh_run_items: priceRefreshRunItems,
    },
  }
}

export async function fetchPortfolioBackupData(portfolio: Portfolio, options: BackupExportOptions): Promise<PortfolioBackupData> {
  const portfolioId = portfolio.id
  const [
    assets,
    transactions,
    incomeEvents,
    cashLedgerEntries,
    edoBonds,
    assetPrices,
    portfolioBenchmarks,
    legacyDividends,
    portfolioSnapshots,
    marketPrices,
    priceRefreshRuns,
    priceRefreshRunItems,
  ] = await Promise.all([
    fetchRows('assets', SELECTS.assets, portfolioId, BACKUP_EXPORT_LIMITS.coreRows, { column: 'created_at', ascending: true }),
    fetchRows('transactions', SELECTS.transactions, portfolioId, BACKUP_EXPORT_LIMITS.coreRows, { column: 'transaction_date', ascending: true }),
    fetchRows('income_events', SELECTS.income_events, portfolioId, BACKUP_EXPORT_LIMITS.coreRows, { column: 'payment_date', ascending: true }),
    fetchRows('cash_ledger_entries', SELECTS.cash_ledger_entries, portfolioId, BACKUP_EXPORT_LIMITS.coreRows, { column: 'entry_date', ascending: true }),
    fetchRows('edo_bonds', SELECTS.edo_bonds, portfolioId, BACKUP_EXPORT_LIMITS.coreRows, { column: 'purchase_date', ascending: true }),
    options.includeAssetPrices
      ? fetchRows('asset_prices', SELECTS.asset_prices, portfolioId, BACKUP_EXPORT_LIMITS.coreRows, { column: 'created_at', ascending: true })
      : Promise.resolve([]),
    fetchRows('portfolio_benchmarks', SELECTS.portfolio_benchmarks, portfolioId, BACKUP_EXPORT_LIMITS.coreRows, { column: 'created_at', ascending: true }),
    fetchRows('dividends', SELECTS.legacy_dividends, portfolioId, BACKUP_EXPORT_LIMITS.coreRows, { column: 'payment_date', ascending: true }),
    options.includeSnapshots
      ? fetchRows('portfolio_snapshots', SELECTS.portfolio_snapshots, portfolioId, BACKUP_EXPORT_LIMITS.snapshots, { column: 'snapshot_date', ascending: true })
      : Promise.resolve([]),
    options.includeMarketPrices
      ? fetchRows('market_prices', SELECTS.market_prices, portfolioId, BACKUP_EXPORT_LIMITS.marketPrices, { column: 'price_date', ascending: true })
      : Promise.resolve([]),
    options.includePriceRefreshMetadata
      ? fetchRows('price_refresh_runs', SELECTS.price_refresh_runs, portfolioId, BACKUP_EXPORT_LIMITS.priceRefreshRuns, { column: 'started_at', ascending: true })
      : Promise.resolve([]),
    options.includePriceRefreshMetadata
      ? fetchRows('price_refresh_run_items', SELECTS.price_refresh_run_items, portfolioId, BACKUP_EXPORT_LIMITS.priceRefreshRunItems, { column: 'created_at', ascending: true })
      : Promise.resolve([]),
  ])

  return {
    portfolio: portfolio as unknown as Record<string, unknown>,
    assets,
    transactions,
    income_events: incomeEvents,
    cash_ledger_entries: cashLedgerEntries,
    edo_bonds: edoBonds,
    asset_prices: assetPrices,
    portfolio_benchmarks: portfolioBenchmarks,
    legacy_dividends: legacyDividends,
    portfolio_snapshots: options.includeSnapshots ? portfolioSnapshots : undefined,
    market_prices: options.includeMarketPrices ? marketPrices : undefined,
    price_refresh_runs: options.includePriceRefreshMetadata ? priceRefreshRuns : undefined,
    price_refresh_run_items: options.includePriceRefreshMetadata ? priceRefreshRunItems : undefined,
    limits: {
      coreRows: BACKUP_EXPORT_LIMITS.coreRows,
      snapshots: BACKUP_EXPORT_LIMITS.snapshots,
      marketPrices: BACKUP_EXPORT_LIMITS.marketPrices,
      priceRefreshRuns: BACKUP_EXPORT_LIMITS.priceRefreshRuns,
      priceRefreshRunItems: BACKUP_EXPORT_LIMITS.priceRefreshRunItems,
    },
  }
}
