'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { AlertTriangle, CheckCircle2, Database, Download, FileDown, FileSearch, KeyRound, Loader2, RefreshCw, RotateCcw, ShieldCheck, Upload } from 'lucide-react'
import { Shell, PageHeader, Card, FeatureNote, TrustBadge } from '@/components/Shell'
import {
  buildPortfolioBackupJson,
  downloadCsvTable,
  downloadJsonBackup,
  type BackupExportOptions,
  type PortfolioBackupData,
} from '@/lib/backup/export'
import {
  compareBackupToCurrentContext,
  parseBackupJsonFile,
  summarizeBackupWithCurrentContext,
  type BackupValidationResult,
} from '@/lib/backup/validate'
import {
  buildCsvDryRunSummary,
  describeCsvDelimiter,
  parseCsvText,
  type CsvDryRunSummary,
} from '@/lib/import/csv-dry-run'
import {
  buildRestorePlan,
  restorePortfolioCoreBackup,
  RESTORE_CONFIRMATION_TEXT,
  type RestoreExecutionSummary,
  type RestorePlan,
} from '@/lib/backup/restore'
import { getBackupContext, fetchPortfolioBackupData, BACKUP_EXPORT_LIMITS, type BackupContext } from '@/lib/supabase/backup'
import { supabase } from '@/lib/supabase/client'

type CsvTableKey = 'assets' | 'transactions' | 'income_events' | 'cash_ledger_entries' | 'edo_bonds'

const defaultOptions: BackupExportOptions = {
  includeAssetPrices: true,
  includeSnapshots: false,
  includeMarketPrices: false,
  includePriceRefreshMetadata: false,
}

const csvTables: { key: CsvTableKey; label: string; description: string }[] = [
  { key: 'assets', label: 'Aktywa CSV', description: 'Instrumenty, waluty, symbole providerów.' },
  { key: 'transactions', label: 'Transakcje CSV', description: 'C5.8 source/base currency i FX.' },
  { key: 'income_events', label: 'Dochody CSV', description: 'C5.9 dywidendy, podatki, FX.' },
  { key: 'cash_ledger_entries', label: 'Cash ledger CSV', description: 'Wpłaty, wypłaty, opłaty i podatki.' },
  { key: 'edo_bonds', label: 'EDO CSV', description: 'Ręcznie dodane obligacje EDO.' },
]

const csvHeaders: Record<CsvTableKey, string[]> = {
  assets: ['id', 'portfolio_id', 'symbol', 'name', 'asset_type', 'currency', 'target_allocation', 'market_symbol', 'price_source', 'auto_refresh_enabled', 'created_at'],
  transactions: ['id', 'portfolio_id', 'asset_id', 'transaction_type', 'quantity', 'source_currency', 'price_source', 'fees_source', 'fx_rate_to_base', 'fx_rate_date', 'base_currency', 'price_base', 'fees_base', 'gross_amount_source', 'gross_amount_base', 'price', 'fees', 'transaction_date', 'notes', 'created_at'],
  income_events: ['id', 'portfolio_id', 'asset_id', 'income_type', 'currency', 'gross_amount', 'withholding_tax', 'local_tax', 'other_fees', 'net_amount', 'fx_rate_to_base', 'fx_rate_date', 'base_currency', 'gross_amount_base', 'withholding_tax_base', 'local_tax_base', 'other_fees_base', 'net_amount_base', 'payment_date', 'ex_date', 'record_date', 'broker', 'source', 'notes', 'created_at'],
  cash_ledger_entries: ['id', 'portfolio_id', 'entry_type', 'amount', 'currency', 'entry_date', 'note', 'created_at', 'updated_at'],
  edo_bonds: ['id', 'portfolio_id', 'series', 'quantity', 'purchase_price', 'purchase_date', 'interest_first_year', 'inflation_margin', 'maturity_date', 'created_at'],
}

function formatCount(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString('pl-PL')
}

function countRows(data: PortfolioBackupData, table: CsvTableKey) {
  return data[table]?.length ?? 0
}

function validationTone(status: BackupValidationResult['status'] | undefined) {
  if (status === 'valid') return { label: 'Backup wygląda poprawnie', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100', icon: CheckCircle2 }
  if (status === 'warning') return { label: 'Backup ma ostrzeżenia', className: 'border-amber-500/20 bg-amber-500/10 text-amber-100', icon: AlertTriangle }
  if (status === 'invalid') return { label: 'Backup jest niepoprawny', className: 'border-rose-500/20 bg-rose-500/10 text-rose-100', icon: AlertTriangle }
  return { label: 'Nie wczytano backupu', className: 'border-white/10 bg-white/[0.03] text-slate-400', icon: ShieldCheck }
}

function csvImportTone(status: CsvDryRunSummary['status'] | undefined) {
  if (status === 'valid') return { label: 'CSV wygląda poprawnie', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100', icon: CheckCircle2 }
  if (status === 'warning') return { label: 'CSV ma ostrzeżenia', className: 'border-amber-500/20 bg-amber-500/10 text-amber-100', icon: AlertTriangle }
  if (status === 'invalid') return { label: 'CSV jest niepoprawny', className: 'border-rose-500/20 bg-rose-500/10 text-rose-100', icon: AlertTriangle }
  return { label: 'Nie wczytano CSV', className: 'border-white/10 bg-white/[0.03] text-slate-400', icon: FileSearch }
}

export default function SettingsPage() {
  const [context, setContext] = useState<BackupContext | null>(null)
  const [options, setOptions] = useState<BackupExportOptions>(defaultOptions)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<BackupValidationResult | null>(null)
  const [validationFileName, setValidationFileName] = useState('')
  const [csvDryRunLoading, setCsvDryRunLoading] = useState(false)
  const [csvDryRunResult, setCsvDryRunResult] = useState<CsvDryRunSummary | null>(null)
  const [csvDryRunFileName, setCsvDryRunFileName] = useState('')
  const [restoreAcknowledged, setRestoreAcknowledged] = useState(false)
  const [restoreConfirmation, setRestoreConfirmation] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [restoreResult, setRestoreResult] = useState<RestoreExecutionSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function loadContext() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getUser()
      if (!data.user) throw new Error('Brak aktywnej sesji użytkownika.')
      setContext(await getBackupContext(data.user))
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się pobrać danych backupu.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadContext() }, [])

  const backupScopeLabel = useMemo(() => {
    const parts = ['core']
    if (options.includeAssetPrices) parts.push('latest prices')
    if (options.includeSnapshots) parts.push('snapshots')
    if (options.includeMarketPrices) parts.push('market history')
    if (options.includePriceRefreshMetadata) parts.push('refresh logs')
    return parts.join(' + ')
  }, [options])

  async function fetchBackupForCurrentOptions(extraOptions?: Partial<BackupExportOptions>) {
    if (!context) throw new Error('Portfolio nie jest jeszcze załadowane.')
    return fetchPortfolioBackupData(context.portfolio, { ...options, ...extraOptions })
  }

  async function handleJsonExport() {
    setExporting(true)
    setError(null)
    setSuccess(null)
    try {
      const data = await fetchBackupForCurrentOptions()
      const backup = buildPortfolioBackupJson(data, options)
      downloadJsonBackup(backup)
      setSuccess(`Pobrano backup JSON (${backupScopeLabel}).`)
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się pobrać backupu JSON.')
    } finally {
      setExporting(false)
    }
  }

  async function handleCsvExport(table: CsvTableKey) {
    setExporting(true)
    setError(null)
    setSuccess(null)
    try {
      const data = await fetchBackupForCurrentOptions({
        includeAssetPrices: false,
        includeSnapshots: false,
        includeMarketPrices: false,
        includePriceRefreshMetadata: false,
      })
      downloadCsvTable(table, data[table], csvHeaders[table])
      setSuccess(`Pobrano ${csvTables.find((item) => item.key === table)?.label ?? table}: ${formatCount(countRows(data, table))} wierszy.`)
    } catch (err: any) {
      setError(err?.message ?? `Nie udało się pobrać CSV dla ${table}.`)
    } finally {
      setExporting(false)
    }
  }

  const counts = context?.counts
  const marketPricesLarge = Number(counts?.market_prices ?? 0) > BACKUP_EXPORT_LIMITS.marketPrices
  const snapshotsLarge = Number(counts?.portfolio_snapshots ?? 0) > BACKUP_EXPORT_LIMITS.snapshots
  const validationSummary = useMemo(() => {
    if (!validationResult?.backup) return validationResult?.summary ?? null
    return summarizeBackupWithCurrentContext(validationResult.backup, context)
  }, [context, validationResult])
  const comparisonMessages = useMemo(() => {
    if (!validationResult?.backup) return []
    return compareBackupToCurrentContext(validationResult.backup, context)
  }, [context, validationResult])
  const validationState = validationTone(validationResult?.status)
  const ValidationIcon = validationState.icon
  const csvState = csvImportTone(csvDryRunResult?.status)
  const CsvStateIcon = csvState.icon
  const restorePlan = useMemo(() => buildRestorePlan(validationResult, context), [context, validationResult])
  const restoreReady = Boolean(
    context
    && validationResult?.backup
    && restorePlan?.restorable
    && restoreAcknowledged
    && restoreConfirmation.trim() === RESTORE_CONFIRMATION_TEXT,
  )

  async function handleBackupValidation(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setValidating(true)
    setError(null)
    setSuccess(null)
    setValidationFileName(file.name)
    try {
      setValidationResult(await parseBackupJsonFile(file))
      setRestoreAcknowledged(false)
      setRestoreConfirmation('')
      setRestoreResult(null)
    } catch (err: any) {
      setValidationResult({
        status: 'invalid',
        backup: null,
        summary: null,
        errors: [{ code: 'file-read-error', message: err?.message ?? 'Nie udało się odczytać pliku backupu.' }],
        warnings: [],
      })
      setRestoreAcknowledged(false)
      setRestoreConfirmation('')
      setRestoreResult(null)
    } finally {
      setValidating(false)
      event.target.value = ''
    }
  }

  async function handleCsvDryRun(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setCsvDryRunLoading(true)
    setError(null)
    setSuccess(null)
    setCsvDryRunFileName(file.name)
    try {
      const text = await file.text()
      setCsvDryRunResult(buildCsvDryRunSummary(parseCsvText(text)))
    } catch (err: any) {
      setCsvDryRunResult({
        status: 'invalid',
        delimiter: null,
        importKind: 'unknown',
        importKindLabel: 'Nieznany format CSV',
        brokerHint: null,
        headers: [],
        normalizedHeaders: [],
        rowCount: 0,
        sampleRows: [],
        mapping: [],
        errors: [{ code: 'file-read-error', message: err?.message ?? 'Nie udało się odczytać pliku CSV.' }],
        warnings: [],
      })
    } finally {
      setCsvDryRunLoading(false)
      event.target.value = ''
    }
  }

  async function handleRestoreBackup() {
    if (!context || !validationResult?.backup || !restorePlan?.restorable) return
    setRestoring(true)
    setError(null)
    setSuccess(null)
    setRestoreResult(null)
    try {
      const result = await restorePortfolioCoreBackup(context.portfolio.id, validationResult.backup)
      setRestoreResult(result)
      setSuccess('Restore zakończony. Odświeżyłem liczniki portfolio; utwórz świeży backup po weryfikacji danych.')
      setRestoreAcknowledged(false)
      setRestoreConfirmation('')
      await loadContext()
    } catch (err: any) {
      setError(err?.message ?? 'Restore backupu nie powiódł się.')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <Shell>
      <PageHeader
        eyebrow="System · C6.0a / C6.0b / C6.0c / C6.0d"
        title="Backup, Supabase i ustawienia"
        description="Eksportuj backup, sprawdź plik JSON, podejrzyj CSV i bezpiecznie przywróć podstawowe dane portfolio."
      />

      {error ? <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
      {success ? <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">{success}</div> : null}
      {loading ? <div className="mb-6 flex items-center gap-2 text-sm text-slate-400"><Loader2 className="animate-spin" size={16} /> Ładowanie kontekstu backupu...</div> : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <Database className="mb-4 text-violet-300" />
          <h3 className="text-lg font-bold text-white">Supabase</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">Eksport czyta dane przez zwykły klient Supabase i RLS zalogowanego użytkownika. Nie używa service role.</p>
          <div className="mt-4"><TrustBadge>RLS scoped</TrustBadge></div>
        </Card>

        <Card>
          <Download className="mb-4 text-cyan-300" />
          <h3 className="text-lg font-bold text-white">Backup przed importem</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">Domyślny backup obejmuje dane wpisane przez użytkownika oraz latest/manual prices. Duże dane historyczne są opcjonalne.</p>
          <div className="mt-4"><TrustBadge>{backupScopeLabel}</TrustBadge></div>
        </Card>

        <Card>
          <KeyRound className="mb-4 text-emerald-300" />
          <h3 className="text-lg font-bold text-white">Bez sekretów</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">Backup nie zawiera env vars, tokenów auth, sekretów serwerowych ani kluczy providerów.</p>
        </Card>
      </div>

      <Card className="mt-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">Backup danych</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Portfolio: <span className="font-semibold text-white">{context?.portfolio.name ?? '—'}</span>
              {' '}· waluta bazowa: <span className="font-semibold text-white">{context?.portfolio.currency ?? 'PLN'}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={loadContext}
            disabled={loading || exporting}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Odśwież liczniki
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CountTile label="Aktywa" value={counts?.assets} />
          <CountTile label="Transakcje" value={counts?.transactions} />
          <CountTile label="Dochody" value={counts?.income_events} />
          <CountTile label="Cash ledger" value={counts?.cash_ledger_entries} />
          <CountTile label="Obligacje EDO" value={counts?.edo_bonds} />
          <CountTile label="Latest/manual prices" value={counts?.asset_prices} />
          <CountTile label="Snapshoty" value={counts?.portfolio_snapshots} />
          <CountTile label="Market prices" value={counts?.market_prices} />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h4 className="font-semibold text-white">Zakres backupu JSON</h4>
            <div className="mt-4 space-y-3">
              <CheckboxRow
                checked={options.includeAssetPrices}
                onChange={(value) => setOptions((current) => ({ ...current, includeAssetPrices: value }))}
                title="Dołącz latest/manual prices"
                description="asset_prices są małe i przydatne do odtworzenia bieżącego stanu."
              />
              <CheckboxRow
                checked={options.includeSnapshots}
                onChange={(value) => setOptions((current) => ({ ...current, includeSnapshots: value }))}
                title="Dołącz portfolio_snapshots"
                description={`Dane pochodne; limit eksportu ${formatCount(BACKUP_EXPORT_LIMITS.snapshots)} wierszy.`}
              />
              {snapshotsLarge ? <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-100">Snapshotów jest więcej niż limit C6.0a. Eksport może być częściowy.</p> : null}
              <CheckboxRow
                checked={options.includeMarketPrices}
                onChange={(value) => setOptions((current) => ({
                  ...current,
                  includeMarketPrices: value,
                  includePriceRefreshMetadata: value ? current.includePriceRefreshMetadata : false,
                }))}
                title="Dołącz market_prices"
                description={`Duża historia providerów; limit eksportu ${formatCount(BACKUP_EXPORT_LIMITS.marketPrices)} wierszy.`}
              />
              {marketPricesLarge ? <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-100">market_prices przekracza limit C6.0a. Core backup nadal jest kompletny dla danych wpisanych ręcznie.</p> : null}
              <CheckboxRow
                checked={Boolean(options.includePriceRefreshMetadata)}
                disabled={!options.includeMarketPrices}
                onChange={(value) => setOptions((current) => ({ ...current, includePriceRefreshMetadata: value }))}
                title="Dołącz logi refreshu cen"
                description="price_refresh_runs i price_refresh_run_items, tylko gdy eksportujesz historię cen."
              />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h4 className="font-semibold text-white">Eksportuj dane</h4>
            <p className="mt-2 text-sm leading-6 text-slate-400">JSON jest głównym formatem backupu C6.0a. CSV służy do szybkiego podglądu najważniejszych tabel.</p>
            <button
              type="button"
              onClick={handleJsonExport}
              disabled={!context || loading || exporting}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-5 py-4 text-sm font-bold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exporting ? <Loader2 size={18} className="animate-spin" /> : <FileDown size={18} />}
              Pobierz backup JSON
            </button>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {csvTables.map((table) => (
                <button
                  key={table.key}
                  type="button"
                  onClick={() => handleCsvExport(table.key)}
                  disabled={!context || loading || exporting}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-cyan-300/40 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-white"><FileDown size={16} /> {table.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">{table.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <FeatureNote>
          Backup JSON jest punktem bezpieczeństwa przed restore i przyszłymi importami. Restore C6.0d wymaga walidacji, planu, checkboxa i wpisania potwierdzenia.
        </FeatureNote>
      </Card>

      <Card className="mt-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">Sprawdź backup</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Wczytaj backup JSON lokalnie w przeglądarce. Tryb dry run niczego nie zapisuje do bazy i nie wysyła pliku do API.</p>
          </div>
          <TrustBadge>Dry run</TrustBadge>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-6 text-center transition hover:border-violet-300/40 hover:bg-violet-500/10">
              <Upload className="mb-3 text-violet-300" size={24} />
              <span className="font-semibold text-white">Wczytaj plik JSON</span>
              <span className="mt-1 text-xs text-slate-500">Plik zostaje w przeglądarce. Restore jest dostępny dopiero po walidacji i planie poniżej.</span>
              <input type="file" accept="application/json,.json" onChange={handleBackupValidation} className="hidden" />
            </label>
            {validating ? <div className="mt-4 flex items-center gap-2 text-sm text-slate-400"><Loader2 className="animate-spin" size={16} /> Sprawdzam backup...</div> : null}
            {validationFileName ? <p className="mt-4 text-xs text-slate-500">Ostatni plik: {validationFileName}</p> : null}
            <button
              type="button"
              disabled
              className="mt-4 inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-white/5 px-4 py-3 text-sm font-semibold text-slate-500"
            >
              Restore wymaga planu i potwierdzenia poniżej
            </button>
          </div>

          <div className="space-y-4">
            <div className={`rounded-2xl border p-4 ${validationState.className}`}>
              <div className="flex items-center gap-2 font-semibold"><ValidationIcon size={18} /> {validationState.label}</div>
              <p className="mt-2 text-sm opacity-80">Nic nie zostanie zapisane. Ten panel pokazuje tylko strukturę, zgodność i ostrzeżenia pliku.</p>
            </div>

            {validationSummary ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <h4 className="font-semibold text-white">Metadata</h4>
                <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                  <InfoLine label="App" value={validationSummary.app ?? '—'} />
                  <InfoLine label="Wersja eksportu" value={validationSummary.exportVersion ?? '—'} />
                  <InfoLine label="Data eksportu" value={validationSummary.exportedAt ?? '—'} />
                  <InfoLine label="Portfolio" value={validationSummary.portfolioName ?? validationSummary.portfolioId ?? '—'} />
                  <InfoLine label="Portfolio ID" value={validationSummary.portfolioId ?? '—'} />
                  <InfoLine label="Waluta bazowa" value={validationSummary.baseCurrency ?? '—'} />
                </div>
              </div>
            ) : null}

            {validationSummary ? (
              <div className="overflow-x-auto rounded-2xl border border-white/10">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr><th className="p-3">Tabela</th><th className="p-3 text-right">Backup</th><th className="p-3 text-right">Metadata</th><th className="p-3 text-right">Obecnie</th></tr>
                  </thead>
                  <tbody>
                    {validationSummary.tableSummaries.map((row) => (
                      <tr key={row.table} className="border-t border-white/10">
                        <td className="p-3 font-semibold text-white">{row.table}</td>
                        <td className="p-3 text-right text-slate-300">{formatCount(row.rows)}</td>
                        <td className="p-3 text-right text-slate-500">{row.metadataCount == null ? '—' : formatCount(row.metadataCount)}</td>
                        <td className="p-3 text-right text-slate-500">{row.currentCount == null ? '—' : formatCount(row.currentCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {comparisonMessages.length > 0 ? (
              <MessageList title="Porównanie z obecnym portfolio" messages={comparisonMessages.map((item) => item.message)} tone="cyan" />
            ) : null}
            {validationResult?.warnings.length ? <MessageList title="Ostrzeżenia" messages={validationResult.warnings.map((item) => item.message)} tone="amber" /> : null}
            {validationResult?.errors.length ? <MessageList title="Błędy pliku" messages={validationResult.errors.map((item) => item.message)} tone="rose" /> : null}
          </div>
        </div>
      </Card>

      <Card className="mt-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">Restore backupu</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Zastępuje podstawowe dane obecnego portfolio danymi z backupu JSON. Wymaga planu, checkboxa i wpisania potwierdzenia.</p>
          </div>
          <TrustBadge>RPC · atomic</TrustBadge>
        </div>

        <FeatureNote>
          Ten restore przywraca dane podstawowe. Historia cen, snapshoty i logi refreshu nie są przywracane w tym etapie.
        </FeatureNote>

        {restorePlan ? (
          <RestorePlanPanel
            plan={restorePlan}
            result={restoreResult}
            acknowledged={restoreAcknowledged}
            confirmation={restoreConfirmation}
            restoring={restoring}
            restoreReady={restoreReady}
            onAcknowledgedChange={setRestoreAcknowledged}
            onConfirmationChange={setRestoreConfirmation}
            onRestore={handleRestoreBackup}
          />
        ) : (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
            Wczytaj i sprawdź backup JSON w sekcji “Sprawdź backup”, żeby zobaczyć plan restore.
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">Import CSV — dry run</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Wczytaj CSV lokalnie w przeglądarce. Ten etap pokazuje nagłówki, próbkę, typ importu i ostrzeżenia, ale niczego nie zapisuje do bazy.</p>
          </div>
          <TrustBadge>Preview only</TrustBadge>
        </div>

        <FeatureNote>
          Najpierw pobierz i sprawdź backup JSON. Ten podgląd CSV nie tworzy aktywów, transakcji, dochodów ani wpisów cash ledger.
        </FeatureNote>

        <div className="mt-5 grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-6 text-center transition hover:border-cyan-300/40 hover:bg-cyan-500/10">
              <FileSearch className="mb-3 text-cyan-300" size={24} />
              <span className="font-semibold text-white">Wczytaj CSV</span>
              <span className="mt-1 text-xs text-slate-500">Obsługiwane: przecinek, średnik, tabulator, cudzysłowy i polskie znaki.</span>
              <input type="file" accept=".csv,text/csv,text/plain" onChange={handleCsvDryRun} className="hidden" />
            </label>
            {csvDryRunLoading ? <div className="mt-4 flex items-center gap-2 text-sm text-slate-400"><Loader2 className="animate-spin" size={16} /> Sprawdzam CSV...</div> : null}
            {csvDryRunFileName ? <p className="mt-4 text-xs text-slate-500">Ostatni plik: {csvDryRunFileName}</p> : null}
            <button
              type="button"
              disabled
              className="mt-4 inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-white/5 px-4 py-3 text-sm font-semibold text-slate-500"
            >
              Import będzie dostępny w kolejnym etapie
            </button>
          </div>

          <div className="space-y-4">
            <div className={`rounded-2xl border p-4 ${csvState.className}`}>
              <div className="flex items-center gap-2 font-semibold"><CsvStateIcon size={18} /> {csvState.label}</div>
              <p className="mt-2 text-sm opacity-80">CSV zostaje lokalnie w przeglądarce. Nie ma uploadu, API route ani zapisu do Supabase.</p>
            </div>

            {csvDryRunResult ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <h4 className="font-semibold text-white">Podsumowanie CSV</h4>
                <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                  <InfoLine label="Typ" value={csvDryRunResult.importKindLabel} />
                  <InfoLine label="Delimiter" value={describeCsvDelimiter(csvDryRunResult.delimiter)} />
                  <InfoLine label="Wiersze danych" value={formatCount(csvDryRunResult.rowCount)} />
                  <InfoLine label="Nagłówki" value={formatCount(csvDryRunResult.headers.length)} />
                </div>
              </div>
            ) : null}

            {csvDryRunResult?.headers.length ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <h4 className="font-semibold text-white">Nagłówki</h4>
                <div className="mt-3 flex flex-wrap gap-2">
                  {csvDryRunResult.headers.map((header, index) => (
                    <span key={`${header}-${index}`} className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-300">{header || `kolumna_${index + 1}`}</span>
                  ))}
                </div>
              </div>
            ) : null}

            {csvDryRunResult?.mapping.length ? <CsvMappingPreview result={csvDryRunResult} /> : null}
            {csvDryRunResult?.mapping.some((row) => row.present) ? <CsvNormalizedPreview result={csvDryRunResult} /> : null}
            {csvDryRunResult?.sampleRows.length ? <CsvRowsPreview result={csvDryRunResult} /> : null}
            {csvDryRunResult?.warnings.length ? <MessageList title="Ostrzeżenia CSV" messages={csvDryRunResult.warnings.map((item) => item.message)} tone="amber" /> : null}
            {csvDryRunResult?.errors.length ? <MessageList title="Błędy CSV" messages={csvDryRunResult.errors.map((item) => item.message)} tone="rose" /> : null}
          </div>
        </div>
      </Card>

      <Card className="mt-6">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/10 text-slate-200"><Upload size={22} /></div>
          <div>
            <h3 className="text-lg font-bold text-white">Import XTB / IBKR</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">W następnym etapie dodamy import. Przed każdym importem pobierz backup JSON z tej strony.</p>
            <div className="mt-4 inline-flex rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-slate-400">Sekcja w budowie · import wyłączony</div>
          </div>
        </div>
      </Card>

      <Card className="mt-6">
        <ShieldCheck className="mb-4 text-emerald-300" />
        <h3 className="text-lg font-bold text-white">Strategia backupu</h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">Dane mają być przenośne: migracje SQL są w repo, aplikacja daje eksport JSON/CSV, a pg_dump pozostaje opcjonalnym backupem technicznym.</p>
      </Card>
    </Shell>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-all font-semibold text-white">{value}</p>
    </div>
  )
}

function MessageList({ title, messages, tone }: { title: string; messages: string[]; tone: 'amber' | 'rose' | 'cyan' }) {
  const classes = tone === 'rose'
    ? 'border-rose-500/20 bg-rose-500/10 text-rose-100'
    : tone === 'amber'
      ? 'border-amber-500/20 bg-amber-500/10 text-amber-100'
      : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-100'

  return (
    <div className={`rounded-2xl border p-4 text-sm ${classes}`}>
      <h4 className="font-semibold">{title}</h4>
      <ul className="mt-3 space-y-2">
        {messages.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
      </ul>
    </div>
  )
}

function RestorePlanPanel({
  plan,
  result,
  acknowledged,
  confirmation,
  restoring,
  restoreReady,
  onAcknowledgedChange,
  onConfirmationChange,
  onRestore,
}: {
  plan: RestorePlan
  result: RestoreExecutionSummary | null
  acknowledged: boolean
  confirmation: string
  restoring: boolean
  restoreReady: boolean
  onAcknowledgedChange: (value: boolean) => void
  onConfirmationChange: (value: string) => void
  onRestore: () => void
}) {
  return (
    <div className="mt-5 space-y-4">
      <div className={`rounded-2xl border p-4 ${plan.restorable ? 'border-amber-500/20 bg-amber-500/10 text-amber-100' : 'border-rose-500/20 bg-rose-500/10 text-rose-100'}`}>
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle size={18} />
          {plan.restorable ? 'Plan restore gotowy do potwierdzenia' : 'Restore zablokowany'}
        </div>
        <p className="mt-2 text-sm opacity-85">
          Ta operacja zastąpi podstawowe dane obecnego portfolio. Operacji nie da się cofnąć bez kolejnego backupu.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h4 className="font-semibold text-white">Portfolio obecne</h4>
          <div className="mt-4 grid gap-3 text-sm">
            <InfoLine label="Nazwa" value={plan.currentPortfolioName ?? '—'} />
            <InfoLine label="Portfolio ID" value={plan.currentPortfolioId ?? '—'} />
            <InfoLine label="Waluta portfela" value={plan.currentBaseCurrency ?? '—'} />
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h4 className="font-semibold text-white">Backup</h4>
          <div className="mt-4 grid gap-3 text-sm">
            <InfoLine label="Nazwa" value={plan.backupPortfolioName ?? '—'} />
            <InfoLine label="Portfolio ID" value={plan.backupPortfolioId ?? '—'} />
            <InfoLine label="Waluta backupu" value={plan.backupBaseCurrency ?? '—'} />
          </div>
        </div>
      </div>

      {plan.samePortfolio === false ? <MessageList title="Uwaga" messages={['Ten backup wygląda na inny portfel. Restore nadal zapisze dane do obecnego portfolio i nie użyje backup user_id.']} tone="amber" /> : null}
      {plan.currencyMismatch ? <MessageList title="Waluta" messages={['Waluta backupu różni się od obecnej waluty portfolio. Dane zostaną przywrócone, ale portfolio zachowa obecną walutę.']} tone="amber" /> : null}
      {plan.hardErrors.length ? <MessageList title="Błędy blokujące restore" messages={plan.hardErrors.map((item) => item.message)} tone="rose" /> : null}
      {plan.warnings.length ? <MessageList title="Ostrzeżenia planu" messages={plan.warnings.map((item) => item.message)} tone="amber" /> : null}

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="p-3">Tabela core</th><th className="p-3 text-right">Usunie obecnie</th><th className="p-3 text-right">Wstawi z backupu</th></tr>
          </thead>
          <tbody>
            {plan.tablePlans.map((row) => (
              <tr key={row.table} className="border-t border-white/10">
                <td className="p-3 font-semibold text-white">{row.table}</td>
                <td className="p-3 text-right text-slate-500">{row.currentRows == null ? '—' : formatCount(row.currentRows)}</td>
                <td className="p-3 text-right text-slate-300">{formatCount(row.backupRows)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="p-3">Nieprzywracane</th><th className="p-3 text-right">W backupie</th><th className="p-3">Powód</th></tr>
          </thead>
          <tbody>
            {plan.ignoredTables.map((row) => (
              <tr key={row.table} className="border-t border-white/10">
                <td className="p-3 font-semibold text-white">{row.table}</td>
                <td className="p-3 text-right text-slate-300">{formatCount(row.backupRows)}</td>
                <td className="p-3 text-slate-500">{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
          <h4 className="font-semibold">Restore zakończony</h4>
          <p className="mt-2 opacity-85">{result.message ?? 'Podstawowe dane portfolio zostały przywrócone.'}</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <RestoreCountBox title="Usunięto" counts={result.deleted} />
            <RestoreCountBox title="Wstawiono" counts={result.inserted} />
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <label className="flex items-start gap-3 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => onAcknowledgedChange(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-white/20 bg-slate-950 text-violet-500"
          />
          <span>Rozumiem, że przed restore powinienem mieć aktualny backup obecnego stanu.</span>
        </label>
        <div className="mt-4">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Wpisz {RESTORE_CONFIRMATION_TEXT}</label>
          <input
            value={confirmation}
            onChange={(event) => onConfirmationChange(event.target.value)}
            placeholder={RESTORE_CONFIRMATION_TEXT}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-violet-300/50"
          />
        </div>
        <button
          type="button"
          disabled={!restoreReady || restoring}
          onClick={onRestore}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 px-5 py-4 text-sm font-bold text-white shadow-lg shadow-rose-950/30 transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {restoring ? <Loader2 size={18} className="animate-spin" /> : <RotateCcw size={18} />}
          Zastąp dane podstawowe z backupu
        </button>
      </div>
    </div>
  )
}

function RestoreCountBox({ title, counts }: { title: string; counts: Record<string, number> }) {
  return (
    <div className="rounded-xl bg-white/[0.06] p-3">
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{title}</p>
      <div className="mt-2 space-y-1">
        {Object.entries(counts).map(([table, count]) => (
          <div key={table} className="flex justify-between gap-3">
            <span>{table}</span>
            <span className="font-semibold">{formatCount(count)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CsvMappingPreview({ result }: { result: CsvDryRunSummary }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full min-w-[620px] text-sm">
        <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="p-3">Docelowe pole</th><th className="p-3">Kolumna CSV</th><th className="p-3">Próbka</th><th className="p-3 text-right">Status</th></tr>
        </thead>
        <tbody>
          {result.mapping.map((row) => (
            <tr key={row.targetField} className="border-t border-white/10">
              <td className="p-3 font-semibold text-white">{row.targetField}</td>
              <td className="p-3 text-slate-300">{row.sourceHeader ?? '—'}</td>
              <td className="max-w-[260px] truncate p-3 text-slate-500">{row.sampleValue || '—'}</td>
              <td className={`p-3 text-right text-xs font-semibold ${row.present ? 'text-emerald-300' : 'text-amber-200'}`}>{row.present ? 'wykryto' : 'brak'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CsvNormalizedPreview({ result }: { result: CsvDryRunSummary }) {
  const fields = result.mapping.filter((row) => row.present).map((row) => row.targetField)
  if (fields.length === 0) return null

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="p-3">#</th>
            {fields.map((field) => <th key={field} className="p-3">{field}</th>)}
          </tr>
        </thead>
        <tbody>
          {result.sampleRows.slice(0, 5).map((row) => (
            <tr key={`normalized-${row.rowNumber}`} className="border-t border-white/10">
              <td className="p-3 text-xs font-semibold text-slate-500">{row.rowNumber}</td>
              {fields.map((field) => (
                <td key={`${row.rowNumber}-${field}`} className="max-w-[220px] truncate p-3 text-slate-300">{row.normalized[field] || '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CsvRowsPreview({ result }: { result: CsvDryRunSummary }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="p-3">#</th>
            {result.headers.map((header, index) => <th key={`${header}-${index}`} className="p-3">{header || `kolumna_${index + 1}`}</th>)}
          </tr>
        </thead>
        <tbody>
          {result.sampleRows.map((row) => (
            <tr key={row.rowNumber} className="border-t border-white/10">
              <td className="p-3 text-xs font-semibold text-slate-500">{row.rowNumber}</td>
              {result.headers.map((header, index) => (
                <td key={`${row.rowNumber}-${header}-${index}`} className="max-w-[220px] truncate p-3 text-slate-300">{row.cells[index] || '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CountTile({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-white">{formatCount(value)}</p>
    </div>
  )
}

function CheckboxRow({
  checked,
  disabled,
  title,
  description,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  title: string
  description: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className={`flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-white/[0.05]'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-white/20 bg-slate-950 text-violet-500"
      />
      <span>
        <span className="block text-sm font-semibold text-white">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      </span>
    </label>
  )
}
