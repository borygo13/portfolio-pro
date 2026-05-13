import { NextResponse } from 'next/server'

type AssetForPricing = {
  id: string
  symbol: string
  name?: string
  asset_type?: string
  currency?: string | null
}

type PriceResult = {
  assetId: string
  symbol: string
  price: number | null
  currency: string
  source: string
  fetchedAt: string
  error?: string
}

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

function cleanSymbol(symbol: string) {
  return symbol.trim().toLowerCase().replace(/^etr:/i, '').replace(/^xetra:/i, '').replace(/^nasdaq:/i, '').replace(/^nyse:/i, '')
}

function normalizeStooqSymbol(asset: AssetForPricing) {
  const raw = cleanSymbol(asset.symbol)
  if (raw.includes('.')) return raw

  const currency = (asset.currency ?? '').toUpperCase()
  if (currency === 'EUR') return `${raw}.de`
  if (currency === 'USD') return `${raw}.us`
  if (currency === 'PLN') return `${raw}.pl`
  return raw
}

async function getNbpRateToPln(currency: string): Promise<number> {
  const ccy = currency.toUpperCase()
  if (!ccy || ccy === 'PLN') return 1
  const res = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/${ccy}/?format=json`, { next: { revalidate: 3600 } })
  if (!res.ok) throw new Error(`Brak kursu NBP dla ${ccy}`)
  const json = await res.json()
  const rate = Number(json?.rates?.[0]?.mid)
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Niepoprawny kurs NBP dla ${ccy}`)
  return rate
}

async function fetchStooqPrice(asset: AssetForPricing): Promise<PriceResult> {
  const symbol = normalizeStooqSymbol(asset)
  const sourceCurrency = (asset.currency ?? 'PLN').toUpperCase()
  const url = `https://stooq.pl/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`)
  const csv = await res.text()
  const lines = csv.trim().split(/\r?\n/)
  const row = lines[1]?.split(',')
  const close = Number(row?.[6])
  if (!Number.isFinite(close) || close <= 0) throw new Error(`Brak ceny dla symbolu ${symbol}. Spróbuj symbolu Stooq, np. iusq.de, aapl.us, pkn.pl.`)
  const fx = await getNbpRateToPln(sourceCurrency)
  return {
    assetId: asset.id,
    symbol: asset.symbol,
    price: close * fx,
    currency: 'PLN',
    source: `Stooq ${symbol}${sourceCurrency !== 'PLN' ? ` + NBP ${sourceCurrency}/PLN` : ''}`,
    fetchedAt: new Date().toISOString(),
  }
}

async function fetchCryptoPrice(asset: AssetForPricing): Promise<PriceResult> {
  const ticker = asset.symbol.trim().toUpperCase()
  const id = CRYPTO_IDS[ticker] ?? ticker.toLowerCase()
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=pln`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)
  const json = await res.json()
  const price = Number(json?.[id]?.pln)
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Brak ceny crypto dla ${ticker}. Dla mniej popularnych coinów ustaw symbol jako CoinGecko ID.`)
  return { assetId: asset.id, symbol: asset.symbol, price, currency: 'PLN', source: `CoinGecko ${id}`, fetchedAt: new Date().toISOString() }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const assets = (body?.assets ?? []) as AssetForPricing[]
    if (!Array.isArray(assets) || assets.length === 0) return NextResponse.json({ prices: [] })

    const prices: PriceResult[] = []
    for (const asset of assets) {
      try {
        const type = (asset.asset_type ?? '').toLowerCase()
        if (type.includes('got')) {
          prices.push({ assetId: asset.id, symbol: asset.symbol, price: 1, currency: 'PLN', source: 'Cash nominal', fetchedAt: new Date().toISOString() })
        } else if (type.includes('crypto')) {
          prices.push(await fetchCryptoPrice(asset))
        } else if (type.includes('oblig')) {
          prices.push({ assetId: asset.id, symbol: asset.symbol, price: null, currency: 'PLN', source: 'EDO engine', fetchedAt: new Date().toISOString(), error: 'Obligacje liczymy w module EDO, nie przez market API.' })
        } else {
          prices.push(await fetchStooqPrice(asset))
        }
      } catch (err: any) {
        prices.push({ assetId: asset.id, symbol: asset.symbol, price: null, currency: 'PLN', source: 'auto', fetchedAt: new Date().toISOString(), error: err?.message ?? 'Nie udało się pobrać ceny.' })
      }
    }

    return NextResponse.json({ prices })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Price refresh failed' }, { status: 500 })
  }
}
