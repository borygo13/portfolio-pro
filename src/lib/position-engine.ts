import type { Asset, Transaction } from '@/lib/supabase/portfolio'

export type AssetPrice = {
  id: string
  portfolio_id: string
  asset_id: string
  price: number
  currency: string | null
  priced_at: string | null
  created_at?: string
  updated_at?: string | null
}

export type Position = {
  asset: Asset
  quantity: number
  avgPrice: number
  investedCost: number
  remainingCost: number
  realizedPnl: number
  currentPrice: number
  currentValue: number
  unrealizedPnl: number
  totalPnl: number
  returnPct: number
  allocationPct: number
  targetAllocation: number
  allocationDiff: number
}

function num(value: unknown) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function buildPositions(assets: Asset[], transactions: Transaction[], prices: AssetPrice[] = []): Position[] {
  const priceByAsset = new Map(prices.map((p) => [p.asset_id, num(p.price)]))

  const positions = assets.map((asset) => {
    const assetTx = transactions
      .filter((t) => t.asset_id === asset.id)
      .slice()
      .sort((a, b) => {
        const byDate = new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime()
        if (byDate !== 0) return byDate
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      })

    let quantity = 0
    let remainingCost = 0
    let investedCost = 0
    let realizedPnl = 0

    for (const t of assetTx) {
      const qty = num(t.quantity)
      const price = num(t.price)
      const fees = num(t.fees)
      if (qty <= 0 || price < 0) continue

      if (t.transaction_type === 'BUY') {
        const buyCost = qty * price + fees
        quantity += qty
        remainingCost += buyCost
        investedCost += buyCost
      }

      if (t.transaction_type === 'SELL') {
        const sellQty = Math.min(qty, quantity)
        if (sellQty <= 0) continue

        const avgBeforeSell = quantity > 0 ? remainingCost / quantity : 0
        const costRemoved = avgBeforeSell * sellQty
        const proceeds = sellQty * price - fees
        realizedPnl += proceeds - costRemoved
        quantity -= sellQty
        remainingCost -= costRemoved

        if (Math.abs(quantity) < 0.00000001) {
          quantity = 0
          remainingCost = 0
        }
      }
    }

    const currentPrice = priceByAsset.get(asset.id) ?? (quantity > 0 ? remainingCost / quantity : 0)
    const currentValue = quantity * currentPrice
    const avgPrice = quantity > 0 ? remainingCost / quantity : 0
    const unrealizedPnl = currentValue - remainingCost
    const totalPnl = realizedPnl + unrealizedPnl
    const baseForReturn = remainingCost > 0 ? remainingCost : investedCost
    const returnPct = baseForReturn > 0 ? totalPnl / baseForReturn : 0

    return {
      asset,
      quantity,
      avgPrice,
      investedCost,
      remainingCost,
      realizedPnl,
      currentPrice,
      currentValue,
      unrealizedPnl,
      totalPnl,
      returnPct,
      allocationPct: 0,
      targetAllocation: num(asset.target_allocation),
      allocationDiff: 0,
    }
  })

  const totalValue = positions.reduce((sum, p) => sum + p.currentValue, 0)
  return positions.map((p) => ({
    ...p,
    allocationPct: totalValue > 0 ? p.currentValue / totalValue : 0,
    allocationDiff: p.targetAllocation / 100 - (totalValue > 0 ? p.currentValue / totalValue : 0),
  }))
}

export function portfolioSummary(positions: Position[]) {
  const totalValue = positions.reduce((sum, p) => sum + p.currentValue, 0)
  const remainingCost = positions.reduce((sum, p) => sum + p.remainingCost, 0)
  const investedCost = positions.reduce((sum, p) => sum + p.investedCost, 0)
  const realizedPnl = positions.reduce((sum, p) => sum + p.realizedPnl, 0)
  const unrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0)
  const totalPnl = realizedPnl + unrealizedPnl
  const returnPct = remainingCost > 0 ? totalPnl / remainingCost : 0
  const openPositions = positions.filter((p) => p.quantity > 0.00000001).length
  const best = positions.slice().sort((a, b) => b.totalPnl - a.totalPnl)[0] ?? null
  const worst = positions.slice().sort((a, b) => a.totalPnl - b.totalPnl)[0] ?? null
  const rebalance = positions
    .filter((p) => p.targetAllocation > 0)
    .slice()
    .sort((a, b) => b.allocationDiff - a.allocationDiff)[0] ?? null

  return { totalValue, remainingCost, investedCost, realizedPnl, unrealizedPnl, totalPnl, returnPct, openPositions, best, worst, rebalance }
}

export function buildSimpleEquityCurve(transactions: Transaction[], currentValue: number) {
  const sorted = transactions.slice().sort((a, b) => new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime())
  const byMonth = new Map<string, number>()
  for (const t of sorted) {
    const d = new Date(t.transaction_date)
    if (Number.isNaN(d.getTime())) continue
    const key = d.toLocaleDateString('pl-PL', { month: 'short', year: '2-digit' })
    const amount = Number(t.quantity) * Number(t.price) + Number(t.fees ?? 0)
    byMonth.set(key, (byMonth.get(key) ?? 0) + (t.transaction_type === 'BUY' ? amount : -amount))
  }

  const points: { month: string; portfolio: number; contribution: number; benchmark: number }[] = []
  let contribution = 0
  for (const [month, value] of byMonth.entries()) {
    contribution += value
    points.push({ month, contribution, portfolio: contribution, benchmark: contribution })
  }

  if (points.length === 0) {
    return [
      { month: 'start', portfolio: 0, contribution: 0, benchmark: 0 },
      { month: 'teraz', portfolio: currentValue, contribution: 0, benchmark: 0 },
    ]
  }

  const last = points[points.length - 1]
  points.push({ month: 'teraz', contribution: last.contribution, portfolio: currentValue, benchmark: last.contribution })
  return points
}
