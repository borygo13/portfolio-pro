import type { BackupContext } from '@/lib/supabase/backup'
import type { BackupValidationResult, BackupValidationMessage } from './validate'
import { compareBackupToCurrentContext, summarizeBackupWithCurrentContext } from './validate'
import { supabase } from '@/lib/supabase/client'

export const RESTORE_CONFIRMATION_TEXT = 'PRZYWRÓĆ'

export const RESTORE_CORE_TABLES = [
  'assets',
  'transactions',
  'income_events',
  'cash_ledger_entries',
  'edo_bonds',
  'portfolio_benchmarks',
  'asset_prices',
  'legacy_dividends',
] as const

export const RESTORE_IGNORED_TABLES = [
  'market_prices',
  'portfolio_snapshots',
  'price_refresh_runs',
  'price_refresh_run_items',
] as const

export type RestoreTablePlan = {
  table: string
  currentRows: number | null
  backupRows: number
}

export type RestoreIgnoredTable = {
  table: string
  backupRows: number
  reason: string
}

export type RestorePlan = {
  restorable: boolean
  hardErrors: BackupValidationMessage[]
  warnings: BackupValidationMessage[]
  tablePlans: RestoreTablePlan[]
  ignoredTables: RestoreIgnoredTable[]
  backupPortfolioId: string | null
  backupPortfolioName: string | null
  backupBaseCurrency: string | null
  currentPortfolioId: string | null
  currentPortfolioName: string | null
  currentBaseCurrency: string | null
  samePortfolio: boolean | null
  currencyMismatch: boolean
}

export type RestoreExecutionSummary = {
  status: string
  portfolio_id: string
  deleted: Record<string, number>
  inserted: Record<string, number>
  ignored_tables: string[]
  message?: string
}

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

function tableRows(backup: Record<string, unknown>, table: string) {
  const data = asRecord(backup.data)
  const rows = data?.[table]
  return Array.isArray(rows) ? rows.length : 0
}

function currentCount(context: BackupContext | null | undefined, table: string) {
  const counts = context?.counts as Record<string, number> | undefined
  const value = counts?.[table]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function hardRestoreErrors(result: BackupValidationResult | null): BackupValidationMessage[] {
  if (!result?.backup) return [message('missing-backup', 'Najpierw wczytaj poprawny backup JSON.')]
  const metadata = asRecord(result.backup.metadata)
  const data = asRecord(result.backup.data)
  const errors = [...result.errors]

  if (asString(metadata?.app) !== 'portfolio-pro') {
    errors.push(message('wrong-app', 'Restore wymaga backupu z metadata.app = portfolio-pro.'))
  }

  if (asString(metadata?.export_version) !== 'c6.0a') {
    errors.push(message('wrong-version', 'Restore C6.0d obsługuje tylko export_version = c6.0a.'))
  }

  if (!data) {
    errors.push(message('missing-data', 'Backup nie zawiera sekcji data.'))
    return errors
  }

  for (const table of ['assets', 'transactions', 'income_events', 'cash_ledger_entries', 'edo_bonds']) {
    if (!Array.isArray(data[table])) errors.push(message(`invalid-${table}`, `${table} musi być tablicą przed restore.`))
  }

  for (const table of ['asset_prices', 'portfolio_benchmarks', 'legacy_dividends']) {
    if (table in data && data[table] !== undefined && !Array.isArray(data[table])) {
      errors.push(message(`invalid-${table}`, `${table} musi być tablicą albo musi być pominięte.`))
    }
  }

  return errors
}

export function buildRestorePlan(result: BackupValidationResult | null, context: BackupContext | null | undefined): RestorePlan | null {
  if (!result?.backup) return null
  const summary = summarizeBackupWithCurrentContext(result.backup, context)
  const comparison = compareBackupToCurrentContext(result.backup, context)
  const hardErrors = hardRestoreErrors(result)
  const currentCurrency = (context?.portfolio.currency ?? null)?.toUpperCase() ?? null
  const backupCurrency = summary.baseCurrency?.toUpperCase() ?? null

  return {
    restorable: hardErrors.length === 0,
    hardErrors,
    warnings: [...result.warnings, ...comparison],
    tablePlans: RESTORE_CORE_TABLES.map((table) => ({
      table,
      currentRows: currentCount(context, table),
      backupRows: tableRows(result.backup as Record<string, unknown>, table),
    })),
    ignoredTables: RESTORE_IGNORED_TABLES.map((table) => ({
      table,
      backupRows: tableRows(result.backup as Record<string, unknown>, table),
      reason: 'Dane pochodne/cache. Nie są przywracane w C6.0d i mogą zostać odbudowane później.',
    })),
    backupPortfolioId: summary.portfolioId,
    backupPortfolioName: summary.portfolioName,
    backupBaseCurrency: backupCurrency,
    currentPortfolioId: context?.portfolio.id ?? null,
    currentPortfolioName: context?.portfolio.name ?? null,
    currentBaseCurrency: currentCurrency,
    samePortfolio: summary.portfolioId && context?.portfolio.id ? summary.portfolioId === context.portfolio.id : null,
    currencyMismatch: Boolean(backupCurrency && currentCurrency && backupCurrency !== currentCurrency),
  }
}

export async function restorePortfolioCoreBackup(portfolioId: string, backup: Record<string, unknown>): Promise<RestoreExecutionSummary> {
  const { data, error } = await supabase.rpc('restore_portfolio_core_backup', {
    p_portfolio_id: portfolioId,
    p_backup: backup,
  })

  if (error) throw new Error(error.message)
  return data as RestoreExecutionSummary
}
