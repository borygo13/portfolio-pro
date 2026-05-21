export const FX_PREVIOUS_LOOKBACK_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export function fxDateKey(value: string | null | undefined) {
  const text = String(value ?? '').trim()
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

export function fxAddDays(date: string, days: number) {
  const key = fxDateKey(date)
  if (!key) return date
  return new Date(new Date(`${key}T00:00:00.000Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10)
}

export function fxDaysBetween(startDate: string, endDate: string) {
  const start = fxDateKey(startDate)
  const end = fxDateKey(endDate)
  if (!start || !end) return Number.POSITIVE_INFINITY
  const startTime = new Date(`${start}T00:00:00.000Z`).getTime()
  const endTime = new Date(`${end}T00:00:00.000Z`).getTime()
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return Number.POSITIVE_INFINITY
  return Math.floor((endTime - startTime) / DAY_MS)
}

export function normalizeCurrencyCode(currency: string | null | undefined, fallback = 'PLN') {
  return String(currency || fallback).trim().toUpperCase()
}
