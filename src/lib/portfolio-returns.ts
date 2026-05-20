import type {
  CashLedgerEntry,
  DividendRecord,
  MarketPriceHistoryPoint,
  PortfolioSnapshot,
  SupportedCashCurrency,
  Transaction,
} from '@/lib/supabase/portfolio'

export type ReturnMetric = {
  available: boolean
  value: number | null
  reason?: string
  startDate?: string | null
  endDate?: string | null
  confidence?: ReturnConfidence
}

export type ReturnConfidence = 'high' | 'limited' | 'low'

export type ExclusionReason =
  | 'cashFlowDominated'
  | 'duplicate'
  | 'extremeReturn'
  | 'invalidBaseline'
  | 'missingValue'
  | 'nearZeroBase'
  | 'nonFinite'
  | 'sparse'

export type ReturnInterval = {
  startDate: string
  endDate: string
  startValue: number
  endValue: number
  externalFlow: number
  income: number
  expense: number
  transactionFlowProxy: number
  denominator: number
  returnPct: number | null
  validForTwr: boolean
  excludedReason?: ExclusionReason
  excludedReasonLabel?: string
}

export type ReturnCurvePoint = {
  date: string
  label: string
  value: number
  returnPct: number
}

export type RollingReturnPoint = {
  date: string
  label: string
  rollingReturnPct: number
}

export type DrawdownCurvePoint = {
  date: string
  label: string
  drawdownPct: number
}

export type BenchmarkRelativePoint = {
  date: string
  label: string
  portfolio: number
  benchmark: number
  relativeReturnPct: number
}

export type LargeCashFlowDiagnostic = {
  date: string
  amount: number
  startValue: number
  endValue: number
}

export type ReturnSanityDiagnostics = {
  confidence: ReturnConfidence
  confidenceReasons: string[]
  startPortfolioValue: number | null
  endPortfolioValue: number | null
  startContribution: number | null
  endContribution: number | null
  startNetCashFlow: number | null
  endNetCashFlow: number | null
  nominalGrowthPct: number | null
  contributionAdjustedGrowthPct: number | null
  totalExternalFlow: number
  flowImpactRatio: number | null
  performanceDriver: 'asset returns' | 'cash flows' | 'mixed' | 'limited'
  largeCashFlowDates: LargeCashFlowDiagnostic[]
}

export type TruePortfolioReturns = {
  intervals: ReturnInterval[]
  validIntervals: ReturnInterval[]
  excludedIntervals: ReturnInterval[]
  cumulativeReturnCurve: ReturnCurvePoint[]
  rollingReturnCurve: RollingReturnPoint[]
  drawdownCurve: DrawdownCurvePoint[]
  benchmarkRelativeCurve: BenchmarkRelativePoint[]
  benchmarkOverlapPoints: number
  benchmarkOverlapStartDate: string | null
  benchmarkOverlapEndDate: string | null
  validIntervalStartDate: string | null
  validIntervalEndDate: string | null
  exclusionReasonCounts: Record<ExclusionReason, number>
  exclusionReasonSummary: string
  returnCurveReason: string | null
  drawdownReason: string | null
  twrReturn: ReturnMetric
  mwrApprox: ReturnMetric
  cagr: ReturnMetric
  rolling30dVolatility: ReturnMetric
  bestRolling12m: ReturnMetric
  worstRolling12m: ReturnMetric
  benchmarkRelativeReturn: ReturnMetric
  recoveryFromDrawdownMonths: ReturnMetric
  sanityDiagnostics: ReturnSanityDiagnostics
  summaryReason: string | null
}

type ReturnEvent = {
  date: string
  externalFlow: number
  income: number
  expense: number
  transactionFlowProxy: number
}

type EngineInput = {
  snapshots: PortfolioSnapshot[]
  cashEntries: CashLedgerEntry[]
  dividends: DividendRecord[]
  transactions: Transaction[]
  benchmarkHistory: MarketPriceHistoryPoint[]
  baseCurrency?: SupportedCashCurrency | string | null
}

const DAY_MS = 24 * 60 * 60 * 1000
const EPS = 0.000001
const MIN_RETURN_BASE = 100
const MIN_VALID_INTERVALS = 10
const MIN_CURVE_POINTS = 10
const MIN_DRAWDOWN_POINTS = 10
const MAX_INTERVAL_GAP_DAYS = 45
const MAX_INTERVAL_RETURN = 0.6
const MAX_TOTAL_RETURN = 10
const MAX_PLAUSIBLE_RETURN = 5
const MAX_EXCLUDED_RATIO = 0.85
const CASH_FLOW_DOMINANCE_MULTIPLE = 20
const MIN_CASH_FLOW_DOMINANCE_ABS = 25000
const MAX_CASH_FLOW_DOMINATED_RETURN = 0.25
const MIN_CURVE_VALUE = 1
const MAX_MWR_ABS_RETURN = 2
const MAX_ANNUALIZED_VOLATILITY = 4
const ROLLING_YEAR_DAYS = 365
const ROLLING_VOL_DAYS = 30
const BENCHMARK_STALE_DAYS = 10
const MIN_BENCHMARK_OVERLAP_DAYS = 30
const MIN_BENCHMARK_OVERLAP_POINTS = 10
const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  cashFlowDominated: 'cash-flow dominated',
  duplicate: 'duplicate',
  extremeReturn: 'extreme return',
  invalidBaseline: 'invalid baseline',
  missingValue: 'missing value',
  nearZeroBase: 'near-zero base',
  nonFinite: 'non-finite',
  sparse: 'sparse',
}

function n(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function supportedCurrency(value: string | null | undefined): SupportedCashCurrency {
  return value === 'EUR' || value === 'USD' || value === 'PLN' ? value : 'PLN'
}

function dateKey(value: string | null | undefined) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

function dayTime(value: string) {
  const key = dateKey(value)
  if (!key) return Number.NaN
  const [year, month, day] = key.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function dateLabel(value: string) {
  const key = dateKey(value)
  if (!key) return value
  const date = new Date(`${key}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' })
}

function daysBetween(start: string, end: string) {
  const startTime = dayTime(start)
  const endTime = dayTime(end)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0
  return Math.max(0, (endTime - startTime) / DAY_MS)
}

function addDays(date: string, days: number) {
  const key = dateKey(date)
  if (!key) return date
  const value = new Date(`${key}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function sortSnapshots(snapshots: PortfolioSnapshot[]) {
  const byDate = new Map<string, PortfolioSnapshot>()
  for (const snapshot of snapshots) {
    const snapshotDate = dateKey(snapshot.snapshot_date)
    if (!snapshotDate || n(snapshot.total_value) <= 0) continue
    const normalized = { ...snapshot, snapshot_date: snapshotDate }
    const current = byDate.get(snapshotDate)
    if (!current || String(normalized.calculated_at ?? '').localeCompare(String(current.calculated_at ?? '')) >= 0) {
      byDate.set(snapshotDate, normalized)
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
}

function metric(value: number | null, reason?: string, startDate?: string | null, endDate?: string | null, confidence?: ReturnConfidence): ReturnMetric {
  const available = value != null && Number.isFinite(value)
  return {
    available,
    value: available ? value : null,
    reason: available ? undefined : reason ?? 'Limited data.',
    startDate,
    endDate,
    confidence: confidence ?? (available ? 'high' : 'low'),
  }
}

function excluded(base: Omit<ReturnInterval, 'returnPct' | 'validForTwr'>, reason: ExclusionReason): ReturnInterval {
  return { ...base, returnPct: null, validForTwr: false, excludedReason: reason, excludedReasonLabel: EXCLUSION_LABELS[reason] }
}

function emptyEvent(date: string): ReturnEvent {
  return { date, externalFlow: 0, income: 0, expense: 0, transactionFlowProxy: 0 }
}

function addEvent(map: Map<string, ReturnEvent>, date: string, patch: Partial<Omit<ReturnEvent, 'date'>>) {
  const key = dateKey(date)
  if (!key) return
  const current = map.get(key) ?? emptyEvent(key)
  current.externalFlow += patch.externalFlow ?? 0
  current.income += patch.income ?? 0
  current.expense += patch.expense ?? 0
  current.transactionFlowProxy += patch.transactionFlowProxy ?? 0
  map.set(key, current)
}

function buildEvents(input: EngineInput) {
  const baseCurrency = supportedCurrency(input.baseCurrency)
  const events = new Map<string, ReturnEvent>()

  for (const entry of input.cashEntries) {
    if (supportedCurrency(entry.currency) !== baseCurrency) continue
    const amount = n(entry.amount)
    if (amount <= 0) continue
    if (entry.entry_type === 'deposit') addEvent(events, entry.entry_date, { externalFlow: amount })
    if (entry.entry_type === 'withdrawal') addEvent(events, entry.entry_date, { externalFlow: -amount })
    if (entry.entry_type === 'adjustment') addEvent(events, entry.entry_date, { externalFlow: amount })
    if (entry.entry_type === 'fee' || entry.entry_type === 'tax') addEvent(events, entry.entry_date, { expense: amount })
  }

  for (const dividend of input.dividends) {
    if (supportedCurrency(dividend.currency) !== baseCurrency) continue
    const income = n(dividend.net_amount)
    if (income > 0) addEvent(events, dividend.payment_date, { income })
  }

  for (const transaction of input.transactions) {
    const assetCurrency = supportedCurrency(transaction.assets?.currency ?? baseCurrency)
    if (assetCurrency !== baseCurrency) continue
    const gross = n(transaction.quantity) * n(transaction.price)
    const fees = n(transaction.fees)
    if (fees > 0) addEvent(events, transaction.transaction_date, { expense: fees })
    if (gross <= 0) continue
    const flow = transaction.transaction_type === 'BUY' ? gross + fees : -(gross - fees)
    addEvent(events, transaction.transaction_date, { transactionFlowProxy: flow })
  }

  return Array.from(events.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function snapshotFlowBetween(start: PortfolioSnapshot, end: PortfolioSnapshot) {
  const contributionDelta = n(end.contribution) - n(start.contribution)
  if (Math.abs(contributionDelta) > EPS) return contributionDelta

  const netCashFlowDelta = n(end.net_cash_flow) - n(start.net_cash_flow)
  if (Math.abs(netCashFlowDelta) > EPS) return netCashFlowDelta

  const investedCostDelta = n(end.invested_cost) - n(start.invested_cost)
  if (Math.abs(investedCostDelta) > EPS) return investedCostDelta

  return 0
}

function consumeEventsBetween(events: ReturnEvent[], cursor: { value: number }, startDate: string, endDate: string) {
  const startKey = dateKey(startDate)
  const endKey = dateKey(endDate)
  const consumed = emptyEvent(endKey || endDate)
  while (cursor.value < events.length && events[cursor.value].date <= startKey) cursor.value += 1
  while (cursor.value < events.length && events[cursor.value].date <= endKey) {
    const event = events[cursor.value]
    consumed.externalFlow += event.externalFlow
    consumed.income += event.income
    consumed.expense += event.expense
    consumed.transactionFlowProxy += event.transactionFlowProxy
    cursor.value += 1
  }
  return consumed
}

function intervalFromSnapshots(start: PortfolioSnapshot, end: PortfolioSnapshot, event: ReturnEvent): ReturnInterval {
  const startValue = n(start.total_value)
  const endValue = n(end.total_value)
  const snapshotFlow = snapshotFlowBetween(start, end)
  const externalFlow = Math.abs(event.externalFlow) > EPS
    ? event.externalFlow
    : Math.abs(snapshotFlow) > EPS
      ? snapshotFlow
      : startValue < MIN_RETURN_BASE * 2
        ? event.transactionFlowProxy
        : 0
  const denominator = startValue + externalFlow * 0.5
  const gapDays = daysBetween(start.snapshot_date, end.snapshot_date)

  const base: Omit<ReturnInterval, 'returnPct' | 'validForTwr'> = {
    startDate: start.snapshot_date,
    endDate: end.snapshot_date,
    startValue,
    endValue,
    externalFlow,
    income: event.income,
    expense: event.expense,
    transactionFlowProxy: event.transactionFlowProxy,
    denominator,
  }

  if (gapDays <= 0) return excluded(base, 'duplicate')
  if (gapDays > MAX_INTERVAL_GAP_DAYS) return excluded(base, 'sparse')
  if (startValue <= 0 || endValue <= 0) return excluded(base, 'missingValue')
  if (denominator < MIN_RETURN_BASE) return excluded(base, 'nearZeroBase')

  const returnPct = (endValue + event.income - event.expense - startValue - externalFlow) / denominator
  if (!Number.isFinite(returnPct)) return excluded(base, 'nonFinite')
  const largeExternalFlow = Math.abs(externalFlow) > Math.max(MIN_CASH_FLOW_DOMINANCE_ABS, Math.max(startValue, MIN_RETURN_BASE) * CASH_FLOW_DOMINANCE_MULTIPLE)
  if (largeExternalFlow && Math.abs(returnPct) > MAX_CASH_FLOW_DOMINATED_RETURN) return excluded(base, 'cashFlowDominated')
  if (Math.abs(returnPct) > MAX_INTERVAL_RETURN) return excluded(base, 'extremeReturn')

  return { ...base, returnPct, validForTwr: true }
}

function buildIntervals(snapshots: PortfolioSnapshot[], events: ReturnEvent[]) {
  const cursor = { value: 0 }
  const intervals: ReturnInterval[] = []
  for (let index = 1; index < snapshots.length; index += 1) {
    const start = snapshots[index - 1]
    const end = snapshots[index]
    const event = consumeEventsBetween(events, cursor, start.snapshot_date, end.snapshot_date)
    intervals.push(intervalFromSnapshots(start, end, event))
  }
  return intervals
}

function cumulativeCurve(validIntervals: ReturnInterval[]) {
  if (validIntervals.length < MIN_VALID_INTERVALS) return { points: [] as ReturnCurvePoint[], reason: 'Need more valid contribution-adjusted intervals.' }
  let indexValue = 100
  const curve: ReturnCurvePoint[] = [{
    date: validIntervals[0].startDate,
    label: dateLabel(validIntervals[0].startDate),
    value: 100,
    returnPct: 0,
  }]

  for (const interval of validIntervals) {
    indexValue *= 1 + (interval.returnPct ?? 0)
    if (!Number.isFinite(indexValue) || indexValue <= 0 || indexValue > (1 + MAX_TOTAL_RETURN) * 100) {
      return { points: [] as ReturnCurvePoint[], reason: 'Cumulative return curve failed safety guards.' }
    }
    if (indexValue < MIN_CURVE_VALUE) {
      return { points: [] as ReturnCurvePoint[], reason: 'Cumulative return curve collapsed below the safety floor.' }
    }
    curve.push({
      date: interval.endDate,
      label: dateLabel(interval.endDate),
      value: indexValue,
      returnPct: indexValue / 100 - 1,
    })
  }

  return { points: curve, reason: null }
}

function twrMetric(curve: ReturnCurvePoint[], excludedRatio: number) {
  if (curve.length < MIN_CURVE_POINTS) return metric(null, 'Need more valid contribution-adjusted intervals.')
  if (excludedRatio > MAX_EXCLUDED_RATIO && curve.length < 30) return metric(null, 'Too many intervals were excluded from TWR.')
  const value = curve[curve.length - 1].value / 100 - 1
  if (!Number.isFinite(value) || Math.abs(value) > MAX_TOTAL_RETURN) return metric(null, 'TWR suppressed because the estimate is too extreme.')
  return metric(value, undefined, curve[0].date, curve[curve.length - 1].date)
}

function mwrApproxMetric(snapshots: PortfolioSnapshot[], intervals: ReturnInterval[]) {
  if (snapshots.length < 2 || intervals.length < MIN_VALID_INTERVALS) return metric(null, 'Need more portfolio history.')
  const first = snapshots[0]
  const last = snapshots[snapshots.length - 1]
  const totalDays = Math.max(1, daysBetween(first.snapshot_date, last.snapshot_date))
  const beginValue = n(first.total_value)
  const endingValue = n(last.total_value)
  if (beginValue < MIN_RETURN_BASE) return metric(null, 'Starting portfolio value is too low.')

  let totalFlows = 0
  let weightedFlows = 0
  let income = 0
  let expense = 0
  for (const interval of intervals) {
    totalFlows += interval.externalFlow
    income += interval.income
    expense += interval.expense
    const daysRemaining = Math.max(0, daysBetween(interval.endDate, last.snapshot_date))
    weightedFlows += interval.externalFlow * (daysRemaining / totalDays)
  }

  const denominator = beginValue + weightedFlows
  const capitalScale = Math.max(MIN_RETURN_BASE, (beginValue + endingValue + Math.abs(weightedFlows)) / 3)
  if (denominator < MIN_RETURN_BASE || denominator < capitalScale * 0.1) return metric(null, 'Money-weighted denominator is too low.')
  const value = (endingValue + income - expense - beginValue - totalFlows) / denominator
  if (!Number.isFinite(value) || Math.abs(value) > MAX_MWR_ABS_RETURN) return metric(null, 'MWR estimate suppressed by safety guard.')
  return metric(value, undefined, first.snapshot_date, last.snapshot_date)
}

function largeCashFlowThreshold(startValue: number) {
  return Math.max(MIN_CASH_FLOW_DOMINANCE_ABS, Math.max(startValue, MIN_RETURN_BASE) * 0.25)
}

function buildSanityDiagnostics(snapshots: PortfolioSnapshot[], intervals: ReturnInterval[], validIntervals: ReturnInterval[], benchmarkOverlapPoints: number): ReturnSanityDiagnostics {
  const first = snapshots[0]
  const last = snapshots[snapshots.length - 1]
  const startPortfolioValue = first ? n(first.total_value) : null
  const endPortfolioValue = last ? n(last.total_value) : null
  const startContribution = first ? n(first.contribution) : null
  const endContribution = last ? n(last.contribution) : null
  const startNetCashFlow = first ? n(first.net_cash_flow) : null
  const endNetCashFlow = last ? n(last.net_cash_flow) : null
  const totalExternalFlow = intervals.reduce((sum, interval) => sum + interval.externalFlow, 0)
  const nominalGrowthPct = startPortfolioValue && startPortfolioValue >= MIN_RETURN_BASE && endPortfolioValue != null
    ? endPortfolioValue / startPortfolioValue - 1
    : null
  const contributionAdjustedGrowthPct = startPortfolioValue && startPortfolioValue >= MIN_RETURN_BASE && endPortfolioValue != null
    ? (endPortfolioValue - startPortfolioValue - totalExternalFlow) / startPortfolioValue
    : null
  const flowImpactRatio = startPortfolioValue && endPortfolioValue != null && Math.max(startPortfolioValue, endPortfolioValue) > 0
    ? Math.abs(totalExternalFlow) / Math.max(startPortfolioValue, endPortfolioValue)
    : null
  const excludedRatio = intervals.length > 0 ? (intervals.length - validIntervals.length) / intervals.length : 1
  const largeCashFlowDates = intervals
    .filter((interval) => Math.abs(interval.externalFlow) >= largeCashFlowThreshold(interval.startValue))
    .sort((a, b) => Math.abs(b.externalFlow) - Math.abs(a.externalFlow))
    .slice(0, 6)
    .map((interval) => ({ date: interval.endDate, amount: interval.externalFlow, startValue: interval.startValue, endValue: interval.endValue }))

  const confidenceReasons: string[] = []
  if (snapshots.length < MIN_VALID_INTERVALS + 1) confidenceReasons.push('needs more snapshots')
  if (validIntervals.length < MIN_VALID_INTERVALS) confidenceReasons.push('needs more stable intervals')
  if (excludedRatio > 0.6) confidenceReasons.push('limited by excluded intervals')
  if (largeCashFlowDates.length > 0) confidenceReasons.push('large cash-flow dates detected')
  if (benchmarkOverlapPoints > 0 && benchmarkOverlapPoints < MIN_BENCHMARK_OVERLAP_POINTS) confidenceReasons.push('benchmark overlap is short')
  if (startPortfolioValue != null && startPortfolioValue < MIN_RETURN_BASE) confidenceReasons.push('starting value is too low')

  const confidence: ReturnConfidence = confidenceReasons.some((reason) => reason.includes('needs more') || reason.includes('starting value'))
    ? 'low'
    : confidenceReasons.length > 0
      ? 'limited'
      : 'high'

  const driver = flowImpactRatio == null || contributionAdjustedGrowthPct == null
    ? 'limited'
    : flowImpactRatio > 0.5 && Math.abs(contributionAdjustedGrowthPct) < Math.max(0.05, Math.abs(nominalGrowthPct ?? 0) * 0.35)
      ? 'cash flows'
      : flowImpactRatio > 0.25
        ? 'mixed'
        : 'asset returns'

  return {
    confidence,
    confidenceReasons,
    startPortfolioValue,
    endPortfolioValue,
    startContribution,
    endContribution,
    startNetCashFlow,
    endNetCashFlow,
    nominalGrowthPct,
    contributionAdjustedGrowthPct,
    totalExternalFlow,
    flowImpactRatio,
    performanceDriver: driver,
    largeCashFlowDates,
  }
}

function calibrateMetric(result: ReturnMetric, label: string, diagnostics: ReturnSanityDiagnostics) {
  if (!result.available || result.value == null) return { ...result, confidence: result.confidence ?? 'low' as ReturnConfidence }
  if (Math.abs(result.value) > MAX_PLAUSIBLE_RETURN) {
    return metric(null, `${label} suppressed because it is outside plausible snapshot-based bounds.`, result.startDate, result.endDate, 'low')
  }
  if (diagnostics.confidence === 'low') {
    return { ...result, confidence: 'limited' as ReturnConfidence }
  }
  return { ...result, confidence: diagnostics.confidence }
}

function cagrMetric(twr: ReturnMetric) {
  if (!twr.available || twr.value == null || !twr.startDate || !twr.endDate) return metric(null, twr.reason ?? 'TWR is unavailable.')
  const days = daysBetween(twr.startDate, twr.endDate)
  if (days < 365) return metric(null, 'Need at least one year of valid history.')
  const value = (1 + twr.value) ** (365 / days) - 1
  if (!Number.isFinite(value) || Math.abs(value) > MAX_TOTAL_RETURN) return metric(null, 'CAGR suppressed by safety guard.')
  return metric(value, undefined, twr.startDate, twr.endDate)
}

function rollingReturnCurve(curve: ReturnCurvePoint[], windowDays = ROLLING_YEAR_DAYS) {
  const points: RollingReturnPoint[] = []
  let startIndex = 0
  for (let index = 1; index < curve.length; index += 1) {
    const point = curve[index]
    const targetDate = addDays(point.date, -windowDays)
    while (startIndex + 1 < index && curve[startIndex + 1].date <= targetDate) startIndex += 1
    const start = curve[startIndex]
    if (daysBetween(start.date, point.date) < windowDays * 0.8) continue
    const rollingReturnPct = point.value / start.value - 1
    if (!Number.isFinite(rollingReturnPct) || Math.abs(rollingReturnPct) > MAX_TOTAL_RETURN) continue
    points.push({ date: point.date, label: dateLabel(point.date), rollingReturnPct })
  }
  return points
}

function rollingExtremes(points: RollingReturnPoint[]) {
  if (points.length === 0) {
    return {
      best: metric(null, 'Need at least 12 months of valid return curve.'),
      worst: metric(null, 'Need at least 12 months of valid return curve.'),
    }
  }
  const best = points.reduce((winner, point) => point.rollingReturnPct > winner.rollingReturnPct ? point : winner, points[0])
  const worst = points.reduce((loser, point) => point.rollingReturnPct < loser.rollingReturnPct ? point : loser, points[0])
  return {
    best: metric(best.rollingReturnPct, undefined, addDays(best.date, -ROLLING_YEAR_DAYS), best.date),
    worst: metric(worst.rollingReturnPct, undefined, addDays(worst.date, -ROLLING_YEAR_DAYS), worst.date),
  }
}

function rolling30dVolatility(intervals: ReturnInterval[]) {
  if (intervals.length === 0) return metric(null, 'Need valid return observations.')
  const lastDate = intervals[intervals.length - 1].endDate
  const startDate = addDays(lastDate, -ROLLING_VOL_DAYS)
  const window = intervals.filter((interval) => interval.endDate >= startDate)
  const validWindow = window.filter((interval) => interval.validForTwr && interval.returnPct != null)
  if (window.length > 0 && (window.length - validWindow.length) / window.length > 0.5) {
    return metric(null, 'Latest 30D window is cash-flow dominated or sparse.')
  }
  if (validWindow.length < 10) return metric(null, 'Need at least 10 valid observations in the latest 30D window.')
  const returns = validWindow.flatMap((interval) => {
    const gapDays = Math.max(1, daysBetween(interval.startDate, interval.endDate))
    const daily = (1 + (interval.returnPct ?? 0)) ** (1 / gapDays) - 1
    return Number.isFinite(daily) ? [daily] : []
  })
  if (returns.length < 10) return metric(null, 'Need at least 10 valid daily return observations.')
  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / (returns.length - 1)
  const value = Math.sqrt(Math.max(0, variance)) * Math.sqrt(252)
  if (!Number.isFinite(value) || value > MAX_ANNUALIZED_VOLATILITY) return metric(null, 'Volatility suppressed by safety guard.')
  return metric(value, undefined, startDate, lastDate)
}

function drawdownCurve(curve: ReturnCurvePoint[]) {
  const first = curve.find((point) => Number.isFinite(point.value) && point.value >= MIN_CURVE_VALUE)
  if (!first || curve.length < MIN_DRAWDOWN_POINTS) return { points: [] as DrawdownCurvePoint[], reason: 'Need more valid return curve points for drawdown.' }
  let peak = first.value
  const points: DrawdownCurvePoint[] = []
  for (const point of curve) {
    if (!Number.isFinite(point.value) || point.value < MIN_CURVE_VALUE) continue
    peak = Math.max(peak, point.value)
    const drawdownPct = peak > 0 ? point.value / peak - 1 : 0
    if (Number.isFinite(drawdownPct)) points.push({ date: point.date, label: point.label, drawdownPct })
  }
  if (points.length < MIN_DRAWDOWN_POINTS) return { points: [] as DrawdownCurvePoint[], reason: 'Need more valid drawdown points.' }
  return { points, reason: null }
}

function recoveryMetric(drawdowns: DrawdownCurvePoint[], validIntervals: ReturnInterval[]) {
  if (drawdowns.length === 0) return metric(null, 'Need drawdown history.')
  const current = drawdowns[drawdowns.length - 1].drawdownPct
  if (current >= -EPS) return metric(0, undefined, drawdowns[drawdowns.length - 1].date, drawdowns[drawdowns.length - 1].date)
  const recent = validIntervals.slice(-90).map((interval) => interval.returnPct ?? 0).filter((value) => Number.isFinite(value))
  if (recent.length < 20) return metric(null, 'Need more recent valid intervals.')
  const average = recent.reduce((sum, value) => sum + value, 0) / recent.length
  if (average <= 0) return metric(null, 'Recent return pace is not positive.')
  const days = Math.log(1 / (1 + current)) / Math.log(1 + average)
  if (!Number.isFinite(days) || days < 0 || days > 3650) return metric(null, 'Recovery estimate unavailable.')
  return metric(days / 30, undefined, drawdowns[drawdowns.length - 1].date, null)
}

function benchmarkValue(point: MarketPriceHistoryPoint) {
  const baseValue = n(point.close_price_base)
  if (baseValue > 0) return baseValue
  const sourceCurrency = (point.source_currency ?? '').toUpperCase()
  const baseCurrency = (point.base_currency ?? '').toUpperCase()
  const sourceValue = n(point.close_price)
  return sourceCurrency && sourceCurrency === baseCurrency && sourceValue > 0 ? sourceValue : null
}

type NormalizedBenchmarkPoint = {
  date: string
  price: number
  fetchedAt: string
}

function normalizeBenchmarkHistory(history: MarketPriceHistoryPoint[]) {
  const byDate = new Map<string, NormalizedBenchmarkPoint>()
  for (const point of history) {
    const date = dateKey(point.price_date)
    const price = benchmarkValue(point)
    if (!date || price == null) continue
    const normalized = { date, price, fetchedAt: String(point.fetched_at ?? '') }
    const current = byDate.get(date)
    if (!current || normalized.fetchedAt.localeCompare(current.fetchedAt) >= 0) byDate.set(date, normalized)
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function closestBenchmarkPoint(history: NormalizedBenchmarkPoint[], date: string, startIndex: number) {
  let index = startIndex
  while (index < history.length - 1 && history[index + 1].date <= date) index += 1
  const point = history[index]
  if (!point || point.date > date || daysBetween(point.date, date) > BENCHMARK_STALE_DAYS) return { point: null, index }
  return { point, index }
}

function benchmarkRelative(curve: ReturnCurvePoint[], history: MarketPriceHistoryPoint[]) {
  const validCurve = curve
    .map((point) => ({ ...point, date: dateKey(point.date) }))
    .filter((point) => point.date && Number.isFinite(point.value) && point.value >= MIN_CURVE_VALUE)
  const benchmark = normalizeBenchmarkHistory(history)

  if (validCurve.length < MIN_BENCHMARK_OVERLAP_POINTS || benchmark.length < 2) {
    return { points: [], metric: metric(null, 'Need portfolio and benchmark history.'), overlapPoints: 0, startDate: null, endDate: null }
  }

  const matched: { curve: ReturnCurvePoint; benchmarkPrice: number }[] = []
  let benchmarkIndex = 0
  for (const point of validCurve) {
    const match = closestBenchmarkPoint(benchmark, point.date, benchmarkIndex)
    benchmarkIndex = match.index
    if (match.point) matched.push({ curve: point, benchmarkPrice: match.point.price })
  }

  if (matched.length < MIN_BENCHMARK_OVERLAP_POINTS) return { points: [], metric: metric(null, 'Benchmark overlap too short.'), overlapPoints: matched.length, startDate: matched[0]?.curve.date ?? null, endDate: matched[matched.length - 1]?.curve.date ?? null }
  const first = matched[0]
  const last = matched[matched.length - 1]
  if (daysBetween(first.curve.date, last.curve.date) < MIN_BENCHMARK_OVERLAP_DAYS) {
    return { points: [], metric: metric(null, 'Benchmark overlap too short.', first.curve.date, last.curve.date), overlapPoints: matched.length, startDate: first.curve.date, endDate: last.curve.date }
  }

  const basePortfolio = first.curve.value
  const baseBenchmark = first.benchmarkPrice
  if (!Number.isFinite(basePortfolio) || !Number.isFinite(baseBenchmark) || basePortfolio < MIN_CURVE_VALUE || baseBenchmark <= 0) {
    return { points: [], metric: metric(null, 'Benchmark-relative baseline is invalid.', first.curve.date, last.curve.date), overlapPoints: matched.length, startDate: first.curve.date, endDate: last.curve.date }
  }
  const points = matched.flatMap((item) => {
    const portfolio = item.curve.value / basePortfolio * 100
    const benchmarkValueIndexed = item.benchmarkPrice / baseBenchmark * 100
    if (!Number.isFinite(portfolio) || !Number.isFinite(benchmarkValueIndexed) || portfolio < MIN_CURVE_VALUE || benchmarkValueIndexed <= 0) return []
    return [{
      date: item.curve.date,
      label: item.curve.label,
      portfolio,
      benchmark: benchmarkValueIndexed,
      relativeReturnPct: portfolio / benchmarkValueIndexed - 1,
    }]
  })

  if (points.length < MIN_BENCHMARK_OVERLAP_POINTS) return { points: [], metric: metric(null, 'Benchmark comparison has too few valid points.', first.curve.date, last.curve.date), overlapPoints: points.length, startDate: first.curve.date, endDate: last.curve.date }
  const final = points[points.length - 1]
  const relative = final.portfolio / final.benchmark - 1
  if (!Number.isFinite(relative) || Math.abs(relative) > MAX_TOTAL_RETURN || relative <= -0.95) {
    return { points: [], metric: metric(null, 'Benchmark-relative estimate suppressed by safety guard.', first.curve.date, last.curve.date), overlapPoints: points.length, startDate: first.curve.date, endDate: last.curve.date }
  }
  return { points, metric: metric(relative, undefined, first.curve.date, last.curve.date), overlapPoints: points.length, startDate: first.curve.date, endDate: last.curve.date }
}

function buildExclusionReasonCounts(intervals: ReturnInterval[]): Record<ExclusionReason, number> {
  const counts = Object.fromEntries(Object.keys(EXCLUSION_LABELS).map((key) => [key, 0])) as Record<ExclusionReason, number>
  for (const interval of intervals) {
    if (interval.excludedReason) counts[interval.excludedReason] += 1
  }
  return counts
}

function exclusionSummary(counts: Record<ExclusionReason, number>) {
  const entries = (Object.keys(counts) as ExclusionReason[])
    .filter((key) => counts[key] > 0)
    .sort((a, b) => counts[b] - counts[a])
    .slice(0, 3)
  if (entries.length === 0) return 'none'
  return entries.map((key) => `${EXCLUSION_LABELS[key]} ${counts[key]}`).join(' · ')
}

export function buildTruePortfolioReturns(input: EngineInput): TruePortfolioReturns {
  const snapshots = sortSnapshots(input.snapshots)
  const events = buildEvents(input)
  const intervals = buildIntervals(snapshots, events)
  const validIntervals = intervals.filter((interval) => interval.validForTwr && interval.returnPct != null)
  const excludedIntervals = intervals.filter((interval) => !interval.validForTwr)
  const excludedRatio = intervals.length > 0 ? excludedIntervals.length / intervals.length : 1
  const curve = cumulativeCurve(validIntervals)
  const twr = curve.points.length > 0 ? twrMetric(curve.points, excludedRatio) : metric(null, curve.reason ?? 'Need more valid return curve points.')
  const rolling = rollingReturnCurve(curve.points)
  const rollingBounds = rollingExtremes(rolling)
  const drawdowns = drawdownCurve(curve.points)
  const benchmark = benchmarkRelative(curve.points, input.benchmarkHistory)
  const exclusionReasonCounts = buildExclusionReasonCounts(intervals)
  const diagnostics = buildSanityDiagnostics(snapshots, intervals, validIntervals, benchmark.overlapPoints)
  const twrCalibrated = calibrateMetric(twr, 'TWR estimate', diagnostics)
  const mwrCalibrated = calibrateMetric(mwrApproxMetric(snapshots, intervals), 'MWR approximation', diagnostics)
  const cagrCalibrated = calibrateMetric(cagrMetric(twrCalibrated), 'CAGR', diagnostics)

  return {
    intervals,
    validIntervals,
    excludedIntervals,
    cumulativeReturnCurve: curve.points,
    rollingReturnCurve: rolling,
    drawdownCurve: drawdowns.points,
    benchmarkRelativeCurve: benchmark.points,
    benchmarkOverlapPoints: benchmark.overlapPoints,
    benchmarkOverlapStartDate: benchmark.startDate,
    benchmarkOverlapEndDate: benchmark.endDate,
    validIntervalStartDate: validIntervals[0]?.startDate ?? null,
    validIntervalEndDate: validIntervals[validIntervals.length - 1]?.endDate ?? null,
    exclusionReasonCounts,
    exclusionReasonSummary: exclusionSummary(exclusionReasonCounts),
    returnCurveReason: curve.reason,
    drawdownReason: drawdowns.reason,
    twrReturn: twrCalibrated,
    mwrApprox: mwrCalibrated,
    cagr: cagrCalibrated,
    rolling30dVolatility: rolling30dVolatility(intervals),
    bestRolling12m: rollingBounds.best,
    worstRolling12m: rollingBounds.worst,
    benchmarkRelativeReturn: benchmark.metric,
    recoveryFromDrawdownMonths: recoveryMetric(drawdowns.points, validIntervals),
    sanityDiagnostics: diagnostics,
    summaryReason: twrCalibrated.available ? null : twrCalibrated.reason ?? curve.reason ?? 'True return engine needs more valid history.',
  }
}
