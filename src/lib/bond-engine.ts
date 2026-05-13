import type { EdoBond } from '@/lib/supabase/portfolio'

function num(value: unknown) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function yearsBetween(startDate: string | null, end = new Date()) {
  if (!startDate) return 0
  const start = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(start.getTime())) return 0
  return Math.max(0, (end.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
}

export type EdoBondProjection = {
  bond: EdoBond
  principal: number
  elapsedYears: number
  effectiveRate: number
  currentValueBeforeTax: number
  estimatedTax: number
  currentValueAfterTax: number
  accruedInterest: number
  maturityValueEstimate: number
}

export function projectEdoBond(bond: EdoBond, annualInflationPct = 4): EdoBondProjection {
  const quantity = num(bond.quantity)
  const purchasePrice = num(bond.purchase_price)
  const principal = quantity * purchasePrice
  const elapsed = yearsBetween(bond.purchase_date)
  const firstYearRate = num(bond.interest_first_year) / 100
  const laterRate = (annualInflationPct + num(bond.inflation_margin)) / 100

  let value = principal
  const fullYears = Math.floor(elapsed)
  const fraction = elapsed - fullYears

  for (let year = 0; year < fullYears; year += 1) {
    value *= 1 + (year === 0 ? firstYearRate : laterRate)
  }
  const currentYearRate = fullYears === 0 ? firstYearRate : laterRate
  value *= 1 + currentYearRate * fraction

  const accruedInterest = Math.max(0, value - principal)
  const estimatedTax = accruedInterest * 0.19
  const afterTax = value - estimatedTax

  // 10-letnie EDO: prosta prognoza do wykupu przy założeniu stałej inflacji z formularza.
  let maturityValue = principal
  for (let year = 0; year < 10; year += 1) {
    maturityValue *= 1 + (year === 0 ? firstYearRate : laterRate)
  }
  maturityValue -= Math.max(0, maturityValue - principal) * 0.19

  return {
    bond,
    principal,
    elapsedYears: elapsed,
    effectiveRate: currentYearRate,
    currentValueBeforeTax: value,
    estimatedTax,
    currentValueAfterTax: afterTax,
    accruedInterest,
    maturityValueEstimate: maturityValue,
  }
}

export function summarizeEdoBonds(projections: EdoBondProjection[]) {
  return {
    principal: projections.reduce((s, p) => s + p.principal, 0),
    currentValueAfterTax: projections.reduce((s, p) => s + p.currentValueAfterTax, 0),
    accruedInterest: projections.reduce((s, p) => s + p.accruedInterest, 0),
    estimatedTax: projections.reduce((s, p) => s + p.estimatedTax, 0),
    maturityValueEstimate: projections.reduce((s, p) => s + p.maturityValueEstimate, 0),
  }
}
