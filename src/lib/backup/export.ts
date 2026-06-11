export type BackupExportOptions = {
  includeSnapshots: boolean
  includeMarketPrices: boolean
  includeAssetPrices: boolean
  includePriceRefreshMetadata?: boolean
}

export type BackupTableCounts = Record<string, number>

export type PortfolioBackupData = {
  portfolio: Record<string, unknown> | null
  assets: Record<string, unknown>[]
  transactions: Record<string, unknown>[]
  income_events: Record<string, unknown>[]
  cash_ledger_entries: Record<string, unknown>[]
  edo_bonds: Record<string, unknown>[]
  asset_prices: Record<string, unknown>[]
  portfolio_benchmarks: Record<string, unknown>[]
  legacy_dividends: Record<string, unknown>[]
  portfolio_snapshots?: Record<string, unknown>[]
  market_prices?: Record<string, unknown>[]
  price_refresh_runs?: Record<string, unknown>[]
  price_refresh_run_items?: Record<string, unknown>[]
  limits?: Record<string, number>
}

export type PortfolioBackupFile = {
  metadata: {
    app: 'portfolio-pro'
    export_version: 'c6.0a'
    exported_at: string
    portfolio_id: string | null
    portfolio_name: string | null
    base_currency: string
    restore_implemented: false
    options: BackupExportOptions
    table_counts: BackupTableCounts
    warnings: string[]
  }
  data: PortfolioBackupData
}

const EXPORT_VERSION = 'c6.0a'

function isoDate() {
  return new Date().toISOString().slice(0, 10)
}

function safeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === 'number') return safeNumber(value)
  if (Array.isArray(value)) return value.map(sanitizeJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, sanitizeJsonValue(child)]),
    )
  }
  return value
}

export function backupTableCounts(data: PortfolioBackupData): BackupTableCounts {
  return {
    assets: data.assets.length,
    transactions: data.transactions.length,
    income_events: data.income_events.length,
    cash_ledger_entries: data.cash_ledger_entries.length,
    edo_bonds: data.edo_bonds.length,
    asset_prices: data.asset_prices.length,
    portfolio_benchmarks: data.portfolio_benchmarks.length,
    legacy_dividends: data.legacy_dividends.length,
    portfolio_snapshots: data.portfolio_snapshots?.length ?? 0,
    market_prices: data.market_prices?.length ?? 0,
    price_refresh_runs: data.price_refresh_runs?.length ?? 0,
    price_refresh_run_items: data.price_refresh_run_items?.length ?? 0,
  }
}

export function buildPortfolioBackupJson(data: PortfolioBackupData, options: BackupExportOptions): PortfolioBackupFile {
  const portfolio = data.portfolio ?? {}
  const portfolioId = typeof portfolio.id === 'string' ? portfolio.id : null
  const portfolioName = typeof portfolio.name === 'string' ? portfolio.name : null
  const baseCurrency = typeof portfolio.currency === 'string' && portfolio.currency.trim()
    ? portfolio.currency.trim().toUpperCase()
    : 'PLN'
  const tableCounts = backupTableCounts(data)
  const warnings = [
    'C6.0d can restore core user-entered data from this backup. Broker import and derived-history restore are not implemented.',
    options.includeMarketPrices
      ? 'Market price export can be large; verify table_counts against the Supabase database if you need an archival-grade market history backup.'
      : 'Core backup excludes market_prices by default because they are derived/provider data and can be large.',
    options.includeSnapshots
      ? 'Portfolio snapshots are included as derived history.'
      : 'Portfolio snapshots are excluded by default and can be rebuilt from source data and market history.',
  ]

  return sanitizeJsonValue({
    metadata: {
      app: 'portfolio-pro',
      export_version: EXPORT_VERSION,
      exported_at: new Date().toISOString(),
      portfolio_id: portfolioId,
      portfolio_name: portfolioName,
      base_currency: baseCurrency,
      restore_implemented: false,
      options,
      table_counts: tableCounts,
      warnings,
    },
    data,
  }) as PortfolioBackupFile
}

export function makeBackupFilename(prefix: string, extension: string) {
  const safePrefix = prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'portfolio-pro-backup'
  return `${safePrefix}-${isoDate()}.${extension.replace(/^\./, '')}`
}

export function sanitizeCsvValue(value: unknown) {
  if (value === null || value === undefined) return ''
  const normalized = typeof value === 'object' ? JSON.stringify(value) : String(value)
  const cleaned = normalized.replace(/\r?\n/g, ' ').trim()
  if (/[",;\n\r]/.test(cleaned)) return `"${cleaned.replace(/"/g, '""')}"`
  return cleaned
}

export function tableToCsv(rows: Record<string, unknown>[], preferredHeaders: string[] = []) {
  const discoveredHeaders = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  const headers = [
    ...preferredHeaders,
    ...discoveredHeaders.filter((header) => !preferredHeaders.includes(header)).sort(),
  ]

  if (headers.length === 0) return ''
  const lines = [
    headers.map(sanitizeCsvValue).join(','),
    ...rows.map((row) => headers.map((header) => sanitizeCsvValue(row[header])).join(',')),
  ]
  return `${lines.join('\n')}\n`
}

export function downloadBlob(content: BlobPart, filename: string, type: string) {
  if (typeof window === 'undefined') return
  const blob = new Blob([content], { type })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

export function downloadJsonBackup(backup: PortfolioBackupFile) {
  downloadBlob(
    `${JSON.stringify(backup, null, 2)}\n`,
    makeBackupFilename('portfolio-pro-backup', 'json'),
    'application/json;charset=utf-8',
  )
}

export function downloadCsvTable(tableName: string, rows: Record<string, unknown>[], preferredHeaders: string[] = []) {
  downloadBlob(
    tableToCsv(rows, preferredHeaders),
    makeBackupFilename(`portfolio-pro-${tableName}`, 'csv'),
    'text/csv;charset=utf-8',
  )
}
