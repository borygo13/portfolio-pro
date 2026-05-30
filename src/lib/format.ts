export const PLN = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
})

export const PLN2 = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 2,
})

export const PCT = new Intl.NumberFormat('pl-PL', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
})

export function formatCurrencyValue(value: number, currency = 'PLN', maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) return '—'
  const code = (currency || 'PLN').toUpperCase()
  try {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: code,
      maximumFractionDigits,
    }).format(value)
  } catch {
    return `${value.toLocaleString('pl-PL', { maximumFractionDigits })} ${code}`
  }
}
