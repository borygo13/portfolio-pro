import { BASE_CURRENCY, normalizeCurrencyCode } from '@/lib/currency'

export type InvestmentTransactionType = 'BUY' | 'SELL'

export type TransactionMathInput = {
  transactionType: InvestmentTransactionType
  quantity: number
  priceSource: number
  feesSource?: number | null
  sourceCurrency?: string | null
  fxRateToBase?: number | null
  baseCurrency?: string | null
  fxRateDate?: string | null
  fxRateSource?: string | null
}

export type TransactionMathResult = {
  transactionType: InvestmentTransactionType
  quantity: number
  priceSource: number
  feesSource: number
  sourceCurrency: string
  fxRateToBase: number | null
  baseCurrency: string
  priceBase: number | null
  feesBase: number | null
  grossAmountSource: number
  grossAmountBase: number | null
  netAmountBase: number | null
  cashFlowBase: number | null
  fxRateDate: string | null
  fxRateSource: string | null
  baseConversionAvailable: boolean
}

export type TransactionAmountLike = {
  transaction_type: InvestmentTransactionType
  quantity?: number | string | null
  price?: number | string | null
  fees?: number | string | null
  source_currency?: string | null
  price_source?: number | string | null
  fees_source?: number | string | null
  fx_rate_to_base?: number | string | null
  base_currency?: string | null
  price_base?: number | string | null
  fees_base?: number | string | null
  gross_amount_source?: number | string | null
  gross_amount_base?: number | string | null
  fx_rate_date?: string | null
  fx_rate_source?: string | null
}

const EPSILON = 0.00000001

export function moneyNumber(value: unknown, fallback = 0) {
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

function requirePositive(value: unknown, label: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} musi być większe od zera.`)
  return parsed
}

function requireNonNegative(value: unknown, label: string) {
  const parsed = Number(value ?? 0)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} nie może być ujemne.`)
  return parsed
}

export function calculateTransactionAmounts(input: TransactionMathInput): TransactionMathResult {
  const baseCurrency = normalizeCurrencyCode(input.baseCurrency, BASE_CURRENCY)
  const sourceCurrency = normalizeCurrencyCode(input.sourceCurrency, baseCurrency)
  const quantity = requirePositive(input.quantity, 'Liczba jednostek')
  const priceSource = requirePositive(input.priceSource, 'Cena')
  const feesSource = requireNonNegative(input.feesSource, 'Prowizja')
  const grossAmountSource = quantity * priceSource
  const fxRateToBase = sourceCurrency === baseCurrency ? 1 : positiveOrNull(input.fxRateToBase)
  const priceBase = fxRateToBase ? priceSource * fxRateToBase : null
  const feesBase = fxRateToBase ? feesSource * fxRateToBase : null
  const grossAmountBase = fxRateToBase ? grossAmountSource * fxRateToBase : null
  const sourceNet = input.transactionType === 'BUY'
    ? grossAmountSource + feesSource
    : grossAmountSource - feesSource

  if (input.transactionType === 'SELL' && sourceNet < -EPSILON) {
    throw new Error('Prowizja nie może przekraczać wartości sprzedaży.')
  }

  const netAmountBase = grossAmountBase == null || feesBase == null
    ? null
    : input.transactionType === 'BUY'
      ? grossAmountBase + feesBase
      : Math.max(0, grossAmountBase - feesBase)

  return {
    transactionType: input.transactionType,
    quantity,
    priceSource,
    feesSource,
    sourceCurrency,
    fxRateToBase,
    baseCurrency,
    priceBase,
    feesBase,
    grossAmountSource,
    grossAmountBase,
    netAmountBase,
    cashFlowBase: netAmountBase == null ? null : input.transactionType === 'BUY' ? -netAmountBase : netAmountBase,
    fxRateDate: input.fxRateDate ?? null,
    fxRateSource: input.fxRateSource ?? null,
    baseConversionAvailable: netAmountBase != null,
  }
}

export function transactionBaseCurrency(transaction: TransactionAmountLike) {
  return normalizeCurrencyCode(transaction.base_currency, BASE_CURRENCY)
}

export function transactionSourceCurrency(transaction: TransactionAmountLike) {
  return normalizeCurrencyCode(transaction.source_currency, transaction.base_currency ?? BASE_CURRENCY)
}

function canUseLegacyAsBase(transaction: TransactionAmountLike) {
  const sourceCurrency = transactionSourceCurrency(transaction)
  const baseCurrency = transactionBaseCurrency(transaction)
  return sourceCurrency === baseCurrency
}

export function transactionPriceSource(transaction: TransactionAmountLike) {
  return moneyNumber(amountOrNull(transaction.price_source) ?? transaction.price)
}

export function transactionFeesSource(transaction: TransactionAmountLike) {
  return moneyNumber(amountOrNull(transaction.fees_source) ?? transaction.fees)
}

export function transactionGrossSource(transaction: TransactionAmountLike) {
  const stored = amountOrNull(transaction.gross_amount_source)
  if (stored != null) return stored
  return moneyNumber(transaction.quantity) * transactionPriceSource(transaction)
}

export function transactionPriceBaseOrNull(transaction: TransactionAmountLike) {
  const stored = amountOrNull(transaction.price_base)
  if (stored != null) return stored
  if (canUseLegacyAsBase(transaction)) return amountOrNull(transaction.price)
  const fx = positiveOrNull(transaction.fx_rate_to_base)
  return fx ? transactionPriceSource(transaction) * fx : null
}

export function transactionFeesBaseOrNull(transaction: TransactionAmountLike) {
  const stored = amountOrNull(transaction.fees_base)
  if (stored != null) return stored
  if (canUseLegacyAsBase(transaction)) return amountOrNull(transaction.fees) ?? 0
  const fx = positiveOrNull(transaction.fx_rate_to_base)
  return fx ? transactionFeesSource(transaction) * fx : null
}

export function transactionGrossBaseOrNull(transaction: TransactionAmountLike) {
  const stored = amountOrNull(transaction.gross_amount_base)
  if (stored != null) return stored
  const priceBase = transactionPriceBaseOrNull(transaction)
  return priceBase == null ? null : moneyNumber(transaction.quantity) * priceBase
}

export function transactionNetBaseOrNull(transaction: TransactionAmountLike) {
  const grossBase = transactionGrossBaseOrNull(transaction)
  const feesBase = transactionFeesBaseOrNull(transaction)
  if (grossBase == null || feesBase == null) return null
  return transaction.transaction_type === 'BUY' ? grossBase + feesBase : Math.max(0, grossBase - feesBase)
}

export function transactionFeeBase(transaction: TransactionAmountLike) {
  return transactionFeesBaseOrNull(transaction) ?? 0
}

export function transactionTaxBase(_transaction: TransactionAmountLike) {
  return 0
}

export function transactionNetBase(transaction: TransactionAmountLike) {
  return transactionNetBaseOrNull(transaction) ?? 0
}

export function transactionHasBaseValuation(transaction: TransactionAmountLike) {
  return transactionNetBaseOrNull(transaction) != null
}
