export const positions = [
  { name: 'IUSQ', fullName: 'iShares MSCI ACWI UCITS ETF', type: 'ETF', ticker: 'ETR:IUSQ', value: 28500, cost: 26000, returnPct: 0.0962, target: 55 },
  { name: 'Akcje dywidendowe', fullName: 'Portfel spółek dywidendowych', type: 'Dywidendy', ticker: 'Manual', value: 9400, cost: 9000, returnPct: 0.0444, target: 15 },
  { name: 'Obligacje EDO', fullName: '10-letnie obligacje indeksowane inflacją', type: 'Obligacje', ticker: 'EDO', value: 14180, cost: 13500, returnPct: 0.0504, target: 25 },
  { name: 'Gotówka PLN', fullName: 'PLN / EUR / USD', type: 'Cash', ticker: 'Cash', value: 2200, cost: 2200, returnPct: 0, target: 5 },
]

export const equityCurve = [
  { month: 'sty', portfolio: 15150, contribution: 15000, benchmark: 15000 },
  { month: 'lut', portfolio: 18320, contribution: 18000, benchmark: 18100 },
  { month: 'mar', portfolio: 22420, contribution: 22000, benchmark: 22050 },
  { month: 'kwi', portfolio: 26780, contribution: 26000, benchmark: 26300 },
  { month: 'maj', portfolio: 32220, contribution: 31000, benchmark: 31600 },
  { month: 'cze', portfolio: 37400, contribution: 36000, benchmark: 36550 },
  { month: 'lip', portfolio: 42100, contribution: 40500, benchmark: 41100 },
  { month: 'sie', portfolio: 47300, contribution: 45500, benchmark: 46100 },
  { month: 'wrz', portfolio: 50950, contribution: 49200, benchmark: 50000 },
  { month: 'paź', portfolio: 53080, contribution: 51200, benchmark: 52050 },
  { month: 'lis', portfolio: 55030, contribution: 53200, benchmark: 53900 },
  { month: 'gru', portfolio: 56280, contribution: 54600, benchmark: 55100 },
]

export const dividends = [
  { month: 'sty', value: 0 }, { month: 'lut', value: 42 }, { month: 'mar', value: 85 }, { month: 'kwi', value: 0 },
  { month: 'maj', value: 136 }, { month: 'cze', value: 92 }, { month: 'lip', value: 0 }, { month: 'sie', value: 185 },
  { month: 'wrz', value: 64 }, { month: 'paź', value: 110 }, { month: 'lis', value: 0 }, { month: 'gru', value: 210 },
]

export const tradingStats = {
  balance: 4200,
  netPnl: 680,
  trades: 42,
  wins: 25,
  losses: 17,
  avgTrade: 16.19,
  avgDaily: 54.4,
  bestTrade: 410,
  worstTrade: -260,
  profitFactor: 1.82,
  maxDrawdown: -540,
}

export const tradingByDay = [
  { day: 'pn', pnl: 120 }, { day: 'wt', pnl: -80 }, { day: 'śr', pnl: 260 }, { day: 'czw', pnl: 90 }, { day: 'pt', pnl: -140 },
  { day: 'pn', pnl: 310 }, { day: 'wt', pnl: 60 }, { day: 'śr', pnl: -210 }, { day: 'czw', pnl: 180 }, { day: 'pt', pnl: 90 },
]

export const bonds = [
  { name: 'EDO0434', units: 75, principal: 7500, rate: 0.067, accrued: 402, maturity: '2034-04' },
  { name: 'EDO0634', units: 60, principal: 6000, rate: 0.067, accrued: 278, maturity: '2034-06' },
]
