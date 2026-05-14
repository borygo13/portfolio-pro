import type { AssetForPricing, MarketPriceResult } from './types'
import { fetchCryptoPrice } from './providers/coingecko'
import { fetchStooqPrice } from './providers/stooq'

export async function refreshAssetPrice(asset: AssetForPricing): Promise<MarketPriceResult> {
  const type = (asset.asset_type ?? '').toLowerCase()

  if (type.includes('got')) {
    return {
      assetId: asset.id,
      portfolioId: asset.portfolio_id,
      symbol: asset.symbol,
      price: 1,
      currency: 'PLN',
      source: 'Cash nominal',
      fetchedAt: new Date().toISOString(),
      sourceSymbol: asset.symbol,
      sourceCurrency: 'PLN',
      sourcePrice: 1,
      priceDate: new Date().toISOString().slice(0, 10),
      closePrice: 1,
      adjustedClosePrice: 1,
      fxRateToBase: 1,
      fxRate: null,
    }
  }

  if (type.includes('crypto')) return fetchCryptoPrice(asset)

  if (type.includes('oblig')) {
    return {
      assetId: asset.id,
      portfolioId: asset.portfolio_id,
      symbol: asset.symbol,
      price: null,
      currency: 'PLN',
      source: 'EDO engine',
      fetchedAt: new Date().toISOString(),
      error: 'Obligacje liczymy w module EDO, nie przez market API.',
    }
  }

  return fetchStooqPrice(asset)
}

export async function refreshAssetPrices(assets: AssetForPricing[]) {
  const prices: MarketPriceResult[] = []

  for (const asset of assets) {
    try {
      prices.push(await refreshAssetPrice(asset))
    } catch (err: any) {
      prices.push({
        assetId: asset.id,
        portfolioId: asset.portfolio_id,
        symbol: asset.symbol,
        price: null,
        currency: 'PLN',
        source: 'auto',
        fetchedAt: new Date().toISOString(),
        sourceSymbol: asset.market_symbol?.trim() || asset.symbol,
        error: err?.message ?? 'Nie udało się pobrać ceny.',
      })
    }
  }

  return prices
}
