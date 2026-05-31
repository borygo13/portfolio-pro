'use client'

import { useEffect, useMemo, useState } from 'react'
import { Database, Download, FileDown, KeyRound, Loader2, RefreshCw, ShieldCheck, Upload } from 'lucide-react'
import { Shell, PageHeader, Card, FeatureNote, TrustBadge } from '@/components/Shell'
import {
  buildPortfolioBackupJson,
  downloadCsvTable,
  downloadJsonBackup,
  type BackupExportOptions,
  type PortfolioBackupData,
} from '@/lib/backup/export'
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

export default function SettingsPage() {
  const [context, setContext] = useState<BackupContext | null>(null)
  const [options, setOptions] = useState<BackupExportOptions>(defaultOptions)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
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

  return (
    <Shell>
      <PageHeader
        eyebrow="System · C6.0a"
        title="Backup, Supabase i ustawienia"
        description="Eksportuj czytelny backup danych przed przyszłymi importami XTB/IBKR. Ten etap nie przywraca danych i niczego nie importuje."
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
          Przywracanie backupu będzie dodane w kolejnym kroku. Na ten moment backup służy jako bezpieczna kopia danych przed importem i jako czytelny audyt tego, co jest w Supabase.
        </FeatureNote>
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
