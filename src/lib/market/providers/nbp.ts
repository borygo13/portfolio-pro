import type { FxRateResult } from '@/lib/market/types'
import { FX_PREVIOUS_LOOKBACK_DAYS, fxAddDays, fxDateKey, fxDaysBetween } from '@/lib/market/fx'

const FX_RANGE_CHUNK_DAYS = 90

function normalizeCurrency(currency: string) {
  return currency.trim().toUpperCase()
}

function chunkDates(startDate: string, endDate: string) {
  const chunks: { start: string; end: string }[] = []
  let cursor = startDate
  while (cursor <= endDate) {
    const end = fxAddDays(cursor, FX_RANGE_CHUNK_DAYS - 1)
    chunks.push({ start: cursor, end: end < endDate ? end : endDate })
    cursor = fxAddDays(chunks[chunks.length - 1].end, 1)
  }
  return chunks
}

export async function getNbpRateToPln(currency: string): Promise<FxRateResult> {
  const ccy = normalizeCurrency(currency)
  const fetchedAt = new Date().toISOString()

  if (!ccy || ccy === 'PLN') {
    return { fromCurrency: 'PLN', toCurrency: 'PLN', rate: 1, rateDate: fetchedAt.slice(0, 10), source: 'NBP', fetchedAt }
  }

  const res = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/${ccy}/?format=json`, { next: { revalidate: 3600 } })
  if (!res.ok) throw new Error(`Brak kursu NBP dla ${ccy}`)

  const json = await res.json()
  const rate = Number(json?.rates?.[0]?.mid)
  const rateDate = String(json?.rates?.[0]?.effectiveDate ?? fetchedAt.slice(0, 10))
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Niepoprawny kurs NBP dla ${ccy}`)

  return { fromCurrency: ccy, toCurrency: 'PLN', rate, rateDate, source: 'NBP', fetchedAt }
}

export async function getNbpHistoricalRatesToPln(currency: string, startDate: string, endDate: string): Promise<FxRateResult[]> {
  const ccy = normalizeCurrency(currency)
  const fetchedAt = new Date().toISOString()

  if (!ccy || ccy === 'PLN') {
    return [{ fromCurrency: 'PLN', toCurrency: 'PLN', rate: 1, rateDate: startDate, source: 'NBP', fetchedAt }]
  }

  const res = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/${ccy}/${startDate}/${endDate}/?format=json`, { cache: 'no-store' })
  if (!res.ok) return []

  const json = await res.json()
  const rates = Array.isArray(json?.rates) ? json.rates : []
  return rates
    .map((rateRow: any) => {
      const rate = Number(rateRow?.mid)
      const rateDate = String(rateRow?.effectiveDate ?? '')
      if (!Number.isFinite(rate) || rate <= 0 || !rateDate) return null
      return { fromCurrency: ccy, toCurrency: 'PLN', rate, rateDate, source: 'NBP', fetchedAt }
    })
    .filter(Boolean) as FxRateResult[]
}

export async function getNbpHistoricalRatesToPlnWithFallback(
  currency: string,
  dates: string[],
  lookbackDays = FX_PREVIOUS_LOOKBACK_DAYS,
): Promise<Map<string, FxRateResult>> {
  const ccy = normalizeCurrency(currency)
  const requestedDates = Array.from(new Set(dates.map(fxDateKey).filter(Boolean))).sort()
  const map = new Map<string, FxRateResult>()
  const fetchedAt = new Date().toISOString()

  if (requestedDates.length === 0) return map

  if (!ccy || ccy === 'PLN') {
    for (const date of requestedDates) {
      map.set(date, { fromCurrency: 'PLN', toCurrency: 'PLN', rate: 1, rateDate: date, source: 'NBP', fetchedAt })
    }
    return map
  }

  const startDate = fxAddDays(requestedDates[0], -lookbackDays)
  const endDate = requestedDates[requestedDates.length - 1]
  const rateRows: FxRateResult[] = []

  for (const chunk of chunkDates(startDate, endDate)) {
    rateRows.push(...await getNbpHistoricalRatesToPln(ccy, chunk.start, chunk.end))
  }

  const sortedRates = rateRows
    .filter((rate) => rate.rate > 0 && fxDateKey(rate.rateDate))
    .sort((a, b) => a.rateDate.localeCompare(b.rateDate))

  let rateIndex = -1
  for (const date of requestedDates) {
    while (rateIndex + 1 < sortedRates.length && sortedRates[rateIndex + 1].rateDate <= date) {
      rateIndex += 1
    }

    const rate = sortedRates[rateIndex] ?? null
    if (!rate) continue
    const ageDays = fxDaysBetween(rate.rateDate, date)
    if (ageDays >= 0 && ageDays <= lookbackDays) map.set(date, rate)
  }

  return map
}
