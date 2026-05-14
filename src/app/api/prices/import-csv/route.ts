import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getServerSupabase, type ServerSupabase } from '@/lib/market/persistence'
import {
  isCsvImportSourceLabel,
  parseHistoricalPriceCsv,
  type CsvImportSourceLabel,
  type ParsedCsvPriceRow,
} from '@/lib/market/csv-import'

const UPSERT_CHUNK_SIZE = 200
const SUPPORTED_CURRENCIES = ['PLN', 'EUR', 'USD'] as const
type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number]

type VerifiedImportRequest = {
  portfolioId: string
  baseCurrency: SupportedCurrency
  assetId: string
  sourceSymbol: string
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
  fetchedAt: string
}) {
  const sameCurrency = options.sourceCurrency === options.baseCurrency
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
    fx_rate_to_base: sameCurrency ? 1 : null,
    close_price_base: sameCurrency ? options.row.closePrice : null,
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
    const payloads = preview.rows.map((row) => marketPricePayload({
      portfolioId: verified.portfolioId,
      assetId: verified.assetId,
      row,
      source,
      sourceSymbol: verified.sourceSymbol,
      sourceCurrency,
      baseCurrency: verified.baseCurrency,
      fetchedAt,
    }))
    const savedRows = await upsertCsvPrices(serverSupabase, payloads)

    return NextResponse.json({
      ok: true,
      savedRows,
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
