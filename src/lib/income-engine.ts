import { BASE_CURRENCY, normalizeCurrencyCode, SUPPORTED_TRANSACTION_CURRENCIES, type SupportedTransactionCurrency } from '@/lib/currency'

export type IncomeType = 'DIVIDEND' | 'BOND_INTEREST' | 'CASH_INTEREST' | 'STAKING' | 'OTHER'
export type IncomeCurrency = SupportedTransactionCurrency

export type IncomeAmountInput = {
  incomeType?: IncomeType
  grossAmount: number
  withholdingTax?: number | null
  localTax?: number | null
  otherFees?: number | null
  currency?: string | null
  baseCurrency?: string | null
  fxRateToBase?: number | null
  fxRateDate?: string | null
  fxRateSource?: string | null
}

export type IncomeAmountResult = {
  incomeType: IncomeType
  currency: IncomeCurrency
  baseCurrency: IncomeCurrency
  grossAmount: number
  withholdingTax: number
  localTax: number
  otherFees: number
  netAmount: number
  fxRateToBase: number | null
  fxRateDate: string | null
  fxRateSource: string | null
  grossAmountBase: number | null
  withholdingTaxBase: number | null
  localTaxBase: number | null
  otherFeesBase: number | null
  netAmountBase: number | null
  baseConversionAvailable: boolean
}

export type IncomeEventLike = {
  income_type?: IncomeType | string | null
  currency?: string | null
  base_currency?: string | null
  gross_amount?: number | string | null
  withholding_tax?: number | string | null
  local_tax?: number | string | null
  other_fees?: number | string | null
  net_amount?: number | string | null
  fx_rate_to_base?: number | string | null
  gross_amount_base?: number | string | null
  withholding_tax_base?: number | string | null
  local_tax_base?: number | string | null
  other_fees_base?: number | string | null
  net_amount_base?: number | string | null
  payment_date?: string | null
  asset_id?: string | null
}

export type IncomeSummary = {
  count: number
  missingBaseCount: number
  grossBase: number
  withholdingTaxBase: number
  localTaxBase: number
  otherFeesBase: number
  taxBase: number
  netBase: number
  currentYearNetBase: number
  currentYearTaxBase: number
  allTimeNetBase: number
}

export type IncomeMonthlyPoint = {
  date: string
  month: string
  gross: number
  tax: number
  net: number
}

export type IncomeByAssetPoint = {
  assetId: string
  symbol: string
  name: string
  count: number
  netBase: number
  latestPaymentDate: string | null
}

const SUPPORTED = new Set<string>(SUPPORTED_TRANSACTION_CURRENCIES)
const EPSILON = 0.00000001

function n(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback)
  return Number.isFinite(parsed) ? parsed : fallback
}

function amountOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function positiveOrNull(value: unknown) {
  const parsed = amountOrNull(value)
  return parsed != null && parsed > 0 ? parsed : null
}

export function normalizeIncomeCurrency(value: string | null | undefined, fallback: string = BASE_CURRENCY): IncomeCurrency {
  const currency = normalizeCurrencyCode(value, fallback)
  return (SUPPORTED.has(currency) ? currency : fallback) as IncomeCurrency
}

function nonNegative(value: unknown, label: string) {
  const parsed = n(value)
  if (parsed < 0) throw new Error(`${label} nie może być ujemna.`)
  return parsed
}

export function calculateIncomeAmounts(input: IncomeAmountInput): IncomeAmountResult {
  const currency = normalizeIncomeCurrency(input.currency)
  const baseCurrency = normalizeIncomeCurrency(input.baseCurrency, BASE_CURRENCY)
  const grossAmount = nonNegative(input.grossAmount, 'Kwota brutto')
  const withholdingTax = nonNegative(input.withholdingTax, 'Podatek u źródła')
  const localTax = nonNegative(input.localTax, 'Podatek lokalny')
  const otherFees = nonNegative(input.otherFees, 'Inne opłaty')
  const netAmount = grossAmount - withholdingTax - localTax - otherFees

  if (netAmount < -EPSILON) {
    throw new Error('Kwota netto nie może być ujemna. Podatki i opłaty przekraczają kwotę brutto.')
  }

  const fxRateToBase = currency === baseCurrency ? 1 : positiveOrNull(input.fxRateToBase)
  const toBase = (value: number) => fxRateToBase ? value * fxRateToBase : null

  return {
    incomeType: input.incomeType ?? 'DIVIDEND',
    currency,
    baseCurrency,
    grossAmount,
    withholdingTax,
    localTax,
    otherFees,
    netAmount: Math.max(0, netAmount),
    fxRateToBase,
    fxRateDate: input.fxRateDate ?? null,
    fxRateSource: input.fxRateSource ?? null,
    grossAmountBase: toBase(grossAmount),
    withholdingTaxBase: toBase(withholdingTax),
    localTaxBase: toBase(localTax),
    otherFeesBase: toBase(otherFees),
    netAmountBase: toBase(Math.max(0, netAmount)),
    baseConversionAvailable: fxRateToBase != null,
  }
}

export function incomeNetBaseOrNull(event: IncomeEventLike) {
  const stored = amountOrNull(event.net_amount_base)
  if (stored != null) return stored
  const sourceCurrency = normalizeIncomeCurrency(event.currency, BASE_CURRENCY)
  const baseCurrency = normalizeIncomeCurrency(event.base_currency, BASE_CURRENCY)
  if (sourceCurrency === baseCurrency) return amountOrNull(event.net_amount) ?? 0
  const fx = positiveOrNull(event.fx_rate_to_base)
  return fx ? n(event.net_amount) * fx : null
}

function incomeBaseAmount(event: IncomeEventLike, baseField: keyof IncomeEventLike, sourceField: keyof IncomeEventLike) {
  const stored = amountOrNull(event[baseField])
  if (stored != null) return stored
  const sourceCurrency = normalizeIncomeCurrency(event.currency, BASE_CURRENCY)
  const baseCurrency = normalizeIncomeCurrency(event.base_currency, BASE_CURRENCY)
  if (sourceCurrency === baseCurrency) return amountOrNull(event[sourceField]) ?? 0
  const fx = positiveOrNull(event.fx_rate_to_base)
  return fx ? n(event[sourceField]) * fx : null
}

function monthKey(value: string) {
  return value.slice(0, 7)
}

function monthLabel(value: string) {
  const date = new Date(`${value}-01T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('pl-PL', { month: 'short', year: '2-digit' })
}

export function summarizeIncomeEvents(events: IncomeEventLike[], baseCurrency: string = BASE_CURRENCY): IncomeSummary {
  const currentYear = new Date().getFullYear().toString()
  const base = normalizeIncomeCurrency(baseCurrency)
  let grossBase = 0
  let withholdingTaxBase = 0
  let localTaxBase = 0
  let otherFeesBase = 0
  let netBase = 0
  let currentYearNetBase = 0
  let currentYearTaxBase = 0
  let missingBaseCount = 0

  for (const event of events) {
    const net = incomeNetBaseOrNull(event)
    const gross = incomeBaseAmount(event, 'gross_amount_base', 'gross_amount')
    const withholding = incomeBaseAmount(event, 'withholding_tax_base', 'withholding_tax')
    const local = incomeBaseAmount(event, 'local_tax_base', 'local_tax')
    const fees = incomeBaseAmount(event, 'other_fees_base', 'other_fees')

    if (net == null || gross == null || withholding == null || local == null || fees == null) {
      missingBaseCount += 1
      continue
    }

    grossBase += gross
    withholdingTaxBase += withholding
    localTaxBase += local
    otherFeesBase += fees
    netBase += net

    if (event.payment_date?.startsWith(currentYear)) {
      currentYearNetBase += net
      currentYearTaxBase += withholding + local
    }
  }

  const taxBase = withholdingTaxBase + localTaxBase
  return {
    count: events.length,
    missingBaseCount,
    grossBase,
    withholdingTaxBase,
    localTaxBase,
    otherFeesBase,
    taxBase,
    netBase: base ? netBase : 0,
    currentYearNetBase,
    currentYearTaxBase,
    allTimeNetBase: netBase,
  }
}

export function buildMonthlyIncomePoints(events: IncomeEventLike[]): IncomeMonthlyPoint[] {
  const byMonth = new Map<string, IncomeMonthlyPoint>()

  for (const event of events) {
    if (!event.payment_date) continue
    const net = incomeNetBaseOrNull(event)
    const gross = incomeBaseAmount(event, 'gross_amount_base', 'gross_amount')
    const withholding = incomeBaseAmount(event, 'withholding_tax_base', 'withholding_tax')
    const local = incomeBaseAmount(event, 'local_tax_base', 'local_tax')
    if (net == null || gross == null || withholding == null || local == null) continue

    const key = monthKey(event.payment_date)
    const current = byMonth.get(key) ?? { date: `${key}-01`, month: monthLabel(key), gross: 0, tax: 0, net: 0 }
    current.gross += gross
    current.tax += withholding + local
    current.net += net
    byMonth.set(key, current)
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, point]) => point)
}

export function summarizeIncomeByAsset<T extends IncomeEventLike & { assets?: { symbol?: string | null; name?: string | null } | null }>(events: T[]): IncomeByAssetPoint[] {
  const byAsset = new Map<string, IncomeByAssetPoint>()

  for (const event of events) {
    const assetId = event.asset_id ?? 'unassigned'
    const net = incomeNetBaseOrNull(event)
    const current = byAsset.get(assetId) ?? {
      assetId,
      symbol: event.assets?.symbol ?? 'Dochód',
      name: event.assets?.name ?? 'Bez aktywa',
      count: 0,
      netBase: 0,
      latestPaymentDate: null,
    }
    current.count += 1
    if (net != null) current.netBase += net
    if (event.payment_date && (!current.latestPaymentDate || event.payment_date > current.latestPaymentDate)) {
      current.latestPaymentDate = event.payment_date
    }
    byAsset.set(assetId, current)
  }

  return Array.from(byAsset.values()).sort((a, b) => b.netBase - a.netBase)
}
