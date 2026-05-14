import type { AssetForPricing, MarketPriceResult } from '@/lib/market/types'
import { getNbpRateToPln } from './nbp'

function cleanSymbol(symbol: string) {
  return symbol.trim().toLowerCase().replace(/^etr:/i, '').replace(/^xetra:/i, '').replace(/^nasdaq:/i, '').replace(/^nyse:/i, '')
}

export function normalizeStooqSymbol(asset: AssetForPricing) {
  const configured = asset.market_symbol?.trim()
  if (configured) return cleanSymbol(configured)

  const raw = cleanSymbol(asset.symbol)
  if (raw.includes('.')) return raw

  const currency = (asset.currency ?? '').toUpperCase()
  if (currency === 'EUR') return `${raw}.de`
  if (currency === 'USD') return `${raw}.us`
  if (currency === 'PLN') return `${raw}.pl`
  return raw
}

function num(value: unknown) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : null
}

function parseStooqDate(value: string | undefined) {
  if (!value) return new Date().toISOString().slice(0, 10)
  const raw = value.trim()
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  return new Date().toISOString().slice(0, 10)
}

export async function fetchStooqPrice(asset: AssetForPricing): Promise<MarketPriceResult> {
  const symbol = normalizeStooqSymbol(asset)
  const sourceCurrency = (asset.currency ?? 'PLN').toUpperCase()
  const url = `https://stooq.pl/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`)

  const csv = await res.text()
  const lines = csv.trim().split(/\r?\n/)
  const row = lines[1]?.split(',')
  const open = num(row?.[3])
  const high = num(row?.[4])
  const low = num(row?.[5])
  const close = num(row?.[6])
  if (!close || close <= 0) throw new Error(`Brak ceny dla symbolu ${symbol}. Spróbuj symbolu Stooq, np. iusq.de, aapl.us, pkn.pl.`)

  const fx = await getNbpRateToPln(sourceCurrency)
  const price = close * fx.rate
  return {
    assetId: asset.id,
    portfolioId: asset.portfolio_id,
    symbol: asset.symbol,
    price,
    currency: 'PLN',
    source: `Stooq ${symbol}${sourceCurrency !== 'PLN' ? ` + NBP ${sourceCurrency}/PLN` : ''}`,
    fetchedAt: new Date().toISOString(),
    sourceSymbol: symbol,
    sourceCurrency,
    sourcePrice: close,
    priceDate: parseStooqDate(row?.[1]),
    openPrice: open,
    highPrice: high,
    lowPrice: low,
    closePrice: close,
    adjustedClosePrice: close,
    fxRateToBase: fx.rate,
    fxRate: sourceCurrency === 'PLN' ? null : fx,
  }
}
