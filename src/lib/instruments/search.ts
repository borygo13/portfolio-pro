import { PROVIDER_CAPABILITIES, providerFallbackOrderForAsset, type MarketProviderId } from '@/lib/market/provider-diagnostics'
import { getProviderSymbolCandidates } from '@/lib/market/provider-symbols'

export type InstrumentSearchable = {
  id?: string
  name: string
  symbol: string
  market_symbol?: string | null
  provider?: string | null
  category?: string | null
  asset_type: string
  currency: string
  exchange?: string | null
  country?: string | null
  aliases?: string[] | null
  benchmark_candidate?: boolean | null
  is_active?: boolean | null
}

type SearchOptions = {
  limit?: number
  activeOnly?: boolean
}

const QUERY_EXPANSIONS: Record<string, string[]> = {
  sp500: ['s p 500', 's&p 500', 'standard poor 500', 'spy', 'ivv', 'voo', 'sxr8', 'cspx', 'vuaa'],
  sandp500: ['s p 500', 's&p 500', 'standard poor 500', 'spy', 'ivv', 'voo', 'sxr8', 'cspx', 'vuaa'],
  spx: ['s p 500', 's&p 500', 'spy', 'ivv', 'voo', 'sxr8', 'cspx'],
  nasdaq: ['nasdaq 100', 'nasdaq100', 'qqq', 'cndx', 'sxrv'],
  nasdaq100: ['nasdaq 100', 'qqq', 'cndx', 'sxrv'],
  msciworld: ['msci world', 'world etf', 'eunl', 'iwda', 'swrd'],
  worldetf: ['msci world', 'msci acwi', 'acwi', 'iusq', 'vwce', 'eunl', 'iwda'],
  acwi: ['msci acwi', 'iusq', 'vwce', 'global etf'],
  bitcoin: ['btc', 'xbt'],
  btc: ['bitcoin', 'xbt'],
  ethereum: ['eth', 'ether'],
  eth: ['ethereum', 'ether'],
  apple: ['aapl'],
  aapl: ['apple'],
  cdprojekt: ['cdr', 'cd projekt', 'cd project'],
  cdr: ['cd projekt', 'cd project'],
  gpw: ['warsaw', 'poland', 'polska', 'wse'],
  obligacje: ['bond', 'bonds', 'bnd', 'tlt'],
  etf: ['fund', 'ucits'],
}

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compact(value: string) {
  return normalize(value).replace(/\s+/g, '')
}

function queryVariants(query: string) {
  const base = normalize(query)
  const compactBase = compact(query)
  const variants = new Set<string>([base, compactBase])

  for (const token of base.split(/\s+/).filter(Boolean)) {
    variants.add(token)
    for (const expansion of QUERY_EXPANSIONS[token] ?? []) variants.add(normalize(expansion))
  }
  for (const expansion of QUERY_EXPANSIONS[compactBase] ?? []) variants.add(normalize(expansion))

  return Array.from(variants).filter(Boolean)
}

function providerIdsFor(row: InstrumentSearchable): MarketProviderId[] {
  return providerFallbackOrderForAsset({
    asset_type: row.asset_type,
    symbol: row.symbol,
    price_source: row.provider ?? 'auto',
  }).filter((provider) => provider !== 'none')
}

export function instrumentProviderChain(row: InstrumentSearchable) {
  return providerIdsFor(row).map((provider) => PROVIDER_CAPABILITIES[provider].label).join(' -> ') || 'CSV/manual'
}

export function instrumentProviderCandidates(row: InstrumentSearchable) {
  return providerIdsFor(row)
    .flatMap((provider) => getProviderSymbolCandidates({
      symbol: row.symbol,
      market_symbol: row.market_symbol,
      asset_type: row.asset_type,
      currency: row.currency,
    }, provider))
}

function searchableParts(row: InstrumentSearchable) {
  return [
    row.name,
    row.symbol,
    row.market_symbol ?? '',
    row.provider ?? '',
    row.category ?? '',
    row.asset_type,
    row.currency,
    row.exchange ?? '',
    row.country ?? '',
    ...(row.aliases ?? []),
    ...instrumentProviderCandidates(row).map((candidate) => candidate.symbol),
  ]
}

function scoreInstrument(row: InstrumentSearchable, query: string) {
  const variants = queryVariants(query)
  const originalTerms = normalize(query).split(/\s+/).filter(Boolean)
  const searchText = normalize(searchableParts(row).join(' '))
  const searchCompact = compact(searchableParts(row).join(' '))
  const symbol = normalize(row.symbol)
  const symbolCompact = compact(row.symbol)
  const marketSymbol = normalize(row.market_symbol ?? '')
  const aliases = (row.aliases ?? []).map(normalize)
  const name = normalize(row.name)
  let score = row.benchmark_candidate ? 40 : 0

  if (!query.trim()) return score + (row.is_active === false ? -1000 : 0)

  const matchesTerms = originalTerms.length === 0 || originalTerms.every((term) => searchText.includes(term) || searchCompact.includes(term))
  const matchesVariant = variants.some((variant) => {
    const key = normalize(variant)
    const compactKey = compact(variant)
    return searchText.includes(key) || searchCompact.includes(compactKey)
  })
  if (!matchesTerms && !matchesVariant) return -1

  const queryCompact = compact(query)
  if (symbol === normalize(query) || symbolCompact === queryCompact) score += 1000
  if (aliases.some((alias) => alias === normalize(query) || compact(alias) === queryCompact)) score += 850
  if (marketSymbol === normalize(query) || compact(marketSymbol) === queryCompact) score += 800
  if (instrumentProviderCandidates(row).some((candidate) => compact(candidate.symbol) === queryCompact)) score += 740
  if (name === normalize(query)) score += 700
  if (name.startsWith(normalize(query))) score += 420
  if (name.includes(normalize(query))) score += 260
  if (matchesTerms) score += 180
  if (matchesVariant) score += 120
  if (row.category && searchText.includes(normalize(row.category))) score += 20
  return score
}

export function searchInstrumentCatalogRows<T extends InstrumentSearchable>(rows: T[], query: string, options: SearchOptions = {}): T[] {
  const activeOnly = options.activeOnly ?? true
  const limit = options.limit ?? 8
  return rows
    .filter((row) => !activeOnly || row.is_active !== false)
    .map((row) => ({ row, score: scoreInstrument(row, query) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (Boolean(b.row.benchmark_candidate) !== Boolean(a.row.benchmark_candidate)) return Number(Boolean(b.row.benchmark_candidate)) - Number(Boolean(a.row.benchmark_candidate))
      return a.row.symbol.localeCompare(b.row.symbol)
    })
    .slice(0, limit)
    .map((item) => item.row)
}

export function instrumentMeta(row: InstrumentSearchable) {
  const exchange = row.exchange || row.country || null
  return `${row.asset_type} · ${row.currency}${exchange ? ` · ${exchange}` : ''}`
}

export function instrumentReadiness(row: InstrumentSearchable, baseCurrency = 'PLN') {
  const providers = providerIdsFor(row)
  const liveProviders = providers.filter((provider) => provider !== 'manual_csv' && provider !== 'yahoo_csv' && provider !== 'other')
  const historicalSupport = liveProviders.some((provider) => PROVIDER_CAPABILITIES[provider].supportsHistorical)
  const latestSupport = liveProviders.some((provider) => PROVIDER_CAPABILITIES[provider].supportsLatest)
  const hasProviderKey = Boolean(row.market_symbol || row.symbol)
  const needsCsv = !hasProviderKey || !historicalSupport || providers[0] === 'manual_csv' || providers[0] === 'other' || providers[0] === 'yahoo_csv'
  return {
    providerChain: instrumentProviderChain(row),
    sourceCurrency: row.currency || '—',
    baseCurrency,
    chartCurrency: row.currency || '—',
    valuationCurrency: baseCurrency,
    historicalSupport,
    latestSupport,
    backfillReady: historicalSupport && hasProviderKey,
    badge: !hasProviderKey ? 'Dodaj symbol instrumentu' : needsCsv ? 'Wymaga ręcznego CSV' : 'Gotowe do pobrania historii',
    tone: needsCsv ? 'amber' : 'emerald',
  }
}
