import type { FxRateResult } from '@/lib/market/types'

function normalizeCurrency(currency: string) {
  return currency.trim().toUpperCase()
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
