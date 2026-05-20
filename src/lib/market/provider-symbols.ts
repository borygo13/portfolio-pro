import { CRYPTO_IDS, resolveCoinGeckoId } from '@/lib/market/providers/coingecko'
import type { MarketProviderId } from '@/lib/market/provider-diagnostics'
import type { AssetForPricing } from '@/lib/market/types'

type SymbolAssetInput = Pick<AssetForPricing, 'symbol' | 'market_symbol' | 'asset_type' | 'currency'>

export type ProviderSymbolCandidate = {
  provider: MarketProviderId
  symbol: string
  source: 'market_symbol' | 'symbol' | 'currency_default' | 'known_mapping'
  inferred: boolean
  note: string
}

export type ProviderSymbolResolution = {
  provider: MarketProviderId
  selectedSymbol: string
  candidates: ProviderSymbolCandidate[]
}

export type SymbolResolutionDescription = {
  displaySymbol: string
  marketSymbol: string | null
  primaryProvider: MarketProviderId
  primarySymbol: string
  resolutions: ProviderSymbolResolution[]
}

const EODHD_SUFFIXES: Record<string, string[]> = {
  DE: ['XETRA', 'F', 'DE'],
  XETRA: ['XETRA'],
  PA: ['PA'],
  FR: ['PA'],
  L: ['LSE', 'L'],
  LSE: ['LSE'],
  UK: ['LSE', 'L'],
  AS: ['AS'],
  NL: ['AS'],
  MI: ['MI'],
  IT: ['MI'],
  SW: ['SW', 'VX'],
  VX: ['VX', 'SW'],
  US: ['US'],
  PL: ['WAR'],
  WAR: ['WAR'],
}

const STOOQ_SUFFIXES: Record<string, string[]> = {
  DE: ['de'],
  XETRA: ['de'],
  F: ['de'],
  PA: ['fr', 'pa'],
  FR: ['fr'],
  L: ['uk', 'l'],
  LSE: ['uk', 'l'],
  UK: ['uk'],
  AS: ['nl', 'as'],
  NL: ['nl'],
  MI: ['it', 'mi'],
  IT: ['it'],
  SW: ['ch', 'sw'],
  VX: ['ch', 'vx'],
  US: ['us'],
  PL: ['pl'],
  WAR: ['pl'],
}

const EODHD_OVERRIDES: Record<string, string[]> = {
  'IUSQ.DE': ['IUSQ.XETRA', 'IUSQ.DE', 'IUSQ.F'],
  '500.PA': ['500.PA'],
  'CSPX.L': ['CSPX.LSE', 'CSPX.L'],
  AAPL: ['AAPL.US'],
}

const STOOQ_OVERRIDES: Record<string, string[]> = {
  'IUSQ.DE': ['iusq.de'],
  'IUSQ.XETRA': ['iusq.de'],
  '500.PA': ['500.fr', '500.pa'],
  'CSPX.L': ['cspx.uk', 'cspx.l'],
  'CSPX.LSE': ['cspx.uk', 'cspx.l'],
  AAPL: ['aapl.us'],
}

function uniqueCandidates(candidates: ProviderSymbolCandidate[]) {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = `${candidate.provider}:${candidate.symbol.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return Boolean(candidate.symbol)
  })
}

function stripProviderPrefix(symbol: string) {
  return symbol.trim().replace(/^(etr|xetra|nasdaq|nyse|lse|stooq):/i, '')
}

function symbolInputs(asset: SymbolAssetInput) {
  const inputs: { value: string; source: 'market_symbol' | 'symbol' }[] = []
  const marketSymbol = stripProviderPrefix(asset.market_symbol ?? '')
  const displaySymbol = stripProviderPrefix(asset.symbol ?? '')
  if (marketSymbol) inputs.push({ value: marketSymbol, source: 'market_symbol' })
  if (displaySymbol && displaySymbol.toLowerCase() !== marketSymbol.toLowerCase()) inputs.push({ value: displaySymbol, source: 'symbol' })
  return inputs
}

function splitExchangeSymbol(symbol: string) {
  const clean = stripProviderPrefix(symbol).replace(/\s+/g, '')
  const lastDot = clean.lastIndexOf('.')
  if (lastDot < 0) return { base: clean, suffix: '' }
  const base = clean.slice(0, lastDot)
  const suffix = clean.slice(lastDot + 1).toUpperCase()
  return { base, suffix }
}

function candidate(provider: MarketProviderId, symbol: string, source: ProviderSymbolCandidate['source'], inferred: boolean, note: string): ProviderSymbolCandidate {
  return { provider, symbol, source, inferred, note }
}

function isCrypto(asset: SymbolAssetInput) {
  const type = (asset.asset_type ?? '').toLowerCase()
  const ticker = asset.symbol.trim().toUpperCase()
  return type.includes('crypto') || ticker in CRYPTO_IDS
}

function cryptoCompareSymbol(asset: SymbolAssetInput) {
  const ticker = asset.symbol.trim().toUpperCase()
  return ticker === 'XBT' ? 'BTC' : ticker
}

function currencyDefaultSuffixes(provider: MarketProviderId, currency: string) {
  const ccy = currency.toUpperCase()
  if (provider === 'eodhd') {
    if (ccy === 'USD') return ['US']
    if (ccy === 'EUR') return ['XETRA', 'PA', 'AS', 'MI']
    if (ccy === 'GBP') return ['LSE']
    if (ccy === 'PLN') return ['WAR']
    if (ccy === 'CHF') return ['SW', 'VX']
  }
  if (provider === 'stooq') {
    if (ccy === 'USD') return ['us']
    if (ccy === 'EUR') return ['de', 'fr', 'nl', 'it']
    if (ccy === 'GBP') return ['uk']
    if (ccy === 'PLN') return ['pl']
    if (ccy === 'CHF') return ['ch']
  }
  return []
}

function eodhdCandidates(asset: SymbolAssetInput) {
  const candidates: ProviderSymbolCandidate[] = []
  for (const input of symbolInputs(asset)) {
    const raw = stripProviderPrefix(input.value).toUpperCase()
    const override = EODHD_OVERRIDES[raw]
    if (override) {
      for (const symbol of override) candidates.push(candidate('eodhd', symbol, 'known_mapping', true, `${raw} mapped for EODHD.`))
    }

    const { base, suffix } = splitExchangeSymbol(raw)
    const mappedSuffixes = EODHD_SUFFIXES[suffix]
    if (base && mappedSuffixes) {
      for (const mapped of mappedSuffixes) candidates.push(candidate('eodhd', `${base}.${mapped}`, input.source, mapped !== suffix, `.${suffix} mapped for EODHD.`))
    } else if (raw && !raw.includes('.')) {
      for (const suffix of currencyDefaultSuffixes('eodhd', asset.currency ?? '')) {
        candidates.push(candidate('eodhd', `${raw}.${suffix}`, 'currency_default', true, `${asset.currency ?? 'currency'} default mapped for EODHD.`))
      }
      candidates.push(candidate('eodhd', raw, input.source, false, `${input.source} used as EODHD candidate.`))
    } else if (raw) {
      candidates.push(candidate('eodhd', raw, input.source, false, `${input.source} used as EODHD candidate.`))
    }
  }

  return uniqueCandidates(candidates)
}

function stooqCandidates(asset: SymbolAssetInput) {
  const candidates: ProviderSymbolCandidate[] = []
  for (const input of symbolInputs(asset)) {
    const rawUpper = stripProviderPrefix(input.value).toUpperCase()
    const override = STOOQ_OVERRIDES[rawUpper]
    if (override) {
      for (const symbol of override) candidates.push(candidate('stooq', symbol, 'known_mapping', true, `${rawUpper} mapped for Stooq.`))
    }

    const { base, suffix } = splitExchangeSymbol(rawUpper)
    const mappedSuffixes = STOOQ_SUFFIXES[suffix]
    if (base && mappedSuffixes) {
      for (const mapped of mappedSuffixes) candidates.push(candidate('stooq', `${base.toLowerCase()}.${mapped}`, input.source, mapped !== suffix.toLowerCase(), `.${suffix} mapped for Stooq.`))
    } else if (rawUpper && !rawUpper.includes('.')) {
      for (const suffix of currencyDefaultSuffixes('stooq', asset.currency ?? '')) {
        candidates.push(candidate('stooq', `${rawUpper.toLowerCase()}.${suffix}`, 'currency_default', true, `${asset.currency ?? 'currency'} default mapped for Stooq.`))
      }
      candidates.push(candidate('stooq', rawUpper.toLowerCase(), input.source, false, `${input.source} used as Stooq candidate.`))
    } else if (rawUpper) {
      candidates.push(candidate('stooq', rawUpper.toLowerCase(), input.source, false, `${input.source} used as Stooq candidate.`))
    }
  }

  return uniqueCandidates(candidates)
}

export function normalizeExchangeSuffix(symbol: string, provider: MarketProviderId) {
  if (provider === 'eodhd') return eodhdCandidates({ symbol, market_symbol: null })[0]?.symbol ?? stripProviderPrefix(symbol).toUpperCase()
  if (provider === 'stooq') return stooqCandidates({ symbol, market_symbol: null })[0]?.symbol ?? stripProviderPrefix(symbol).toLowerCase()
  return stripProviderPrefix(symbol)
}

export function getProviderSymbolCandidates(asset: SymbolAssetInput, provider: MarketProviderId): ProviderSymbolCandidate[] {
  if (!asset) return []
  if (isCrypto(asset)) {
    if (provider === 'coingecko') return [candidate('coingecko', resolveCoinGeckoId(asset as AssetForPricing), 'market_symbol', Boolean(asset.market_symbol), 'CoinGecko ID.')]
    if (provider === 'cryptocompare') return [candidate('cryptocompare', cryptoCompareSymbol(asset), 'symbol', false, 'CryptoCompare ticker.')]
  }
  if (provider === 'eodhd') return eodhdCandidates(asset)
  if (provider === 'stooq') return stooqCandidates(asset)

  const raw = stripProviderPrefix(asset.market_symbol || asset.symbol)
  return raw ? [candidate(provider, raw, asset.market_symbol ? 'market_symbol' : 'symbol', false, 'Manual/provider symbol.')] : []
}

export function resolveProviderSymbol(asset: SymbolAssetInput, provider: MarketProviderId) {
  return getProviderSymbolCandidates(asset, provider)[0]?.symbol ?? stripProviderPrefix(asset.market_symbol || asset.symbol)
}

export function describeSymbolResolution(asset: SymbolAssetInput | null, providers: MarketProviderId[] = ['eodhd', 'stooq', 'coingecko', 'cryptocompare']): SymbolResolutionDescription | null {
  if (!asset) return null
  const resolutions = providers.map((provider) => {
    const candidates = getProviderSymbolCandidates(asset, provider)
    return {
      provider,
      selectedSymbol: candidates[0]?.symbol ?? '—',
      candidates,
    }
  }).filter((resolution) => resolution.candidates.length > 0)
  const primaryProvider = resolutions[0]?.provider ?? 'none'
  return {
    displaySymbol: asset.symbol,
    marketSymbol: asset.market_symbol ?? null,
    primaryProvider,
    primarySymbol: resolutions[0]?.selectedSymbol ?? '—',
    resolutions,
  }
}
