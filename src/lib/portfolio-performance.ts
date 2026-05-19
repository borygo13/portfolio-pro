import type { MarketPriceHistoryPoint, PortfolioSnapshot } from '@/lib/supabase/portfolio'

export type ReturnPeriodKey = 'MTD' | 'YTD' | '1Y' | '3Y' | 'MAX'

export type ReturnPeriod = {
  key: ReturnPeriodKey
  label: string
  available: boolean
  returnPct: number | null
  startDate: string | null
  endDate: string | null
  reason?: string
}

export type IndexedReturnPoint = {
  date: string
  label: string
  portfolio: number
}

export type MonthlyReturnCell = {
  key: string
  year: string
  month: number
  monthLabel: string
  startDate: string
  endDate: string
  startValue: number
  endValue: number
  cashFlow: number
  returnPct: number
}

export type YearlyReturnPoint = {
  year: string
  startDate: string
  endDate: string
  returnPct: number
}

export type DrawdownPoint = {
  date: string
  label: string
  drawdownPct: number
}

export type PortfolioPerformance = {
  snapshots: PortfolioSnapshot[]
  indexedSeries: IndexedReturnPoint[]
  drawdownSeries: DrawdownPoint[]
  periods: ReturnPeriod[]
  monthlyReturns: MonthlyReturnCell[]
  yearlyReturns: YearlyReturnPoint[]
  totalReturnPct: number | null
  maxDrawdownPct: number | null
  maxDrawdownDate: string | null
  volatilityPct: number | null
  bestMonth: MonthlyReturnCell | null
  worstMonth: MonthlyReturnCell | null
}

export type BenchmarkComparisonPoint = {
  date: string
  month: string
  portfolio: number
  benchmark: number
}

export type BenchmarkPerformance = {
  available: boolean
  points: BenchmarkComparisonPoint[]
  overlapStartDate: string | null
  overlapEndDate: string | null
  portfolioReturnPct: number | null
  benchmarkReturnPct: number | null
  relativeReturnPct: number | null
  trackingDifferencePct: number | null
  message?: string
}

const PERIODS: { key: ReturnPeriodKey; label: string }[] = [
  { key: 'MTD', label: 'MTD' },
  { key: 'YTD', label: 'YTD' },
  { key: '1Y', label: '1Y' },
  { key: '3Y', label: '3Y' },
  { key: 'MAX', label: 'MAX' },
]

const MONTH_LABELS = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru']
const DAY_MS = 24 * 60 * 60 * 1000

function n(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function sortSnapshots(snapshots: PortfolioSnapshot[]) {
  return snapshots
    .filter((snapshot) => n(snapshot.total_value) > 0)
    .slice()
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
}

function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', year: '2-digit' })
}

function addYears(date: Date, years: number) {
  const copy = new Date(date)
  copy.setUTCFullYear(copy.getUTCFullYear() + years)
  return copy
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function monthKey(date: string) {
  return date.slice(0, 7)
}

function yearKey(date: string) {
  return date.slice(0, 4)
}

function daysBetween(start: string, end: string) {
  return Math.max(0, (new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / DAY_MS)
}

function snapshotReturn(start: PortfolioSnapshot, end: PortfolioSnapshot) {
  const startValue = n(start.total_value)
  const endValue = n(end.total_value)
  if (startValue <= 0 || endValue <= 0 || start.snapshot_date === end.snapshot_date) return null
  const cashFlow = n(end.contribution) - n(start.contribution)
  const value = (endValue - startValue - cashFlow) / startValue
  return Number.isFinite(value) ? value : null
}

function periodStart(key: ReturnPeriodKey, endDate: string) {
  const end = new Date(`${endDate}T00:00:00.000Z`)
  if (key === 'MAX') return null
  if (key === 'MTD') return `${endDate.slice(0, 7)}-01`
  if (key === 'YTD') return `${end.getUTCFullYear()}-01-01`
  if (key === '1Y') return formatDate(addYears(end, -1))
  return formatDate(addYears(end, -3))
}

function periodCoverageToleranceDays(key: ReturnPeriodKey) {
  if (key === 'MTD') return 7
  if (key === 'YTD') return 31
  if (key === '1Y' || key === '3Y') return 45
  return 0
}

function firstOnOrAfter(snapshots: PortfolioSnapshot[], date: string) {
  return snapshots.find((snapshot) => snapshot.snapshot_date >= date) ?? null
}

function periodReturn(snapshots: PortfolioSnapshot[], key: ReturnPeriodKey): ReturnPeriod {
  const meta = PERIODS.find((period) => period.key === key) ?? { key, label: key }
  if (snapshots.length < 2) {
    return { ...meta, available: false, returnPct: null, startDate: null, endDate: null, reason: 'Need at least two snapshots.' }
  }

  const latest = snapshots[snapshots.length - 1]
  const requestedStart = periodStart(key, latest.snapshot_date)
  const start = requestedStart ? firstOnOrAfter(snapshots, requestedStart) : snapshots[0]
  if (!start || start.snapshot_date === latest.snapshot_date) {
    return { ...meta, available: false, returnPct: null, startDate: start?.snapshot_date ?? requestedStart, endDate: latest.snapshot_date, reason: 'Not enough snapshots in this period.' }
  }
  if (requestedStart && daysBetween(requestedStart, start.snapshot_date) > periodCoverageToleranceDays(key)) {
    return {
      ...meta,
      available: false,
      returnPct: null,
      startDate: start.snapshot_date,
      endDate: latest.snapshot_date,
      reason: `Need snapshots closer to ${requestedStart}.`,
    }
  }

  const returnPct = snapshotReturn(start, latest)
  return {
    ...meta,
    available: returnPct != null,
    returnPct,
    startDate: start.snapshot_date,
    endDate: latest.snapshot_date,
    reason: returnPct == null ? 'Period return is unavailable.' : undefined,
  }
}

function indexedSeries(snapshots: PortfolioSnapshot[]): IndexedReturnPoint[] {
  if (snapshots.length === 0) return []
  const first = snapshots[0]
  const baseValue = n(first.total_value)
  const baseContribution = n(first.contribution)
  if (baseValue <= 0) return []

  return snapshots.flatMap((snapshot) => {
    const adjustedReturn = (n(snapshot.total_value) - baseValue - (n(snapshot.contribution) - baseContribution)) / baseValue
    if (!Number.isFinite(adjustedReturn)) return []
    return [{
      date: snapshot.snapshot_date,
      label: dateLabel(snapshot.snapshot_date),
      portfolio: (1 + adjustedReturn) * 100,
    }]
  })
}

function monthlyReturns(snapshots: PortfolioSnapshot[]): MonthlyReturnCell[] {
  const byMonth = new Map<string, PortfolioSnapshot[]>()
  for (const snapshot of snapshots) {
    const key = monthKey(snapshot.snapshot_date)
    const current = byMonth.get(key) ?? []
    current.push(snapshot)
    byMonth.set(key, current)
  }

  return Array.from(byMonth.entries()).flatMap(([key, items]) => {
    if (items.length < 2) return []
    const start = items[0]
    const end = items[items.length - 1]
    const returnPct = snapshotReturn(start, end)
    if (returnPct == null) return []
    const month = Number(key.slice(5, 7))
    return [{
      key,
      year: key.slice(0, 4),
      month,
      monthLabel: MONTH_LABELS[month - 1] ?? key,
      startDate: start.snapshot_date,
      endDate: end.snapshot_date,
      startValue: n(start.total_value),
      endValue: n(end.total_value),
      cashFlow: n(end.contribution) - n(start.contribution),
      returnPct,
    }]
  })
}

function yearlyReturns(snapshots: PortfolioSnapshot[]): YearlyReturnPoint[] {
  const byYear = new Map<string, PortfolioSnapshot[]>()
  for (const snapshot of snapshots) {
    const key = yearKey(snapshot.snapshot_date)
    const current = byYear.get(key) ?? []
    current.push(snapshot)
    byYear.set(key, current)
  }

  return Array.from(byYear.entries()).flatMap(([year, items]) => {
    if (items.length < 2) return []
    const start = items[0]
    const end = items[items.length - 1]
    const returnPct = snapshotReturn(start, end)
    if (returnPct == null) return []
    return [{ year, startDate: start.snapshot_date, endDate: end.snapshot_date, returnPct }]
  })
}

function drawdowns(series: IndexedReturnPoint[]) {
  let peak = 0
  let maxDrawdownPct: number | null = null
  let maxDrawdownDate: string | null = null
  const points: DrawdownPoint[] = []

  for (const point of series) {
    peak = Math.max(peak, point.portfolio)
    const drawdownPct = peak > 0 ? point.portfolio / peak - 1 : 0
    points.push({ date: point.date, label: point.label, drawdownPct })
    if (maxDrawdownPct == null || drawdownPct < maxDrawdownPct) {
      maxDrawdownPct = drawdownPct
      maxDrawdownDate = point.date
    }
  }

  return { points, maxDrawdownPct, maxDrawdownDate }
}

function volatility(series: IndexedReturnPoint[]) {
  if (series.length < 10) return null
  const returns: number[] = []
  for (let i = 1; i < series.length; i += 1) {
    const previous = series[i - 1].portfolio
    const current = series[i].portfolio
    if (previous > 0) returns.push(current / previous - 1)
  }
  if (returns.length < 10) return null

  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / (returns.length - 1)
  const daily = Math.sqrt(Math.max(0, variance))
  return Number.isFinite(daily) ? daily * Math.sqrt(252) : null
}

export function buildPortfolioPerformance(snapshots: PortfolioSnapshot[]): PortfolioPerformance {
  const sorted = sortSnapshots(snapshots)
  const series = indexedSeries(sorted)
  const monthly = monthlyReturns(sorted)
  const drawdown = drawdowns(series)
  const bestMonth = monthly.length > 0 ? monthly.reduce((best, item) => item.returnPct > best.returnPct ? item : best, monthly[0]) : null
  const worstMonth = monthly.length > 0 ? monthly.reduce((worst, item) => item.returnPct < worst.returnPct ? item : worst, monthly[0]) : null

  return {
    snapshots: sorted,
    indexedSeries: series,
    drawdownSeries: drawdown.points,
    periods: PERIODS.map((period) => periodReturn(sorted, period.key)),
    monthlyReturns: monthly,
    yearlyReturns: yearlyReturns(sorted),
    totalReturnPct: periodReturn(sorted, 'MAX').returnPct,
    maxDrawdownPct: drawdown.maxDrawdownPct,
    maxDrawdownDate: drawdown.maxDrawdownDate,
    volatilityPct: volatility(series),
    bestMonth,
    worstMonth,
  }
}

function benchmarkValue(point: MarketPriceHistoryPoint) {
  const value = n(point.close_price_base ?? point.close_price)
  return value > 0 ? value : null
}

function closestBenchmarkPoint(history: MarketPriceHistoryPoint[], date: string, startIndex: number) {
  let index = startIndex
  while (index < history.length - 1 && history[index + 1].price_date <= date) index += 1
  const point = history[index]
  if (!point || point.price_date > date || daysBetween(point.price_date, date) > 10) return { point: null, index }
  return { point, index }
}

export function buildBenchmarkPerformance(snapshots: PortfolioSnapshot[], benchmarkHistory: MarketPriceHistoryPoint[]): BenchmarkPerformance {
  const sortedSnapshots = sortSnapshots(snapshots)
  const sortedBenchmark = benchmarkHistory
    .filter((point) => benchmarkValue(point) != null)
    .slice()
    .sort((a, b) => a.price_date.localeCompare(b.price_date))

  if (sortedSnapshots.length < 2 || sortedBenchmark.length < 2) {
    return {
      available: false,
      points: [],
      overlapStartDate: null,
      overlapEndDate: null,
      portfolioReturnPct: null,
      benchmarkReturnPct: null,
      relativeReturnPct: null,
      trackingDifferencePct: null,
      message: 'Need at least two portfolio snapshots and two benchmark price points.',
    }
  }

  const matched: { snapshot: PortfolioSnapshot; benchmark: MarketPriceHistoryPoint; benchmarkPrice: number }[] = []
  let benchmarkIndex = 0

  for (const snapshot of sortedSnapshots) {
    const match = closestBenchmarkPoint(sortedBenchmark, snapshot.snapshot_date, benchmarkIndex)
    benchmarkIndex = match.index
    if (!match.point) continue
    const price = benchmarkValue(match.point)
    if (price == null) continue
    matched.push({ snapshot, benchmark: match.point, benchmarkPrice: price })
  }

  if (matched.length < 2) {
    return {
      available: false,
      points: [],
      overlapStartDate: matched[0]?.snapshot.snapshot_date ?? null,
      overlapEndDate: matched[matched.length - 1]?.snapshot.snapshot_date ?? null,
      portfolioReturnPct: null,
      benchmarkReturnPct: null,
      relativeReturnPct: null,
      trackingDifferencePct: null,
      message: 'Not enough overlapping portfolio and benchmark history yet.',
    }
  }

  const first = matched[0]
  const last = matched[matched.length - 1]
  if (daysBetween(first.snapshot.snapshot_date, last.snapshot.snapshot_date) < 30) {
    return {
      available: false,
      points: [],
      overlapStartDate: first.snapshot.snapshot_date,
      overlapEndDate: last.snapshot.snapshot_date,
      portfolioReturnPct: null,
      benchmarkReturnPct: null,
      relativeReturnPct: null,
      trackingDifferencePct: null,
      message: 'Need at least 30 days of overlapping portfolio and benchmark history.',
    }
  }

  const basePortfolio = n(first.snapshot.total_value)
  const baseContribution = n(first.snapshot.contribution)
  const baseBenchmark = first.benchmarkPrice
  const points = matched.flatMap((item) => {
    const portfolioReturn = (n(item.snapshot.total_value) - basePortfolio - (n(item.snapshot.contribution) - baseContribution)) / basePortfolio
    const benchmarkReturn = item.benchmarkPrice / baseBenchmark - 1
    if (!Number.isFinite(portfolioReturn) || !Number.isFinite(benchmarkReturn)) return []
    return [{
      date: item.snapshot.snapshot_date,
      month: dateLabel(item.snapshot.snapshot_date),
      portfolio: (1 + portfolioReturn) * 100,
      benchmark: (1 + benchmarkReturn) * 100,
    }]
  })

  if (points.length < 2) {
    return {
      available: false,
      points: [],
      overlapStartDate: first.snapshot.snapshot_date,
      overlapEndDate: last.snapshot.snapshot_date,
      portfolioReturnPct: null,
      benchmarkReturnPct: null,
      relativeReturnPct: null,
      trackingDifferencePct: null,
      message: 'Benchmark comparison has too few valid normalized points.',
    }
  }

  const portfolioReturnPct = points[points.length - 1].portfolio / 100 - 1
  const benchmarkReturnPct = points[points.length - 1].benchmark / 100 - 1
  const pointDiffs = points.map((point) => (point.portfolio - point.benchmark) / 100)
  const trackingDifferencePct = pointDiffs.reduce((sum, value) => sum + value, 0) / pointDiffs.length

  return {
    available: true,
    points,
    overlapStartDate: first.snapshot.snapshot_date,
    overlapEndDate: last.snapshot.snapshot_date,
    portfolioReturnPct,
    benchmarkReturnPct,
    relativeReturnPct: portfolioReturnPct - benchmarkReturnPct,
    trackingDifferencePct,
  }
}
