import type { AssetForPricing, MarketPriceResult } from '@/lib/market/types'

const CRYPTO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  XBT: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  ADA: 'cardano',
  XRP: 'ripple',
  DOT: 'polkadot',
  BNB: 'binancecoin',
  DOGE: 'dogecoin',
}

export async function fetchCryptoPrice(asset: AssetForPricing): Promise<MarketPriceResult> {
  const ticker = asset.symbol.trim().toUpperCase()
  const id = asset.market_symbol?.trim().toLowerCase() || CRYPTO_IDS[ticker] || ticker.toLowerCase()
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=pln`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)

  const json = await res.json()
  const price = Number(json?.[id]?.pln)
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Brak ceny crypto dla ${ticker}. Dla mniej popularnych coinów ustaw symbol jako CoinGecko ID.`)

  const today = new Date().toISOString().slice(0, 10)
  return {
    assetId: asset.id,
    portfolioId: asset.portfolio_id,
    symbol: asset.symbol,
    price,
    currency: 'PLN',
    source: `CoinGecko ${id}`,
    fetchedAt: new Date().toISOString(),
    sourceSymbol: id,
    sourceCurrency: 'PLN',
    sourcePrice: price,
    priceDate: today,
    closePrice: price,
    adjustedClosePrice: price,
    fxRateToBase: 1,
    fxRate: null,
  }
}
