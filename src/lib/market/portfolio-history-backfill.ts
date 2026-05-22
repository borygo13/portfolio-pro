import { buildAllocationBreakdown, isMarketPricedAsset, num, summarizeCashLedger, summarizeDividends } from '@/lib/portfolio-intelligence'
import { buildPositions, portfolioSummary, type AssetPrice } from '@/lib/position-engine'
import { FX_PREVIOUS_LOOKBACK_DAYS, fxDaysBetween } from '@/lib/market/fx'
import { transactionFeeBase } from '@/lib/transaction-math'
import type {
  Asset,
  CashLedgerEntry,
  DividendRecord,
  EdoBond,
  Portfolio,
  PortfolioBenchmark,
  Transaction,
} from '@/lib/supabase/portfolio'
import { getServerSupabase, type ServerSupabase } from './persistence'
import type { BackfillRange } from './backfill'

export type PortfolioHistoryBackfillReport = {
  ok: boolean
  status: 'success' | 'partial_success' | 'failed' | 'skipped'
  portfolioId: string
  range: BackfillRange
  startDate: string | null
  endDate: string
  requestedDays: number
  processedDays: number
  generatedSnapshots: number
  skippedExistingDays: number
  skippedNoActivityDays: number
  skippedMissingPriceDays: number
  remainingDays: number
  skippedDays: { date: string; reason: string }[]
  errorDays: { date: string; error: string }[]
  error?: string
}

type MarketPriceRow = {
  asset_id: string
  price_date: string
  close_price: number
  close_price_base: number | null
  source_currency: string | null
  base_currency: string | null
  fx_rate_to_base: number | null
  fetched_at: string
}

type FxRateRow = {
  from_currency: string
  to_currency: string
  rate_date: string
  rate: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_SNAPSHOT_DAYS_PER_REQUEST = 1200
const UPSERT_CHUNK_SIZE = 200
const PRICE_LOOKBACK_DAYS = 14
const MAX_REPORTED_DAYS = 20
const BACKFILL_TRANSACTION_SELECT = 'id,portfolio_id,asset_id,transaction_type,quantity,price,fees,source_currency,price_source,fees_source,fx_rate_to_base,base_currency,price_base,fees_base,gross_amount_source,gross_amount_base,fx_rate_date,fx_rate_source,transaction_date,notes,created_at'

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function today() {
  return formatDate(new Date())
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

function addDays(value: string, days: number) {
  return formatDate(new Date(parseDate(value).getTime() + days * DAY_MS))
}

function yearsBack(years: number) {
  const date = new Date()
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(date.getUTCFullYear() - years)
  return formatDate(date)
}

function maxDate(a: string, b: string) {
  return a > b ? a : b
}

function startDateForRange(range: BackfillRange, earliestActivity: string | null) {
  if (range === 'MAX') return earliestActivity
  const rangeStart = range === '1Y' ? yearsBack(1) : range === '3Y' ? yearsBack(3) : yearsBack(5)
  return earliestActivity ? maxDate(rangeStart, earliestActivity) : rangeStart
}

function datesBetween(startDate: string, endDate: string) {
  const dates: string[] = []
  let cursor = startDate
  while (cursor <= endDate) {
    dates.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return dates
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

function earliestDate(values: Array<string | null | undefined>) {
  const valid = values.filter((value): value is string => Boolean(value)).sort()
  return valid[0] ?? null
}

function bondPrincipal(bonds: EdoBond[], date: string) {
  return bonds
    .filter((bond) => bond.purchase_date && bond.purchase_date <= date)
    .reduce((sum, bond) => sum + num(bond.quantity) * num(bond.purchase_price), 0)
}

async function fetchEarliestActivityDate(supabase: ServerSupabase, portfolioId: string, endDate: string) {
  const [transactionsRes, cashRes, dividendsRes, bondsRes] = await Promise.all([
    supabase.from('transactions').select('transaction_date').eq('portfolio_id', portfolioId).lte('transaction_date', endDate).order('transaction_date', { ascending: true }).limit(1),
    supabase.from('cash_ledger_entries').select('entry_date').eq('portfolio_id', portfolioId).lte('entry_date', endDate).order('entry_date', { ascending: true }).limit(1),
    supabase.from('dividends').select('payment_date').eq('portfolio_id', portfolioId).lte('payment_date', endDate).order('payment_date', { ascending: true }).limit(1),
    supabase.from('edo_bonds').select('purchase_date').eq('portfolio_id', portfolioId).order('purchase_date', { ascending: true }).limit(1),
  ])

  if (transactionsRes.error) throw new Error(`transactions: ${transactionsRes.error.message}`)
  if (cashRes.error) throw new Error(`cash_ledger_entries: ${cashRes.error.message}`)
  if (dividendsRes.error) throw new Error(`dividends: ${dividendsRes.error.message}`)
  if (bondsRes.error) throw new Error(`edo_bonds: ${bondsRes.error.message}`)

  return earliestDate([
    ...((transactionsRes.data ?? []) as { transaction_date: string | null }[]).map((item) => item.transaction_date),
    ...((cashRes.data ?? []) as { entry_date: string | null }[]).map((item) => item.entry_date),
    ...((dividendsRes.data ?? []) as { payment_date: string | null }[]).map((item) => item.payment_date),
    ...((bondsRes.data ?? []) as { purchase_date: string | null }[]).map((item) => item.purchase_date),
  ])
}

function groupPrices(rows: MarketPriceRow[]) {
  const byAsset = new Map<string, MarketPriceRow[]>()
  for (const row of rows) {
    const current = byAsset.get(row.asset_id) ?? []
    current.push(row)
    byAsset.set(row.asset_id, current)
  }

  for (const [assetId, assetRows] of byAsset.entries()) {
    byAsset.set(assetId, assetRows.sort((a, b) => {
      const byDate = a.price_date.localeCompare(b.price_date)
      if (byDate !== 0) return byDate
      return a.fetched_at.localeCompare(b.fetched_at)
    }))
  }

  return byAsset
}

function groupFxRates(rows: FxRateRow[]) {
  const byPair = new Map<string, FxRateRow[]>()
  for (const row of rows) {
    const key = `${row.from_currency.toUpperCase()}:${row.to_currency.toUpperCase()}`
    const current = byPair.get(key) ?? []
    current.push(row)
    byPair.set(key, current)
  }

  for (const [key, pairRows] of byPair.entries()) {
    byPair.set(key, pairRows.sort((a, b) => a.rate_date.localeCompare(b.rate_date)))
  }

  return byPair
}

function closestFxRate(fxByPair: Map<string, FxRateRow[]>, fromCurrency: string, toCurrency: string, date: string) {
  if (fromCurrency === toCurrency) return 1
  const rows = fxByPair.get(`${fromCurrency}:${toCurrency}`) ?? []
  let left = 0
  let right = rows.length - 1
  let match: FxRateRow | null = null

  while (left <= right) {
    const middle = Math.floor((left + right) / 2)
    const row = rows[middle]
    if (row.rate_date <= date) {
      match = row
      left = middle + 1
    } else {
      right = middle - 1
    }
  }

  if (!match) return null

  const ageDays = fxDaysBetween(match.rate_date, date)
  if (ageDays < 0 || ageDays > FX_PREVIOUS_LOOKBACK_DAYS) return null
  return num(match.rate)
}

function basePrice(row: MarketPriceRow, baseCurrency: string, fxByPair: Map<string, FxRateRow[]>) {
  const rowBase = (row.base_currency ?? '').toUpperCase() || baseCurrency
  const sourceCurrency = (row.source_currency ?? rowBase).toUpperCase() || baseCurrency
  const closePrice = num(row.close_price)
  const closePriceBase = num(row.close_price_base)
  const fxRateToBase = num(row.fx_rate_to_base)

  if (rowBase === baseCurrency && closePriceBase > 0) return closePriceBase
  if (sourceCurrency === baseCurrency && closePrice > 0) return closePrice
  if (rowBase === baseCurrency && fxRateToBase > 0 && closePrice > 0) return closePrice * fxRateToBase

  const fx = closestFxRate(fxByPair, sourceCurrency, baseCurrency, row.price_date)
  if (fx && closePrice > 0) return closePrice * fx
  return null
}

async function fetchInputs(supabase: ServerSupabase, portfolioId: string, startDate: string, endDate: string) {
  const priceStartDate = addDays(startDate, -PRICE_LOOKBACK_DAYS)
  const [
    portfolioRes,
    assetsRes,
    transactionsRes,
    cashRes,
    dividendsRes,
    bondsRes,
    benchmarkRes,
    existingSnapshotRes,
    marketPriceRes,
    fxRateRes,
  ] = await Promise.all([
    supabase.from('portfolios').select('id,user_id,name,currency').eq('id', portfolioId).single(),
    supabase.from('assets').select('id,portfolio_id,symbol,name,asset_type,currency,target_allocation,market_symbol,price_source,auto_refresh_enabled,created_at').eq('portfolio_id', portfolioId).limit(5000),
    supabase.from('transactions').select(BACKFILL_TRANSACTION_SELECT).eq('portfolio_id', portfolioId).lte('transaction_date', endDate).limit(50000),
    supabase.from('cash_ledger_entries').select('id,portfolio_id,entry_type,amount,currency,entry_date,note,created_at,updated_at').eq('portfolio_id', portfolioId).lte('entry_date', endDate).limit(50000),
    supabase.from('dividends').select('id,portfolio_id,asset_id,payment_date,gross_amount,tax_amount,net_amount,currency,note,created_at,updated_at').eq('portfolio_id', portfolioId).lte('payment_date', endDate).limit(50000),
    supabase.from('edo_bonds').select('id,portfolio_id,series,quantity,purchase_price,purchase_date,interest_first_year,inflation_margin,maturity_date,created_at').eq('portfolio_id', portfolioId).limit(5000),
    supabase.from('portfolio_benchmarks').select('portfolio_id,benchmark_asset_id,created_at,updated_at').eq('portfolio_id', portfolioId).maybeSingle(),
    supabase.from('portfolio_snapshots').select('snapshot_date').eq('portfolio_id', portfolioId).gte('snapshot_date', startDate).lte('snapshot_date', endDate).limit(10000),
    supabase.from('market_prices').select('asset_id,price_date,close_price,close_price_base,source_currency,base_currency,fx_rate_to_base,fetched_at').eq('portfolio_id', portfolioId).gte('price_date', priceStartDate).lte('price_date', endDate).order('price_date', { ascending: true }).limit(60000),
    supabase.from('fx_rates').select('from_currency,to_currency,rate_date,rate').lte('rate_date', endDate).order('rate_date', { ascending: true }).limit(60000),
  ])

  if (portfolioRes.error) throw new Error(`portfolios: ${portfolioRes.error.message}`)
  if (assetsRes.error) throw new Error(`assets: ${assetsRes.error.message}`)
  if (transactionsRes.error) throw new Error(`transactions: ${transactionsRes.error.message}`)
  if (cashRes.error) throw new Error(`cash_ledger_entries: ${cashRes.error.message}`)
  if (dividendsRes.error) throw new Error(`dividends: ${dividendsRes.error.message}`)
  if (bondsRes.error) throw new Error(`edo_bonds: ${bondsRes.error.message}`)
  if (benchmarkRes.error) throw new Error(`portfolio_benchmarks: ${benchmarkRes.error.message}`)
  if (existingSnapshotRes.error) throw new Error(`portfolio_snapshots: ${existingSnapshotRes.error.message}`)
  if (marketPriceRes.error) throw new Error(`market_prices: ${marketPriceRes.error.message}`)
  if (fxRateRes.error) throw new Error(`fx_rates: ${fxRateRes.error.message}`)

  return {
    portfolio: portfolioRes.data as Portfolio,
    assets: (assetsRes.data ?? []) as Asset[],
    transactions: (transactionsRes.data ?? []) as Transaction[],
    cashEntries: (cashRes.data ?? []) as CashLedgerEntry[],
    dividends: (dividendsRes.data ?? []) as DividendRecord[],
    bonds: (bondsRes.data ?? []) as EdoBond[],
    benchmark: benchmarkRes.data as PortfolioBenchmark | null,
    existingSnapshotDates: new Set((existingSnapshotRes.data ?? []).map((row: { snapshot_date: string }) => row.snapshot_date)),
    marketPrices: (marketPriceRes.data ?? []) as MarketPriceRow[],
    fxRates: (fxRateRes.data ?? []) as FxRateRow[],
  }
}

function pickDatesToProcess(allDates: string[], existingDates: Set<string>) {
  const missingDates = allDates.filter((date) => !existingDates.has(date))
  const source = missingDates.length > 0 ? missingDates : allDates
  const selected = source.slice(-MAX_SNAPSHOT_DAYS_PER_REQUEST)
  return {
    selected,
    skippedExistingDays: missingDates.length > 0 ? allDates.length - missingDates.length : 0,
    remainingDays: Math.max(0, source.length - selected.length),
  }
}

function statusFor(report: Omit<PortfolioHistoryBackfillReport, 'ok' | 'status' | 'portfolioId' | 'range' | 'startDate' | 'endDate' | 'error'>): PortfolioHistoryBackfillReport['status'] {
  if (report.processedDays === 0) return 'skipped'
  if (report.generatedSnapshots === 0 && report.skippedNoActivityDays === report.processedDays) return 'skipped'
  if (report.generatedSnapshots === 0 && (report.skippedMissingPriceDays > 0 || report.errorDays.length > 0)) return 'failed'
  if (report.remainingDays > 0 || report.skippedMissingPriceDays > 0 || report.errorDays.length > 0) return 'partial_success'
  return 'success'
}

export async function runPortfolioHistoryBackfill(options: {
  portfolioId: string
  range: BackfillRange
}): Promise<PortfolioHistoryBackfillReport> {
  const supabase = getServerSupabase()
  if (!supabase) throw new Error('Brak SUPABASE_SERVICE_ROLE_KEY dla portfolio history backfill.')

  const endDate = today()
  const earliestActivity = await fetchEarliestActivityDate(supabase, options.portfolioId, endDate)
  const startDate = startDateForRange(options.range, earliestActivity)

  if (!startDate) {
    return {
      ok: true,
      status: 'skipped',
      portfolioId: options.portfolioId,
      range: options.range,
      startDate: null,
      endDate,
      requestedDays: 0,
      processedDays: 0,
      generatedSnapshots: 0,
      skippedExistingDays: 0,
      skippedNoActivityDays: 0,
      skippedMissingPriceDays: 0,
      remainingDays: 0,
      skippedDays: [],
      errorDays: [],
    }
  }

  const inputs = await fetchInputs(supabase, options.portfolioId, startDate, endDate)
  const allDates = datesBetween(startDate, endDate)
  const { selected, skippedExistingDays, remainingDays } = pickDatesToProcess(allDates, inputs.existingSnapshotDates)
  const pricesByAsset = groupPrices(inputs.marketPrices)
  const fxByPair = groupFxRates(inputs.fxRates)
  const pricePointers = new Map<string, number>()
  const latestBasePriceByAsset = new Map<string, number>()
  const baseCurrency = (inputs.portfolio.currency ?? 'PLN').toUpperCase()
  const payloads: Record<string, unknown>[] = []
  const skippedDays: PortfolioHistoryBackfillReport['skippedDays'] = []
  const errorDays: PortfolioHistoryBackfillReport['errorDays'] = []
  let skippedNoActivityDays = 0
  let skippedMissingPriceDays = 0

  for (const date of selected) {
    try {
      for (const [assetId, rows] of pricesByAsset.entries()) {
        let pointer = pricePointers.get(assetId) ?? -1
        while (pointer + 1 < rows.length && rows[pointer + 1].price_date <= date) {
          pointer += 1
          const value = basePrice(rows[pointer], baseCurrency, fxByPair)
          if (value != null && value > 0) latestBasePriceByAsset.set(assetId, value)
        }
        pricePointers.set(assetId, pointer)
      }

      const transactions = inputs.transactions.filter((item) => item.transaction_date <= date)
      const cashEntries = inputs.cashEntries.filter((item) => item.entry_date <= date)
      const dividends = inputs.dividends.filter((item) => item.payment_date <= date)
      const edoPrincipal = bondPrincipal(inputs.bonds, date)

      if (transactions.length === 0 && cashEntries.length === 0 && dividends.length === 0 && edoPrincipal <= 0) {
        skippedNoActivityDays += 1
        if (skippedDays.length < MAX_REPORTED_DAYS) skippedDays.push({ date, reason: 'No transactions, cash ledger entries, dividends, or bonds yet.' })
        continue
      }

      const skeletonPositions = buildPositions(inputs.assets, transactions, [])
      const openMarketPositions = skeletonPositions.filter((position) => position.quantity > 0.00000001 && isMarketPricedAsset(position.asset))
      const missingPriceSymbols = openMarketPositions
        .filter((position) => !latestBasePriceByAsset.has(position.asset.id))
        .map((position) => position.asset.symbol)

      if (missingPriceSymbols.length > 0) {
        skippedMissingPriceDays += 1
        if (skippedDays.length < MAX_REPORTED_DAYS) skippedDays.push({ date, reason: `Missing historical price for ${missingPriceSymbols.join(', ')}` })
        continue
      }

      const historicalPrices: AssetPrice[] = openMarketPositions.map((position) => ({
        id: `${position.asset.id}-${date}`,
        portfolio_id: options.portfolioId,
        asset_id: position.asset.id,
        price: latestBasePriceByAsset.get(position.asset.id) ?? 0,
        currency: baseCurrency,
        priced_at: `${date}T18:00:00.000Z`,
      }))
      const positions = buildPositions(inputs.assets, transactions, historicalPrices)
      const summary = portfolioSummary(positions)
      const cashSummary = summarizeCashLedger(cashEntries, baseCurrency)
      const dividendSummary = summarizeDividends(dividends, baseCurrency)
      const transactionFees = transactions.reduce((sum, transaction) => sum + transactionFeeBase(transaction), 0)
      const positionsValue = summary.totalValue
      const cashValue = cashSummary.cashBalanceBase
      const totalValue = positionsValue + edoPrincipal + cashValue
      const feesValue = cashSummary.feesBase + transactionFees
      const taxesValue = cashSummary.taxesBase + dividendSummary.taxBase
      const realizedPnl = summary.realizedPnl + dividendSummary.netBase - cashSummary.feesBase - cashSummary.taxesBase
      const unrealizedPnl = summary.unrealizedPnl
      const contributionFallback = summary.investedCost + edoPrincipal
      const hasCashLedgerFlow = cashEntries.some((entry) => entry.entry_type === 'deposit' || entry.entry_type === 'withdrawal')
      const contribution = hasCashLedgerFlow ? cashSummary.contributionBase : contributionFallback

      payloads.push({
        portfolio_id: options.portfolioId,
        snapshot_date: date,
        base_currency: baseCurrency,
        total_value: totalValue,
        positions_value: positionsValue,
        edo_value: edoPrincipal,
        cash_value: cashValue,
        invested_cost: summary.investedCost + edoPrincipal,
        remaining_cost: summary.remainingCost + edoPrincipal,
        realized_pnl: realizedPnl,
        unrealized_pnl: unrealizedPnl,
        total_pnl: realizedPnl + unrealizedPnl,
        net_cash_flow: cashSummary.netCashFlowBase !== 0 ? cashSummary.netCashFlowBase : contribution,
        contribution,
        dividends_value: dividendSummary.netBase,
        fees_value: feesValue,
        taxes_value: taxesValue,
        allocation_breakdown: buildAllocationBreakdown(positions, edoPrincipal, cashValue, totalValue),
        benchmark_asset_id: inputs.benchmark?.benchmark_asset_id ?? null,
        source: 'historical_backfill',
        calculated_at: new Date().toISOString(),
      })
    } catch (err: any) {
      errorDays.push({ date, error: err?.message ?? 'Snapshot valuation failed.' })
    }
  }

  let generatedSnapshots = 0
  for (const part of chunk(payloads, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase
      .from('portfolio_snapshots')
      .upsert(part, { onConflict: 'portfolio_id,snapshot_date' })

    if (error) throw new Error(`portfolio_snapshots: ${error.message}`)
    generatedSnapshots += part.length
  }

  const core = {
    requestedDays: allDates.length,
    processedDays: selected.length,
    generatedSnapshots,
    skippedExistingDays,
    skippedNoActivityDays,
    skippedMissingPriceDays,
    remainingDays,
    skippedDays,
    errorDays,
  }
  const status = statusFor(core)

  return {
    ok: status === 'success' || status === 'partial_success' || status === 'skipped',
    status,
    portfolioId: options.portfolioId,
    range: options.range,
    startDate,
    endDate,
    ...core,
    error: status === 'failed' ? 'Nie udało się wygenerować żadnych historycznych snapshotów.' : undefined,
  }
}
