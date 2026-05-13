export type Trade = { result: number; fees?: number; date: string }

export function netTradeResult(t: Trade) { return t.result - (t.fees ?? 0) }

export function tradingStats(trades: Trade[]) {
  const net = trades.map(netTradeResult)
  const wins = net.filter(v => v > 0)
  const losses = net.filter(v => v < 0)
  const days = new Set(trades.map(t => t.date)).size || 1
  return {
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    winrate: trades.length ? wins.length / trades.length : 0,
    avgPerTrade: trades.length ? net.reduce((a,b)=>a+b,0) / trades.length : 0,
    avgDaily: net.reduce((a,b)=>a+b,0) / days,
    bestTrade: net.length ? Math.max(...net) : 0,
    worstTrade: net.length ? Math.min(...net) : 0,
    totalNet: net.reduce((a,b)=>a+b,0),
    profitFactor: Math.abs(losses.reduce((a,b)=>a+b,0)) > 0 ? wins.reduce((a,b)=>a+b,0) / Math.abs(losses.reduce((a,b)=>a+b,0)) : null,
  }
}

export function edoBondValue(input: { principal: number; firstYearRate: number; yearsHeld: number; inflationRates?: number[]; belkaTax?: number }) {
  const belka = input.belkaTax ?? 0.19
  let value = input.principal
  for (let y = 0; y < Math.floor(input.yearsHeld); y++) {
    const rate = y === 0 ? input.firstYearRate : ((input.inflationRates?.[y - 1] ?? 0.03) + 0.015)
    const interest = value * rate
    value += interest * (1 - belka)
  }
  const partial = input.yearsHeld - Math.floor(input.yearsHeld)
  if (partial > 0) {
    const rate = Math.floor(input.yearsHeld) === 0 ? input.firstYearRate : ((input.inflationRates?.[Math.floor(input.yearsHeld) - 1] ?? 0.03) + 0.015)
    value += value * rate * partial * (1 - belka)
  }
  return value
}
