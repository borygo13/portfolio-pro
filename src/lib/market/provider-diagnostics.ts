export type MarketProviderId = 'coingecko' | 'cryptocompare' | 'eodhd' | 'stooq' | 'manual_csv' | 'yahoo_csv' | 'other' | 'none'

export type ProviderCapability = {
  id: MarketProviderId
  label: string
  supportsHistorical: boolean
  supportsLatest: boolean
  supportsAdjustedClose: boolean
  requiresApiKey: boolean
  supportedAssetTypes: string[]
  historicalRangeSupport: string
  rateLimitDiagnostics: string
  notes: string
}

export type ProviderStatus = ProviderCapability & {
  provider: string
  fallbackOrder: MarketProviderId[]
}

export const PROVIDER_CAPABILITIES: Record<MarketProviderId, ProviderCapability> = {
  eodhd: {
    id: 'eodhd',
    label: 'EODHD',
    supportsHistorical: true,
    supportsLatest: true,
    supportsAdjustedClose: true,
    requiresApiKey: true,
    supportedAssetTypes: ['ETF', 'Akcje', 'CFD', 'Inne', 'Index'],
    historicalRangeSupport: '1Y / 3Y / 5Y / MAX, plan-dependent',
    rateLimitDiagnostics: 'HTTP 429 and provider error payloads are reported per asset.',
    notes: 'Primary provider for ETF, stock, and index historical backfill. Uses adjusted_close when available.',
  },
  stooq: {
    id: 'stooq',
    label: 'Stooq',
    supportsHistorical: true,
    supportsLatest: true,
    supportsAdjustedClose: false,
    requiresApiKey: false,
    supportedAssetTypes: ['ETF', 'Akcje', 'CFD', 'Inne', 'Index'],
    historicalRangeSupport: 'Best effort, symbol coverage varies',
    rateLimitDiagnostics: 'HTTP status and CSV parse previews are reported per asset.',
    notes: 'Fallback provider. Some symbols have partial history; use CSV import when coverage is missing.',
  },
  manual_csv: {
    id: 'manual_csv',
    label: 'Manual CSV',
    supportsHistorical: true,
    supportsLatest: false,
    supportsAdjustedClose: true,
    requiresApiKey: false,
    supportedAssetTypes: ['ETF', 'Akcje', 'Crypto', 'CFD', 'Inne', 'Index'],
    historicalRangeSupport: 'User-provided file, up to import row limit',
    rateLimitDiagnostics: 'No network rate limits.',
    notes: 'Manual CSV fills history; daily cron still needs a live provider for future prices.',
  },
  yahoo_csv: {
    id: 'yahoo_csv',
    label: 'Yahoo CSV',
    supportsHistorical: true,
    supportsLatest: false,
    supportsAdjustedClose: true,
    requiresApiKey: false,
    supportedAssetTypes: ['ETF', 'Akcje', 'Crypto', 'CFD', 'Inne', 'Index'],
    historicalRangeSupport: 'User-provided file, up to import row limit',
    rateLimitDiagnostics: 'No network rate limits.',
    notes: 'CSV import path accepts Yahoo-style Date/Open/High/Low/Close/Adj Close headers.',
  },
  other: {
    id: 'other',
    label: 'Other CSV',
    supportsHistorical: true,
    supportsLatest: false,
    supportsAdjustedClose: false,
    requiresApiKey: false,
    supportedAssetTypes: ['ETF', 'Akcje', 'Crypto', 'CFD', 'Inne', 'Index'],
    historicalRangeSupport: 'User-provided file, up to import row limit',
    rateLimitDiagnostics: 'No network rate limits.',
    notes: 'Generic CSV import. The parser validates dates and close prices row by row.',
  },
  coingecko: {
    id: 'coingecko',
    label: 'CoinGecko',
    supportsHistorical: true,
    supportsLatest: true,
    supportsAdjustedClose: false,
    requiresApiKey: false,
    supportedAssetTypes: ['Crypto'],
    historicalRangeSupport: '1Y primary; longer ranges are best-effort/fallback',
    rateLimitDiagnostics: 'HTTP status and empty-price responses are reported per asset.',
    notes: 'Primary latest-price provider for crypto and short historical ranges.',
  },
  cryptocompare: {
    id: 'cryptocompare',
    label: 'CryptoCompare',
    supportsHistorical: true,
    supportsLatest: false,
    supportsAdjustedClose: false,
    requiresApiKey: false,
    supportedAssetTypes: ['Crypto'],
    historicalRangeSupport: 'Long-range daily crypto history, capped by request row limits',
    rateLimitDiagnostics: 'HTTP status and provider response messages are reported per asset.',
    notes: 'Long-range crypto fallback. Existing crypto flow remains unchanged.',
  },
  none: {
    id: 'none',
    label: 'None',
    supportsHistorical: false,
    supportsLatest: false,
    supportsAdjustedClose: false,
    requiresApiKey: false,
    supportedAssetTypes: [],
    historicalRangeSupport: 'Unavailable',
    rateLimitDiagnostics: 'Unavailable',
    notes: 'Select an asset to inspect provider readiness.',
  },
}

type ProviderAssetInput = {
  asset_type?: string | null
  symbol?: string | null
  price_source?: string | null
}

function isCryptoAsset(asset: ProviderAssetInput) {
  return (asset.asset_type ?? '').toLowerCase().includes('crypto')
}

function providerIdFromSource(source: string): MarketProviderId | null {
  if (source.includes('eodhd')) return 'eodhd'
  if (source.includes('stooq')) return 'stooq'
  if (source.includes('coingecko')) return 'coingecko'
  if (source.includes('cryptocompare')) return 'cryptocompare'
  if (source.includes('manual')) return 'manual_csv'
  if (source.includes('yahoo')) return 'yahoo_csv'
  if (source.includes('csv') || source.includes('other')) return 'other'
  if (source === 'none') return 'none'
  return null
}

export function providerFallbackOrderForAsset(asset: ProviderAssetInput | null): MarketProviderId[] {
  if (!asset) return ['none']
  const source = (asset.price_source ?? 'auto').trim().toLowerCase()
  const explicit = providerIdFromSource(source)
  if (explicit === 'manual_csv' || explicit === 'yahoo_csv' || explicit === 'other' || explicit === 'none') return [explicit]
  if (isCryptoAsset(asset)) return ['coingecko', 'cryptocompare', 'manual_csv']
  return ['eodhd', 'stooq', 'manual_csv']
}

export function providerStatusForAsset(asset: ProviderAssetInput | null): ProviderStatus {
  const fallbackOrder = providerFallbackOrderForAsset(asset)
  const primary = fallbackOrder[0] ?? 'none'
  const capabilities = PROVIDER_CAPABILITIES[primary]

  return {
    ...capabilities,
    provider: fallbackOrder.map((id) => PROVIDER_CAPABILITIES[id].label).join(' -> '),
    fallbackOrder,
  }
}
