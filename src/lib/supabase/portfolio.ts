import type { User } from '@supabase/supabase-js'
import { BASE_CURRENCY } from '@/lib/currency'
import { calculateIncomeAmounts, type IncomeType } from '@/lib/income-engine'
import { searchInstrumentCatalogRows } from '@/lib/instruments/search'
import { FX_PREVIOUS_LOOKBACK_DAYS, fxAddDays, fxDaysBetween, normalizeCurrencyCode } from '@/lib/market/fx'
import { calculateTransactionAmounts } from '@/lib/transaction-math'
import { supabase } from './client'
import { ensureUserWorkspace } from './bootstrap'

export type AssetType = 'ETF' | 'Akcje' | 'Obligacje' | 'Gotówka' | 'Crypto' | 'CFD' | 'Inne'

export type Portfolio = {
  id: string
  user_id: string
  name: string
  currency: string | null
}

export type Asset = {
  id: string
  portfolio_id: string
  symbol: string
  name: string
  asset_type: string
  currency: string | null
  target_allocation: number | null
  market_symbol?: string | null
  price_source?: string | null
  auto_refresh_enabled?: boolean | null
  created_at: string
}

export type CreateAssetInput = {
  symbol: string
  name: string
  asset_type: AssetType
  currency: string
  target_allocation: number
  market_symbol?: string | null
  price_source?: string | null
}

export type InstrumentCatalogRow = {
  id: string
  name: string
  symbol: string
  market_symbol: string
  provider: string
  category: string
  asset_type: string
  currency: string
  exchange: string | null
  country: string | null
  aliases: string[] | null
  benchmark_candidate: boolean
  is_active: boolean
  created_at: string
  updated_at: string | null
}

const INSTRUMENT_CATALOG_SELECT = 'id,name,symbol,market_symbol,provider,category,asset_type,currency,exchange,country,aliases,benchmark_candidate,is_active,created_at,updated_at'

export async function getDefaultPortfolio(user: User): Promise<Portfolio> {
  await ensureUserWorkspace(user)

  const { data, error } = await supabase
    .from('portfolios')
    .select('id,user_id,name,currency')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (error) throw new Error(`Nie udało się pobrać portfolio: ${error.message}`)
  return data as Portfolio
}

export async function listAssets(portfolioId: string): Promise<Asset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('id,portfolio_id,symbol,name,asset_type,currency,target_allocation,market_symbol,price_source,auto_refresh_enabled,created_at')
    .eq('portfolio_id', portfolioId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Nie udało się pobrać aktywów: ${error.message}`)
  return (data ?? []) as Asset[]
}

export async function createAsset(portfolioId: string, input: CreateAssetInput): Promise<Asset> {
  const payload = {
    portfolio_id: portfolioId,
    symbol: input.symbol.trim().toUpperCase(),
    name: input.name.trim(),
    asset_type: input.asset_type,
    currency: input.currency.trim().toUpperCase(),
    target_allocation: input.target_allocation || 0,
    market_symbol: input.market_symbol?.trim() || null,
    price_source: input.price_source?.trim() || 'auto',
  }

  const { data, error } = await supabase
    .from('assets')
    .insert(payload)
    .select('id,portfolio_id,symbol,name,asset_type,currency,target_allocation,market_symbol,price_source,auto_refresh_enabled,created_at')
    .single()

  if (error) throw new Error(`Nie udało się dodać aktywa: ${error.message}`)
  return data as Asset
}

export async function deleteAsset(assetId: string) {
  const { error } = await supabase.from('assets').delete().eq('id', assetId)
  if (error) throw new Error(`Nie udało się usunąć aktywa: ${error.message}`)
}


export type TransactionType = 'BUY' | 'SELL'

export const TRANSACTION_SELECT = 'id,portfolio_id,asset_id,transaction_type,quantity,price,fees,source_currency,price_source,fees_source,fx_rate_to_base,base_currency,price_base,fees_base,gross_amount_source,gross_amount_base,fx_rate_date,fx_rate_source,transaction_date,notes,created_at'
const TRANSACTION_SELECT_WITH_ASSET = `${TRANSACTION_SELECT},assets(symbol,name,asset_type,currency)`

export type Transaction = {
  id: string
  portfolio_id: string
  asset_id: string
  transaction_type: TransactionType
  quantity: number
  price: number
  fees: number | null
  source_currency?: string | null
  price_source?: number | null
  fees_source?: number | null
  fx_rate_to_base?: number | null
  base_currency?: string | null
  price_base?: number | null
  fees_base?: number | null
  gross_amount_source?: number | null
  gross_amount_base?: number | null
  fx_rate_date?: string | null
  fx_rate_source?: string | null
  transaction_date: string
  notes: string | null
  created_at: string
  assets?: Pick<Asset, 'symbol' | 'name' | 'asset_type' | 'currency'> | null
}

export type CreateTransactionInput = {
  asset_id: string
  transaction_type: TransactionType
  quantity: number
  price: number
  fees: number
  source_currency?: string | null
  price_source?: number | null
  fees_source?: number | null
  fx_rate_to_base?: number | null
  base_currency?: string | null
  price_base?: number | null
  fees_base?: number | null
  gross_amount_source?: number | null
  gross_amount_base?: number | null
  fx_rate_date?: string | null
  fx_rate_source?: string | null
  transaction_date: string
  notes?: string
}

export async function listTransactions(portfolioId: string): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select(TRANSACTION_SELECT_WITH_ASSET)
    .eq('portfolio_id', portfolioId)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Nie udało się pobrać transakcji: ${error.message}`)
  return (data ?? []) as unknown as Transaction[]
}

export async function createTransaction(portfolioId: string, input: CreateTransactionInput): Promise<Transaction> {
  const amounts = calculateTransactionAmounts({
    transactionType: input.transaction_type,
    quantity: input.quantity,
    priceSource: input.price_source ?? input.price,
    feesSource: input.fees_source ?? input.fees ?? 0,
    sourceCurrency: input.source_currency,
    fxRateToBase: input.fx_rate_to_base,
    baseCurrency: input.base_currency ?? BASE_CURRENCY,
    fxRateDate: input.fx_rate_date,
    fxRateSource: input.fx_rate_source,
  })

  const legacyPrice = amounts.priceBase ?? amounts.priceSource
  const legacyFees = amounts.feesBase ?? amounts.feesSource

  const { data: inserted, error } = await supabase.rpc('create_transaction_checked', {
    p_portfolio_id: portfolioId,
    p_asset_id: input.asset_id,
    p_transaction_type: input.transaction_type,
    p_quantity: amounts.quantity,
    p_price: legacyPrice,
    p_fees: legacyFees || 0,
    p_transaction_date: input.transaction_date,
    p_notes: input.notes?.trim() || null,
  })

  if (error) throw new Error(`Nie udało się dodać transakcji: ${error.message}`)

  const insertedId = (inserted as { id?: string } | null)?.id
  if (!insertedId) throw new Error('Nie udało się odczytać zapisanej transakcji.')

  const { error: updateError } = await supabase
    .from('transactions')
    .update({
      source_currency: amounts.sourceCurrency,
      price_source: amounts.priceSource,
      fees_source: amounts.feesSource,
      fx_rate_to_base: amounts.fxRateToBase,
      base_currency: amounts.baseCurrency,
      price_base: amounts.priceBase,
      fees_base: amounts.feesBase,
      gross_amount_source: amounts.grossAmountSource,
      gross_amount_base: amounts.grossAmountBase,
      fx_rate_date: amounts.fxRateDate,
      fx_rate_source: amounts.fxRateSource,
    })
    .eq('id', insertedId)

  if (updateError) throw new Error(`Transakcja została utworzona, ale nie udało się zapisać danych walutowych: ${updateError.message}`)

  const { data, error: fetchError } = await supabase
    .from('transactions')
    .select(TRANSACTION_SELECT_WITH_ASSET)
    .eq('id', insertedId)
    .single()

  if (fetchError) throw new Error(`Nie udało się pobrać zapisanej transakcji: ${fetchError.message}`)
  return data as unknown as Transaction
}

export async function deleteTransaction(transactionId: string) {
  const { error } = await supabase.from('transactions').delete().eq('id', transactionId)
  if (error) throw new Error(`Nie udało się usunąć transakcji: ${error.message}`)
}

export type AssetPrice = {
  id: string
  portfolio_id: string
  asset_id: string
  price: number
  currency: string | null
  priced_at: string | null
  created_at: string
  updated_at: string | null
}

export async function listAssetPrices(portfolioId: string): Promise<AssetPrice[]> {
  const { data, error } = await supabase
    .from('asset_prices')
    .select('id,portfolio_id,asset_id,price,currency,priced_at,created_at,updated_at')
    .eq('portfolio_id', portfolioId)

  if (error) throw new Error(`Nie udało się pobrać cen: ${error.message}`)
  return (data ?? []) as AssetPrice[]
}

export type PortfolioSnapshot = {
  id: string
  portfolio_id: string
  snapshot_date: string
  base_currency?: string | null
  total_value: number
  cash_value?: number | null
  invested_cost: number
  remaining_cost?: number | null
  realized_pnl?: number | null
  unrealized_pnl?: number | null
  total_pnl?: number | null
  net_cash_flow?: number | null
  contribution: number
  dividends_value?: number | null
  fees_value?: number | null
  taxes_value?: number | null
  allocation_breakdown?: { name: string; type: string; value: number; pct: number }[] | null
  benchmark_asset_id?: string | null
  calculated_at: string
}

export async function listPortfolioSnapshots(portfolioId: string): Promise<PortfolioSnapshot[]> {
  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .select('id,portfolio_id,snapshot_date,base_currency,total_value,cash_value,invested_cost,remaining_cost,realized_pnl,unrealized_pnl,total_pnl,net_cash_flow,contribution,dividends_value,fees_value,taxes_value,allocation_breakdown,benchmark_asset_id,calculated_at')
    .eq('portfolio_id', portfolioId)
    .order('snapshot_date', { ascending: true })

  if (error) throw new Error(`Nie udało się pobrać historii portfolio: ${error.message}`)
  return (data ?? []) as PortfolioSnapshot[]
}

export type PriceRefreshRun = {
  id: string
  portfolio_id: string
  trigger_type: 'manual' | 'cron' | 'backfill'
  status: 'running' | 'success' | 'partial_success' | 'failed'
  started_at: string
  finished_at: string | null
  requested_assets: number
  refreshed_assets: number
  failed_assets: number
  error: string | null
}

export async function getLatestPriceRefreshRun(portfolioId: string): Promise<PriceRefreshRun | null> {
  const { data, error } = await supabase
    .from('price_refresh_runs')
    .select('id,portfolio_id,trigger_type,status,started_at,finished_at,requested_assets,refreshed_assets,failed_assets,error')
    .eq('portfolio_id', portfolioId)
    .order('started_at', { ascending: false })
    .limit(1)

  if (error) throw new Error(`Nie udało się pobrać statusu refreshu cen: ${error.message}`)
  return ((data ?? [])[0] ?? null) as PriceRefreshRun | null
}

export type MarketPriceHistoryPoint = {
  id: string
  portfolio_id: string
  asset_id: string
  price_date: string
  close_price: number
  close_price_base: number | null
  fx_rate_to_base: number | null
  fx_rate_date?: string | null
  fx_fallback_days?: number | null
  base_currency: string | null
  source_currency: string | null
  fetched_at: string
}

export type MarketPriceSourceDistribution = {
  source: string
  count: number
}

export type MarketPriceDiagnostics = {
  asset_id: string
  rowCount: number
  sourcePriceRows: number
  minPriceDate: string | null
  maxPriceDate: string | null
  latestPriceDate: string | null
  latestFetchedAt: string | null
  sourceCurrency: string | null
  baseCurrency: string | null
  expectedTradingDays: number
  historyCoveragePct: number | null
  recentCalendarGapDays: number | null
  missingRecentTradingDays: number
  recentGapCount: number
  maxRecentGapDays: number
  sourceDistribution: MarketPriceSourceDistribution[]
  sourceCurrencyDistribution: MarketPriceSourceDistribution[]
  baseCurrencyDistribution: MarketPriceSourceDistribution[]
  sourceSymbol: string | null
  basePriceRows: number
  missingBasePriceRows: number
  valuationReadyRows: number
  fxExactRows: number
  fxFallbackRows: number
  fxMissingRows: number
  maxFxFallbackDays: number
  fxLookbackDays: number
  readyForPortfolioHistory: boolean
  quality: 'ready' | 'limited' | 'missing'
  warnings: string[]
}

export const CHART_RANGES = ['30D', '90D', '1Y', '3Y', '5Y', 'MAX'] as const
export type ChartRange = typeof CHART_RANGES[number]

function marketDateKey(value: string | null | undefined) {
  const text = String(value ?? '').trim()
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function marketDayTime(value: string) {
  const key = marketDateKey(value)
  if (!key) return Number.NaN
  const [year, month, day] = key.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function marketDaysBetween(start: string, end: string) {
  const startTime = marketDayTime(start)
  const endTime = marketDayTime(end)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0
  return Math.max(0, Math.floor((endTime - startTime) / (24 * 60 * 60 * 1000)))
}

function marketAddDays(date: string, days: number) {
  const key = marketDateKey(date)
  if (!key) return date
  const value = new Date(`${key}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function marketIsWeekday(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`)
  const day = value.getUTCDay()
  return day !== 0 && day !== 6
}

function marketWeekdaysAfter(startDate: string | null, endDate: string) {
  if (!startDate) return 0
  let count = 0
  let cursor = marketAddDays(startDate, 1)
  while (cursor <= endDate) {
    if (marketIsWeekday(cursor)) count += 1
    cursor = marketAddDays(cursor, 1)
  }
  return count
}

function chartRangeStartDate(range: ChartRange) {
  if (range === 'MAX') return null
  const days = range === '30D' ? 30 : range === '90D' ? 90 : range === '1Y' ? 365 : range === '3Y' ? 365 * 3 : 365 * 5
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return date.toISOString().slice(0, 10)
}

function chartRangeLimit(range: ChartRange) {
  if (range === '30D') return 90
  if (range === '90D') return 180
  if (range === '1Y') return 420
  if (range === '3Y') return 1200
  if (range === '5Y') return 2200
  return 5000
}

type FxRateDiagnosticRow = {
  from_currency: string | null
  to_currency: string | null
  rate_date: string
  rate: number | null
}

type MarketFxLookupRow = {
  price_date: string
  source_currency: string | null
  base_currency: string | null
  fx_rate_to_base: number | null
}

function roughlySameRate(a: number, b: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return false
  return Math.abs(a - b) / Math.max(a, b) < 0.0001
}

function groupFxDiagnosticRows(rows: FxRateDiagnosticRow[]) {
  const grouped = new Map<string, FxRateDiagnosticRow[]>()
  for (const row of rows) {
    const from = normalizeCurrencyCode(row.from_currency)
    const to = normalizeCurrencyCode(row.to_currency)
    const current = grouped.get(`${from}:${to}`) ?? []
    current.push({ ...row, from_currency: from, to_currency: to, rate_date: marketDateKey(row.rate_date) })
    grouped.set(`${from}:${to}`, current)
  }

  for (const [key, values] of grouped.entries()) {
    grouped.set(key, values.sort((a, b) => a.rate_date.localeCompare(b.rate_date)))
  }

  return grouped
}

function findFxMatch(
  fxByPair: Map<string, FxRateDiagnosticRow[]>,
  row: MarketFxLookupRow,
) {
  const fromCurrency = normalizeCurrencyCode(row.source_currency)
  const toCurrency = normalizeCurrencyCode(row.base_currency)
  if (fromCurrency === toCurrency) return null

  const expectedRate = Number(row.fx_rate_to_base ?? 0)
  if (!Number.isFinite(expectedRate) || expectedRate <= 0) return null

  const priceDate = marketDateKey(row.price_date)
  const rows = fxByPair.get(`${fromCurrency}:${toCurrency}`) ?? []
  let left = 0
  let right = rows.length - 1
  let match: FxRateDiagnosticRow | null = null

  while (left <= right) {
    const middle = Math.floor((left + right) / 2)
    const candidate = rows[middle]
    if (candidate.rate_date <= priceDate) {
      match = candidate
      left = middle + 1
    } else {
      right = middle - 1
    }
  }

  if (!match || !roughlySameRate(Number(match.rate ?? 0), expectedRate)) return null
  const fallbackDays = fxDaysBetween(match.rate_date, priceDate)
  if (fallbackDays < 0 || fallbackDays > FX_PREVIOUS_LOOKBACK_DAYS) return null

  return { rateDate: match.rate_date, fallbackDays }
}

async function fetchFxDiagnosticRows(rows: MarketFxLookupRow[]) {
  const dates = rows.map((row) => marketDateKey(row.price_date)).filter(Boolean).sort()
  if (dates.length === 0) return []

  const fromCurrencies = Array.from(new Set(rows
    .map((row) => normalizeCurrencyCode(row.source_currency))
    .filter((currency) => currency && currency !== 'PLN')))
  const toCurrencies = Array.from(new Set(rows
    .map((row) => normalizeCurrencyCode(row.base_currency))
    .filter((currency) => currency)))

  if (fromCurrencies.length === 0 || toCurrencies.length === 0) return []

  const { data, error } = await supabase
    .from('fx_rates')
    .select('from_currency,to_currency,rate_date,rate')
    .in('from_currency', fromCurrencies)
    .in('to_currency', toCurrencies)
    .gte('rate_date', fxAddDays(dates[0], -FX_PREVIOUS_LOOKBACK_DAYS))
    .lte('rate_date', dates[dates.length - 1])
    .order('rate_date', { ascending: true })
    .limit(20000)

  if (error) return []
  return (data ?? []) as FxRateDiagnosticRow[]
}

async function annotateMarketHistoryFx(rows: MarketPriceHistoryPoint[]) {
  const fxByPair = groupFxDiagnosticRows(await fetchFxDiagnosticRows(rows))
  return rows.map((row) => {
    const match = findFxMatch(fxByPair, row)
    return {
      ...row,
      fx_rate_date: match?.rateDate ?? null,
      fx_fallback_days: match?.fallbackDays ?? null,
    }
  })
}

export async function listMarketPriceHistory(portfolioId: string, assetId: string, range: ChartRange = '1Y'): Promise<MarketPriceHistoryPoint[]> {
  let query = supabase
    .from('market_prices')
    .select('id,portfolio_id,asset_id,price_date,close_price,close_price_base,fx_rate_to_base,base_currency,source_currency,fetched_at')
    .eq('portfolio_id', portfolioId)
    .eq('asset_id', assetId)

  const startDate = chartRangeStartDate(range)
  if (startDate) query = query.gte('price_date', startDate)

  const { data, error } = await query
    .order('price_date', { ascending: false })
    .limit(chartRangeLimit(range))

  if (error) throw new Error(`Nie udało się pobrać historii cen aktywa: ${error.message}`)
  return annotateMarketHistoryFx(((data ?? []) as MarketPriceHistoryPoint[]).slice().reverse())
}

export async function getMarketPriceDiagnostics(portfolioId: string, assetId: string): Promise<MarketPriceDiagnostics> {
  const { data, error } = await supabase
    .from('market_prices')
    .select('asset_id,source,source_symbol,price_date,close_price,close_price_base,source_currency,base_currency,fx_rate_to_base,fetched_at')
    .eq('portfolio_id', portfolioId)
    .eq('asset_id', assetId)
    .order('price_date', { ascending: true })
    .limit(10000)

  if (error) throw new Error(`Nie udało się pobrać diagnostyki cen: ${error.message}`)

  const rows = (data ?? []) as {
    asset_id: string
    source: string | null
    source_symbol: string | null
    price_date: string
    close_price: number | null
    close_price_base: number | null
    source_currency: string | null
    base_currency: string | null
    fx_rate_to_base: number | null
    fetched_at: string | null
  }[]
  const fxByPair = groupFxDiagnosticRows(await fetchFxDiagnosticRows(rows))
  const dates = rows.map((row) => marketDateKey(row.price_date)).filter(Boolean)
  const uniqueDates = Array.from(new Set(dates)).sort()
  const minPriceDate = uniqueDates[0] ?? null
  const maxPriceDate = uniqueDates[uniqueDates.length - 1] ?? null
  const latestFetchedAt = rows[rows.length - 1]?.fetched_at ?? null
  const today = new Date().toISOString().slice(0, 10)
  const expectedTradingDays = minPriceDate && maxPriceDate ? marketWeekdaysAfter(marketAddDays(minPriceDate, -1), maxPriceDate) : 0
  const historyCoveragePct = expectedTradingDays > 0 ? uniqueDates.length / expectedTradingDays : null
  const recentCalendarGapDays = maxPriceDate ? marketDaysBetween(maxPriceDate, today) : null
  const missingRecentTradingDays = marketWeekdaysAfter(maxPriceDate, today)
  const recentStart = marketAddDays(today, -90)
  let recentGapCount = 0
  let maxRecentGapDays = 0
  for (let index = 1; index < uniqueDates.length; index += 1) {
    const current = uniqueDates[index]
    if (current < recentStart) continue
    const gap = marketDaysBetween(uniqueDates[index - 1], current)
    if (gap > 4) recentGapCount += 1
    maxRecentGapDays = Math.max(maxRecentGapDays, gap)
  }

  const sourceCounts = new Map<string, number>()
  const sourceSymbolCounts = new Map<string, number>()
  const sourceCurrencyCounts = new Map<string, number>()
  const baseCurrencyCounts = new Map<string, number>()
  let sourcePriceRows = 0
  let basePriceRows = 0
  let missingBasePriceRows = 0
  let valuationReadyRows = 0
  let fxExactRows = 0
  let fxFallbackRows = 0
  let fxMissingRows = 0
  let maxFxFallbackDays = 0
  for (const row of rows) {
    const source = row.source || 'unknown'
    const sourceCurrency = (row.source_currency || 'unknown').toUpperCase()
    const baseCurrency = (row.base_currency || 'unknown').toUpperCase()
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1)
    sourceCurrencyCounts.set(sourceCurrency, (sourceCurrencyCounts.get(sourceCurrency) ?? 0) + 1)
    baseCurrencyCounts.set(baseCurrency, (baseCurrencyCounts.get(baseCurrency) ?? 0) + 1)
    if (row.source_symbol) sourceSymbolCounts.set(row.source_symbol, (sourceSymbolCounts.get(row.source_symbol) ?? 0) + 1)
    if (Number(row.close_price ?? 0) > 0) sourcePriceRows += 1
    if (Number(row.close_price_base ?? 0) > 0) basePriceRows += 1
    else missingBasePriceRows += 1
    if (Number(row.close_price_base ?? 0) > 0 || (sourceCurrency === baseCurrency && Number(row.close_price ?? 0) > 0)) valuationReadyRows += 1
    if (sourceCurrency !== baseCurrency && Number(row.close_price ?? 0) > 0) {
      if (Number(row.close_price_base ?? 0) <= 0) {
        fxMissingRows += 1
      } else {
        const match = findFxMatch(fxByPair, row)
        if (match?.fallbackDays === 0) fxExactRows += 1
        if (match && match.fallbackDays > 0) {
          fxFallbackRows += 1
          maxFxFallbackDays = Math.max(maxFxFallbackDays, match.fallbackDays)
        }
      }
    }
  }

  const sourceDistribution = Array.from(sourceCounts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
  const sourceCurrencyDistribution = Array.from(sourceCurrencyCounts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
  const baseCurrencyDistribution = Array.from(baseCurrencyCounts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
  const sourceSymbol = Array.from(sourceSymbolCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const sourceCurrency = sourceCurrencyDistribution[0]?.source === 'unknown' ? null : sourceCurrencyDistribution[0]?.source ?? null
  const baseCurrency = baseCurrencyDistribution[0]?.source === 'unknown' ? null : baseCurrencyDistribution[0]?.source ?? null
  const warnings: string[] = []
  if (rows.length === 0) warnings.push('No historical market_prices rows for this asset.')
  if (sourceCurrencyDistribution.filter((item) => item.source !== 'unknown').length > 1) warnings.push('Multiple source currencies detected; source-currency charts use one currency at a time.')
  if (recentCalendarGapDays != null && recentCalendarGapDays > 7) warnings.push(`Latest price is ${recentCalendarGapDays} calendar days old.`)
  if (missingRecentTradingDays > 3) warnings.push(`${missingRecentTradingDays} recent weekdays have no market price rows.`)
  if (recentGapCount > 0) warnings.push(`${recentGapCount} recent history gap(s) exceed 4 calendar days.`)
  if (historyCoveragePct != null && historyCoveragePct < 0.7) warnings.push(`History coverage is about ${Math.round(historyCoveragePct * 100)}% of expected weekdays.`)
  if (rows.length > 0 && missingBasePriceRows / rows.length > 0.5) warnings.push('Most rows do not have close_price_base; portfolio valuation needs FX coverage.')
  if (fxFallbackRows > 0 && maxFxFallbackDays > 3) warnings.push(`${fxFallbackRows} row(s) use previous available FX; max fallback age is ${maxFxFallbackDays} day(s).`)
  if (fxMissingRows > 0) warnings.push(`${fxMissingRows} row(s) still miss base-currency conversion because no FX was found within ${FX_PREVIOUS_LOOKBACK_DAYS} day(s).`)
  if (rows.length > 0 && valuationReadyRows < 2) warnings.push('Portfolio valuation is not ready because fewer than two rows have safe base-currency values.')

  const quality: MarketPriceDiagnostics['quality'] = rows.length === 0
    ? 'missing'
    : warnings.length > 0
      ? 'limited'
      : 'ready'

  return {
    asset_id: assetId,
    rowCount: rows.length,
    sourcePriceRows,
    minPriceDate,
    maxPriceDate,
    latestPriceDate: maxPriceDate,
    latestFetchedAt,
    sourceCurrency,
    baseCurrency,
    expectedTradingDays,
    historyCoveragePct,
    recentCalendarGapDays,
    missingRecentTradingDays,
    recentGapCount,
    maxRecentGapDays,
    sourceDistribution,
    sourceCurrencyDistribution,
    baseCurrencyDistribution,
    sourceSymbol,
    basePriceRows,
    missingBasePriceRows,
    valuationReadyRows,
    fxExactRows,
    fxFallbackRows,
    fxMissingRows,
    maxFxFallbackDays,
    fxLookbackDays: FX_PREVIOUS_LOOKBACK_DAYS,
    readyForPortfolioHistory: valuationReadyRows >= 2 && quality !== 'missing',
    quality,
    warnings,
  }
}

export type CashLedgerEntryType = 'deposit' | 'withdrawal' | 'fee' | 'tax' | 'adjustment'
export type SupportedCashCurrency = 'PLN' | 'EUR' | 'USD'

export type CashLedgerEntry = {
  id: string
  portfolio_id: string
  entry_type: CashLedgerEntryType
  amount: number
  currency: SupportedCashCurrency
  entry_date: string
  note: string | null
  created_at: string
  updated_at: string | null
}

export type CreateCashLedgerEntryInput = {
  entry_type: CashLedgerEntryType
  amount: number
  currency: SupportedCashCurrency
  entry_date: string
  note?: string
}

export async function listCashLedgerEntries(portfolioId: string): Promise<CashLedgerEntry[]> {
  const { data, error } = await supabase
    .from('cash_ledger_entries')
    .select('id,portfolio_id,entry_type,amount,currency,entry_date,note,created_at,updated_at')
    .eq('portfolio_id', portfolioId)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Nie udało się pobrać cash ledger: ${error.message}`)
  return (data ?? []) as CashLedgerEntry[]
}

export async function createCashLedgerEntry(portfolioId: string, input: CreateCashLedgerEntryInput): Promise<CashLedgerEntry> {
  const payload = {
    portfolio_id: portfolioId,
    entry_type: input.entry_type,
    amount: input.amount,
    currency: input.currency,
    entry_date: input.entry_date,
    note: input.note?.trim() || null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('cash_ledger_entries')
    .insert(payload)
    .select('id,portfolio_id,entry_type,amount,currency,entry_date,note,created_at,updated_at')
    .single()

  if (error) throw new Error(`Nie udało się dodać wpisu cash ledger: ${error.message}`)
  return data as CashLedgerEntry
}

export async function deleteCashLedgerEntry(id: string) {
  const { error } = await supabase.from('cash_ledger_entries').delete().eq('id', id)
  if (error) throw new Error(`Nie udało się usunąć wpisu cash ledger: ${error.message}`)
}

export type DividendRecord = {
  id: string
  portfolio_id: string
  asset_id: string
  payment_date: string
  gross_amount: number
  tax_amount: number
  net_amount: number
  currency: SupportedCashCurrency
  note: string | null
  created_at: string
  updated_at: string | null
  assets?: Pick<Asset, 'symbol' | 'name' | 'asset_type' | 'currency'> | null
}

export type CreateDividendInput = {
  asset_id: string
  payment_date: string
  gross_amount: number
  tax_amount: number
  currency: SupportedCashCurrency
  note?: string
}

export async function listDividends(portfolioId: string): Promise<DividendRecord[]> {
  const { data, error } = await supabase
    .from('dividends')
    .select('id,portfolio_id,asset_id,payment_date,gross_amount,tax_amount,net_amount,currency,note,created_at,updated_at,assets(symbol,name,asset_type,currency)')
    .eq('portfolio_id', portfolioId)
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Nie udało się pobrać dywidend: ${error.message}`)
  return (data ?? []) as unknown as DividendRecord[]
}

export async function createDividend(portfolioId: string, input: CreateDividendInput): Promise<DividendRecord> {
  const gross = Number(input.gross_amount)
  const tax = Number(input.tax_amount)
  const net = gross - tax

  if (!input.asset_id) throw new Error('Wybierz aktywo dla dywidendy.')
  if (!input.payment_date) throw new Error('Wybierz datę płatności dywidendy.')
  if (!Number.isFinite(gross) || gross < 0) throw new Error('Kwota brutto dywidendy nie może być ujemna.')
  if (!Number.isFinite(tax) || tax < 0) throw new Error('Podatek od dywidendy nie może być ujemny.')
  if (!Number.isFinite(net) || net < 0) throw new Error('Kwota netto dywidendy nie może być ujemna.')

  const payload = {
    portfolio_id: portfolioId,
    asset_id: input.asset_id,
    payment_date: input.payment_date,
    gross_amount: gross,
    tax_amount: tax,
    net_amount: net,
    currency: input.currency,
    note: input.note?.trim() || null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('dividends')
    .insert(payload)
    .select('id,portfolio_id,asset_id,payment_date,gross_amount,tax_amount,net_amount,currency,note,created_at,updated_at,assets(symbol,name,asset_type,currency)')
    .single()

  if (error) throw new Error(`Nie udało się dodać dywidendy: ${error.message}`)
  return data as unknown as DividendRecord
}

export async function deleteDividend(id: string) {
  const { error } = await supabase.from('dividends').delete().eq('id', id)
  if (error) throw new Error(`Nie udało się usunąć dywidendy: ${error.message}`)
}

export type IncomeEvent = {
  id: string
  user_id: string
  portfolio_id: string
  asset_id: string | null
  income_type: IncomeType
  broker: string | null
  source: string | null
  currency: string
  gross_amount: number
  withholding_tax: number
  local_tax: number
  other_fees: number
  net_amount: number
  fx_rate_to_base: number | null
  fx_rate_date: string | null
  fx_rate_source: string | null
  base_currency: string
  gross_amount_base: number | null
  withholding_tax_base: number | null
  local_tax_base: number | null
  other_fees_base: number | null
  net_amount_base: number | null
  payment_date: string
  ex_date: string | null
  record_date: string | null
  notes: string | null
  created_at: string
  updated_at: string | null
  assets?: Pick<Asset, 'symbol' | 'name' | 'asset_type' | 'currency'> | null
}

export type CreateIncomeEventInput = {
  income_type?: IncomeType
  asset_id?: string | null
  broker?: string | null
  source?: string | null
  currency: string
  gross_amount: number
  withholding_tax?: number | null
  local_tax?: number | null
  other_fees?: number | null
  fx_rate_to_base?: number | null
  fx_rate_date?: string | null
  fx_rate_source?: string | null
  base_currency?: string | null
  payment_date: string
  ex_date?: string | null
  record_date?: string | null
  notes?: string | null
}

const INCOME_EVENT_SELECT = 'id,user_id,portfolio_id,asset_id,income_type,broker,source,currency,gross_amount,withholding_tax,local_tax,other_fees,net_amount,fx_rate_to_base,fx_rate_date,fx_rate_source,base_currency,gross_amount_base,withholding_tax_base,local_tax_base,other_fees_base,net_amount_base,payment_date,ex_date,record_date,notes,created_at,updated_at,assets(symbol,name,asset_type,currency)'

export async function listIncomeEvents(portfolioId: string): Promise<IncomeEvent[]> {
  const { data, error } = await supabase
    .from('income_events')
    .select(INCOME_EVENT_SELECT)
    .eq('portfolio_id', portfolioId)
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Nie udało się pobrać dochodów: ${error.message}`)
  return (data ?? []) as unknown as IncomeEvent[]
}

export async function createIncomeEvent(portfolioId: string, input: CreateIncomeEventInput): Promise<IncomeEvent> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error('Brak aktywnej sesji użytkownika.')
  if (!input.payment_date) throw new Error('Wybierz datę wypłaty dochodu.')

  const amounts = calculateIncomeAmounts({
    incomeType: input.income_type ?? 'DIVIDEND',
    grossAmount: input.gross_amount,
    withholdingTax: input.withholding_tax,
    localTax: input.local_tax,
    otherFees: input.other_fees,
    currency: input.currency,
    baseCurrency: input.base_currency ?? BASE_CURRENCY,
    fxRateToBase: input.fx_rate_to_base,
    fxRateDate: input.fx_rate_date,
    fxRateSource: input.fx_rate_source,
  })

  const payload = {
    user_id: userData.user.id,
    portfolio_id: portfolioId,
    asset_id: input.asset_id || null,
    income_type: amounts.incomeType,
    broker: input.broker?.trim() || null,
    source: input.source?.trim() || 'manual',
    currency: amounts.currency,
    gross_amount: amounts.grossAmount,
    withholding_tax: amounts.withholdingTax,
    local_tax: amounts.localTax,
    other_fees: amounts.otherFees,
    net_amount: amounts.netAmount,
    fx_rate_to_base: amounts.fxRateToBase,
    fx_rate_date: amounts.fxRateDate,
    fx_rate_source: amounts.fxRateSource,
    base_currency: amounts.baseCurrency,
    gross_amount_base: amounts.grossAmountBase,
    withholding_tax_base: amounts.withholdingTaxBase,
    local_tax_base: amounts.localTaxBase,
    other_fees_base: amounts.otherFeesBase,
    net_amount_base: amounts.netAmountBase,
    payment_date: input.payment_date,
    ex_date: input.ex_date || null,
    record_date: input.record_date || null,
    notes: input.notes?.trim() || null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('income_events')
    .insert(payload)
    .select(INCOME_EVENT_SELECT)
    .single()

  if (error) throw new Error(`Nie udało się dodać dochodu: ${error.message}`)
  return data as unknown as IncomeEvent
}

export async function deleteIncomeEvent(id: string) {
  const { error } = await supabase.from('income_events').delete().eq('id', id)
  if (error) throw new Error(`Nie udało się usunąć dochodu: ${error.message}`)
}

export type PortfolioBenchmark = {
  portfolio_id: string
  benchmark_asset_id: string | null
  created_at: string
  updated_at: string | null
}

export async function getPortfolioBenchmark(portfolioId: string): Promise<PortfolioBenchmark | null> {
  const { data, error } = await supabase
    .from('portfolio_benchmarks')
    .select('portfolio_id,benchmark_asset_id,created_at,updated_at')
    .eq('portfolio_id', portfolioId)
    .maybeSingle()

  if (error) throw new Error(`Nie udało się pobrać benchmarku: ${error.message}`)
  return data as PortfolioBenchmark | null
}

export async function upsertPortfolioBenchmark(portfolioId: string, benchmarkAssetId: string | null): Promise<PortfolioBenchmark> {
  const payload = {
    portfolio_id: portfolioId,
    benchmark_asset_id: benchmarkAssetId || null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('portfolio_benchmarks')
    .upsert(payload, { onConflict: 'portfolio_id' })
    .select('portfolio_id,benchmark_asset_id,created_at,updated_at')
    .single()

  if (error) throw new Error(`Nie udało się zapisać benchmarku: ${error.message}`)
  return data as PortfolioBenchmark
}

export async function upsertAssetPrice(portfolioId: string, assetId: string, price: number, currency: string) {
  const payload = {
    portfolio_id: portfolioId,
    asset_id: assetId,
    price,
    currency,
    priced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('asset_prices')
    .upsert(payload, { onConflict: 'portfolio_id,asset_id' })
    .select('id,portfolio_id,asset_id,price,currency,priced_at,created_at,updated_at')
    .single()

  if (error) throw new Error(`Nie udało się zapisać ceny: ${error.message}`)
  return data as AssetPrice
}

export type EdoBond = {
  id: string
  portfolio_id: string
  series: string | null
  quantity: number | null
  purchase_price: number | null
  purchase_date: string | null
  interest_first_year: number | null
  inflation_margin: number | null
  maturity_date: string | null
  created_at: string
}

export type CreateEdoBondInput = {
  series: string
  quantity: number
  purchase_price: number
  purchase_date: string
  interest_first_year: number
  inflation_margin: number
  maturity_date: string
}

export async function listEdoBonds(portfolioId: string): Promise<EdoBond[]> {
  const { data, error } = await supabase
    .from('edo_bonds')
    .select('id,portfolio_id,series,quantity,purchase_price,purchase_date,interest_first_year,inflation_margin,maturity_date,created_at')
    .eq('portfolio_id', portfolioId)
    .order('purchase_date', { ascending: false })

  if (error) throw new Error(`Nie udało się pobrać obligacji EDO: ${error.message}`)
  return (data ?? []) as EdoBond[]
}

export async function createEdoBond(portfolioId: string, input: CreateEdoBondInput): Promise<EdoBond> {
  const payload = {
    portfolio_id: portfolioId,
    series: input.series.trim().toUpperCase(),
    quantity: input.quantity,
    purchase_price: input.purchase_price,
    purchase_date: input.purchase_date,
    interest_first_year: input.interest_first_year,
    inflation_margin: input.inflation_margin,
    maturity_date: input.maturity_date,
  }

  const { data, error } = await supabase
    .from('edo_bonds')
    .insert(payload)
    .select('id,portfolio_id,series,quantity,purchase_price,purchase_date,interest_first_year,inflation_margin,maturity_date,created_at')
    .single()

  if (error) throw new Error(`Nie udało się dodać obligacji EDO: ${error.message}`)
  return data as EdoBond
}

export async function deleteEdoBond(id: string) {
  const { error } = await supabase.from('edo_bonds').delete().eq('id', id)
  if (error) throw new Error(`Nie udało się usunąć obligacji EDO: ${error.message}`)
}

export type UpdateAssetInput = Partial<CreateAssetInput> & { market_symbol?: string | null; price_source?: string | null }

export async function updateAsset(assetId: string, input: UpdateAssetInput): Promise<Asset> {
  const payload: Record<string, any> = {}
  if (input.symbol !== undefined) payload.symbol = input.symbol.trim().toUpperCase()
  if (input.name !== undefined) payload.name = input.name.trim()
  if (input.asset_type !== undefined) payload.asset_type = input.asset_type
  if (input.currency !== undefined) payload.currency = input.currency.trim().toUpperCase()
  if (input.target_allocation !== undefined) payload.target_allocation = input.target_allocation || 0
  if (input.market_symbol !== undefined) payload.market_symbol = input.market_symbol?.trim() || null
  if (input.price_source !== undefined) payload.price_source = input.price_source?.trim() || 'auto'

  const { data, error } = await supabase
    .from('assets')
    .update(payload)
    .eq('id', assetId)
    .select('id,portfolio_id,symbol,name,asset_type,currency,target_allocation,market_symbol,price_source,auto_refresh_enabled,created_at')
    .single()

  if (error) throw new Error(`Nie udało się zaktualizować aktywa: ${error.message}`)
  return data as Asset
}

export async function listInstrumentCatalog(limit = 300): Promise<InstrumentCatalogRow[]> {
  const { data, error } = await supabase
    .from('instrument_catalog')
    .select(INSTRUMENT_CATALOG_SELECT)
    .eq('is_active', true)
    .order('benchmark_candidate', { ascending: false })
    .order('symbol', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Nie udało się pobrać katalogu instrumentów: ${error.message}`)
  return (data ?? []) as InstrumentCatalogRow[]
}

export async function searchInstrumentCatalog(query: string, category?: string): Promise<InstrumentCatalogRow[]> {
  let request = supabase
    .from('instrument_catalog')
    .select(INSTRUMENT_CATALOG_SELECT)
    .eq('is_active', true)
    .order('benchmark_candidate', { ascending: false })
    .order('symbol', { ascending: true })
    .limit(300)

  if (category) request = request.eq('category', category)

  const { data, error } = await request
  if (error) throw new Error(`Nie udało się wyszukać instrumentów: ${error.message}`)

  return searchInstrumentCatalogRows((data ?? []) as InstrumentCatalogRow[], query, { limit: 50 })
}

export async function listBenchmarkCandidates(): Promise<InstrumentCatalogRow[]> {
  const { data, error } = await supabase
    .from('instrument_catalog')
    .select(INSTRUMENT_CATALOG_SELECT)
    .eq('is_active', true)
    .eq('benchmark_candidate', true)
    .order('category', { ascending: true })
    .order('symbol', { ascending: true })
    .limit(120)

  if (error) throw new Error(`Nie udało się pobrać kandydatów benchmarku: ${error.message}`)
  return (data ?? []) as InstrumentCatalogRow[]
}

export async function updateAssetMarketSymbol(assetId: string, marketSymbol: string | null): Promise<Asset> {
  return updateAsset(assetId, { market_symbol: marketSymbol })
}

export async function applyInstrumentPresetToAsset(assetId: string, presetId: string): Promise<Asset> {
  const { data, error } = await supabase
    .from('instrument_catalog')
    .select(INSTRUMENT_CATALOG_SELECT)
    .eq('id', presetId)
    .eq('is_active', true)
    .single()

  if (error) throw new Error(`Nie udało się pobrać presetu instrumentu: ${error.message}`)
  const preset = data as InstrumentCatalogRow

  return updateAsset(assetId, {
    symbol: preset.symbol,
    name: preset.name,
    asset_type: preset.asset_type as AssetType,
    currency: preset.currency,
    market_symbol: preset.market_symbol,
    price_source: preset.provider,
  })
}
