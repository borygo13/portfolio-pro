export const BASE_CURRENCY = 'PLN' as const

export const SUPPORTED_TRANSACTION_CURRENCIES = ['PLN', 'EUR', 'USD', 'GBP', 'CHF'] as const

export type BaseCurrency = typeof BASE_CURRENCY
export type SupportedTransactionCurrency = typeof SUPPORTED_TRANSACTION_CURRENCIES[number]

export function normalizeCurrencyCode(value: string | null | undefined, fallback: string = BASE_CURRENCY) {
  const normalized = String(value ?? '').trim().toUpperCase()
  return normalized || fallback
}
