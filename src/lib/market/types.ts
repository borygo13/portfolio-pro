export type AssetForPricing = {
  id: string
  portfolio_id?: string
  symbol: string
  name?: string
  asset_type?: string
  currency?: string | null
  market_symbol?: string | null
  price_source?: string | null
  auto_refresh_enabled?: boolean | null
}

export type FxRateResult = {
  fromCurrency: string
  toCurrency: string
  rate: number
  rateDate: string
  source: string
  fetchedAt: string
}

export type MarketPriceResult = {
  assetId: string
  portfolioId?: string
  symbol: string
  price: number | null
  currency: string
  source: string
  fetchedAt: string
  sourceSymbol?: string
  sourceCurrency?: string
  sourcePrice?: number | null
  priceDate?: string
  openPrice?: number | null
  highPrice?: number | null
  lowPrice?: number | null
  closePrice?: number | null
  adjustedClosePrice?: number | null
  fxRateToBase?: number | null
  fxRate?: FxRateResult | null
  error?: string
}

export type RefreshTrigger = 'manual' | 'cron' | 'backfill'

export type RefreshRunSummary = {
  runId?: string
  persistenceError?: string
}
