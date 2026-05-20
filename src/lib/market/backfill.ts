import { resolveCoinGeckoId } from '@/lib/market/providers/coingecko'
import { getNbpHistoricalRatesToPln } from '@/lib/market/providers/nbp'
import { PROVIDER_CAPABILITIES, providerFallbackOrderForAsset, type MarketProviderId } from '@/lib/market/provider-diagnostics'
import { getProviderSymbolCandidates, resolveProviderSymbol, type ProviderSymbolCandidate } from '@/lib/market/provider-symbols'
import { getServerSupabase, type ServerSupabase } from '@/lib/market/persistence'
import type { AssetForPricing, FxRateResult } from '@/lib/market/types'

export const BACKFILL_RANGES = ['1Y', '3Y', '5Y', 'MAX'] as const
export type BackfillRange = typeof BACKFILL_RANGES[number]
export type BackfillScope = 'asset' | 'all_active'
export type BackfillAssetStatus = 'success' | 'partial' | 'failed' | 'skipped'

export const MAX_BACKFILL_ASSETS_PER_REQUEST = 5
const SELECTED_ASSET_MAX_ROWS_PER_REQUEST = 5000
const ALL_ACTIVE_MAX_ROWS_PER_ASSET = 2500
const UPSERT_CHUNK_SIZE = 200
const FX_RANGE_CHUNK_DAYS = 90
const CRYPTOCOMPARE_CHUNK_LIMIT = 2000
const DAY_MS = 24 * 60 * 60 * 1000

type HistoricalSource = Extract<MarketProviderId, 'coingecko' | 'cryptocompare' | 'eodhd' | 'stooq'>

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

type HistoricalFetchResult = {
  rows: RawHistoricalPricePoint[]
  providerFallbackChain: MarketProviderId[]
  providerMessages: string[]
  providerCandidateSymbols: string[]
}

type ProviderHistoryResult = {
  rows: RawHistoricalPricePoint[]
  candidateSymbols: string[]
  messages: string[]
}

export type BackfillAssetReport = {
  assetId: string
  symbol: string
  name?: string
  provider: MarketProviderId
  sourceSymbol: string
  range: BackfillRange
  status: BackfillAssetStatus
  fetchedRows: number
  persistedRows: number
  remainingRows: number
  fxMissingRows: number
  latestPriceDate: string | null
  error: string | null
  providerFallbackChain: MarketProviderId[]
  providerMessages: string[]
  providerCandidateSymbols: string[]
  adjustedPriceRows: number
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

function eodhdSource(symbol: string, currency: string) {
  return `EODHD ${symbol}${currency !== 'PLN' ? ` + NBP ${currency}/PLN` : ''}`
}

function providerSymbolError() {
  return 'Sprawdź market_symbol/provider symbol. Przykłady: IUSQ.DE -> EODHD IUSQ.XETRA / Stooq iusq.de, 500.PA -> Stooq 500.fr, CSPX.L -> EODHD CSPX.LSE, BTC via CoinGecko bitcoin.'
}

function responsePreview(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 220)
}

function backfillHeaders() {
  return {
    Accept: 'application/json,text/csv,text/plain,*/*',
    'User-Agent': 'portfolio-pro-backfill/1.0',
  }
}

function cryptoCompareSymbol(asset: AssetForPricing) {
  const ticker = asset.symbol.trim().toUpperCase()
  if (ticker === 'XBT') return 'BTC'
  return ticker
}

function mapCryptoPoint(
  asset: AssetForPricing,
  id: string,
  date: string,
  price: number,
  provider: Extract<HistoricalSource, 'coingecko' | 'cryptocompare'> = 'coingecko',
  ohlc: { open?: number | null; high?: number | null; low?: number | null } = {},
): RawHistoricalPricePoint {
  const fetchedAt = new Date().toISOString()
  return {
    assetId: asset.id,
    portfolioId: String(asset.portfolio_id),
    symbol: asset.symbol,
    source: `CoinGecko ${id}`,
    sourceSymbol: id,
    provider,
    priceDate: date,
    openPrice: ohlc.open ?? null,
    highPrice: ohlc.high ?? null,
    lowPrice: ohlc.low ?? null,
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
  const url = new URL(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart/range`)
  url.searchParams.set('vs_currency', 'pln')
  url.searchParams.set('from', startDate ?? '2013-01-01')
  url.searchParams.set('to', endDate)
  url.searchParams.set('interval', 'daily')
  url.searchParams.set('precision', 'full')

  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store', headers: backfillHeaders() })
  } catch (err: any) {
    throw new Error(`CoinGecko request failed for ${id}: ${err?.message ?? 'fetch failed'}`)
  }

  const text = await res.text()
  if (!res.ok) throw new Error(`CoinGecko returned HTTP ${res.status} for ${id} ${range}. ${responsePreview(text)}`)

  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`CoinGecko returned invalid JSON for ${id} ${range}. Preview: ${responsePreview(text)}`)
  }

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

  if (rows.length === 0) throw new Error(`CoinGecko returned no prices for ${id} ${range}. ${providerSymbolError()}`)
  return rows
}

function cryptoCompareUrl(symbol: string, limit: number, toTs: number) {
  const url = new URL('https://min-api.cryptocompare.com/data/v2/histoday')
  url.searchParams.set('fsym', symbol)
  url.searchParams.set('tsym', 'PLN')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('toTs', String(toTs))
  return url
}

async function fetchCryptoCompareChunk(symbol: string, limit: number, toTs: number) {
  const url = cryptoCompareUrl(symbol, limit, toTs)
  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store', headers: backfillHeaders() })
  } catch (err: any) {
    throw new Error(`CryptoCompare request failed for ${symbol}/PLN: ${err?.message ?? 'fetch failed'}`)
  }

  const text = await res.text()
  if (!res.ok) throw new Error(`CryptoCompare returned HTTP ${res.status} for ${symbol}/PLN. ${responsePreview(text)}`)

  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`CryptoCompare returned invalid JSON for ${symbol}/PLN. Preview: ${responsePreview(text)}`)
  }

  if (json?.Response !== 'Success') {
    throw new Error(`CryptoCompare failed for ${symbol}/PLN. ${responsePreview(String(json?.Message ?? text))}`)
  }

  return Array.isArray(json?.Data?.Data) ? json.Data.Data : []
}

async function fetchCryptoCompareHistory(asset: AssetForPricing, range: BackfillRange, maxRows: number): Promise<RawHistoricalPricePoint[]> {
  const id = resolveCoinGeckoId(asset)
  const symbol = cryptoCompareSymbol(asset)
  const { startDate, endDate } = rangeWindow(range)
  const endTs = Math.floor(new Date(`${endDate}T23:59:59.999Z`).getTime() / 1000)
  const rangeDays = startDate ? Math.ceil((new Date(`${endDate}T00:00:00.000Z`).getTime() - new Date(`${startDate}T00:00:00.000Z`).getTime()) / DAY_MS) : maxRows
  const targetRows = Math.min(maxRows, Math.max(1, rangeDays + 2))
  const byDate = new Map<string, RawHistoricalPricePoint>()
  let toTs = endTs

  while (byDate.size < targetRows) {
    const limit = Math.min(CRYPTOCOMPARE_CHUNK_LIMIT, Math.max(1, targetRows - byDate.size - 1))
    const chunkRows = await fetchCryptoCompareChunk(symbol, limit, toTs)
    if (chunkRows.length === 0) break

    let oldestTs = Number.POSITIVE_INFINITY
    for (const row of chunkRows) {
      const timestamp = asNumber(row?.time)
      const close = asNumber(row?.close)
      if (!timestamp || !close || close <= 0) continue
      oldestTs = Math.min(oldestTs, timestamp)
      const priceDate = formatDate(new Date(timestamp * 1000))
      if (priceDate > endDate) continue
      if (startDate && priceDate < startDate) continue

      byDate.set(priceDate, mapCryptoPoint(asset, id, priceDate, close, 'cryptocompare', {
        open: asNumber(row?.open),
        high: asNumber(row?.high),
        low: asNumber(row?.low),
      }))
    }

    if (!Number.isFinite(oldestTs)) break
    const nextToTs = oldestTs - 1
    if (nextToTs >= toTs) break
    toTs = nextToTs
    if (startDate && formatDate(new Date(toTs * 1000)) < startDate) break
  }

  const rows = Array.from(byDate.values()).sort((a, b) => a.priceDate.localeCompare(b.priceDate))
  if (rows.length === 0) throw new Error(`CryptoCompare returned no prices for ${symbol}/PLN ${range}. ${providerSymbolError()}`)
  return rows
}

async function fetchCryptoHistory(asset: AssetForPricing, range: BackfillRange, maxRows: number): Promise<RawHistoricalPricePoint[]> {
  if (range === '1Y') {
    try {
      return await fetchCoinGeckoHistory(asset, range)
    } catch {
      return fetchCryptoCompareHistory(asset, range, maxRows)
    }
  }

  return fetchCryptoCompareHistory(asset, range, maxRows)
}

function mapEodhdRow(asset: AssetForPricing, sourceSymbol: string, sourceCurrency: string, row: any, fetchedAt: string): RawHistoricalPricePoint | null {
  const priceDate = typeof row?.date === 'string' ? row.date.slice(0, 10) : ''
  const close = asNumber(row?.close)
  if (!priceDate || !close || close <= 0) return null

  const adjustedClose = asNumber(row?.adjusted_close ?? row?.adjustedClose ?? row?.adjusted)
  return {
    assetId: asset.id,
    portfolioId: String(asset.portfolio_id),
    symbol: asset.symbol,
    source: eodhdSource(sourceSymbol, sourceCurrency),
    sourceSymbol,
    provider: 'eodhd',
    priceDate,
    openPrice: asNumber(row?.open),
    highPrice: asNumber(row?.high),
    lowPrice: asNumber(row?.low),
    closePrice: close,
    adjustedClosePrice: adjustedClose && adjustedClose > 0 ? adjustedClose : close,
    sourceCurrency,
    baseCurrency: 'PLN',
    fetchedAt,
  }
}

async function fetchEodhdHistoryForSymbol(asset: AssetForPricing, symbol: string, range: BackfillRange): Promise<RawHistoricalPricePoint[]> {
  const apiKey = process.env.EODHD_API_KEY?.trim()
  if (!apiKey) throw new Error('EODHD_API_KEY is not configured.')

  const sourceCurrency = (asset.currency ?? 'PLN').toUpperCase()
  const { startDate, endDate } = rangeWindow(range)
  const url = new URL(`https://eodhd.com/api/eod/${encodeURIComponent(symbol)}`)
  url.searchParams.set('api_token', apiKey)
  url.searchParams.set('fmt', 'json')
  url.searchParams.set('period', 'd')
  url.searchParams.set('order', 'a')
  if (startDate) url.searchParams.set('from', startDate)
  url.searchParams.set('to', endDate)

  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store', headers: backfillHeaders() })
  } catch (err: any) {
    throw new Error(`EODHD request failed for ${symbol}: ${err?.message ?? 'fetch failed'}`)
  }

  const text = await res.text()
  if (!res.ok) {
    const limit = res.status === 429 ? ' Rate limit reached.' : ''
    throw new Error(`EODHD returned HTTP ${res.status} for ${symbol}.${limit} Preview: ${responsePreview(text)}`)
  }

  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`EODHD returned invalid JSON for ${symbol}. Preview: ${responsePreview(text)}`)
  }

  if (!Array.isArray(json)) {
    const message = typeof json?.message === 'string' ? json.message : typeof json?.error === 'string' ? json.error : responsePreview(text)
    throw new Error(`EODHD returned no historical array for ${symbol}. ${message}`)
  }

  const fetchedAt = new Date().toISOString()
  const byDate = new Map<string, RawHistoricalPricePoint>()
  for (const item of json) {
    const mapped = mapEodhdRow(asset, symbol, sourceCurrency, item, fetchedAt)
    if (mapped) byDate.set(mapped.priceDate, mapped)
  }

  const rows = Array.from(byDate.values()).sort((a, b) => a.priceDate.localeCompare(b.priceDate))
  if (rows.length === 0) throw new Error(`EODHD returned no usable prices for ${symbol} ${range}. ${providerSymbolError()}`)
  return rows
}

function candidateList(candidates: ProviderSymbolCandidate[]) {
  return candidates.map((candidate) => candidate.symbol)
}

async function fetchEodhdHistory(asset: AssetForPricing, range: BackfillRange): Promise<ProviderHistoryResult> {
  const candidates = getProviderSymbolCandidates(asset, 'eodhd')
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const rows = await fetchEodhdHistoryForSymbol(asset, candidate.symbol, range)
      return {
        rows,
        candidateSymbols: candidateList(candidates),
        messages: [
          ...errors.map((error) => `EODHD candidate failed: ${error}`),
          `EODHD selected ${candidate.symbol}${candidate.inferred ? ' (inferred mapping)' : ''}.`,
        ],
      }
    } catch (err: any) {
      errors.push(`${candidate.symbol}: ${err?.message ?? 'failed'}`)
    }
  }

  throw new Error(`EODHD candidates failed (${candidateList(candidates).join(', ') || 'none'}). ${errors.join(' | ') || providerSymbolError()}`)
}

async function fetchStooqHistoryForSymbol(asset: AssetForPricing, symbol: string, range: BackfillRange): Promise<RawHistoricalPricePoint[]> {
  const sourceCurrency = (asset.currency ?? 'PLN').toUpperCase()
  const { startDate, endDate } = rangeWindow(range)
  const url = new URL('https://stooq.com/q/d/l/')
  url.searchParams.set('s', symbol)
  if (startDate) url.searchParams.set('d1', compactDate(startDate))
  url.searchParams.set('d2', compactDate(endDate))
  url.searchParams.set('i', 'd')
  const stooqApiKey = process.env.STOOQ_API_KEY?.trim()
  if (stooqApiKey) url.searchParams.set('apikey', stooqApiKey)

  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store', headers: backfillHeaders() })
  } catch (err: any) {
    throw new Error(`Stooq request failed for ${symbol} on stooq.com: ${err?.message ?? 'fetch failed'}`)
  }

  const csv = await res.text()
  if (!res.ok) throw new Error(`Stooq returned HTTP ${res.status} for ${symbol} on stooq.com. Preview: ${responsePreview(csv)}`)
  if (/get your apikey|uzyskaj apikey/i.test(csv)) {
    throw new Error(`Stooq historical CSV requires an API key for ${symbol}. Set STOOQ_API_KEY server-side. Preview: ${responsePreview(csv)}`)
  }

  const lines = csv.trim().split(/\r?\n/).filter(Boolean)
  const delimiter = lines[0]?.includes(';') ? ';' : ','
  const header = (lines[0] ?? '').split(delimiter).map((item) => item.trim().toLowerCase())
  const dateIndex = header.indexOf('date')
  const openIndex = header.indexOf('open')
  const highIndex = header.indexOf('high')
  const lowIndex = header.indexOf('low')
  const closeIndex = header.indexOf('close')
  if (dateIndex < 0 || closeIndex < 0) {
    throw new Error(`Stooq CSV header was not recognized for ${symbol} on stooq.com. Preview: ${responsePreview(csv)}`)
  }

  const rows: RawHistoricalPricePoint[] = []
  const fetchedAt = new Date().toISOString()

  for (const line of lines.slice(1)) {
    const row = line.split(delimiter)
    const priceDate = row[dateIndex]?.trim()
    const close = asNumber(row[closeIndex])
    if (!priceDate || !close || close <= 0) continue

    rows.push({
      assetId: asset.id,
      portfolioId: String(asset.portfolio_id),
      symbol: asset.symbol,
      source: stooqSource(symbol, sourceCurrency),
      sourceSymbol: symbol,
      provider: 'stooq',
      priceDate,
      openPrice: openIndex >= 0 ? asNumber(row[openIndex]) : null,
      highPrice: highIndex >= 0 ? asNumber(row[highIndex]) : null,
      lowPrice: lowIndex >= 0 ? asNumber(row[lowIndex]) : null,
      closePrice: close,
      adjustedClosePrice: close,
      sourceCurrency,
      baseCurrency: 'PLN',
      fetchedAt,
    })
  }

  if (rows.length === 0) {
    throw new Error(`Stooq CSV had no rows for ${symbol} between ${startDate ?? 'MAX'} and ${endDate}. Preview: ${responsePreview(csv)}`)
  }
  return rows
}

async function fetchStooqHistory(asset: AssetForPricing, range: BackfillRange): Promise<ProviderHistoryResult> {
  const candidates = getProviderSymbolCandidates(asset, 'stooq')
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const rows = await fetchStooqHistoryForSymbol(asset, candidate.symbol, range)
      return {
        rows,
        candidateSymbols: candidateList(candidates),
        messages: [
          ...errors.map((error) => `Stooq candidate failed: ${error}`),
          `Stooq selected ${candidate.symbol}${candidate.inferred ? ' (inferred mapping)' : ''}.`,
        ],
      }
    } catch (err: any) {
      errors.push(`${candidate.symbol}: ${err?.message ?? 'failed'}`)
    }
  }

  throw new Error(`Stooq candidates failed (${candidateList(candidates).join(', ') || 'none'}). ${errors.join(' | ') || providerSymbolError()}`)
}

async function fetchEquityHistory(asset: AssetForPricing, range: BackfillRange): Promise<HistoricalFetchResult> {
  const fallbackChain = providerFallbackOrderForAsset(asset)
  const chain = fallbackChain.filter((provider): provider is HistoricalSource => provider === 'eodhd' || provider === 'stooq')
  const providerMessages: string[] = []
  if (chain.length === 0) {
    throw new Error(`Asset is configured for ${fallbackChain.join(' -> ')}. Use CSV import as the manual historical fallback.`)
  }

  for (const provider of chain) {
    try {
      const result = provider === 'eodhd' ? await fetchEodhdHistory(asset, range) : await fetchStooqHistory(asset, range)
      if (providerMessages.length > 0) providerMessages.push(`Using ${PROVIDER_CAPABILITIES[provider].label} after fallback.`)
      return {
        rows: result.rows,
        providerFallbackChain: fallbackChain,
        providerMessages: [...providerMessages, ...result.messages],
        providerCandidateSymbols: result.candidateSymbols,
      }
    } catch (err: any) {
      providerMessages.push(`${PROVIDER_CAPABILITIES[provider].label}: ${err?.message ?? 'failed'}`)
    }
  }

  throw new Error(`Provider fallback failed. ${providerMessages.join(' | ')} Use CSV import as manual fallback.`)
}

async function fetchHistoricalRows(asset: AssetForPricing, range: BackfillRange, maxRows: number): Promise<HistoricalFetchResult> {
  if (!asset.portfolio_id) throw new Error('Brak portfolio_id dla aktywa.')
  if (isCrypto(asset)) {
    return {
      rows: await fetchCryptoHistory(asset, range, maxRows),
      providerFallbackChain: providerFallbackOrderForAsset(asset),
      providerMessages: [],
      providerCandidateSymbols: [
        resolveProviderSymbol(asset, 'coingecko'),
        resolveProviderSymbol(asset, 'cryptocompare'),
      ],
    }
  }

  return fetchEquityHistory(asset, range)
}

function latestRows(rows: RawHistoricalPricePoint[], maxRows: number) {
  if (rows.length <= maxRows) return { rows, remainingRows: 0 }
  return {
    rows: rows.slice(rows.length - maxRows),
    remainingRows: rows.length - maxRows,
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

async function backfillOneAsset(supabase: ServerSupabase, portfolioId: string, asset: AssetForPricing, range: BackfillRange, maxRows: number): Promise<BackfillAssetReport> {
  const baseReport = {
    assetId: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    range,
  }

  try {
    const fetched = await fetchHistoricalRows(asset, range, maxRows)
    const { rows: limitedRows, remainingRows } = latestRows(fetched.rows, maxRows)
    const withFx = await applyHistoricalFx(limitedRows)
    const persistedRows = await persistBackfilledAsset(supabase, portfolioId, withFx)
    const latestPriceDate = withFx[withFx.length - 1]?.priceDate ?? null
    const fxMissingRows = withFx.filter((row) => row.sourceCurrency !== row.baseCurrency && row.closePriceBase == null).length
    const provider = withFx[0]?.provider ?? (isCrypto(asset) ? 'coingecko' : 'stooq')
    const sourceSymbol = withFx[0]?.sourceSymbol ?? resolveProviderSymbol(asset, provider)
    const adjustedPriceRows = withFx.filter((row) => row.adjustedClosePrice !== row.closePrice).length
    const status: BackfillAssetStatus = remainingRows > 0 ? 'partial' : persistedRows > 0 ? 'success' : 'skipped'
    const error = remainingRows > 0
      ? `MAX/range returned more than ${maxRows} rows; saved newest rows. Run a narrower range if you need older data.`
      : null

    await updateAssetBackfillStatus(supabase, asset.id, error)

    return {
      ...baseReport,
      provider,
      sourceSymbol,
      status,
      fetchedRows: fetched.rows.length,
      persistedRows,
      remainingRows,
      fxMissingRows,
      latestPriceDate,
      error,
      providerFallbackChain: fetched.providerFallbackChain,
      providerMessages: fetched.providerMessages,
      providerCandidateSymbols: fetched.providerCandidateSymbols,
      adjustedPriceRows,
    }
  } catch (err: any) {
    const fallbackChain = providerFallbackOrderForAsset(asset)
    const provider = fallbackChain[0] ?? (isCrypto(asset) ? 'coingecko' : 'eodhd')
    const sourceSymbol = resolveProviderSymbol(asset, provider)
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
      providerFallbackChain: fallbackChain,
      providerMessages: [error],
      providerCandidateSymbols: fallbackChain.flatMap((candidateProvider) => getProviderSymbolCandidates(asset, candidateProvider).map((candidate) => candidate.symbol)),
      adjustedPriceRows: 0,
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
  const maxRowsPerAsset = options.scope === 'all_active' ? ALL_ACTIVE_MAX_ROWS_PER_ASSET : SELECTED_ASSET_MAX_ROWS_PER_REQUEST

  for (const asset of options.assets) {
    const result = await backfillOneAsset(supabase, options.portfolioId, asset, options.range, maxRowsPerAsset)
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
