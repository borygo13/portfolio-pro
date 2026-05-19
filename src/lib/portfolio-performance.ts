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
  observationCount: number
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
  maxDrawdownReason: string | null
  volatilityPct: number | null
  volatilityReason: string | null
  indexedSeriesReason: string | null
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

type IntervalReturn = {
  valid: boolean
  startDate: string
  endDate: string
  startValue: number
  endValue: number
  cashFlow: number
  returnPct: number | null
  reason?: string
}

type ChainedReturnResult = {
  available: boolean
  returnPct: number | null
  startDate: string | null
  endDate: string | null
  observationCount: number
  cashFlow: number
  reason?: string
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
const EPS = 0.000001
const MIN_RETURN_BASE = 100
const MIN_INDEXED_OBSERVATIONS = 10
const MIN_DRAWDOWN_POINTS = 30
const MIN_VOLATILITY_OBSERVATIONS = 30
const MAX_INTERVAL_RETURN = 0.5
const MAX_MONTHLY_RETURN = 1.5
const MAX_PERIOD_RETURN = 5
const MAX_INVALID_INTERVAL_RATIO = 0.25
const MIN_BENCHMARK_OVERLAP_DAYS = 30

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
  const startTime = new Date(`${start}T00:00:00`).getTime()
  const endTime = new Date(`${end}T00:00:00`).getTime()
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0
  return Math.max(0, (endTime - startTime) / DAY_MS)
}

function cashFlowBetween(start: PortfolioSnapshot, end: PortfolioSnapshot) {
  const contributionDelta = n(end.contribution) - n(start.contribution)
  if (Math.abs(contributionDelta) > EPS) return contributionDelta

  const netCashFlow = n(end.net_cash_flow)
  if (Math.abs(netCashFlow) > EPS) return netCashFlow

  const investedCostDelta = n(end.invested_cost) - n(start.invested_cost)
  if (Math.abs(investedCostDelta) > EPS) return investedCostDelta

  return 0
}

function intervalReturn(start: PortfolioSnapshot, end: PortfolioSnapshot): IntervalReturn {
  const startValue = n(start.total_value)
  const endValue = n(end.total_value)
  const cashFlow = cashFlowBetween(start, end)

  if (start.snapshot_date === end.snapshot_date) {
    return { valid: false, startDate: start.snapshot_date, endDate: end.snapshot_date, startValue, endValue, cashFlow, returnPct: null, reason: 'Duplicate snapshot date.' }
  }
  if (startValue <= 0 || endValue <= 0) {
    return { valid: false, startDate: start.snapshot_date, endDate: end.snapshot_date, startValue, endValue, cashFlow, returnPct: null, reason: 'Portfolio value is missing.' }
  }

  const base = startValue + cashFlow * 0.5
  if (base < MIN_RETURN_BASE) {
    return { valid: false, startDate: start.snapshot_date, endDate: end.snapshot_date, startValue, endValue, cashFlow, returnPct: null, reason: 'Starting portfolio value is too low.' }
  }

  const returnPct = (endValue - startValue - cashFlow) / base
  if (!Number.isFinite(returnPct)) {
    return { valid: false, startDate: start.snapshot_date, endDate: end.snapshot_date, startValue, endValue, cashFlow, returnPct: null, reason: 'Return is not finite.' }
  }
  if (Math.abs(returnPct) > MAX_INTERVAL_RETURN) {
    return { valid: false, startDate: start.snapshot_date, endDate: end.snapshot_date, startValue, endValue, cashFlow, returnPct: null, reason: 'Interval return was suppressed by safety guard.' }
  }

  return { valid: true, startDate: start.snapshot_date, endDate: end.snapshot_date, startValue, endValue, cashFlow, returnPct }
}

function buildIntervals(snapshots: PortfolioSnapshot[]) {
  const intervals: IntervalReturn[] = []
  for (let index = 1; index < snapshots.length; index += 1) {
    intervals.push(intervalReturn(snapshots[index - 1], snapshots[index]))
  }
  return intervals
}

function minObservationsForPeriod(key: ReturnPeriodKey) {
  if (key === 'MTD') return 2
  if (key === 'YTD') return 8
  if (key === '1Y') return 20
  if (key === '3Y') return 40
  return 10
}

function minSpanForPeriod(key: ReturnPeriodKey) {
  if (key === 'MTD') return 2
  if (key === 'YTD') return 14
  if (key === '1Y') return 180
  if (key === '3Y') return 365
  return 14
}

function periodCoverageToleranceDays(key: ReturnPeriodKey) {
  if (key === 'MTD') return 7
  if (key === 'YTD') return 31
  if (key === '1Y' || key === '3Y') return 45
  return 0
}

function periodStart(key: ReturnPeriodKey, endDate: string) {
  const end = new Date(`${endDate}T00:00:00.000Z`)
  if (key === 'MAX') return null
  if (key === 'MTD') return `${endDate.slice(0, 7)}-01`
  if (key === 'YTD') return `${end.getUTCFullYear()}-01-01`
  if (key === '1Y') return formatDate(addYears(end, -1))
  return formatDate(addYears(end, -3))
}

function firstIndexOnOrAfter(snapshots: PortfolioSnapshot[], date: string) {
  const index = snapshots.findIndex((snapshot) => snapshot.snapshot_date >= date)
  return index >= 0 ? index : null
}

function chainIntervals(intervals: IntervalReturn[], maxAbsReturn: number): ChainedReturnResult {
  if (intervals.length === 0) {
    return { available: false, returnPct: null, startDate: null, endDate: null, observationCount: 0, cashFlow: 0, reason: 'Need more portfolio snapshots.' }
  }

  const valid = intervals.filter((interval) => interval.valid && interval.returnPct != null)
  const invalidRatio = (intervals.length - valid.length) / intervals.length
  if (valid.length === 0) {
    return { available: false, returnPct: null, startDate: null, endDate: null, observationCount: 0, cashFlow: 0, reason: intervals[0]?.reason ?? 'No valid contribution-adjusted intervals.' }
  }
  if (invalidRatio > MAX_INVALID_INTERVAL_RATIO) {
    return { available: false, returnPct: null, startDate: valid[0].startDate, endDate: valid[valid.length - 1].endDate, observationCount: valid.length, cashFlow: valid.reduce((sum, item) => sum + item.cashFlow, 0), reason: 'Too many sparse or cash-flow-dominated intervals.' }
  }

  let cumulative = 1
  for (const interval of valid) {
    cumulative *= 1 + (interval.returnPct ?? 0)
  }

  const returnPct = cumulative - 1
  if (!Number.isFinite(returnPct)) {
    return { available: false, returnPct: null, startDate: valid[0].startDate, endDate: valid[valid.length - 1].endDate, observationCount: valid.length, cashFlow: valid.reduce((sum, item) => sum + item.cashFlow, 0), reason: 'Return is not finite.' }
  }
  if (Math.abs(returnPct) > maxAbsReturn) {
    return { available: false, returnPct: null, startDate: valid[0].startDate, endDate: valid[valid.length - 1].endDate, observationCount: valid.length, cashFlow: valid.reduce((sum, item) => sum + item.cashFlow, 0), reason: 'Return suppressed because the estimate is too extreme.' }
  }

  return {
    available: true,
    returnPct,
    startDate: valid[0].startDate,
    endDate: valid[valid.length - 1].endDate,
    observationCount: valid.length,
    cashFlow: valid.reduce((sum, item) => sum + item.cashFlow, 0),
  }
}

function periodReturn(snapshots: PortfolioSnapshot[], key: ReturnPeriodKey): ReturnPeriod {
  const meta = PERIODS.find((period) => period.key === key) ?? { key, label: key }
  if (snapshots.length < 2) {
    return { ...meta, available: false, returnPct: null, startDate: null, endDate: null, reason: 'Need at least two snapshots.' }
  }

  const latest = snapshots[snapshots.length - 1]
  const requestedStart = periodStart(key, latest.snapshot_date)
  const startIndex = requestedStart ? firstIndexOnOrAfter(snapshots, requestedStart) : 0
  if (startIndex == null || startIndex >= snapshots.length - 1) {
    return { ...meta, available: false, returnPct: null, startDate: requestedStart, endDate: latest.snapshot_date, reason: 'Not enough snapshots in this period.' }
  }

  const periodSnapshots = snapshots.slice(startIndex)
  const actualStart = periodSnapshots[0]
  if (requestedStart && daysBetween(requestedStart, actualStart.snapshot_date) > periodCoverageToleranceDays(key)) {
    return {
      ...meta,
      available: false,
      returnPct: null,
      startDate: actualStart.snapshot_date,
      endDate: latest.snapshot_date,
      reason: `Need snapshots closer to ${requestedStart}.`,
    }
  }

  const chained = chainIntervals(buildIntervals(periodSnapshots), MAX_PERIOD_RETURN)
  if (!chained.available) {
    return { ...meta, available: false, returnPct: null, startDate: chained.startDate ?? actualStart.snapshot_date, endDate: chained.endDate ?? latest.snapshot_date, reason: chained.reason }
  }
  if (chained.observationCount < minObservationsForPeriod(key)) {
    return { ...meta, available: false, returnPct: null, startDate: chained.startDate, endDate: chained.endDate, reason: 'Need more valid return observations.' }
  }
  if (chained.startDate && chained.endDate && daysBetween(chained.startDate, chained.endDate) < minSpanForPeriod(key)) {
    return { ...meta, available: false, returnPct: null, startDate: chained.startDate, endDate: chained.endDate, reason: 'Snapshot history is too short for this period.' }
  }

  return {
    ...meta,
    available: true,
    returnPct: chained.returnPct,
    startDate: chained.startDate,
    endDate: chained.endDate,
  }
}

function linkedSeries(snapshots: PortfolioSnapshot[]): { points: IndexedReturnPoint[]; intervals: IntervalReturn[]; reason: string | null } {
  const intervals = buildIntervals(snapshots)
  if (intervals.length < MIN_INDEXED_OBSERVATIONS) {
    return { points: [], intervals, reason: 'Need more portfolio snapshots.' }
  }

  const valid = intervals.filter((interval) => interval.valid && interval.returnPct != null)
  const invalidRatio = (intervals.length - valid.length) / intervals.length
  if (valid.length < MIN_INDEXED_OBSERVATIONS) {
    return { points: [], intervals, reason: 'Need more valid contribution-adjusted intervals.' }
  }
  if (invalidRatio > MAX_INVALID_INTERVAL_RATIO) {
    return { points: [], intervals, reason: 'History is too sparse or cash-flow dominated.' }
  }

  let indexValue = 100
  const points: IndexedReturnPoint[] = [{
    date: valid[0].startDate,
    label: dateLabel(valid[0].startDate),
    portfolio: 100,
  }]

  for (const interval of valid) {
    indexValue *= 1 + (interval.returnPct ?? 0)
    if (!Number.isFinite(indexValue) || indexValue <= 0 || indexValue > (1 + MAX_PERIOD_RETURN) * 100) {
      return { points: [], intervals, reason: 'Indexed return estimate was suppressed by safety guard.' }
    }
    points.push({
      date: interval.endDate,
      label: dateLabel(interval.endDate),
      portfolio: indexValue,
    })
  }

  return { points, intervals, reason: null }
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
    if (items.length < 3 || daysBetween(items[0].snapshot_date, items[items.length - 1].snapshot_date) < 7) return []
    const result = chainIntervals(buildIntervals(items), MAX_MONTHLY_RETURN)
    if (!result.available || result.observationCount < 2 || result.returnPct == null) return []
    const month = Number(key.slice(5, 7))
    return [{
      key,
      year: key.slice(0, 4),
      month,
      monthLabel: MONTH_LABELS[month - 1] ?? key,
      startDate: result.startDate ?? items[0].snapshot_date,
      endDate: result.endDate ?? items[items.length - 1].snapshot_date,
      startValue: n(items[0].total_value),
      endValue: n(items[items.length - 1].total_value),
      cashFlow: result.cashFlow,
      observationCount: result.observationCount,
      returnPct: result.returnPct,
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
    if (items.length < 10 || daysBetween(items[0].snapshot_date, items[items.length - 1].snapshot_date) < 30) return []
    const result = chainIntervals(buildIntervals(items), MAX_PERIOD_RETURN)
    if (!result.available || result.returnPct == null) return []
    return [{ year, startDate: result.startDate ?? items[0].snapshot_date, endDate: result.endDate ?? items[items.length - 1].snapshot_date, returnPct: result.returnPct }]
  })
}

function drawdowns(series: IndexedReturnPoint[]) {
  if (series.length < MIN_DRAWDOWN_POINTS) {
    return { points: [], maxDrawdownPct: null, maxDrawdownDate: null, reason: 'Need more valid portfolio history for drawdown.' }
  }

  let peak = 0
  let maxDrawdownPct: number | null = null
  let maxDrawdownDate: string | null = null
  const points: DrawdownPoint[] = []

  for (const point of series) {
    peak = Math.max(peak, point.portfolio)
    const drawdownPct = peak > 0 ? point.portfolio / peak - 1 : 0
    if (!Number.isFinite(drawdownPct)) {
      return { points: [], maxDrawdownPct: null, maxDrawdownDate: null, reason: 'Drawdown estimate is not finite.' }
    }
    points.push({ date: point.date, label: point.label, drawdownPct })
    if (maxDrawdownPct == null || drawdownPct < maxDrawdownPct) {
      maxDrawdownPct = drawdownPct
      maxDrawdownDate = point.date
    }
  }

  return { points, maxDrawdownPct, maxDrawdownDate, reason: null }
}

function volatility(intervals: IntervalReturn[]) {
  const returns = intervals.flatMap((interval) => interval.valid && interval.returnPct != null ? [interval.returnPct] : [])
  if (returns.length < MIN_VOLATILITY_OBSERVATIONS) {
    return { value: null, reason: 'Need more valid return observations.' }
  }

  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / (returns.length - 1)
  const daily = Math.sqrt(Math.max(0, variance))
  const annualized = Number.isFinite(daily) ? daily * Math.sqrt(252) : null
  if (annualized == null || annualized > 5) {
    return { value: null, reason: 'Volatility suppressed because the estimate is too extreme.' }
  }

  return { value: annualized, reason: null }
}

export function buildPortfolioPerformance(snapshots: PortfolioSnapshot[]): PortfolioPerformance {
  const sorted = sortSnapshots(snapshots)
  const linked = linkedSeries(sorted)
  const monthly = monthlyReturns(sorted)
  const drawdown = drawdowns(linked.points)
  const vol = volatility(linked.intervals)
  const bestMonth = monthly.length > 0 ? monthly.reduce((best, item) => item.returnPct > best.returnPct ? item : best, monthly[0]) : null
  const worstMonth = monthly.length > 0 ? monthly.reduce((worst, item) => item.returnPct < worst.returnPct ? item : worst, monthly[0]) : null
  const periods = PERIODS.map((period) => periodReturn(sorted, period.key))

  return {
    snapshots: sorted,
    indexedSeries: linked.points,
    drawdownSeries: drawdown.points,
    periods,
    monthlyReturns: monthly,
    yearlyReturns: yearlyReturns(sorted),
    totalReturnPct: periods.find((period) => period.key === 'MAX')?.returnPct ?? null,
    maxDrawdownPct: drawdown.maxDrawdownPct,
    maxDrawdownDate: drawdown.maxDrawdownDate,
    maxDrawdownReason: linked.reason ?? drawdown.reason,
    volatilityPct: vol.value,
    volatilityReason: linked.reason ?? vol.reason,
    indexedSeriesReason: linked.reason,
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
  const portfolio = linkedSeries(sortSnapshots(snapshots))
  const sortedBenchmark = benchmarkHistory
    .filter((point) => benchmarkValue(point) != null)
    .slice()
    .sort((a, b) => a.price_date.localeCompare(b.price_date))

  if (portfolio.reason) {
    return {
      available: false,
      points: [],
      overlapStartDate: null,
      overlapEndDate: null,
      portfolioReturnPct: null,
      benchmarkReturnPct: null,
      relativeReturnPct: null,
      trackingDifferencePct: null,
      message: portfolio.reason,
    }
  }
  if (portfolio.points.length < 2 || sortedBenchmark.length < 2) {
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

  const matched: { point: IndexedReturnPoint; benchmark: MarketPriceHistoryPoint; benchmarkPrice: number }[] = []
  let benchmarkIndex = 0

  for (const point of portfolio.points) {
    const match = closestBenchmarkPoint(sortedBenchmark, point.date, benchmarkIndex)
    benchmarkIndex = match.index
    if (!match.point) continue
    const price = benchmarkValue(match.point)
    if (price == null) continue
    matched.push({ point, benchmark: match.point, benchmarkPrice: price })
  }

  if (matched.length < 2) {
    return {
      available: false,
      points: [],
      overlapStartDate: matched[0]?.point.date ?? null,
      overlapEndDate: matched[matched.length - 1]?.point.date ?? null,
      portfolioReturnPct: null,
      benchmarkReturnPct: null,
      relativeReturnPct: null,
      trackingDifferencePct: null,
      message: 'Not enough overlapping portfolio and benchmark history yet.',
    }
  }

  const first = matched[0]
  const last = matched[matched.length - 1]
  if (daysBetween(first.point.date, last.point.date) < MIN_BENCHMARK_OVERLAP_DAYS) {
    return {
      available: false,
      points: [],
      overlapStartDate: first.point.date,
      overlapEndDate: last.point.date,
      portfolioReturnPct: null,
      benchmarkReturnPct: null,
      relativeReturnPct: null,
      trackingDifferencePct: null,
      message: 'Benchmark overlap too short.',
    }
  }

  const basePortfolio = first.point.portfolio
  const baseBenchmark = first.benchmarkPrice
  const points = matched.flatMap((item) => {
    const portfolioIndex = item.point.portfolio / basePortfolio * 100
    const benchmarkIndexValue = item.benchmarkPrice / baseBenchmark * 100
    if (!Number.isFinite(portfolioIndex) || !Number.isFinite(benchmarkIndexValue)) return []
    return [{
      date: item.point.date,
      month: dateLabel(item.point.date),
      portfolio: portfolioIndex,
      benchmark: benchmarkIndexValue,
    }]
  })

  if (points.length < 2) {
    return {
      available: false,
      points: [],
      overlapStartDate: first.point.date,
      overlapEndDate: last.point.date,
      portfolioReturnPct: null,
      benchmarkReturnPct: null,
      relativeReturnPct: null,
      trackingDifferencePct: null,
      message: 'Benchmark comparison has too few valid normalized points.',
    }
  }

  const portfolioReturnPct = points[points.length - 1].portfolio / 100 - 1
  const benchmarkReturnPct = points[points.length - 1].benchmark / 100 - 1
  if (Math.abs(portfolioReturnPct) > MAX_PERIOD_RETURN || Math.abs(benchmarkReturnPct) > MAX_PERIOD_RETURN) {
    return {
      available: false,
      points: [],
      overlapStartDate: first.point.date,
      overlapEndDate: last.point.date,
      portfolioReturnPct: null,
      benchmarkReturnPct: null,
      relativeReturnPct: null,
      trackingDifferencePct: null,
      message: 'Benchmark comparison suppressed because the estimate is too extreme.',
    }
  }

  const pointDiffs = points.map((point) => (point.portfolio - point.benchmark) / 100)
  const trackingDifferencePct = pointDiffs.reduce((sum, value) => sum + value, 0) / pointDiffs.length

  return {
    available: true,
    points,
    overlapStartDate: first.point.date,
    overlapEndDate: last.point.date,
    portfolioReturnPct,
    benchmarkReturnPct,
    relativeReturnPct: portfolioReturnPct - benchmarkReturnPct,
    trackingDifferencePct,
  }
}
