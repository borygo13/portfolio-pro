import { NextResponse } from 'next/server'
import { getServerSupabase, persistRefresh } from '@/lib/market/persistence'
import { refreshAssetPrices } from '@/lib/market/refresh'
import type { AssetForPricing } from '@/lib/market/types'

function bearerToken(request: Request) {
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET
  return Boolean(secret && bearerToken(request) === secret)
}

async function refreshPortfolio(portfolioId: string) {
  const supabase = getServerSupabase()
  if (!supabase) throw new Error('Brak SUPABASE_SERVICE_ROLE_KEY dla cron refresh.')

  const { data, error } = await supabase
    .from('assets')
    .select('id,portfolio_id,symbol,name,asset_type,currency,market_symbol,price_source,auto_refresh_enabled')
    .eq('portfolio_id', portfolioId)
    .eq('auto_refresh_enabled', true)
    .not('price_source', 'eq', 'none')
    .not('price_source', 'eq', 'manual')

  if (error) throw new Error(`assets: ${error.message}`)

  const assets = ((data ?? []) as AssetForPricing[]).filter((asset) => {
    const type = (asset.asset_type ?? '').toLowerCase()
    return !type.includes('got') && !type.includes('oblig')
  })

  if (assets.length === 0) return { portfolioId, prices: [], skipped: true }

  const prices = await refreshAssetPrices(assets)
  const persistence = await persistRefresh(assets, prices, 'cron', { enabled: true, createSnapshot: true, snapshotSource: 'cron' })
  return { portfolioId, prices, ...persistence }
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const supabase = getServerSupabase()
    if (!supabase) throw new Error('Brak SUPABASE_SERVICE_ROLE_KEY dla cron refresh.')

    const { data: portfolios, error } = await supabase.from('portfolios').select('id').order('created_at', { ascending: true })
    if (error) throw new Error(`portfolios: ${error.message}`)

    const results = []
    for (const portfolio of portfolios ?? []) {
      const portfolioId = String(portfolio.id)
      try {
        results.push(await refreshPortfolio(portfolioId))
      } catch (err: any) {
        results.push({ portfolioId, error: err?.message ?? 'Nie udało się odświeżyć portfolio.' })
      }
    }

    return NextResponse.json({ ok: true, portfolios: results.length, results })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Cron price refresh failed' }, { status: 500 })
  }
}
