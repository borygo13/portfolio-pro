import type { Asset } from '@/lib/supabase/portfolio'

export type ProviderStatus = {
  provider: string
  supportsHistorical: boolean
  supportsLatest: boolean
  supportsAdjustedClose: boolean
  requiresApiKey: boolean
  notes: string
}

function isCryptoAsset(asset: Pick<Asset, 'asset_type' | 'symbol'>) {
  return (asset.asset_type ?? '').toLowerCase().includes('crypto')
}

export function providerStatusForAsset(asset: Pick<Asset, 'asset_type' | 'symbol' | 'price_source'> | null): ProviderStatus {
  const source = (asset?.price_source ?? 'auto').trim().toLowerCase()

  if (!asset) {
    return {
      provider: 'none',
      supportsHistorical: false,
      supportsLatest: false,
      supportsAdjustedClose: false,
      requiresApiKey: false,
      notes: 'Select an asset to inspect provider readiness.',
    }
  }

  if (source.includes('manual') || source.includes('csv') || source.includes('yahoo')) {
    return {
      provider: source || 'manual_csv',
      supportsHistorical: true,
      supportsLatest: false,
      supportsAdjustedClose: source.includes('yahoo'),
      requiresApiKey: false,
      notes: 'Manual CSV fills history; daily cron still needs a live provider for future prices.',
    }
  }

  if (isCryptoAsset(asset) || source.includes('coingecko') || source.includes('cryptocompare')) {
    return {
      provider: source === 'cryptocompare' ? 'cryptocompare' : 'coingecko / cryptocompare',
      supportsHistorical: true,
      supportsLatest: true,
      supportsAdjustedClose: false,
      requiresApiKey: false,
      notes: 'Crypto history is daily close data. CryptoCompare is used as a long-range fallback.',
    }
  }

  return {
    provider: source && source !== 'auto' ? source : 'stooq',
    supportsHistorical: true,
    supportsLatest: true,
    supportsAdjustedClose: false,
    requiresApiKey: false,
    notes: 'Stooq can be partial for some symbols. Use CSV import when recent or long-range history is missing.',
  }
}
