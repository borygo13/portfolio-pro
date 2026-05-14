import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  MAX_BACKFILL_ASSETS_PER_REQUEST,
  parseBackfillRange,
  runHistoricalBackfill,
  type BackfillScope,
} from '@/lib/market/backfill'
import type { AssetForPricing } from '@/lib/market/types'

type VerifiedBackfillRequest = {
  portfolioId: string
  assets: AssetForPricing[]
  remainingAssets: AssetForPricing[]
  requestedAssets: number
  scope: BackfillScope
}

function getBearerToken(request: Request) {
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

function createUserSupabase(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null

  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function isMarketPricedAsset(asset: AssetForPricing) {
  const type = (asset.asset_type ?? '').toLowerCase()
  return !type.includes('got') && !type.includes('oblig')
}

function isAutoRefreshEligible(asset: AssetForPricing) {
  const source = (asset.price_source ?? 'auto').toLowerCase()
  return isMarketPricedAsset(asset) && asset.auto_refresh_enabled !== false && source !== 'none' && source !== 'manual'
}

async function verifyUser(supabase: SupabaseClient, token: string) {
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return false
  return true
}

async function getPortfolioId(supabase: SupabaseClient, requestedPortfolioId: string | null) {
  if (requestedPortfolioId) {
    const { data, error } = await supabase
      .from('portfolios')
      .select('id')
      .eq('id', requestedPortfolioId)
      .maybeSingle()

    if (error || !data?.id) return null
    return String(data.id)
  }

  const { data, error } = await supabase
    .from('portfolios')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)

  if (error || !data?.[0]?.id) return null
  return String(data[0].id)
}

async function getActiveAssetIds(supabase: SupabaseClient, portfolioId: string) {
  const { data, error } = await supabase
    .from('transactions')
    .select('asset_id,transaction_type,quantity')
    .eq('portfolio_id', portfolioId)

  if (error) throw new Error(`transactions: ${error.message}`)

  const quantities = new Map<string, number>()
  for (const tx of data ?? []) {
    const assetId = String(tx.asset_id)
    const quantity = Number(tx.quantity ?? 0)
    const current = quantities.get(assetId) ?? 0
    quantities.set(assetId, current + (tx.transaction_type === 'SELL' ? -quantity : quantity))
  }

  return new Set(Array.from(quantities.entries()).filter(([, quantity]) => quantity > 0.00000001).map(([assetId]) => assetId))
}

async function getSelectedAsset(supabase: SupabaseClient, portfolioId: string, assetId: string): Promise<AssetForPricing[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('id,portfolio_id,symbol,name,asset_type,currency,market_symbol,price_source,auto_refresh_enabled')
    .eq('portfolio_id', portfolioId)
    .eq('id', assetId)
    .maybeSingle()

  if (error) throw new Error(`assets: ${error.message}`)
  if (!data) throw new Error('Nie znaleziono aktywa w tym portfolio.')

  const asset = data as AssetForPricing
  if (!isMarketPricedAsset(asset)) throw new Error('Backfill obsługuje aktywa rynkowe, nie gotówkę ani obligacje EDO.')
  return [asset]
}

async function getAllActiveAssets(supabase: SupabaseClient, portfolioId: string) {
  const [{ data, error }, activeAssetIds] = await Promise.all([
    supabase
      .from('assets')
      .select('id,portfolio_id,symbol,name,asset_type,currency,market_symbol,price_source,auto_refresh_enabled')
      .eq('portfolio_id', portfolioId)
      .order('created_at', { ascending: true }),
    getActiveAssetIds(supabase, portfolioId),
  ])

  if (error) throw new Error(`assets: ${error.message}`)

  return ((data ?? []) as AssetForPricing[])
    .filter((asset) => activeAssetIds.has(asset.id))
    .filter(isAutoRefreshEligible)
}

async function getVerifiedBackfillRequest(request: Request, body: any): Promise<VerifiedBackfillRequest | null> {
  const token = getBearerToken(request)
  if (!token) return null

  const supabase = createUserSupabase(token)
  if (!supabase) throw new Error('Brak konfiguracji Supabase dla authenticated backfill.')
  if (!await verifyUser(supabase, token)) return null

  const scope: BackfillScope = body?.scope === 'all_active' ? 'all_active' : 'asset'
  const portfolioId = await getPortfolioId(supabase, typeof body?.portfolio_id === 'string' ? body.portfolio_id : null)
  if (!portfolioId) throw new Error('Nie znaleziono portfolio dla aktywnej sesji.')

  if (scope === 'asset') {
    const assetId = typeof body?.asset_id === 'string' ? body.asset_id : ''
    if (!assetId) throw new Error('Wybierz aktywo do backfillu.')
    const assets = await getSelectedAsset(supabase, portfolioId, assetId)
    return { portfolioId, assets, remainingAssets: [], requestedAssets: 1, scope }
  }

  const eligibleAssets = await getAllActiveAssets(supabase, portfolioId)
  return {
    portfolioId,
    assets: eligibleAssets.slice(0, MAX_BACKFILL_ASSETS_PER_REQUEST),
    remainingAssets: eligibleAssets.slice(MAX_BACKFILL_ASSETS_PER_REQUEST),
    requestedAssets: eligibleAssets.length,
    scope,
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const verified = await getVerifiedBackfillRequest(request, body)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const report = await runHistoricalBackfill({
      portfolioId: verified.portfolioId,
      assets: verified.assets,
      remainingAssets: verified.remainingAssets,
      requestedAssets: verified.requestedAssets,
      scope: verified.scope,
      range: parseBackfillRange(body?.range),
    })

    return NextResponse.json(report)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Historical backfill failed' }, { status: 500 })
  }
}
