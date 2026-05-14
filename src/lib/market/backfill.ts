import { resolveCoinGeckoId } from '@/lib/market/providers/coingecko'
import { getNbpHistoricalRatesToPln } from '@/lib/market/providers/nbp'
import { normalizeStooqSymbol } from '@/lib/market/providers/stooq'
import { getServerSupabase, type ServerSupabase } from '@/lib/market/persistence'
import type { AssetForPricing, FxRateResult } from '@/lib/market/types'

export const BACKFILL_RANGES = ['1Y', '3Y', '5Y', 'MAX'] as const
export type BackfillRange = typeof BACKFILL_RANGES[number]
export type BackfillScope = 'asset' | 'all_active'
export type BackfillAssetStatus = 'success' | 'partial' | 'failed' | 'skipped'

export const MAX_BACKFILL_ASSETS_PER_REQUEST = 5
const MAX_ROWS_PER_ASSET_PER_REQUEST = 2500
const UPSERT_CHUNK_SIZE = 200
const FX_RANGE_CHUNK_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

type HistoricalSource = 'coingecko' | 'stooq'

type HistoricalPricePoint = {
  assetId: string
  portfolioId: string
  symbol: string
  source: string
  sourceSymbol: string
  provider: HistoricalSource
  priceDate: string
  openPrice: number | null
  highPrice: number | null
  lowPrice: number | null
  closePrice: number
  adjustedClosePrice: number
  sourceCurrency: string
  baseCurrency: string
  fxRateToBase: number | null
  closePriceBase: number | null
  fetchedAt: string
  fxRate: FxRateResult | null
}

type RawHistoricalPricePoint = Omit<HistoricalPricePoint, 'fxRateToBase' | 'closePriceBase' | 'fxRate'>

export type BackfillAssetReport = {
  assetId: string
  symbol: string
  name?: string
  provider: HistoricalSource
  sourceSymbol: string
  range: BackfillRange
  status: BackfillAssetStatus
  fetchedRows: number
  persistedRows: number
  remainingRows: number
  fxMissingRows: number
  latestPriceDate: string | null
  error: string | null
}

export type BackfillReport = {
  ok: boolean
  runId?: string
  status: 'success' | 'partial_success' | 'failed' | 'skipped'
  portfolioId: string
  scope: BackfillScope
  range: BackfillRange
  requestedAssets: number
  processedAssets: number
  remainingCount: number
  remainingAssets: { id: string; symbol: string; name?: string }[]
  results: BackfillAssetReport[]
  error?: string
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function compactDate(date: string) {
  return date.replaceAll('-', '')
}

function addDays(date: string, days: number) {
  return formatDate(new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * DAY_MS))
}

function startDateForRange(range: BackfillRange) {
  if (range === 'MAX') return null

  const years = range === '1Y' ? 1 : range === '3Y' ? 3 : 5
  const date = new Date()
  date.setUTCFullYear(date.getUTCFullYear() - years)
  return formatDate(date)
}

function rangeWindow(range: BackfillRange) {
  return { startDate: startDateForRange(range), endDate: formatDate(new Date()) }
}

function asNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isCrypto(asset: AssetForPricing) {
  const type = (asset.asset_type ?? '').toLowerCase()
  const symbol = asset.symbol.trim().toUpperCase()
  return type.includes('crypto') || ['BTC', 'XBT', 'ETH', 'SOL', 'ADA', 'XRP', 'DOT', 'BNB', 'DOGE'].includes(symbol)
}

function stooqSource(symbol: string, currency: string) {
  return `Stooq ${symbol}${currency !== 'PLN' ? ` + NBP ${currency}/PLN` : ''}`
}

function providerSymbolError() {
  return 'Sprawdź market_symbol. Przykłady: iusq.de, aapl.us, msft.us, btc via CoinGecko bitcoin.'
}

function mapCryptoPoint(asset: AssetForPricing, id: string, date: string, price: number): RawHistoricalPricePoint {
  const fetchedAt = new Date().toISOString()
  return {
    assetId: asset.id,
    portfolioId: String(asset.portfolio_id),
    symbol: asset.symbol,
    source: `CoinGecko ${id}`,
    sourceSymbol: id,
    provider: 'coingecko',
    priceDate: date,
    openPrice: null,
    highPrice: null,
    lowPrice: null,
    closePrice: price,
    adjustedClosePrice: price,
    sourceCurrency: 'PLN',
    baseCurrency: 'PLN',
    fetchedAt,
  }
}

async function fetchCoinGeckoHistory(asset: AssetForPricing, range: BackfillRange): Promise<RawHistoricalPricePoint[]> {
  const id = resolveCoinGeckoId(asset)
  const { startDate, endDate } = rangeWindow(range)
  const fromSeconds = startDate ? Math.floor(new Date(`${startDate}T00:00:00.000Z`).getTime() / 1000) : 0
  const toSeconds = Math.floor(new Date(`${endDate}T23:59:59.999Z`).getTime() / 1000)
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart/range?vs_currency=pln&from=${fromSeconds}&to=${toSeconds}&precision=full`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}. ${providerSymbolError()}`)

  const json = await res.json()
  const prices = Array.isArray(json?.prices) ? json.prices : []
  const byDate = new Map<string, number>()

  for (const row of prices) {
    const timestamp = asNumber(row?.[0])
    const price = asNumber(row?.[1])
    if (!timestamp || !price || price <= 0) continue
    byDate.set(formatDate(new Date(timestamp)), price)
  }

  const rows = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, price]) => mapCryptoPoint(asset, id, date, price))

  if (rows.length === 0) throw new Error(`Brak historii CoinGecko dla ${id}. ${providerSymbolError()}`)
  return rows
}

async function fetchStooqHistory(asset: AssetForPricing, range: BackfillRange): Promise<RawHistoricalPricePoint[]> {
  const symbol = normalizeStooqSymbol(asset)
  const sourceCurrency = (asset.currency ?? 'PLN').toUpperCase()
  const { startDate, endDate } = rangeWindow(range)
  const params = new URLSearchParams({ s: symbol, i: 'd' })
  if (startDate) params.set('d1', compactDate(startDate))
  params.set('d2', compactDate(endDate))

  const res = await fetch(`https://stooq.pl/q/d/l/?${params.toString()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}. ${providerSymbolError()}`)

  const csv = await res.text()
  const lines = csv.trim().split(/\r?\n/).filter(Boolean)
  const delimiter = lines[0]?.includes(';') ? ';' : ','
  const rows: RawHistoricalPricePoint[] = []
  const fetchedAt = new Date().toISOString()

  for (const line of lines.slice(1)) {
    const row = line.split(delimiter)
    const priceDate = row[0]?.trim()
    const close = asNumber(row[4])
    if (!priceDate || !close || close <= 0) continue

    rows.push({
      assetId: asset.id,
      portfolioId: String(asset.portfolio_id),
      symbol: asset.symbol,
      source: stooqSource(symbol, sourceCurrency),
      sourceSymbol: symbol,
      provider: 'stooq',
      priceDate,
      openPrice: asNumber(row[1]),
      highPrice: asNumber(row[2]),
      lowPrice: asNumber(row[3]),
      closePrice: close,
      adjustedClosePrice: close,
      sourceCurrency,
      baseCurrency: 'PLN',
      fetchedAt,
    })
  }

  if (rows.length === 0) throw new Error(`Brak historii Stooq dla ${symbol}. ${providerSymbolError()}`)
  return rows
}

async function fetchHistoricalRows(asset: AssetForPricing, range: BackfillRange) {
  if (!asset.portfolio_id) throw new Error('Brak portfolio_id dla aktywa.')
  return isCrypto(asset) ? fetchCoinGeckoHistory(asset, range) : fetchStooqHistory(asset, range)
}

function latestRows(rows: RawHistoricalPricePoint[]) {
  if (rows.length <= MAX_ROWS_PER_ASSET_PER_REQUEST) return { rows, remainingRows: 0 }
  return {
    rows: rows.slice(rows.length - MAX_ROWS_PER_ASSET_PER_REQUEST),
    remainingRows: rows.length - MAX_ROWS_PER_ASSET_PER_REQUEST,
  }
}

function chunkDates(startDate: string, endDate: string) {
  const chunks: { start: string; end: string }[] = []
  let cursor = startDate
  while (cursor <= endDate) {
    const end = addDays(cursor, FX_RANGE_CHUNK_DAYS - 1)
    chunks.push({ start: cursor, end: end < endDate ? end : endDate })
    cursor = addDays(chunks[chunks.length - 1].end, 1)
  }
  return chunks
}

async function fetchFxMap(currency: string, dates: string[]) {
  const ccy = currency.toUpperCase()
  const map = new Map<string, FxRateResult>()
  if (ccy === 'PLN') return map

  const uniqueDates = Array.from(new Set(dates)).sort()
  if (uniqueDates.length === 0) return map

  for (const chunk of chunkDates(uniqueDates[0], uniqueDates[uniqueDates.length - 1])) {
    const rates = await getNbpHistoricalRatesToPln(ccy, chunk.start, chunk.end)
    for (const rate of rates) map.set(rate.rateDate, rate)
  }

  return map
}

async function applyHistoricalFx(rows: RawHistoricalPricePoint[]): Promise<HistoricalPricePoint[]> {
  const datesByCurrency = new Map<string, string[]>()

  for (const row of rows) {
    if (row.sourceCurrency === 'PLN') continue
    const current = datesByCurrency.get(row.sourceCurrency) ?? []
    current.push(row.priceDate)
    datesByCurrency.set(row.sourceCurrency, current)
  }

  const fxByCurrency = new Map<string, Map<string, FxRateResult>>()
  for (const [currency, dates] of datesByCurrency.entries()) {
    fxByCurrency.set(currency, await fetchFxMap(currency, dates))
  }

  return rows.map((row) => {
    if (row.sourceCurrency === 'PLN') {
      return { ...row, fxRateToBase: 1, closePriceBase: row.closePrice, fxRate: null }
    }

    const fx = fxByCurrency.get(row.sourceCurrency)?.get(row.priceDate) ?? null
    return {
      ...row,
      fxRateToBase: fx?.rate ?? null,
      closePriceBase: fx ? row.closePrice * fx.rate : null,
      fxRate: fx,
    }
  })
}

function marketPricePayload(row: HistoricalPricePoint) {
  return {
    portfolio_id: row.portfolioId,
    asset_id: row.assetId,
    source: row.source,
    source_symbol: row.sourceSymbol,
    price_date: row.priceDate,
    open_price: row.openPrice,
    high_price: row.highPrice,
    low_price: row.lowPrice,
    close_price: row.closePrice,
    adjusted_close_price: row.adjustedClosePrice,
    source_currency: row.sourceCurrency,
    base_currency: row.baseCurrency,
    fx_rate_to_base: row.fxRateToBase,
    close_price_base: row.closePriceBase,
    fetched_at: row.fetchedAt,
  }
}

function fxRatePayload(rate: FxRateResult) {
  return {
    from_currency: rate.fromCurrency,
    to_currency: rate.toCurrency,
    rate_date: rate.rateDate,
    rate: rate.rate,
    source: rate.source.toLowerCase(),
    fetched_at: rate.fetchedAt,
  }
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

async function upsertHistoricalRows(supabase: ServerSupabase, rows: HistoricalPricePoint[]) {
  let persistedRows = 0
  for (const part of chunk(rows.map(marketPricePayload), UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase.from('market_prices').upsert(part, { onConflict: 'asset_id,source,price_date' })
    if (error) throw new Error(`market_prices: ${error.message}`)
    persistedRows += part.length
  }
  return persistedRows
}

async function upsertHistoricalFxRates(supabase: ServerSupabase, rows: HistoricalPricePoint[]) {
  const byKey = new Map<string, FxRateResult>()
  for (const row of rows) {
    if (!row.fxRate || row.fxRate.rate <= 0 || row.fxRate.fromCurrency === row.fxRate.toCurrency) continue
    byKey.set(`${row.fxRate.fromCurrency}:${row.fxRate.toCurrency}:${row.fxRate.rateDate}:${row.fxRate.source}`, row.fxRate)
  }

  for (const part of chunk(Array.from(byKey.values()).map(fxRatePayload), UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase.from('fx_rates').upsert(part, { onConflict: 'from_currency,to_currency,rate_date,source' })
    if (error) throw new Error(`fx_rates: ${error.message}`)
  }
}

async function updateLatestAssetPrice(supabase: ServerSupabase, portfolioId: string, rows: HistoricalPricePoint[]) {
  const latest = rows
    .filter((row) => row.closePriceBase != null && row.closePriceBase > 0)
    .sort((a, b) => b.priceDate.localeCompare(a.priceDate))[0]

  if (!latest || latest.closePriceBase == null) return

  const pricedAt = `${latest.priceDate}T18:00:00.000Z`
  const { error } = await supabase.from('asset_prices').upsert({
    portfolio_id: portfolioId,
    asset_id: latest.assetId,
    price: latest.closePriceBase,
    currency: latest.baseCurrency,
    priced_at: pricedAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'portfolio_id,asset_id' })

  if (error) throw new Error(`asset_prices: ${error.message}`)
}

async function updateAssetBackfillStatus(supabase: ServerSupabase, assetId: string, errorMessage: string | null) {
  const { error } = await supabase
    .from('assets')
    .update({
      last_price_refresh_at: new Date().toISOString(),
      last_price_refresh_error: errorMessage,
    })
    .eq('id', assetId)

  if (error) throw new Error(`assets: ${error.message}`)
}

async function persistBackfilledAsset(supabase: ServerSupabase, portfolioId: string, rows: HistoricalPricePoint[]) {
  await upsertHistoricalFxRates(supabase, rows)
  const persistedRows = await upsertHistoricalRows(supabase, rows)
  await updateLatestAssetPrice(supabase, portfolioId, rows)
  return persistedRows
}

async function backfillOneAsset(supabase: ServerSupabase, portfolioId: string, asset: AssetForPricing, range: BackfillRange): Promise<BackfillAssetReport> {
  const baseReport = {
    assetId: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    range,
  }

  try {
    const fetchedRows = await fetchHistoricalRows(asset, range)
    const { rows: limitedRows, remainingRows } = latestRows(fetchedRows)
    const withFx = await applyHistoricalFx(limitedRows)
    const persistedRows = await persistBackfilledAsset(supabase, portfolioId, withFx)
    const latestPriceDate = withFx[withFx.length - 1]?.priceDate ?? null
    const fxMissingRows = withFx.filter((row) => row.sourceCurrency !== row.baseCurrency && row.closePriceBase == null).length
    const provider = withFx[0]?.provider ?? (isCrypto(asset) ? 'coingecko' : 'stooq')
    const sourceSymbol = withFx[0]?.sourceSymbol ?? (isCrypto(asset) ? resolveCoinGeckoId(asset) : normalizeStooqSymbol(asset))
    const status: BackfillAssetStatus = remainingRows > 0 ? 'partial' : persistedRows > 0 ? 'success' : 'skipped'
    const error = remainingRows > 0
      ? `MAX/range returned more than ${MAX_ROWS_PER_ASSET_PER_REQUEST} rows; saved newest rows. Run a narrower range if you need older data.`
      : null

    await updateAssetBackfillStatus(supabase, asset.id, error)

    return {
      ...baseReport,
      provider,
      sourceSymbol,
      status,
      fetchedRows: fetchedRows.length,
      persistedRows,
      remainingRows,
      fxMissingRows,
      latestPriceDate,
      error,
    }
  } catch (err: any) {
    const provider = isCrypto(asset) ? 'coingecko' : 'stooq'
    const sourceSymbol = provider === 'coingecko' ? resolveCoinGeckoId(asset) : normalizeStooqSymbol(asset)
    const error = err?.message ?? 'Nie udało się wykonać backfillu.'
    await updateAssetBackfillStatus(supabase, asset.id, error).catch(() => undefined)

    return {
      ...baseReport,
      provider,
      sourceSymbol,
      status: 'failed',
      fetchedRows: 0,
      persistedRows: 0,
      remainingRows: 0,
      fxMissingRows: 0,
      latestPriceDate: null,
      error,
    }
  }
}

function runStatus(results: BackfillAssetReport[], remainingCount: number): BackfillReport['status'] {
  if (results.length === 0) return 'skipped'
  const successes = results.filter((result) => result.status === 'success' || result.status === 'partial').length
  const failures = results.filter((result) => result.status === 'failed').length
  const partial = remainingCount > 0 || results.some((result) => result.status === 'partial')
  if (failures === results.length) return 'failed'
  if (failures > 0 || partial) return successes > 0 ? 'partial_success' : 'failed'
  return 'success'
}

function itemStatus(status: BackfillAssetStatus) {
  if (status === 'failed') return 'failed'
  if (status === 'skipped') return 'skipped'
  return 'success'
}

export async function runHistoricalBackfill(options: {
  portfolioId: string
  assets: AssetForPricing[]
  remainingAssets?: AssetForPricing[]
  requestedAssets: number
  scope: BackfillScope
  range: BackfillRange
}): Promise<BackfillReport> {
  const supabase = getServerSupabase()
  if (!supabase) throw new Error('Brak SUPABASE_SERVICE_ROLE_KEY dla historical backfill.')

  const remainingAssets = options.remainingAssets ?? []
  if (options.assets.length === 0) {
    return {
      ok: true,
      status: 'skipped',
      portfolioId: options.portfolioId,
      scope: options.scope,
      range: options.range,
      requestedAssets: options.requestedAssets,
      processedAssets: 0,
      remainingCount: remainingAssets.length,
      remainingAssets: remainingAssets.map((asset) => ({ id: asset.id, symbol: asset.symbol, name: asset.name })),
      results: [],
    }
  }

  const { data: run, error: runError } = await supabase
    .from('price_refresh_runs')
    .insert({
      portfolio_id: options.portfolioId,
      trigger_type: 'backfill',
      status: 'running',
      requested_assets: options.requestedAssets,
    })
    .select('id')
    .single()

  if (runError) throw new Error(`price_refresh_runs: ${runError.message}`)
  const runId = String(run.id)
  const results: BackfillAssetReport[] = []

  for (const asset of options.assets) {
    const result = await backfillOneAsset(supabase, options.portfolioId, asset, options.range)
    results.push(result)

    const { error: itemError } = await supabase.from('price_refresh_run_items').insert({
      run_id: runId,
      portfolio_id: options.portfolioId,
      asset_id: result.assetId,
      symbol: result.symbol,
      source: `${result.provider} ${result.sourceSymbol}`,
      status: itemStatus(result.status),
      price_date: result.latestPriceDate,
      price: null,
      currency: 'PLN',
      error: result.error,
    })

    if (itemError) {
      results[results.length - 1] = { ...result, status: 'failed', error: `price_refresh_run_items: ${itemError.message}` }
    }
  }

  const status = runStatus(results, remainingAssets.length)
  const refreshedAssets = results.filter((result) => result.status === 'success' || result.status === 'partial').length
  const failedAssets = results.filter((result) => result.status === 'failed').length
  const runErrorMessage = results.find((result) => result.error)?.error
    ?? (remainingAssets.length > 0 ? `${remainingAssets.length} aktywów pominięto w tym requestcie ze względu na limit batcha.` : null)

  const { error: finishError } = await supabase
    .from('price_refresh_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      refreshed_assets: refreshedAssets,
      failed_assets: failedAssets,
      error: status === 'success' ? null : runErrorMessage,
    })
    .eq('id', runId)

  if (finishError) throw new Error(`price_refresh_runs update: ${finishError.message}`)

  return {
    ok: status === 'success' || status === 'partial_success',
    runId,
    status,
    portfolioId: options.portfolioId,
    scope: options.scope,
    range: options.range,
    requestedAssets: options.requestedAssets,
    processedAssets: options.assets.length,
    remainingCount: remainingAssets.length,
    remainingAssets: remainingAssets.map((asset) => ({ id: asset.id, symbol: asset.symbol, name: asset.name })),
    results,
    error: status === 'success' ? undefined : runErrorMessage ?? undefined,
  }
}

export function parseBackfillRange(value: unknown): BackfillRange {
  return BACKFILL_RANGES.includes(value as BackfillRange) ? value as BackfillRange : '1Y'
}
