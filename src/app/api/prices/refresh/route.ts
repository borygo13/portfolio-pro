import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { persistManualRefresh } from '@/lib/market/persistence'
import { refreshAssetPrices } from '@/lib/market/refresh'
import type { AssetForPricing } from '@/lib/market/types'

function getBearerToken(request: Request) {
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

async function getVerifiedAssets(request: Request, requestedAssets: AssetForPricing[]) {
  const token = getBearerToken(request)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!token || !url || !anonKey || requestedAssets.length === 0) return null

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const requestedIds = requestedAssets.map((asset) => asset.id).filter(Boolean)
  const { data, error } = await supabase
    .from('assets')
    .select('id,portfolio_id,symbol,name,asset_type,currency,market_symbol,price_source,auto_refresh_enabled')
    .in('id', requestedIds)

  if (error || !data || data.length === 0) return null

  const requestedById = new Map(requestedAssets.map((asset) => [asset.id, asset]))
  return data.map((asset: any) => ({
    ...requestedById.get(asset.id),
    ...asset,
  })) as AssetForPricing[]
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const requestedAssets = (body?.assets ?? []) as AssetForPricing[]
    if (!Array.isArray(requestedAssets) || requestedAssets.length === 0) return NextResponse.json({ prices: [] })

    const verifiedAssets = await getVerifiedAssets(request, requestedAssets)
    const assets = verifiedAssets ?? requestedAssets
    const prices = await refreshAssetPrices(assets)
    const persistence = await persistManualRefresh(assets, prices, Boolean(verifiedAssets))

    return NextResponse.json({ prices, ...persistence })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Price refresh failed' }, { status: 500 })
  }
}
