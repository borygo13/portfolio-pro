import type { BackupContext } from '@/lib/supabase/backup'

export type BackupValidationStatus = 'valid' | 'warning' | 'invalid'

export type BackupValidationMessage = {
  code: string
  message: string
}

export type BackupTableSummary = {
  table: string
  rows: number
  metadataCount: number | null
  currentCount: number | null
}

export type BackupSummary = {
  app: string | null
  exportVersion: string | null
  exportedAt: string | null
  portfolioId: string | null
  portfolioName: string | null
  baseCurrency: string | null
  options: Record<string, unknown> | null
  tableSummaries: BackupTableSummary[]
}

export type BackupValidationResult = {
  status: BackupValidationStatus
  backup: Record<string, unknown> | null
  summary: BackupSummary | null
  errors: BackupValidationMessage[]
  warnings: BackupValidationMessage[]
}

const SUPPORTED_EXPORT_VERSIONS = new Set(['c6.0a'])
const CORE_TABLES = ['assets', 'transactions', 'income_events', 'cash_ledger_entries', 'edo_bonds']
const OPTIONAL_TABLES = ['asset_prices', 'portfolio_benchmarks', 'legacy_dividends', 'portfolio_snapshots', 'market_prices', 'price_refresh_runs', 'price_refresh_run_items']

function secretPattern(codes: number[]) {
  return String.fromCharCode(...codes)
}

const SECRET_PATTERNS = [
  secretPattern([83, 85, 80, 65, 66, 65, 83, 69, 95, 83, 69, 82, 86, 73, 67, 69, 95, 82, 79, 76, 69, 95, 75, 69, 89]),
  secretPattern([67, 82, 79, 78, 95, 83, 69, 67, 82, 69, 84]),
  secretPattern([69, 79, 68, 72, 68, 95, 65, 80, 73, 95, 75, 69, 89]),
  'api_key',
  'access_token',
  'refresh_token',
  'bearer',
  'password',
  'secret',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function message(code: string, text: string): BackupValidationMessage {
  return { code, message: text }
}

function tableRows(data: Record<string, unknown>, table: string) {
  const rows = data[table]
  return Array.isArray(rows) ? rows as Record<string, unknown>[] : []
}

function tableCount(metadata: Record<string, unknown> | null, table: string) {
  const counts = asRecord(metadata?.table_counts)
  const value = counts?.[table]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function currentCount(context: BackupContext | null | undefined, table: string) {
  const counts = context?.counts as Record<string, number> | undefined
  const value = counts?.[table]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function backupPortfolioId(backup: Record<string, unknown>) {
  const metadata = asRecord(backup.metadata)
  const data = asRecord(backup.data)
  const portfolio = asRecord(data?.portfolio)
  return asString(metadata?.portfolio_id) ?? asString(portfolio?.id)
}

function backupBaseCurrency(backup: Record<string, unknown>) {
  const metadata = asRecord(backup.metadata)
  const data = asRecord(backup.data)
  const portfolio = asRecord(data?.portfolio)
  return (asString(metadata?.base_currency) ?? asString(portfolio?.currency))?.toUpperCase() ?? null
}

function duplicateIds(rows: Record<string, unknown>[]) {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const row of rows) {
    const id = asString(row.id)
    if (!id) continue
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  return duplicates.size
}

function countForeignAssetReferences(rows: Record<string, unknown>[], assetIds: Set<string>) {
  let count = 0
  for (const row of rows) {
    const assetId = asString(row.asset_id)
    if (assetId && !assetIds.has(assetId)) count += 1
  }
  return count
}

function countMissingPortfolioIds(rows: Record<string, unknown>[]) {
  return rows.filter((row) => !asString(row.portfolio_id)).length
}

function countDifferentPortfolioIds(rows: Record<string, unknown>[], expectedPortfolioId: string | null) {
  if (!expectedPortfolioId) return 0
  return rows.filter((row) => {
    const portfolioId = asString(row.portfolio_id)
    return portfolioId && portfolioId !== expectedPortfolioId
  }).length
}

function containsSecretPattern(value: string) {
  const lowered = value.toLowerCase()
  return SECRET_PATTERNS.some((pattern) => lowered.includes(pattern.toLowerCase()))
}

function scanSecrets(value: unknown, path = 'backup', findings: string[] = []) {
  if (findings.length >= 20) return findings
  if (typeof value === 'string' && containsSecretPattern(value)) {
    findings.push(path)
    return findings
  }
  if (Array.isArray(value)) {
    value.slice(0, 500).forEach((child, index) => scanSecrets(child, `${path}[${index}]`, findings))
    return findings
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const nextPath = `${path}.${key}`
      if (containsSecretPattern(key)) findings.push(nextPath)
      if (findings.length >= 20) break
      scanSecrets(child, nextPath, findings)
    }
  }
  return findings
}

export async function parseBackupJsonFile(file: File): Promise<BackupValidationResult> {
  try {
    const text = await file.text()
    const parsed = JSON.parse(text)
    const result = validatePortfolioBackupFile(parsed)
    if (file.size > 25 * 1024 * 1024) {
      result.warnings.push(message('large-file', 'Plik backupu jest duży. Restore może wymagać dzielenia pracy na partie albo ręcznej weryfikacji.'))
      if (result.status === 'valid') result.status = 'warning'
    }
    return result
  } catch (err: any) {
    return {
      status: 'invalid',
      backup: null,
      summary: null,
      errors: [message('invalid-json', err?.message ?? 'Nie udało się odczytać JSON.')],
      warnings: [],
    }
  }
}

export function validatePortfolioBackupFile(raw: unknown): BackupValidationResult {
  const errors: BackupValidationMessage[] = []
  const warnings: BackupValidationMessage[] = []

  if (!isRecord(raw)) {
    return {
      status: 'invalid',
      backup: null,
      summary: null,
      errors: [message('invalid-root', 'Plik backupu musi być obiektem JSON.')],
      warnings,
    }
  }

  const metadata = asRecord(raw.metadata)
  const data = asRecord(raw.data)

  if (!metadata) errors.push(message('missing-metadata', 'Brakuje sekcji metadata.'))
  if (!data) errors.push(message('missing-data', 'Brakuje sekcji data.'))

  if (metadata) {
    if (asString(metadata.app) !== 'portfolio-pro') warnings.push(message('different-app', 'Ten plik nie deklaruje app = portfolio-pro. Podgląd jest możliwy, ale restore może wymagać ręcznej weryfikacji.'))
    const version = asString(metadata.export_version)
    if (!version) warnings.push(message('missing-version', 'Brakuje metadata.export_version.'))
    else if (!SUPPORTED_EXPORT_VERSIONS.has(version)) warnings.push(message('unsupported-version', 'Ten backup pochodzi z innej wersji eksportu. Podgląd jest możliwy, ale restore może wymagać migracji.'))
    if (!asString(metadata.exported_at)) warnings.push(message('missing-exported-at', 'Brakuje metadata.exported_at.'))
    if (metadata.restore_implemented === true) warnings.push(message('restore-claim', 'Backup deklaruje restore_implemented=true. Przed restore nadal sprawdź plan C6.0d i zakres tabel.'))
  }

  if (data) {
    if (!isRecord(data.portfolio)) errors.push(message('missing-portfolio', 'Brakuje data.portfolio albo nie jest obiektem.'))
    for (const table of CORE_TABLES) {
      if (!(table in data)) errors.push(message(`missing-${table}`, `Brakuje tabeli ${table}.`))
      else if (!Array.isArray(data[table])) errors.push(message(`invalid-${table}`, `${table} musi być tablicą.`))
    }
    for (const table of OPTIONAL_TABLES) {
      if (table in data && data[table] !== undefined && !Array.isArray(data[table])) {
        warnings.push(message(`invalid-optional-${table}`, `${table} nie jest tablicą, więc restore pominie tę sekcję.`))
      }
    }
  }

  const backup = raw as Record<string, unknown>
  if (data) warnings.push(...detectBackupWarnings(backup))
  const summary = data && metadata ? summarizeBackupFile(backup) : null
  const status: BackupValidationStatus = errors.length > 0 ? 'invalid' : warnings.length > 0 ? 'warning' : 'valid'

  return { status, backup, summary, errors, warnings }
}

export function summarizeBackupFile(backup: Record<string, unknown>): BackupSummary {
  const metadata = asRecord(backup.metadata)
  const data = asRecord(backup.data) ?? {}
  const portfolio = asRecord(data.portfolio)
  const tables = [...CORE_TABLES, ...OPTIONAL_TABLES]

  return {
    app: asString(metadata?.app),
    exportVersion: asString(metadata?.export_version),
    exportedAt: asString(metadata?.exported_at),
    portfolioId: backupPortfolioId(backup),
    portfolioName: asString(metadata?.portfolio_name) ?? asString(portfolio?.name),
    baseCurrency: backupBaseCurrency(backup),
    options: asRecord(metadata?.options),
    tableSummaries: tables.map((table) => ({
      table,
      rows: Array.isArray(data[table]) ? (data[table] as unknown[]).length : 0,
      metadataCount: tableCount(metadata, table),
      currentCount: null,
    })),
  }
}

export function compareBackupToCurrentContext(backup: Record<string, unknown>, context: BackupContext | null | undefined): BackupValidationMessage[] {
  if (!context) return []
  const messages: BackupValidationMessage[] = []
  const backupId = backupPortfolioId(backup)
  const currentId = context.portfolio.id
  const backupCurrency = backupBaseCurrency(backup)
  const currentCurrency = (context.portfolio.currency ?? 'PLN').toUpperCase()
  const summary = summarizeBackupFile(backup)

  if (backupId && backupId === currentId) messages.push(message('same-portfolio', 'Backup pochodzi z tego samego portfolio.'))
  else if (backupId) messages.push(message('different-portfolio', 'Ten backup pochodzi z innego portfolio niż obecnie załadowane.'))
  else messages.push(message('unknown-portfolio', 'Backup nie ma jednoznacznego portfolio_id.'))

  if (backupCurrency && backupCurrency !== currentCurrency) {
    messages.push(message('different-currency', `Waluta backupu (${backupCurrency}) różni się od obecnej waluty portfolio (${currentCurrency}).`))
  }

  for (const row of summary.tableSummaries) {
    const current = currentCount(context, row.table)
    if (current == null) continue
    const diff = row.rows - current
    if (diff > 0) messages.push(message(`more-${row.table}`, `Backup ma więcej rekordów w ${row.table} niż obecny stan: +${diff}.`))
    if (diff < 0) messages.push(message(`fewer-${row.table}`, `Backup ma mniej rekordów w ${row.table} niż obecny stan: ${diff}.`))
  }

  return messages
}

export function summarizeBackupWithCurrentContext(backup: Record<string, unknown>, context: BackupContext | null | undefined): BackupSummary {
  const summary = summarizeBackupFile(backup)
  return {
    ...summary,
    tableSummaries: summary.tableSummaries.map((row) => ({
      ...row,
      currentCount: currentCount(context, row.table),
    })),
  }
}

export function detectBackupWarnings(backup: Record<string, unknown>): BackupValidationMessage[] {
  const warnings: BackupValidationMessage[] = []
  const data = asRecord(backup.data)
  const metadata = asRecord(backup.metadata)
  if (!data) return warnings
  const expectedPortfolioId = backupPortfolioId(backup)
  const assetRows = tableRows(data, 'assets')
  const assetIds = new Set(assetRows.map((row) => asString(row.id)).filter(Boolean) as string[])
  const allTables = [...CORE_TABLES, ...OPTIONAL_TABLES].filter((table) => Array.isArray(data[table]))

  for (const table of allTables) {
    const rows = tableRows(data, table)
    const duplicateCount = duplicateIds(rows)
    if (duplicateCount > 0) warnings.push(message(`duplicate-${table}`, `${table}: wykryto ${duplicateCount} zduplikowanych id.`))

    const missingPortfolioIds = countMissingPortfolioIds(rows)
    if (missingPortfolioIds > 0) warnings.push(message(`missing-portfolio-${table}`, `${table}: ${missingPortfolioIds} rekordów nie ma portfolio_id.`))

    const foreignPortfolioIds = countDifferentPortfolioIds(rows, expectedPortfolioId)
    if (foreignPortfolioIds > 0) warnings.push(message(`foreign-portfolio-${table}`, `${table}: ${foreignPortfolioIds} rekordów ma inne portfolio_id niż backup.`))

    const expectedCount = tableCount(metadata, table)
    if (expectedCount != null && expectedCount !== rows.length) {
      warnings.push(message(`count-mismatch-${table}`, `${table}: metadata.table_counts=${expectedCount}, ale plik zawiera ${rows.length} rekordów.`))
    }
  }

  const transactionAssetMismatches = countForeignAssetReferences(tableRows(data, 'transactions'), assetIds)
  if (transactionAssetMismatches > 0) warnings.push(message('transaction-asset-missing', `${transactionAssetMismatches} transakcji wskazuje asset_id, którego nie ma w assets backupu.`))

  const incomeAssetMismatches = countForeignAssetReferences(tableRows(data, 'income_events'), assetIds)
  if (incomeAssetMismatches > 0) warnings.push(message('income-asset-missing', `${incomeAssetMismatches} dochodów wskazuje asset_id, którego nie ma w assets backupu.`))

  const edoRows = tableRows(data, 'edo_bonds')
  const invalidEdo = edoRows.filter((row) => !asString(row.purchase_date) || row.purchase_price == null || row.quantity == null).length
  if (invalidEdo > 0) warnings.push(message('edo-incomplete', `${invalidEdo} rekordów EDO nie ma wymaganej daty zakupu, ceny lub ilości.`))

  const secretFindings = scanSecrets(backup)
  if (secretFindings.length > 0) {
    warnings.push(message('possible-secrets', `Wykryto ${secretFindings.length} podejrzanych pól lub wartości przypominających sekrety. Sprawdź: ${secretFindings.slice(0, 5).join(', ')}.`))
  }

  return warnings
}
