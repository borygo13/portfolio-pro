import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { parseBackfillRange } from '@/lib/market/backfill'
import { runPortfolioHistoryBackfill } from '@/lib/market/portfolio-history-backfill'

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

export async function POST(request: Request) {
  try {
    const token = getBearerToken(request)
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createUserSupabase(token)
    if (!supabase) throw new Error('Brak konfiguracji Supabase dla portfolio history backfill.')
    if (!await verifyUser(supabase, token)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const portfolioId = await getPortfolioId(supabase, typeof body?.portfolio_id === 'string' ? body.portfolio_id : null)
    if (!portfolioId) throw new Error('Nie znaleziono portfolio dla aktywnej sesji.')

    const report = await runPortfolioHistoryBackfill({
      portfolioId,
      range: parseBackfillRange(body?.range),
    })

    return NextResponse.json(report)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Portfolio history backfill failed' }, { status: 500 })
  }
}
