import { NextResponse } from 'next/server'
import { FX_PREVIOUS_LOOKBACK_DAYS, fxDateKey, fxDaysBetween, normalizeCurrencyCode } from '@/lib/market/fx'
import { getNbpHistoricalRatesToPlnWithFallback } from '@/lib/market/providers/nbp'

const BASE_CURRENCY = 'PLN'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const currency = normalizeCurrencyCode(url.searchParams.get('currency'), BASE_CURRENCY)
  const date = fxDateKey(url.searchParams.get('date'))

  if (!date) {
    return NextResponse.json({ ok: false, error: 'INVALID_DATE', message: 'Podaj poprawną datę transakcji.' }, { status: 400 })
  }

  if (currency === BASE_CURRENCY) {
    return NextResponse.json({
      ok: true,
      currency,
      baseCurrency: BASE_CURRENCY,
      rate: 1,
      rateDate: date,
      source: 'PLN',
      fallbackDays: 0,
      lookbackDays: FX_PREVIOUS_LOOKBACK_DAYS,
    })
  }

  try {
    const rates = await getNbpHistoricalRatesToPlnWithFallback(currency, [date], FX_PREVIOUS_LOOKBACK_DAYS)
    const rate = rates.get(date)

    if (!rate) {
      return NextResponse.json({
        ok: false,
        error: 'FX_MISSING',
        currency,
        baseCurrency: BASE_CURRENCY,
        rate: null,
        rateDate: null,
        source: null,
        fallbackDays: null,
        lookbackDays: FX_PREVIOUS_LOOKBACK_DAYS,
        message: `Brak kursu ${currency}/${BASE_CURRENCY} dla tej daty i poprzednich ${FX_PREVIOUS_LOOKBACK_DAYS} dni.`,
      })
    }

    const fallbackDays = fxDaysBetween(rate.rateDate, date)
    return NextResponse.json({
      ok: true,
      currency,
      baseCurrency: BASE_CURRENCY,
      rate: rate.rate,
      rateDate: rate.rateDate,
      source: fallbackDays > 0 ? `${rate.source} previous available` : rate.source,
      fallbackDays,
      lookbackDays: FX_PREVIOUS_LOOKBACK_DAYS,
    })
  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      error: 'FX_FETCH_FAILED',
      currency,
      baseCurrency: BASE_CURRENCY,
      rate: null,
      rateDate: null,
      source: null,
      fallbackDays: null,
      lookbackDays: FX_PREVIOUS_LOOKBACK_DAYS,
      message: error?.message ?? `Nie udało się pobrać kursu ${currency}/${BASE_CURRENCY}.`,
    }, { status: 502 })
  }
}
