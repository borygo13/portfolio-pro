import { projectEdoBond, summarizeEdoBonds } from '@/lib/bond-engine'
import { buildPositions, portfolioSummary } from '@/lib/position-engine'
import type { Asset, EdoBond, Portfolio, Transaction } from '@/lib/supabase/portfolio'
import type { AssetPrice } from '@/lib/position-engine'
import type { ServerSupabase } from './persistence'

function today() {
  return new Date().toISOString().slice(0, 10)
}

async function fetchPortfolioSnapshotInputs(supabase: ServerSupabase, portfolioId: string) {
  const [portfolioRes, assetsRes, transactionsRes, pricesRes, bondsRes] = await Promise.all([
    supabase.from('portfolios').select('id,user_id,name,currency').eq('id', portfolioId).single(),
    supabase.from('assets').select('id,portfolio_id,symbol,name,asset_type,currency,target_allocation,created_at').eq('portfolio_id', portfolioId),
    supabase.from('transactions').select('id,portfolio_id,asset_id,transaction_type,quantity,price,fees,transaction_date,notes,created_at').eq('portfolio_id', portfolioId),
    supabase.from('asset_prices').select('id,portfolio_id,asset_id,price,currency,priced_at,created_at,updated_at').eq('portfolio_id', portfolioId),
    supabase.from('edo_bonds').select('id,portfolio_id,series,quantity,purchase_price,purchase_date,interest_first_year,inflation_margin,maturity_date,created_at').eq('portfolio_id', portfolioId),
  ])

  if (portfolioRes.error) throw new Error(`portfolio_snapshots portfolio: ${portfolioRes.error.message}`)
  if (assetsRes.error) throw new Error(`portfolio_snapshots assets: ${assetsRes.error.message}`)
  if (transactionsRes.error) throw new Error(`portfolio_snapshots transactions: ${transactionsRes.error.message}`)
  if (pricesRes.error) throw new Error(`portfolio_snapshots asset_prices: ${pricesRes.error.message}`)
  if (bondsRes.error) throw new Error(`portfolio_snapshots edo_bonds: ${bondsRes.error.message}`)

  return {
    portfolio: portfolioRes.data as Portfolio,
    assets: (assetsRes.data ?? []) as Asset[],
    transactions: (transactionsRes.data ?? []) as Transaction[],
    prices: (pricesRes.data ?? []) as AssetPrice[],
    bonds: (bondsRes.data ?? []) as EdoBond[],
  }
}

export async function createPortfolioSnapshot(supabase: ServerSupabase, portfolioId: string, source = 'system', snapshotDate = today()) {
  const { portfolio, assets, transactions, prices, bonds } = await fetchPortfolioSnapshotInputs(supabase, portfolioId)
  const positions = buildPositions(assets, transactions, prices)
  const summary = portfolioSummary(positions)
  const edoSummary = summarizeEdoBonds(bonds.map((bond) => projectEdoBond(bond)))

  const positionsValue = summary.totalValue
  const edoValue = edoSummary.currentValueAfterTax
  const totalValue = positionsValue + edoValue
  const totalPnl = summary.totalPnl + (edoValue - edoSummary.principal)

  const payload = {
    portfolio_id: portfolioId,
    snapshot_date: snapshotDate,
    base_currency: portfolio.currency ?? 'PLN',
    total_value: totalValue,
    positions_value: positionsValue,
    edo_value: edoValue,
    cash_value: 0,
    invested_cost: summary.investedCost + edoSummary.principal,
    remaining_cost: summary.remainingCost + edoSummary.principal,
    realized_pnl: summary.realizedPnl,
    unrealized_pnl: summary.unrealizedPnl + (edoValue - edoSummary.principal),
    total_pnl: totalPnl,
    net_cash_flow: 0,
    contribution: 0,
    source,
    calculated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('portfolio_snapshots')
    .upsert(payload, { onConflict: 'portfolio_id,snapshot_date' })

  if (error) throw new Error(`portfolio_snapshots upsert: ${error.message}`)
  return { snapshotDate, totalValue }
}
