import type { Position } from '@/lib/position-engine'
import type {
  Asset,
  CashLedgerEntry,
  DividendRecord,
  MarketPriceHistoryPoint,
  PortfolioSnapshot,
  SupportedCashCurrency,
} from '@/lib/supabase/portfolio'

export type CurrencyTotals = Record<SupportedCashCurrency, number>

export type CashLedgerSummary = {
  balanceByCurrency: CurrencyTotals
  contributionByCurrency: CurrencyTotals
  feesByCurrency: CurrencyTotals
  taxesByCurrency: CurrencyTotals
  netCashFlowByCurrency: CurrencyTotals
  baseCurrency: SupportedCashCurrency
  cashBalanceBase: number
  contributionBase: number
  feesBase: number
  taxesBase: number
  netCashFlowBase: number
}

export type DividendSummary = {
  grossByCurrency: CurrencyTotals
  taxByCurrency: CurrencyTotals
  netByCurrency: CurrencyTotals
  baseCurrency: SupportedCashCurrency
  grossBase: number
  taxBase: number
  netBase: number
}

export type MonthlyPoint = {
  month: string
  gross: number
  tax: number
  net: number
}

export type MonthlyReturnPoint = {
  month: string
  startValue: number
  endValue: number
  cashFlow: number
  returnPct: number
}

export type PerformanceMetrics = {
  totalReturnAmount: number
  totalReturnPct: number | null
  realizedPnl: number
  unrealizedPnl: number
  contribution: number
  monthlyReturnPct: number | null
  ytdReturnPct: number | null
  maxDrawdownPct: number | null
}

export type BenchmarkPoint = {
  month: string
  portfolio: number
  benchmark: number
}

export type AllocationDriftItem = {
  name: string
  type: string
  currentValue: number
  currentPct: number
  targetPct: number
  driftPct: number
  suggestedDirection: 'buy' | 'trim' | 'hold'
  suggestedAmount: number
}

export type AllocationBreakdownItem = {
  name: string
  type: string
  value: number
  pct: number
}

const SUPPORTED_CURRENCIES: SupportedCashCurrency[] = ['PLN', 'EUR', 'USD']

function emptyCurrencyTotals(): CurrencyTotals {
  return { PLN: 0, EUR: 0, USD: 0 }
}

export function num(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function asSupportedCurrency(value: string | null | undefined, fallback: SupportedCashCurrency = 'PLN'): SupportedCashCurrency {
  return SUPPORTED_CURRENCIES.includes(value as SupportedCashCurrency) ? value as SupportedCashCurrency : fallback
}

function monthKey(value: string) {
  return value.slice(0, 7)
}

function monthLabel(value: string) {
  const date = new Date(`${value}-01T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('pl-PL', { month: 'short', year: '2-digit' })
}

function snapshotDateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('pl-PL', { month: 'short', day: '2-digit' })
}

export function isMarketPricedAsset(asset: Asset) {
  const type = (asset.asset_type ?? '').toLowerCase()
  return !type.includes('got') && !type.includes('oblig')
}

export function summarizeCashLedger(entries: CashLedgerEntry[], baseCurrency = 'PLN'): CashLedgerSummary {
  const base = asSupportedCurrency(baseCurrency)
  const balanceByCurrency = emptyCurrencyTotals()
  const contributionByCurrency = emptyCurrencyTotals()
  const feesByCurrency = emptyCurrencyTotals()
  const taxesByCurrency = emptyCurrencyTotals()
  const netCashFlowByCurrency = emptyCurrencyTotals()

  for (const entry of entries) {
    const currency = asSupportedCurrency(entry.currency, base)
    const amount = num(entry.amount)
    if (amount <= 0) continue

    if (entry.entry_type === 'deposit') {
      balanceByCurrency[currency] += amount
      contributionByCurrency[currency] += amount
      netCashFlowByCurrency[currency] += amount
    }

    if (entry.entry_type === 'withdrawal') {
      balanceByCurrency[currency] -= amount
      contributionByCurrency[currency] -= amount
      netCashFlowByCurrency[currency] -= amount
    }

    if (entry.entry_type === 'fee') {
      balanceByCurrency[currency] -= amount
      feesByCurrency[currency] += amount
      netCashFlowByCurrency[currency] -= amount
    }

    if (entry.entry_type === 'tax') {
      balanceByCurrency[currency] -= amount
      taxesByCurrency[currency] += amount
      netCashFlowByCurrency[currency] -= amount
    }

    if (entry.entry_type === 'adjustment') {
      balanceByCurrency[currency] += amount
      netCashFlowByCurrency[currency] += amount
    }
  }

  return {
    balanceByCurrency,
    contributionByCurrency,
    feesByCurrency,
    taxesByCurrency,
    netCashFlowByCurrency,
    baseCurrency: base,
    cashBalanceBase: balanceByCurrency[base],
    contributionBase: contributionByCurrency[base],
    feesBase: feesByCurrency[base],
    taxesBase: taxesByCurrency[base],
    netCashFlowBase: netCashFlowByCurrency[base],
  }
}

export function summarizeDividends(dividends: DividendRecord[], baseCurrency = 'PLN'): DividendSummary {
  const base = asSupportedCurrency(baseCurrency)
  const grossByCurrency = emptyCurrencyTotals()
  const taxByCurrency = emptyCurrencyTotals()
  const netByCurrency = emptyCurrencyTotals()

  for (const dividend of dividends) {
    const currency = asSupportedCurrency(dividend.currency, base)
    grossByCurrency[currency] += num(dividend.gross_amount)
    taxByCurrency[currency] += num(dividend.tax_amount)
    netByCurrency[currency] += num(dividend.net_amount)
  }

  return {
    grossByCurrency,
    taxByCurrency,
    netByCurrency,
    baseCurrency: base,
    grossBase: grossByCurrency[base],
    taxBase: taxByCurrency[base],
    netBase: netByCurrency[base],
  }
}

export function buildMonthlyDividendPoints(dividends: DividendRecord[], baseCurrency = 'PLN'): MonthlyPoint[] {
  const base = asSupportedCurrency(baseCurrency)
  const byMonth = new Map<string, MonthlyPoint>()

  for (const dividend of dividends.filter((item) => asSupportedCurrency(item.currency, base) === base)) {
    const key = monthKey(dividend.received_date)
    const current = byMonth.get(key) ?? { month: monthLabel(key), gross: 0, tax: 0, net: 0 }
    current.gross += num(dividend.gross_amount)
    current.tax += num(dividend.tax_amount)
    current.net += num(dividend.net_amount)
    byMonth.set(key, current)
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, point]) => point)
}

export function buildMonthlyReturnPoints(snapshots: PortfolioSnapshot[]): MonthlyReturnPoint[] {
  const sorted = snapshots.slice().sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  const byMonth = new Map<string, PortfolioSnapshot[]>()

  for (const snapshot of sorted) {
    const key = monthKey(snapshot.snapshot_date)
    const current = byMonth.get(key) ?? []
    current.push(snapshot)
    byMonth.set(key, current)
  }

  return Array.from(byMonth.entries()).map(([key, items]) => {
    const first = items[0]
    const last = items[items.length - 1]
    const startValue = num(first.total_value)
    const endValue = num(last.total_value)
    const cashFlow = num(last.contribution) - num(first.contribution)
    const returnPct = startValue > 0 ? (endValue - startValue - cashFlow) / startValue : 0
    return { month: monthLabel(key), startValue, endValue, cashFlow, returnPct }
  })
}

export function calculateMaxDrawdown(snapshots: PortfolioSnapshot[]) {
  const values = snapshots
    .slice()
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
    .map((snapshot) => num(snapshot.total_value))
    .filter((value) => value > 0)

  if (values.length < 2) return null

  let peak = values[0]
  let maxDrawdown = 0
  for (const value of values) {
    peak = Math.max(peak, value)
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, (value - peak) / peak)
  }

  return maxDrawdown
}

export function calculatePerformanceMetrics(input: {
  snapshots: PortfolioSnapshot[]
  currentValue: number
  contribution: number
  fallbackCost: number
  realizedPnl: number
  unrealizedPnl: number
}): PerformanceMetrics {
  const sorted = input.snapshots.slice().sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  const latest = sorted[sorted.length - 1]
  const currentValue = latest ? num(latest.total_value) : input.currentValue
  const contribution = input.contribution || num(latest?.contribution) || input.fallbackCost
  const totalReturnAmount = contribution > 0 ? currentValue - contribution : input.realizedPnl + input.unrealizedPnl
  const totalReturnPct = contribution > 0 ? totalReturnAmount / contribution : null
  const monthlyReturns = buildMonthlyReturnPoints(sorted)
  const latestMonthlyReturn = monthlyReturns[monthlyReturns.length - 1]?.returnPct ?? null

  const currentYear = new Date().getFullYear().toString()
  const ytd = sorted.filter((snapshot) => snapshot.snapshot_date.startsWith(currentYear))
  let ytdReturnPct: number | null = null
  if (ytd.length >= 2) {
    const first = ytd[0]
    const last = ytd[ytd.length - 1]
    const startValue = num(first.total_value)
    const cashFlow = num(last.contribution) - num(first.contribution)
    ytdReturnPct = startValue > 0 ? (num(last.total_value) - startValue - cashFlow) / startValue : null
  }

  return {
    totalReturnAmount,
    totalReturnPct,
    realizedPnl: input.realizedPnl,
    unrealizedPnl: input.unrealizedPnl,
    contribution,
    monthlyReturnPct: latestMonthlyReturn,
    ytdReturnPct,
    maxDrawdownPct: calculateMaxDrawdown(sorted),
  }
}

export function buildBenchmarkComparison(snapshots: PortfolioSnapshot[], benchmarkHistory: MarketPriceHistoryPoint[]): BenchmarkPoint[] {
  const sortedSnapshots = snapshots.slice().sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  const sortedBenchmark = benchmarkHistory
    .slice()
    .sort((a, b) => a.price_date.localeCompare(b.price_date))
    .filter((point) => num(point.close_price_base ?? point.close_price) > 0)

  if (sortedSnapshots.length === 0 || sortedBenchmark.length === 0) return []

  const points: { snapshot: PortfolioSnapshot; benchmarkPrice: number }[] = []
  let benchmarkIndex = 0

  for (const snapshot of sortedSnapshots) {
    while (
      benchmarkIndex < sortedBenchmark.length - 1
      && sortedBenchmark[benchmarkIndex + 1].price_date <= snapshot.snapshot_date
    ) {
      benchmarkIndex += 1
    }

    const benchmark = sortedBenchmark[benchmarkIndex]
    if (benchmark.price_date <= snapshot.snapshot_date) {
      points.push({ snapshot, benchmarkPrice: num(benchmark.close_price_base ?? benchmark.close_price) })
    }
  }

  const first = points.find((point) => num(point.snapshot.total_value) > 0 && point.benchmarkPrice > 0)
  if (!first) return []

  const basePortfolio = num(first.snapshot.total_value)
  const baseBenchmark = first.benchmarkPrice

  return points.map((point) => ({
    month: snapshotDateLabel(point.snapshot.snapshot_date),
    portfolio: basePortfolio > 0 ? (num(point.snapshot.total_value) / basePortfolio) * 100 : 100,
    benchmark: baseBenchmark > 0 ? (point.benchmarkPrice / baseBenchmark) * 100 : 100,
  }))
}

export function buildAllocationBreakdown(positions: Position[], edoValue: number, cashValue: number, totalValue: number): AllocationBreakdownItem[] {
  const byType = new Map<string, AllocationBreakdownItem>()

  for (const position of positions.filter((item) => item.currentValue > 0)) {
    const key = position.asset.asset_type || 'Inne'
    const current = byType.get(key) ?? { name: key, type: key, value: 0, pct: 0 }
    current.value += position.currentValue
    byType.set(key, current)
  }

  if (edoValue > 0) byType.set('Obligacje EDO', { name: 'Obligacje EDO', type: 'Obligacje', value: edoValue, pct: 0 })
  if (cashValue > 0) byType.set('Gotówka', { name: 'Gotówka', type: 'Gotówka', value: cashValue, pct: 0 })

  return Array.from(byType.values())
    .map((item) => ({ ...item, pct: totalValue > 0 ? item.value / totalValue : 0 }))
    .sort((a, b) => b.value - a.value)
}

export function buildAllocationDrift(positions: Position[], edoValue: number, bondsTarget: number, cashValue: number, totalValue: number): AllocationDriftItem[] {
  const items: AllocationDriftItem[] = positions
    .filter((position) => position.currentValue > 0 || position.targetAllocation > 0)
    .map((position) => {
      const currentPct = totalValue > 0 ? position.currentValue / totalValue : 0
      const targetPct = position.targetAllocation / 100
      const driftPct = currentPct - targetPct
      const suggestedDirection = Math.abs(driftPct) < 0.01 ? 'hold' : driftPct < 0 ? 'buy' : 'trim'
      return {
        name: position.asset.symbol,
        type: position.asset.asset_type,
        currentValue: position.currentValue,
        currentPct,
        targetPct,
        driftPct,
        suggestedDirection,
        suggestedAmount: Math.abs(driftPct) * totalValue,
      }
    })

  if (edoValue > 0 || bondsTarget > 0) {
    const currentPct = totalValue > 0 ? edoValue / totalValue : 0
    const targetPct = bondsTarget / 100
    const driftPct = currentPct - targetPct
    items.push({
      name: 'Obligacje EDO',
      type: 'Obligacje',
      currentValue: edoValue,
      currentPct,
      targetPct,
      driftPct,
      suggestedDirection: Math.abs(driftPct) < 0.01 ? 'hold' : driftPct < 0 ? 'buy' : 'trim',
      suggestedAmount: Math.abs(driftPct) * totalValue,
    })
  }

  if (cashValue > 0) {
    items.push({
      name: 'Gotówka',
      type: 'Gotówka',
      currentValue: cashValue,
      currentPct: totalValue > 0 ? cashValue / totalValue : 0,
      targetPct: 0,
      driftPct: totalValue > 0 ? cashValue / totalValue : 0,
      suggestedDirection: 'trim',
      suggestedAmount: cashValue,
    })
  }

  return items.sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct))
}
