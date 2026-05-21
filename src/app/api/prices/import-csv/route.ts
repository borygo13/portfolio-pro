import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { FX_PREVIOUS_LOOKBACK_DAYS, fxDaysBetween } from '@/lib/market/fx'
import { getServerSupabase, type ServerSupabase } from '@/lib/market/persistence'
import { getNbpHistoricalRatesToPlnWithFallback } from '@/lib/market/providers/nbp'
import {
  isCsvImportSourceLabel,
  parseHistoricalPriceCsv,
  type CsvImportSourceLabel,
  type ParsedCsvPriceRow,
} from '@/lib/market/csv-import'
import type { FxRateResult } from '@/lib/market/types'

const UPSERT_CHUNK_SIZE = 200
const SUPPORTED_CURRENCIES = ['PLN', 'EUR', 'USD'] as const
type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number]

type VerifiedImportRequest = {
  portfolioId: string
  baseCurrency: SupportedCurrency
  assetId: string
  sourceSymbol: string
}

type CsvFxStats = {
  fxExactRows: number
  fxFallbackRows: number
  fxMissingRows: number
  maxFxFallbackDays: number
}

function getBearerToken(request: Request) {
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

function createUserSupabase(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null

  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function normalizeCurrency(value: unknown): SupportedCurrency {
  const currency = String(value ?? '').trim().toUpperCase()
  return SUPPORTED_CURRENCIES.includes(currency as SupportedCurrency) ? currency as SupportedCurrency : 'PLN'
}

async function verifyUser(supabase: SupabaseClient, token: string) {
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return false
  return true
}

async function verifyImportRequest(supabase: SupabaseClient, body: any): Promise<VerifiedImportRequest> {
  const portfolioId = typeof body?.portfolio_id === 'string' ? body.portfolio_id : ''
  const assetId = typeof body?.asset_id === 'string' ? body.asset_id : ''
  if (!portfolioId || !assetId) throw new Error('Wybierz portfolio i aktywo do importu CSV.')

  const { data: portfolio, error: portfolioError } = await supabase
    .from('portfolios')
    .select('id,currency')
    .eq('id', portfolioId)
    .maybeSingle()

  if (portfolioError) throw new Error(`portfolios: ${portfolioError.message}`)
  if (!portfolio?.id) throw new Error('Nie znaleziono portfolio dla aktywnej sesji.')

  const { data: asset, error: assetError } = await supabase
    .from('assets')
    .select('id,portfolio_id,symbol,market_symbol')
    .eq('portfolio_id', portfolioId)
    .eq('id', assetId)
    .maybeSingle()

  if (assetError) throw new Error(`assets: ${assetError.message}`)
  if (!asset?.id) throw new Error('Nie znaleziono aktywa w tym portfolio.')

  return {
    portfolioId,
    baseCurrency: normalizeCurrency(portfolio.currency),
    assetId,
    sourceSymbol: String(asset.market_symbol || asset.symbol || assetId),
  }
}

function marketPricePayload(options: {
  portfolioId: string
  assetId: string
  row: ParsedCsvPriceRow
  source: CsvImportSourceLabel
  sourceSymbol: string
  sourceCurrency: SupportedCurrency
  baseCurrency: SupportedCurrency
  fxRate: FxRateResult | null
  fetchedAt: string
}) {
  const sameCurrency = options.sourceCurrency === options.baseCurrency
  const fxRate = sameCurrency ? 1 : options.fxRate?.rate ?? null
  const closePriceBase = sameCurrency
    ? options.row.closePrice
    : options.fxRate
      ? options.row.closePrice * options.fxRate.rate
      : null

  return {
    portfolio_id: options.portfolioId,
    asset_id: options.assetId,
    source: options.source,
    source_symbol: options.sourceSymbol,
    price_date: options.row.priceDate,
    open_price: options.row.openPrice,
    high_price: options.row.highPrice,
    low_price: options.row.lowPrice,
    close_price: options.row.closePrice,
    adjusted_close_price: options.row.adjustedClosePrice ?? options.row.closePrice,
    source_currency: options.sourceCurrency,
    base_currency: options.baseCurrency,
    fx_rate_to_base: fxRate,
    close_price_base: closePriceBase,
    fetched_at: options.fetchedAt,
  }
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

async function upsertCsvPrices(supabase: ServerSupabase, payloads: ReturnType<typeof marketPricePayload>[]) {
  let savedRows = 0
  for (const part of chunk(payloads, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase.from('market_prices').upsert(part, { onConflict: 'asset_id,source,price_date' })
    if (error) throw new Error(`market_prices: ${error.message}`)
    savedRows += part.length
  }
  return savedRows
}

async function upsertCsvFxRates(supabase: ServerSupabase, rates: FxRateResult[]) {
  const byKey = new Map<string, FxRateResult>()
  for (const rate of rates) {
    if (rate.fromCurrency === rate.toCurrency || rate.rate <= 0) continue
    byKey.set(`${rate.fromCurrency}:${rate.toCurrency}:${rate.rateDate}:${rate.source}`, rate)
  }

  for (const part of chunk(Array.from(byKey.values()).map((rate) => ({
    from_currency: rate.fromCurrency,
    to_currency: rate.toCurrency,
    rate_date: rate.rateDate,
    rate: rate.rate,
    source: rate.source.toLowerCase(),
    fetched_at: rate.fetchedAt,
  })), UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase.from('fx_rates').upsert(part, { onConflict: 'from_currency,to_currency,rate_date,source' })
    if (error) throw new Error(`fx_rates: ${error.message}`)
  }
}

async function buildCsvFxMap(sourceCurrency: SupportedCurrency, baseCurrency: SupportedCurrency, rows: ParsedCsvPriceRow[]) {
  if (sourceCurrency === baseCurrency || sourceCurrency === 'PLN' || baseCurrency !== 'PLN') return new Map<string, FxRateResult>()
  return getNbpHistoricalRatesToPlnWithFallback(sourceCurrency, rows.map((row) => row.priceDate), FX_PREVIOUS_LOOKBACK_DAYS)
}

function csvFxStats(rows: ParsedCsvPriceRow[], sourceCurrency: SupportedCurrency, baseCurrency: SupportedCurrency, fxByDate: Map<string, FxRateResult>): CsvFxStats {
  if (sourceCurrency === baseCurrency) return { fxExactRows: 0, fxFallbackRows: 0, fxMissingRows: 0, maxFxFallbackDays: 0 }
  if (baseCurrency !== 'PLN') return { fxExactRows: 0, fxFallbackRows: 0, fxMissingRows: rows.length, maxFxFallbackDays: 0 }

  let fxExactRows = 0
  let fxFallbackRows = 0
  let fxMissingRows = 0
  let maxFxFallbackDays = 0

  for (const row of rows) {
    const rate = fxByDate.get(row.priceDate)
    if (!rate) {
      fxMissingRows += 1
      continue
    }

    const ageDays = fxDaysBetween(rate.rateDate, row.priceDate)
    if (ageDays > 0) {
      fxFallbackRows += 1
      maxFxFallbackDays = Math.max(maxFxFallbackDays, ageDays)
    } else {
      fxExactRows += 1
    }
  }

  return { fxExactRows, fxFallbackRows, fxMissingRows, maxFxFallbackDays }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const token = getBearerToken(request)
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const userSupabase = createUserSupabase(token)
    if (!userSupabase) throw new Error('Brak konfiguracji Supabase dla importu CSV.')
    if (!await verifyUser(userSupabase, token)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const source = isCsvImportSourceLabel(body?.source) ? body.source : 'manual_csv'
    const sourceCurrency = normalizeCurrency(body?.source_currency)
    const csvText = typeof body?.csv === 'string' ? body.csv : ''
    if (!csvText.trim()) throw new Error('Wklej albo wczytaj CSV przed importem.')

    const verified = await verifyImportRequest(userSupabase, body)
    const preview = parseHistoricalPriceCsv(csvText)
    if (preview.validRows === 0) {
      return NextResponse.json({ error: 'CSV nie ma poprawnych wierszy do zapisania.', preview }, { status: 400 })
    }

    const serverSupabase = getServerSupabase()
    if (!serverSupabase) throw new Error('Brak SUPABASE_SERVICE_ROLE_KEY dla importu CSV.')

    const fetchedAt = new Date().toISOString()
    const fxByDate = await buildCsvFxMap(sourceCurrency, verified.baseCurrency, preview.rows)
    const payloads = preview.rows.map((row) => marketPricePayload({
      portfolioId: verified.portfolioId,
      assetId: verified.assetId,
      row,
      source,
      sourceSymbol: verified.sourceSymbol,
      sourceCurrency,
      baseCurrency: verified.baseCurrency,
      fxRate: fxByDate.get(row.priceDate) ?? null,
      fetchedAt,
    }))
    await upsertCsvFxRates(serverSupabase, Array.from(fxByDate.values()))
    const savedRows = await upsertCsvPrices(serverSupabase, payloads)
    const fxStats = csvFxStats(preview.rows, sourceCurrency, verified.baseCurrency, fxByDate)

    return NextResponse.json({
      ok: true,
      savedRows,
      ...fxStats,
      fxLookbackDays: FX_PREVIOUS_LOOKBACK_DAYS,
      source,
      sourceCurrency,
      baseCurrency: verified.baseCurrency,
      sourceSymbol: verified.sourceSymbol,
      preview,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'CSV price import failed' }, { status: 500 })
  }
}
