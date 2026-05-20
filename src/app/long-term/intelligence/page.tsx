'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { Banknote, BarChart3, CheckCircle2, FileUp, History, Loader2, Percent, Plus, Save, Search, Scale, Trash2, TrendingDown, TrendingUp } from 'lucide-react'
import { BenchmarkComparisonChart, BenchmarkRelativeChart, DrawdownCurveChart, MonthlyDividendChart, RollingReturnChart } from '@/components/Charts'
import { Card, PageHeader, Shell, StatCard, TrustBadge } from '@/components/Shell'
import { projectEdoBond, summarizeEdoBonds } from '@/lib/bond-engine'
import { PLN, PCT } from '@/lib/format'
import {
  buildAllocationDrift,
  buildMonthlyDividendPoints,
  isMarketPricedAsset,
  num,
  summarizeCashLedger,
  summarizeDividends,
} from '@/lib/portfolio-intelligence'
import {
  buildBenchmarkPerformance,
  buildPortfolioPerformance,
  type BenchmarkPerformance,
  type MonthlyReturnCell,
  type PortfolioPerformance,
  type YearlyReturnPoint,
} from '@/lib/portfolio-performance'
import {
  buildTruePortfolioReturns,
  type ReturnMetric,
  type ReturnSanityDiagnostics,
} from '@/lib/portfolio-returns'
import { buildPositions, portfolioSummary } from '@/lib/position-engine'
import {
  CSV_IMPORT_SOURCE_LABELS,
  parseHistoricalPriceCsv,
  type CsvImportPreview,
  type CsvImportSourceLabel,
} from '@/lib/market/csv-import'
import { providerStatusForAsset, type ProviderStatus } from '@/lib/market/provider-diagnostics'
import { describeSymbolResolution, type SymbolResolutionDescription } from '@/lib/market/provider-symbols'
import { supabase } from '@/lib/supabase/client'
import {
  applyInstrumentPresetToAsset,
  createCashLedgerEntry,
  createDividend,
  deleteCashLedgerEntry,
  deleteDividend,
  getDefaultPortfolio,
  getMarketPriceDiagnostics,
  getPortfolioBenchmark,
  listBenchmarkCandidates,
  listInstrumentCatalog,
  listAssets,
  listAssetPrices,
  listCashLedgerEntries,
  listDividends,
  listEdoBonds,
  listMarketPriceHistory,
  listPortfolioSnapshots,
  listTransactions,
  updateAssetMarketSymbol,
  upsertPortfolioBenchmark,
  type Asset,
  type AssetPrice,
  type CashLedgerEntry,
  type CashLedgerEntryType,
  type DividendRecord,
  type EdoBond,
  type InstrumentCatalogRow,
  type MarketPriceDiagnostics,
  type MarketPriceHistoryPoint,
  type Portfolio,
  type PortfolioBenchmark,
  type PortfolioSnapshot,
  type SupportedCashCurrency,
  type Transaction,
} from '@/lib/supabase/portfolio'

type TabId = 'overview' | 'cash' | 'dividends' | 'benchmark' | 'allocation' | 'backfill'
type BackfillRange = '1Y' | '3Y' | '5Y' | 'MAX'
type BackfillScope = 'asset' | 'all_active'

type BackfillResult = {
  ok: boolean
  runId?: string
  status: string
  requestedAssets: number
  processedAssets: number
  remainingCount: number
  remainingAssets?: { id: string; symbol: string; name?: string }[]
  results?: {
    assetId: string
    symbol: string
    provider: string
    sourceSymbol: string
    status: string
    fetchedRows: number
    persistedRows: number
    remainingRows: number
    fxMissingRows: number
    latestPriceDate: string | null
    error: string | null
    providerFallbackChain?: string[]
    providerMessages?: string[]
    providerCandidateSymbols?: string[]
    adjustedPriceRows?: number
  }[]
  error?: string
}

type PortfolioHistoryBackfillResult = {
  ok: boolean
  status: string
  range: BackfillRange
  startDate: string | null
  endDate: string
  requestedDays: number
  processedDays: number
  generatedSnapshots: number
  skippedExistingDays: number
  skippedNoActivityDays: number
  skippedMissingPriceDays: number
  remainingDays: number
  skippedDays?: { date: string; reason: string }[]
  errorDays?: { date: string; error: string }[]
  error?: string
}

type CsvImportResult = {
  ok: boolean
  savedRows: number
  source: CsvImportSourceLabel
  sourceCurrency: SupportedCashCurrency
  baseCurrency: SupportedCashCurrency
  sourceSymbol: string
  preview: CsvImportPreview
  error?: string
}

const tabs: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'cash', label: 'Cash' },
  { id: 'dividends', label: 'Dividends' },
  { id: 'benchmark', label: 'Benchmark' },
  { id: 'allocation', label: 'Allocation' },
  { id: 'backfill', label: 'Backfill' },
]

const backfillRanges: BackfillRange[] = ['1Y', '3Y', '5Y', 'MAX']
const cashTypes: { value: CashLedgerEntryType; label: string }[] = [
  { value: 'deposit', label: 'Wpłata' },
  { value: 'withdrawal', label: 'Wypłata' },
  { value: 'fee', label: 'Opłata' },
  { value: 'tax', label: 'Podatek' },
  { value: 'adjustment', label: 'Korekta' },
]

const currencies: SupportedCashCurrency[] = ['PLN', 'EUR', 'USD']

function today() {
  return new Date().toISOString().slice(0, 10)
}

function asCurrency(value: string | null | undefined): SupportedCashCurrency {
  return currencies.includes(value as SupportedCashCurrency) ? value as SupportedCashCurrency : 'PLN'
}

function formatPct(value: number | null) {
  return value == null ? '—' : PCT.format(value)
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDateRange(startDate: string | null | undefined, endDate: string | null | undefined) {
  if (!startDate || !endDate) return null
  return `${formatDate(startDate)} → ${formatDate(endDate)}`
}

function diagnosticCount(count: number, startDate: string | null | undefined, endDate: string | null | undefined) {
  const range = formatDateRange(startDate, endDate)
  return range ? `${count} · ${range}` : String(count)
}

function confidenceLabel(value: 'high' | 'limited' | 'low' | undefined) {
  if (value === 'high') return 'High confidence'
  if (value === 'limited') return 'Limited'
  return 'Low confidence'
}

function confidenceTone(value: 'high' | 'limited' | 'low' | undefined) {
  if (value === 'high') return 'text-emerald-200 bg-emerald-500/10'
  if (value === 'limited') return 'text-amber-200 bg-amber-500/10'
  return 'text-rose-200 bg-rose-500/10'
}

function qualityLabel(value: MarketPriceDiagnostics['quality'] | undefined) {
  if (value === 'ready') return 'Ready'
  if (value === 'limited') return 'Limited'
  return 'Missing'
}

function qualityTone(value: MarketPriceDiagnostics['quality'] | undefined) {
  if (value === 'ready') return 'text-emerald-200 bg-emerald-500/10'
  if (value === 'limited') return 'text-amber-200 bg-amber-500/10'
  return 'text-rose-200 bg-rose-500/10'
}

function directionLabel(value: string) {
  if (value === 'buy') return 'Dokup'
  if (value === 'trim') return 'Redukuj'
  return 'Trzymaj'
}

function normalizeCatalogQuery(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function filterCatalogPresets(rows: InstrumentCatalogRow[], query: string) {
  const terms = normalizeCatalogQuery(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return rows.slice(0, 8)

  return rows.filter((row) => {
    const haystack = normalizeCatalogQuery([
      row.name,
      row.symbol,
      row.market_symbol,
      row.provider,
      row.category,
      row.currency,
      row.exchange ?? '',
      row.country ?? '',
      ...(row.aliases ?? []),
    ].join(' '))
    return terms.every((term) => haystack.includes(term))
  }).slice(0, 8)
}

function catalogMeta(row: InstrumentCatalogRow) {
  return `${row.provider} · ${row.category.replaceAll('_', ' ')} · ${row.currency}${row.exchange ? ` · ${row.exchange}` : ''}`
}

function metricOrReason(value: number | null, reason: string | null | undefined) {
  return value == null ? reason ?? 'Limited data' : formatPct(value)
}

function returnMetricValue(metric: ReturnMetric) {
  return metric.available ? formatPct(metric.value) : '—'
}

function returnMetricSub(metric: ReturnMetric, fallback = 'true return engine') {
  if (!metric.available) return metric.reason ?? 'Limited data'
  const suffix = metric.confidence && metric.confidence !== 'high' ? ` · ${confidenceLabel(metric.confidence)}` : ''
  if (metric.startDate && metric.endDate) return `${formatDate(metric.startDate)} → ${formatDate(metric.endDate)}${suffix}`
  return `${fallback}${suffix}`
}

function returnMetricTone(metric: ReturnMetric, positiveIsGood = true) {
  if (!metric.available || metric.value == null) return 'cyan'
  const positive = metric.value >= 0
  return positive === positiveIsGood ? 'emerald' : 'red'
}

function recoveryMetricValue(metric: ReturnMetric) {
  if (!metric.available || metric.value == null) return '—'
  if (metric.value === 0) return 'Recovered'
  return `${metric.value.toFixed(1)} mo`
}

export default function PortfolioIntelligencePage() {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [prices, setPrices] = useState<AssetPrice[]>([])
  const [edoBonds, setEdoBonds] = useState<EdoBond[]>([])
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([])
  const [cashEntries, setCashEntries] = useState<CashLedgerEntry[]>([])
  const [dividendRecords, setDividendRecords] = useState<DividendRecord[]>([])
  const [instrumentCatalog, setInstrumentCatalog] = useState<InstrumentCatalogRow[]>([])
  const [benchmarkCatalog, setBenchmarkCatalog] = useState<InstrumentCatalogRow[]>([])
  const [benchmark, setBenchmark] = useState<PortfolioBenchmark | null>(null)
  const [benchmarkAssetId, setBenchmarkAssetId] = useState('')
  const [benchmarkHistory, setBenchmarkHistory] = useState<MarketPriceHistoryPoint[]>([])
  const [backfillScope, setBackfillScope] = useState<BackfillScope>('asset')
  const [backfillRange, setBackfillRange] = useState<BackfillRange>('1Y')
  const [backfillAssetId, setBackfillAssetId] = useState('')
  const [backfillLoading, setBackfillLoading] = useState(false)
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null)
  const [marketDiagnostics, setMarketDiagnostics] = useState<MarketPriceDiagnostics | null>(null)
  const [marketDiagnosticsLoading, setMarketDiagnosticsLoading] = useState(false)
  const [marketDiagnosticsError, setMarketDiagnosticsError] = useState<string | null>(null)
  const [portfolioHistoryRange, setPortfolioHistoryRange] = useState<BackfillRange>('1Y')
  const [portfolioHistoryLoading, setPortfolioHistoryLoading] = useState(false)
  const [portfolioHistoryResult, setPortfolioHistoryResult] = useState<PortfolioHistoryBackfillResult | null>(null)
  const [marketSymbolDrafts, setMarketSymbolDrafts] = useState<Record<string, string>>({})
  const [catalogQuery, setCatalogQuery] = useState('')
  const [benchmarkCatalogQuery, setBenchmarkCatalogQuery] = useState('')
  const [applyingPresetId, setApplyingPresetId] = useState<string | null>(null)
  const [presetMessage, setPresetMessage] = useState<string | null>(null)
  const [csvImportAssetId, setCsvImportAssetId] = useState('')
  const [csvImportSource, setCsvImportSource] = useState<CsvImportSourceLabel>('manual_csv')
  const [csvImportCurrency, setCsvImportCurrency] = useState<SupportedCashCurrency>('PLN')
  const [csvText, setCsvText] = useState('')
  const [csvFileName, setCsvFileName] = useState('')
  const [csvImportLoading, setCsvImportLoading] = useState(false)
  const [csvImportResult, setCsvImportResult] = useState<CsvImportResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cashForm, setCashForm] = useState({
    entry_type: 'deposit' as CashLedgerEntryType,
    amount: '',
    currency: 'PLN' as SupportedCashCurrency,
    entry_date: today(),
    note: '',
  })
  const [dividendForm, setDividendForm] = useState({
    asset_id: '',
    payment_date: today(),
    gross_amount: '',
    tax_amount: '',
    currency: 'PLN' as SupportedCashCurrency,
    note: '',
  })

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getUser()
      if (!data.user) throw new Error('Brak aktywnej sesji użytkownika.')
      const defaultPortfolio = await getDefaultPortfolio(data.user)
      const [
        assetList,
        transactionList,
        priceList,
        bondList,
        snapshotList,
        cashList,
        dividendList,
        benchmarkRow,
        catalogRows,
        benchmarkCatalogRows,
      ] = await Promise.all([
        listAssets(defaultPortfolio.id),
        listTransactions(defaultPortfolio.id),
        listAssetPrices(defaultPortfolio.id),
        listEdoBonds(defaultPortfolio.id),
        listPortfolioSnapshots(defaultPortfolio.id),
        listCashLedgerEntries(defaultPortfolio.id),
        listDividends(defaultPortfolio.id),
        getPortfolioBenchmark(defaultPortfolio.id),
        listInstrumentCatalog(),
        listBenchmarkCandidates(),
      ])

      const baseCurrency = asCurrency(defaultPortfolio.currency)
      setPortfolio(defaultPortfolio)
      setAssets(assetList)
      setTransactions(transactionList)
      setPrices(priceList)
      setEdoBonds(bondList)
      setSnapshots(snapshotList)
      setCashEntries(cashList)
      setDividendRecords(dividendList)
      setInstrumentCatalog(catalogRows)
      setBenchmarkCatalog(benchmarkCatalogRows)
      setBenchmark(benchmarkRow)
      setBenchmarkAssetId(benchmarkRow?.benchmark_asset_id ?? '')
      setBackfillAssetId((current) => current && assetList.some((asset) => asset.id === current)
        ? current
        : assetList.find(isMarketPricedAsset)?.id ?? '')
      setCsvImportAssetId((current) => current && assetList.some((asset) => asset.id === current)
        ? current
        : assetList.find(isMarketPricedAsset)?.id ?? '')
      setMarketSymbolDrafts(Object.fromEntries(assetList.map((asset) => [asset.id, asset.market_symbol ?? ''])))
      setCashForm((current) => ({ ...current, currency: baseCurrency }))
      setCsvImportCurrency(baseCurrency)
      setDividendForm((current) => ({
        ...current,
        currency: baseCurrency,
        asset_id: current.asset_id && assetList.some((asset) => asset.id === current.asset_id)
          ? current.asset_id
          : assetList.find(isMarketPricedAsset)?.id ?? assetList[0]?.id ?? '',
      }))
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się pobrać danych C5.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    if (!portfolio?.id || !benchmarkAssetId) {
      setBenchmarkHistory([])
      return
    }

    let cancelled = false
    listMarketPriceHistory(portfolio.id, benchmarkAssetId, 'MAX')
      .then((history) => {
        if (!cancelled) setBenchmarkHistory(history)
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? 'Nie udało się pobrać historii benchmarku.')
      })

    return () => { cancelled = true }
  }, [portfolio?.id, benchmarkAssetId])

  useEffect(() => {
    if (!portfolio?.id || !backfillAssetId) {
      setMarketDiagnostics(null)
      setMarketDiagnosticsError(null)
      return
    }

    let cancelled = false
    setMarketDiagnosticsLoading(true)
    setMarketDiagnosticsError(null)
    getMarketPriceDiagnostics(portfolio.id, backfillAssetId)
      .then((diagnostics) => {
        if (!cancelled) setMarketDiagnostics(diagnostics)
      })
      .catch((err: any) => {
        if (!cancelled) {
          setMarketDiagnostics(null)
          setMarketDiagnosticsError(err?.message ?? 'Nie udało się pobrać diagnostyki market_prices.')
        }
      })
      .finally(() => {
        if (!cancelled) setMarketDiagnosticsLoading(false)
      })

    return () => { cancelled = true }
  }, [portfolio?.id, backfillAssetId])

  const baseCurrency = asCurrency(portfolio?.currency)
  const positions = useMemo(() => buildPositions(assets, transactions, prices), [assets, transactions, prices])
  const activePositions = useMemo(() => positions.filter((position) => position.quantity > 0.00000001), [positions])
  const marketAssets = useMemo(() => assets.filter(isMarketPricedAsset), [assets])
  const summary = useMemo(() => portfolioSummary(positions), [positions])
  const edoSummary = useMemo(() => summarizeEdoBonds(edoBonds.map((bond) => projectEdoBond(bond))), [edoBonds])
  const cashSummary = useMemo(() => summarizeCashLedger(cashEntries, baseCurrency), [cashEntries, baseCurrency])
  const dividendSummary = useMemo(() => summarizeDividends(dividendRecords, baseCurrency), [dividendRecords, baseCurrency])
  const monthlyDividends = useMemo(() => buildMonthlyDividendPoints(dividendRecords, baseCurrency), [dividendRecords, baseCurrency])
  const performance = useMemo(() => buildPortfolioPerformance(snapshots), [snapshots])
  const benchmarkPerformance = useMemo(() => buildBenchmarkPerformance(snapshots, benchmarkHistory), [snapshots, benchmarkHistory])
  const trueReturns = useMemo(() => buildTruePortfolioReturns({
    snapshots,
    cashEntries,
    dividends: dividendRecords,
    transactions,
    benchmarkHistory,
    baseCurrency,
  }), [snapshots, cashEntries, dividendRecords, transactions, benchmarkHistory, baseCurrency])
  const bondsTarget = useMemo(() => {
    const explicitTarget = assets
      .filter((asset) => asset.asset_type === 'Obligacje' || asset.symbol.toUpperCase().includes('EDO'))
      .reduce((sum, asset) => sum + num(asset.target_allocation), 0)
    return explicitTarget > 0 ? explicitTarget : edoBonds.length > 0 ? 25 : 0
  }, [assets, edoBonds.length])

  const transactionFees = transactions.reduce((sum, transaction) => sum + num(transaction.fees), 0)
  const bondPnl = edoSummary.currentValueAfterTax - edoSummary.principal
  const totalValue = summary.totalValue + edoSummary.currentValueAfterTax + cashSummary.cashBalanceBase
  const realizedPnl = summary.realizedPnl + dividendSummary.netBase - transactionFees - cashSummary.feesBase - cashSummary.taxesBase
  const unrealizedPnl = summary.unrealizedPnl + bondPnl
  const feesAndTaxes = transactionFees + cashSummary.feesBase + cashSummary.taxesBase + dividendSummary.taxBase
  const allocationDrift = useMemo(() => buildAllocationDrift(positions, edoSummary.currentValueAfterTax, bondsTarget, cashSummary.cashBalanceBase, totalValue), [positions, edoSummary.currentValueAfterTax, bondsTarget, cashSummary.cashBalanceBase, totalValue])
  const selectedBenchmark = assets.find((asset) => asset.id === benchmarkAssetId) ?? null
  const selectedBackfillAsset = marketAssets.find((asset) => asset.id === backfillAssetId) ?? null
  const selectedProviderStatus = useMemo(() => providerStatusForAsset(selectedBackfillAsset), [selectedBackfillAsset])
  const selectedSymbolResolution = useMemo(() => describeSymbolResolution(selectedBackfillAsset
    ? { ...selectedBackfillAsset, market_symbol: marketSymbolDrafts[selectedBackfillAsset.id] || selectedBackfillAsset.market_symbol }
    : null, selectedProviderStatus.fallbackOrder), [selectedBackfillAsset, selectedProviderStatus, marketSymbolDrafts])
  const selectedBackfillSymbol = selectedSymbolResolution?.primarySymbol ?? '—'
  const backfillCatalogResults = useMemo(() => filterCatalogPresets(instrumentCatalog, catalogQuery), [instrumentCatalog, catalogQuery])
  const benchmarkCatalogResults = useMemo(() => filterCatalogPresets(benchmarkCatalog, benchmarkCatalogQuery), [benchmarkCatalog, benchmarkCatalogQuery])
  const selectedCsvImportAsset = marketAssets.find((asset) => asset.id === csvImportAssetId) ?? null
  const csvPreview = useMemo(() => parseHistoricalPriceCsv(csvText), [csvText])
  const latestSnapshotAllocation = snapshots[snapshots.length - 1]?.allocation_breakdown ?? []
  const portfolioHistoryPoints = snapshots.filter((snapshot) => num(snapshot.total_value) > 0).length
  const singleMonthlyReturn = performance.monthlyReturns.length === 1 ? performance.monthlyReturns[0] : null

  async function handleCashSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!portfolio) return
    const amount = Number(cashForm.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Kwota cash ledger musi być większa od zera.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const created = await createCashLedgerEntry(portfolio.id, {
        ...cashForm,
        amount,
      })
      setCashEntries((current) => [created, ...current])
      setCashForm((current) => ({ ...current, amount: '', note: '' }))
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się dodać wpisu cash ledger.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDividendSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!portfolio) return
    const gross = Number(dividendForm.gross_amount)
    const tax = Number(dividendForm.tax_amount || 0)
    const net = gross - tax
    if (!dividendForm.asset_id || !dividendForm.payment_date || !Number.isFinite(gross) || gross < 0 || !Number.isFinite(tax) || tax < 0 || !Number.isFinite(net) || net < 0) {
      setError('Uzupełnij aktywo, datę płatności oraz poprawne kwoty dywidendy: brutto, podatek i netto nie mogą być ujemne.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const created = await createDividend(portfolio.id, {
        ...dividendForm,
        gross_amount: gross,
        tax_amount: tax,
      })
      setDividendRecords((current) => [created, ...current])
      setDividendForm((current) => ({ ...current, gross_amount: '', tax_amount: '', note: '' }))
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się dodać dywidendy.')
    } finally {
      setSaving(false)
    }
  }

  async function handleBenchmarkChange(value: string) {
    if (!portfolio) return
    setSaving(true)
    setError(null)
    try {
      const updated = await upsertPortfolioBenchmark(portfolio.id, value || null)
      setBenchmark(updated)
      setBenchmarkAssetId(updated.benchmark_asset_id ?? '')
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się zapisać benchmarku.')
    } finally {
      setSaving(false)
    }
  }

  async function handleMarketSymbolSave(asset: Asset) {
    setSaving(true)
    setError(null)
    try {
      const updated = await updateAssetMarketSymbol(asset.id, marketSymbolDrafts[asset.id] ?? '')
      setAssets((current) => current.map((item) => item.id === updated.id ? updated : item))
      setMarketSymbolDrafts((current) => ({ ...current, [asset.id]: updated.market_symbol ?? '' }))
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się zapisać symbolu provider.')
    } finally {
      setSaving(false)
    }
  }

  async function handleApplyPreset(asset: Asset | null, preset: InstrumentCatalogRow) {
    if (!asset) return

    setApplyingPresetId(preset.id)
    setPresetMessage(null)
    setError(null)
    try {
      const updated = await applyInstrumentPresetToAsset(asset.id, preset.id)
      setAssets((current) => current.map((item) => item.id === updated.id ? updated : item))
      setMarketSymbolDrafts((current) => ({ ...current, [updated.id]: updated.market_symbol ?? '' }))
      setPresetMessage(`Zastosowano preset ${preset.symbol} -> ${preset.market_symbol}.`)
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się zastosować presetu instrumentu.')
    } finally {
      setApplyingPresetId(null)
    }
  }

  async function handleBackfillSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!portfolio) return
    if (backfillScope === 'asset' && !backfillAssetId) {
      setError('Wybierz aktywo do backfillu.')
      return
    }

    setBackfillLoading(true)
    setBackfillResult(null)
    setError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Brak aktywnej sesji użytkownika.')

      const response = await fetch('/api/prices/backfill', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scope: backfillScope,
          range: backfillRange,
          portfolio_id: portfolio.id,
          asset_id: backfillScope === 'asset' ? backfillAssetId : undefined,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error ?? 'Nie udało się wykonać backfillu.')

      setBackfillResult(result as BackfillResult)
      setPrices(await listAssetPrices(portfolio.id))
      if (backfillAssetId) setMarketDiagnostics(await getMarketPriceDiagnostics(portfolio.id, backfillAssetId))
      if (benchmarkAssetId) setBenchmarkHistory(await listMarketPriceHistory(portfolio.id, benchmarkAssetId, 'MAX'))
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się wykonać historical backfill.')
    } finally {
      setBackfillLoading(false)
    }
  }

  async function handlePortfolioHistoryBackfillSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!portfolio) return

    setPortfolioHistoryLoading(true)
    setPortfolioHistoryResult(null)
    setError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Brak aktywnej sesji użytkownika.')

      const response = await fetch('/api/portfolio/snapshots/backfill', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          range: portfolioHistoryRange,
          portfolio_id: portfolio.id,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error ?? 'Nie udało się wygenerować historii portfolio.')

      setPortfolioHistoryResult(result as PortfolioHistoryBackfillResult)
      setSnapshots(await listPortfolioSnapshots(portfolio.id))
      if (benchmarkAssetId) setBenchmarkHistory(await listMarketPriceHistory(portfolio.id, benchmarkAssetId, 'MAX'))
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się wygenerować historii portfolio.')
    } finally {
      setPortfolioHistoryLoading(false)
    }
  }

  async function handleCsvFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setCsvFileName(file.name)
    setCsvImportResult(null)
    try {
      setCsvText(await file.text())
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się odczytać pliku CSV.')
    }
  }

  async function handleCsvImportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!portfolio) return
    if (!csvImportAssetId) {
      setError('Wybierz aktywo do importu CSV.')
      return
    }
    if (csvPreview.validRows === 0) {
      setError('CSV nie ma poprawnych wierszy do zapisania.')
      return
    }

    setCsvImportLoading(true)
    setCsvImportResult(null)
    setError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Brak aktywnej sesji użytkownika.')

      const response = await fetch('/api/prices/import-csv', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          portfolio_id: portfolio.id,
          asset_id: csvImportAssetId,
          source: csvImportSource,
          source_currency: csvImportCurrency,
          csv: csvText,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error ?? 'Nie udało się zaimportować CSV.')

      setCsvImportResult(result as CsvImportResult)
      if (backfillAssetId === csvImportAssetId) setMarketDiagnostics(await getMarketPriceDiagnostics(portfolio.id, csvImportAssetId))
      if (benchmarkAssetId === csvImportAssetId) setBenchmarkHistory(await listMarketPriceHistory(portfolio.id, benchmarkAssetId, 'MAX'))
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się zaimportować historii cen z CSV.')
    } finally {
      setCsvImportLoading(false)
    }
  }

  async function removeCashEntry(id: string) {
    setSaving(true)
    setError(null)
    try {
      await deleteCashLedgerEntry(id)
      setCashEntries((current) => current.filter((entry) => entry.id !== id))
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się usunąć wpisu cash ledger.')
    } finally {
      setSaving(false)
    }
  }

  async function removeDividend(id: string) {
    setSaving(true)
    setError(null)
    try {
      await deleteDividend(id)
      setDividendRecords((current) => current.filter((entry) => entry.id !== id))
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się usunąć dywidendy.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Shell>
      <PageHeader
        eyebrow="Stage C5 · Portfolio Intelligence"
        title="Intelligence"
        description="Cash ledger, dywidendy, TWR/MWR-style performance analytics, benchmark i drift alokacji. Metryki nadal oznaczają ograniczenia danych, gdy historia jest zbyt rzadka."
      />

      {error ? <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
      {presetMessage ? <div className="mb-6 flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100"><CheckCircle2 size={16} /> {presetMessage}</div> : null}
      {loading ? <div className="mb-6 flex items-center gap-2 text-sm text-slate-400"><Loader2 className="animate-spin" size={16} /> Ładowanie Portfolio Intelligence...</div> : null}

      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${activeTab === tab.id ? 'bg-violet-500 text-white shadow-lg shadow-violet-950/40' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
            <StatCard icon={Percent} label="TWR estimate" value={returnMetricValue(trueReturns.twrReturn)} sub={returnMetricSub(trueReturns.twrReturn, 'cash-flow neutral')} tone={returnMetricTone(trueReturns.twrReturn)} />
            <StatCard icon={TrendingUp} label="CAGR" value={returnMetricValue(trueReturns.cagr)} sub={returnMetricSub(trueReturns.cagr, 'annualized TWR')} tone={returnMetricTone(trueReturns.cagr)} />
            <StatCard icon={Scale} label="MWR approx." value={returnMetricValue(trueReturns.mwrApprox)} sub={returnMetricSub(trueReturns.mwrApprox, 'Modified Dietz estimate')} tone={returnMetricTone(trueReturns.mwrApprox)} />
            <StatCard icon={BarChart3} label="Benchmark relative" value={returnMetricValue(trueReturns.benchmarkRelativeReturn)} sub={returnMetricSub(trueReturns.benchmarkRelativeReturn, 'common overlap')} tone={returnMetricTone(trueReturns.benchmarkRelativeReturn)} />
          </div>

          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
            <StatCard icon={TrendingUp} label="Rolling 30D vol." value={returnMetricValue(trueReturns.rolling30dVolatility)} sub={returnMetricSub(trueReturns.rolling30dVolatility, 'annualized')} tone={trueReturns.rolling30dVolatility.available ? 'violet' : 'cyan'} />
            <StatCard icon={TrendingUp} label="Best rolling 12M" value={returnMetricValue(trueReturns.bestRolling12m)} sub={returnMetricSub(trueReturns.bestRolling12m)} tone={returnMetricTone(trueReturns.bestRolling12m)} />
            <StatCard icon={TrendingDown} label="Worst rolling 12M" value={returnMetricValue(trueReturns.worstRolling12m)} sub={returnMetricSub(trueReturns.worstRolling12m)} tone={returnMetricTone(trueReturns.worstRolling12m)} />
            <StatCard icon={TrendingDown} label="Drawdown recovery" value={recoveryMetricValue(trueReturns.recoveryFromDrawdownMonths)} sub={returnMetricSub(trueReturns.recoveryFromDrawdownMonths, 'estimated months')} tone={trueReturns.recoveryFromDrawdownMonths.available ? 'cyan' : 'red'} />
          </div>

          {trueReturns.summaryReason ? (
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-100">
              True return engine limited data: {trueReturns.summaryReason}
            </div>
          ) : null}

          <ReturnDiagnosticsPanel diagnostics={trueReturns.sanityDiagnostics} />

          <div className="grid gap-3 md:grid-cols-5">
            <InfoLine label="Valid TWR intervals" value={diagnosticCount(trueReturns.validIntervals.length, trueReturns.validIntervalStartDate, trueReturns.validIntervalEndDate)} />
            <InfoLine label="Excluded intervals" value={String(trueReturns.excludedIntervals.length)} />
            <InfoLine label="Excluded reasons" value={trueReturns.exclusionReasonSummary} />
            <InfoLine label="Return curve" value={String(trueReturns.cumulativeReturnCurve.length)} />
            <InfoLine label="Benchmark overlap" value={diagnosticCount(trueReturns.benchmarkOverlapPoints, trueReturns.benchmarkOverlapStartDate, trueReturns.benchmarkOverlapEndDate)} />
          </div>

          <div className="grid gap-6 2xl:grid-cols-3">
            <Card>
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-white">Rolling 12M return</h3>
                  <p className="mt-1 text-sm text-slate-500">TWR-based rolling return, excluding invalid cash-flow dominated intervals.</p>
                </div>
                <TrustBadge>TWR</TrustBadge>
              </div>
              {trueReturns.rollingReturnCurve.length > 0 ? <RollingReturnChart data={trueReturns.rollingReturnCurve} range="MAX" /> : <EmptyState text="Need at least 12 months of valid TWR history." />}
            </Card>

            <Card>
              <div className="mb-5">
                <h3 className="text-lg font-bold text-white">Rolling drawdown</h3>
                <p className="mt-1 text-sm text-slate-500">Drawdown from the true-return cumulative curve, not raw deposits.</p>
              </div>
              {trueReturns.drawdownCurve.length > 0 ? <DrawdownCurveChart data={trueReturns.drawdownCurve} range="MAX" /> : <EmptyState text={trueReturns.drawdownReason ?? 'Need more valid contribution-adjusted intervals for drawdown.'} />}
            </Card>

            <Card>
              <div className="mb-5">
                <h3 className="text-lg font-bold text-white">Benchmark relative</h3>
                <p className="mt-1 text-sm text-slate-500">Portfolio TWR curve versus benchmark on shared valid dates.</p>
              </div>
              {trueReturns.benchmarkRelativeCurve.length > 0 ? <BenchmarkRelativeChart data={trueReturns.benchmarkRelativeCurve} range="MAX" /> : <EmptyState text={trueReturns.benchmarkRelativeReturn.reason ?? 'Need overlapping benchmark history.'} />}
            </Card>
          </div>

          <div className="grid gap-6 2xl:grid-cols-[1fr_1fr]">
            <Card>
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-white">Monthly returns</h3>
                  <p className="mt-1 text-sm text-slate-500">Snapshot-based estimated monthly returns. Months that fail sparse-history or cash-flow guards stay unavailable.</p>
                </div>
                <TrustBadge>Estimated</TrustBadge>
              </div>
              {performance.monthlyReturns.length >= 2 ? (
                <MonthlyReturnsGrid rows={performance.monthlyReturns} />
              ) : singleMonthlyReturn ? (
                <SingleMonthlyReturnSummary row={singleMonthlyReturn} />
              ) : (
                <EmptyState text={portfolioHistoryPoints < 2 ? 'Not enough portfolio history yet. Run portfolio historical valuation backfill.' : 'Need more monthly snapshots before monthly returns are meaningful.'} />
              )}
              <PerformanceEngineSummary performance={performance} realizedPnl={realizedPnl} unrealizedPnl={unrealizedPnl} feesAndTaxes={feesAndTaxes} baseCurrency={baseCurrency} />
            </Card>

            <Card>
              <div className="mb-5">
                <h3 className="text-lg font-bold text-white">Portfolio vs benchmark</h3>
                <p className="mt-1 text-sm text-slate-500">Common-overlap indexed comparison. Index 100 = first shared snapshot/benchmark point.</p>
              </div>
              {benchmarkPerformance.available ? (
                <>
                  <BenchmarkSummary result={benchmarkPerformance} />
                  <BenchmarkComparisonChart data={benchmarkPerformance.points} range="MAX" />
                </>
              ) : (
                <EmptyState text={benchmarkPerformance.message ?? 'Not enough overlapping portfolio and benchmark history yet. Run portfolio historical valuation backfill and make sure the benchmark has market_prices.'} />
              )}
            </Card>
          </div>
        </div>
      ) : null}

      {activeTab === 'cash' ? (
        <div className="grid gap-6 2xl:grid-cols-[.8fr_1.2fr]">
          <Card>
            <h3 className="text-lg font-bold text-white">Cash ledger</h3>
            <p className="mt-1 text-sm text-slate-500">Wpłaty i wypłaty są liczone jako contribution. Opłaty i podatki obniżają cash balance.</p>
            <form onSubmit={handleCashSubmit} className="mt-5 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Select value={cashForm.entry_type} onChange={(value) => setCashForm((current) => ({ ...current, entry_type: value as CashLedgerEntryType }))}>
                  {cashTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </Select>
                <Select value={cashForm.currency} onChange={(value) => setCashForm((current) => ({ ...current, currency: value as SupportedCashCurrency }))}>
                  {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                </Select>
              </div>
              <Input type="number" step="0.01" min="0" placeholder="Kwota" value={cashForm.amount} onChange={(value) => setCashForm((current) => ({ ...current, amount: value }))} />
              <Input type="date" value={cashForm.entry_date} onChange={(value) => setCashForm((current) => ({ ...current, entry_date: value }))} />
              <Input placeholder="Notatka" value={cashForm.note} onChange={(value) => setCashForm((current) => ({ ...current, note: value }))} />
              <SubmitButton disabled={saving}><Plus size={16} /> Dodaj wpis</SubmitButton>
            </form>
          </Card>

          <Card>
            <div className="mb-5 grid gap-3 md:grid-cols-3">
              {currencies.map((currency) => (
                <div key={currency} className="rounded-2xl bg-white/[0.04] p-4">
                  <p className="text-xs text-slate-500">{currency} balance</p>
                  <p className="mt-2 text-xl font-bold text-white">{PLN.format(cashSummary.balanceByCurrency[currency])}</p>
                  <p className="mt-1 text-xs text-slate-500">Contribution: {PLN.format(cashSummary.contributionByCurrency[currency])}</p>
                </div>
              ))}
            </div>
            <LedgerTable entries={cashEntries} onDelete={removeCashEntry} saving={saving} />
          </Card>
        </div>
      ) : null}

      {activeTab === 'dividends' ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard icon={Banknote} label="Dividend net" value={PLN.format(dividendSummary.netBase)} sub={baseCurrency} tone="emerald" />
            <StatCard icon={Percent} label="Dividend tax" value={PLN.format(dividendSummary.taxBase)} sub="withholding / PIT" tone="cyan" />
            <StatCard icon={TrendingUp} label="Dividend gross" value={PLN.format(dividendSummary.grossBase)} sub={`${dividendRecords.length} rekordów`} tone="violet" />
          </div>
          <div className="grid gap-6 2xl:grid-cols-[.8fr_1.2fr]">
            <Card>
              <h3 className="text-lg font-bold text-white">Dodaj dywidendę</h3>
              <form onSubmit={handleDividendSubmit} className="mt-5 space-y-3">
                <Select value={dividendForm.asset_id} onChange={(value) => setDividendForm((current) => ({ ...current, asset_id: value }))}>
                  {assets.length === 0 ? <option value="">Brak aktywów</option> : assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>)}
                </Select>
                <div className="grid gap-3 md:grid-cols-2">
                  <Input type="number" step="0.01" min="0" placeholder="Brutto" value={dividendForm.gross_amount} onChange={(value) => setDividendForm((current) => ({ ...current, gross_amount: value }))} />
                  <Input type="number" step="0.01" min="0" placeholder="Podatek" value={dividendForm.tax_amount} onChange={(value) => setDividendForm((current) => ({ ...current, tax_amount: value }))} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Input type="date" value={dividendForm.payment_date} onChange={(value) => setDividendForm((current) => ({ ...current, payment_date: value }))} />
                  <Select value={dividendForm.currency} onChange={(value) => setDividendForm((current) => ({ ...current, currency: value as SupportedCashCurrency }))}>
                    {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                  </Select>
                </div>
                <Input placeholder="Notatka" value={dividendForm.note} onChange={(value) => setDividendForm((current) => ({ ...current, note: value }))} />
                <SubmitButton disabled={saving || assets.length === 0}><Plus size={16} /> Dodaj dywidendę</SubmitButton>
              </form>
            </Card>
            <Card>
              <h3 className="text-lg font-bold text-white">Dywidendy miesięczne</h3>
              <p className="mt-1 text-sm text-slate-500">Netto i podatek w walucie bazowej portfolio.</p>
              {monthlyDividends.length > 0 ? <MonthlyDividendChart data={monthlyDividends} /> : <EmptyState text="Brak dywidend w walucie bazowej." />}
            </Card>
          </div>
          <Card><DividendTable rows={dividendRecords} onDelete={removeDividend} saving={saving} /></Card>
        </div>
      ) : null}

      {activeTab === 'benchmark' ? (
        <div className="grid gap-6 2xl:grid-cols-[.7fr_1.3fr]">
          <Card>
            <h3 className="text-lg font-bold text-white">Benchmark</h3>
            <p className="mt-1 text-sm text-slate-500">Benchmark jest aktywem z tej samej listy instrumentów. Historia pochodzi z `market_prices`.</p>
            <div className="mt-5">
              <Select value={benchmarkAssetId} onChange={handleBenchmarkChange}>
                <option value="">Brak benchmarku</option>
                {marketAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>)}
              </Select>
            </div>
            <p className="mt-4 text-xs text-slate-500">Zapisano: {benchmark?.benchmark_asset_id ? selectedBenchmark?.symbol ?? 'benchmark' : 'brak'}</p>
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 flex items-center gap-2">
                <Search size={16} className="text-cyan-200" />
                <p className="text-sm font-semibold text-white">Katalog benchmarków</p>
              </div>
              <Input
                placeholder="Szukaj: Nasdaq, S&P 500, ACWI, MSCI World"
                value={benchmarkCatalogQuery}
                onChange={setBenchmarkCatalogQuery}
              />
              <CatalogPresetList
                rows={benchmarkCatalogResults}
                targetAsset={selectedBenchmark}
                applyingPresetId={applyingPresetId}
                emptyText="Brak kandydatów benchmarku dla tej frazy."
                onApply={handleApplyPreset}
              />
              {!selectedBenchmark ? <p className="mt-3 text-xs text-slate-500">Wybierz aktywo benchmarku, żeby zastosować preset do istniejącej pozycji.</p> : null}
            </div>
          </Card>
          <Card>
            <h3 className="text-lg font-bold text-white">Portfolio vs benchmark</h3>
            <p className="mt-1 text-sm text-slate-500">Porównanie bazowane do 100 na pierwszym wspólnym punkcie.</p>
            {benchmarkPerformance.available ? (
              <>
                <BenchmarkSummary result={benchmarkPerformance} />
                <BenchmarkComparisonChart data={benchmarkPerformance.points} range="MAX" />
              </>
            ) : <EmptyState text={benchmarkPerformance.message ?? 'Potrzeba co najmniej dwóch wspólnych punktów historii portfolio_snapshots oraz market_prices dla benchmarku.'} />}
          </Card>
        </div>
      ) : null}

      {activeTab === 'backfill' ? (
        <div className="space-y-6">
          <div className="grid gap-6 2xl:grid-cols-[.8fr_1.2fr]">
            <Card>
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cyan-500/10 text-cyan-200"><History size={20} /></div>
              <div>
                <h3 className="text-lg font-bold text-white">Historical backfill</h3>
                <p className="mt-1 text-sm text-slate-500">Wybrane aktywo jest głównym trybem. Backfill wszystkich aktywnych instrumentów przetwarza maksymalnie 5 aktywów na request.</p>
              </div>
            </div>

            <form onSubmit={handleBackfillSubmit} className="mt-5 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Select value={backfillScope} onChange={(value) => setBackfillScope(value as BackfillScope)}>
                  <option value="asset">Wybrane aktywo</option>
                  <option value="all_active">Wszystkie aktywne · max 5</option>
                </Select>
                <Select value={backfillRange} onChange={(value) => setBackfillRange(value as BackfillRange)}>
                  {backfillRanges.map((range) => <option key={range} value={range}>{range}</option>)}
                </Select>
              </div>

              <Select value={backfillAssetId} onChange={setBackfillAssetId}>
                {marketAssets.length === 0 ? <option value="">Brak aktywów rynkowych</option> : marketAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>)}
              </Select>

              {selectedBackfillAsset ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Provider symbol</p>
                      <p className="mt-1 text-xs text-slate-500">Używany do EODHD/Stooq/CoinGecko. Symbol użytkownika pozostaje bez zmian.</p>
                    </div>
                    <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-200">{selectedBackfillSymbol}</span>
                  </div>
                  <div className="flex flex-col gap-3 md:flex-row">
                    <Input
                      placeholder="np. IUSQ.DE, AAPL.US, bitcoin"
                      value={marketSymbolDrafts[selectedBackfillAsset.id] ?? ''}
                      onChange={(value) => setMarketSymbolDrafts((current) => ({ ...current, [selectedBackfillAsset.id]: value }))}
                    />
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleMarketSymbolSave(selectedBackfillAsset)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Save size={16} /> Zapisz
                    </button>
                  </div>
                  <div className="mt-4 border-t border-white/10 pt-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Search size={16} className="text-cyan-200" />
                      <p className="text-sm font-semibold text-white">Preset z katalogu</p>
                    </div>
                    <Input
                      placeholder="Szukaj: BTC, IUSQ, Nasdaq, Apple"
                      value={catalogQuery}
                      onChange={setCatalogQuery}
                    />
                    <CatalogPresetList
                      rows={backfillCatalogResults}
                      targetAsset={selectedBackfillAsset}
                      applyingPresetId={applyingPresetId}
                      emptyText="Brak presetów dla tej frazy."
                      onApply={handleApplyPreset}
                    />
                  </div>
                  <MarketDataQualityPanel
                    asset={selectedBackfillAsset}
                    provider={selectedProviderStatus}
                    resolution={selectedSymbolResolution}
                    diagnostics={marketDiagnostics}
                    loading={marketDiagnosticsLoading}
                    error={marketDiagnosticsError}
                  />
                </div>
              ) : null}

              <SubmitButton disabled={backfillLoading || marketAssets.length === 0}>
                {backfillLoading ? <Loader2 className="animate-spin" size={16} /> : <History size={16} />}
                Uruchom backfill
              </SubmitButton>
            </form>

            <p className="mt-4 text-xs leading-5 text-slate-500">Przykłady: IUSQ.DE zostanie przetłumaczone na EODHD IUSQ.XETRA i Stooq iusq.de; 500.PA może próbować 500.fr w Stooq; BTC zostaje CoinGecko bitcoin.</p>
            </Card>

            <Card>
              <h3 className="text-lg font-bold text-white">Wynik backfillu</h3>
              <p className="mt-1 text-sm text-slate-500">Raport pokazuje zapisane wiersze, braki FX oraz aktywa pozostałe do kolejnego requestu.</p>
              <BackfillResultPanel result={backfillResult} loading={backfillLoading} />
            </Card>
          </div>

          <Card>
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-200"><BarChart3 size={20} /></div>
              <div>
                <h3 className="text-lg font-bold text-white">Portfolio historical valuation</h3>
                <p className="mt-1 text-sm text-slate-500">Generuje dzienne `portfolio_snapshots` z transakcji i historycznych `market_prices`. Request przetwarza maksymalnie 1200 dni, więc długie zakresy można uruchamiać ponownie.</p>
              </div>
            </div>
            <form onSubmit={handlePortfolioHistoryBackfillSubmit} className="mt-5 grid gap-3 md:grid-cols-[220px_auto] md:items-start">
              <Select value={portfolioHistoryRange} onChange={(value) => setPortfolioHistoryRange(value as BackfillRange)}>
                {backfillRanges.map((range) => <option key={range} value={range}>{range}</option>)}
              </Select>
              <SubmitButton disabled={portfolioHistoryLoading}>
                {portfolioHistoryLoading ? <Loader2 className="animate-spin" size={16} /> : <BarChart3 size={16} />}
                Generate portfolio history
              </SubmitButton>
            </form>
            <PortfolioHistoryResultPanel result={portfolioHistoryResult} loading={portfolioHistoryLoading} snapshots={snapshots.length} />
          </Card>

          <Card>
            <div className="mb-5 flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-500/10 text-violet-200"><FileUp size={20} /></div>
              <div>
                <h3 className="text-lg font-bold text-white">CSV import cen historycznych</h3>
                <p className="mt-1 text-sm text-slate-500">Ręczny import uzupełnia `market_prices`; cron dalej dopisuje przyszłe ceny.</p>
              </div>
            </div>

            <form onSubmit={handleCsvImportSubmit} className="grid gap-6 2xl:grid-cols-[.8fr_1.2fr]">
              <div className="space-y-3">
                <Select value={csvImportAssetId} onChange={setCsvImportAssetId}>
                  {marketAssets.length === 0 ? <option value="">Brak aktywów rynkowych</option> : marketAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>)}
                </Select>
                <div className="grid gap-3 md:grid-cols-2">
                  <Select value={csvImportCurrency} onChange={(value) => setCsvImportCurrency(value as SupportedCashCurrency)}>
                    {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                  </Select>
                  <Select value={csvImportSource} onChange={(value) => setCsvImportSource(value as CsvImportSourceLabel)}>
                    {CSV_IMPORT_SOURCE_LABELS.map((source) => <option key={source} value={source}>{source}</option>)}
                  </Select>
                </div>
                <label className="block rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400 transition hover:border-violet-300/50">
                  <input type="file" accept=".csv,text/csv,text/plain" onChange={handleCsvFileChange} className="sr-only" />
                  <span className="inline-flex items-center gap-2 font-semibold text-white"><FileUp size={16} /> {csvFileName || 'Wybierz plik CSV'}</span>
                </label>
                <Textarea
                  rows={9}
                  placeholder={'date,close\n2024-01-02,100.12\n2024-01-03,101.55'}
                  value={csvText}
                  onChange={(value) => {
                    setCsvText(value)
                    setCsvImportResult(null)
                  }}
                />
                <SubmitButton disabled={csvImportLoading || !selectedCsvImportAsset || csvPreview.validRows === 0}>
                  {csvImportLoading ? <Loader2 className="animate-spin" size={16} /> : <FileUp size={16} />}
                  Potwierdź import
                </SubmitButton>
              </div>

              <CsvImportPreviewPanel preview={csvPreview} result={csvImportResult} loading={csvImportLoading} />
            </form>
          </Card>
        </div>
      ) : null}

      {activeTab === 'allocation' ? (
        <div className="grid gap-6 2xl:grid-cols-[1.25fr_.75fr]">
          <Card>
            <h3 className="text-lg font-bold text-white">Allocation drift</h3>
            <p className="mt-1 text-sm text-slate-500">Prosty drift względem targetów. Sugestia nie uwzględnia podatków, spreadów ani minimalnych kwot zleceń.</p>
            <AllocationDriftTable rows={allocationDrift} />
          </Card>
          <Card>
            <h3 className="text-lg font-bold text-white">Allocation history</h3>
            <p className="mt-1 text-sm text-slate-500">Najnowszy `allocation_breakdown` z portfolio_snapshots. Starsze snapshoty sprzed C5 mogą być puste.</p>
            {latestSnapshotAllocation.length > 0 ? (
              <div className="mt-5 space-y-3">
                {latestSnapshotAllocation.map((item) => (
                  <InfoLine key={`${item.name}-${item.type}`} label={item.name} value={`${PCT.format(num(item.pct))} · ${PLN.format(num(item.value))}`} />
                ))}
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                <InfoLine label="Snapshots" value={String(snapshots.length)} />
                <InfoLine label="Latest contribution" value={PLN.format(num(snapshots[snapshots.length - 1]?.contribution))} />
                <InfoLine label="Current cash" value={PLN.format(cashSummary.cashBalanceBase)} />
                <InfoLine label="Active positions" value={String(activePositions.length)} />
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </Shell>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-500">{text}</div>
}

function Input({ value, onChange, ...props }: { value: string; onChange: (value: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'>) {
  return <input {...props} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-violet-300/60" />
}

function Textarea({ value, onChange, ...props }: { value: string; onChange: (value: string) => void } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'>) {
  return <textarea {...props} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 font-mono text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-violet-300/60" />
}

function Select({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-violet-300/60">{children}</select>
}

function SubmitButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return <button disabled={disabled} className="inline-flex items-center gap-2 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50">{children}</button>
}

function ReturnDiagnosticsPanel({ diagnostics }: { diagnostics: ReturnSanityDiagnostics }) {
  const reasons = diagnostics.confidenceReasons.length > 0 ? diagnostics.confidenceReasons.join(' · ') : 'stable interval coverage'
  const largeFlows = diagnostics.largeCashFlowDates.length > 0
    ? diagnostics.largeCashFlowDates.map((item) => `${formatDate(item.date)} ${PLN.format(item.amount)}`).join(' · ')
    : 'none detected'

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-white">Return confidence</h3>
          <p className="mt-1 text-sm text-slate-500">Snapshot-based sanity checks compare raw portfolio growth, contributions, and valid TWR intervals.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${confidenceTone(diagnostics.confidence)}`}>{confidenceLabel(diagnostics.confidence)}</span>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
        <InfoLine label="Portfolio value" value={`${diagnostics.startPortfolioValue == null ? '—' : PLN.format(diagnostics.startPortfolioValue)} → ${diagnostics.endPortfolioValue == null ? '—' : PLN.format(diagnostics.endPortfolioValue)}`} />
        <InfoLine label="Contribution" value={`${diagnostics.startContribution == null ? '—' : PLN.format(diagnostics.startContribution)} → ${diagnostics.endContribution == null ? '—' : PLN.format(diagnostics.endContribution)}`} />
        <InfoLine label="Nominal growth" value={formatPct(diagnostics.nominalGrowthPct)} />
        <InfoLine label="Adjusted growth" value={formatPct(diagnostics.contributionAdjustedGrowthPct)} />
        <InfoLine label="Net cash flow" value={`${diagnostics.startNetCashFlow == null ? '—' : PLN.format(diagnostics.startNetCashFlow)} → ${diagnostics.endNetCashFlow == null ? '—' : PLN.format(diagnostics.endNetCashFlow)}`} />
        <InfoLine label="Flow impact" value={formatPct(diagnostics.flowImpactRatio)} />
        <InfoLine label="Main driver" value={diagnostics.performanceDriver} />
        <InfoLine label="Confidence note" value={reasons} />
      </div>
      <details className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
        <summary className="cursor-pointer font-semibold text-white">Large cash-flow dates</summary>
        <p className="mt-3 leading-6">{largeFlows}</p>
      </details>
    </Card>
  )
}

function MarketDataQualityPanel({ asset, provider, resolution, diagnostics, loading, error }: {
  asset: Asset
  provider: ProviderStatus
  resolution: SymbolResolutionDescription | null
  diagnostics: MarketPriceDiagnostics | null
  loading: boolean
  error: string | null
}) {
  const sourceDistribution = diagnostics?.sourceDistribution.length
    ? diagnostics.sourceDistribution.map((item) => `${item.source} ${item.count}`).join(' · ')
    : '—'
  const warnings = diagnostics?.warnings.length ? diagnostics.warnings : []
  const stooqWarning = provider.fallbackOrder.includes('stooq') && diagnostics?.quality !== 'ready'
  const candidateSymbols = resolution?.resolutions
    .flatMap((item) => item.candidates.map((candidate) => candidate.symbol))
    .filter((symbol, index, all) => all.indexOf(symbol) === index)
    .join(' -> ') || '—'
  const inferredNotes = resolution?.resolutions
    .flatMap((item) => item.candidates.filter((candidate) => candidate.inferred).map((candidate) => `${candidate.symbol}: ${candidate.note}`))
    .slice(0, 4)
    .join(' ') || null

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Market data quality</p>
          <p className="mt-1 text-xs text-slate-500">Provider diagnostics for backfill and portfolio history readiness.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${qualityTone(diagnostics?.quality)}`}>{loading ? 'Loading' : qualityLabel(diagnostics?.quality)}</span>
      </div>

      {error ? <p className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</p> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <InfoLine label="Provider" value={provider.provider} />
        <InfoLine label="Market symbol" value={asset.market_symbol || asset.symbol} />
        <InfoLine label="Selected provider symbol" value={resolution?.primarySymbol ?? '—'} />
        <InfoLine label="Candidate symbols" value={candidateSymbols} />
        <InfoLine label="Stored source symbol" value={diagnostics?.sourceSymbol ?? '—'} />
        <InfoLine label="Rows" value={diagnostics ? String(diagnostics.rowCount) : '—'} />
        <InfoLine label="Date range" value={diagnostics?.minPriceDate && diagnostics.maxPriceDate ? `${formatDate(diagnostics.minPriceDate)} → ${formatDate(diagnostics.maxPriceDate)}` : '—'} />
        <InfoLine label="Coverage" value={diagnostics?.historyCoveragePct == null ? '—' : `${PCT.format(diagnostics.historyCoveragePct)} · ${diagnostics.expectedTradingDays} weekdays`} />
        <InfoLine label="Latest price" value={diagnostics?.latestPriceDate ? formatDate(diagnostics.latestPriceDate) : '—'} />
        <InfoLine label="Recent gap" value={diagnostics?.recentCalendarGapDays == null ? '—' : `${diagnostics.recentCalendarGapDays} calendar days · ${diagnostics.missingRecentTradingDays} weekdays`} />
        <InfoLine label="Recent history gaps" value={diagnostics ? `${diagnostics.recentGapCount} · max ${diagnostics.maxRecentGapDays} days` : '—'} />
        <InfoLine label="Base price rows" value={diagnostics ? `${diagnostics.basePriceRows}/${diagnostics.rowCount}` : '—'} />
        <InfoLine label="Sources" value={sourceDistribution} />
        <InfoLine label="Portfolio backfill" value={diagnostics?.readyForPortfolioHistory ? 'Ready' : 'Limited'} />
        <InfoLine label="Historical support" value={provider.supportsHistorical ? 'Yes' : 'No'} />
        <InfoLine label="Latest support" value={provider.supportsLatest ? 'Yes' : 'No'} />
        <InfoLine label="Adjusted close" value={provider.supportsAdjustedClose ? 'Yes' : 'No'} />
        <InfoLine label="API key" value={provider.requiresApiKey ? 'Required' : 'Not required'} />
        <InfoLine label="Range support" value={provider.historicalRangeSupport} />
        <InfoLine label="Asset types" value={provider.supportedAssetTypes.join(', ') || '—'} />
        <InfoLine label="Rate limits" value={provider.rateLimitDiagnostics} />
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">{provider.notes}</p>
      {inferredNotes ? <p className="mt-2 text-xs leading-5 text-slate-500">Symbol mapping inferred: {inferredNotes}</p> : null}
      {warnings.length > 0 || stooqWarning ? (
        <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">
          {[...warnings, ...(stooqWarning ? ['Stooq history looks partial; use CSV import fallback if provider backfill misses rows.'] : [])].join(' ')}
        </div>
      ) : null}
    </div>
  )
}

function LedgerTable({ entries, onDelete, saving }: { entries: CashLedgerEntry[]; onDelete: (id: string) => void; saving: boolean }) {
  if (entries.length === 0) return <EmptyState text="Brak wpisów cash ledger." />
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10">
      <table className="w-full text-sm">
        <thead className="bg-white/[0.04] text-slate-500">
          <tr><th className="p-4 text-left">Data</th><th className="p-4 text-left">Typ</th><th className="p-4 text-right">Kwota</th><th className="p-4 text-left">Note</th><th className="p-4 text-right" /></tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t border-white/10 text-slate-300">
              <td className="p-4">{formatDate(entry.entry_date)}</td>
              <td className="p-4">{entry.entry_type}</td>
              <td className="p-4 text-right font-semibold text-white">{PLN.format(num(entry.amount))} {entry.currency}</td>
              <td className="p-4 text-slate-500">{entry.note ?? '—'}</td>
              <td className="p-4 text-right"><button disabled={saving} onClick={() => onDelete(entry.id)} className="rounded-xl p-2 text-slate-500 transition hover:bg-white/10 hover:text-rose-300"><Trash2 size={16} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DividendTable({ rows, onDelete, saving }: { rows: DividendRecord[]; onDelete: (id: string) => void; saving: boolean }) {
  if (rows.length === 0) return <EmptyState text="Brak dywidend." />
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10">
      <table className="w-full text-sm">
        <thead className="bg-white/[0.04] text-slate-500">
          <tr><th className="p-4 text-left">Data</th><th className="p-4 text-left">Aktywo</th><th className="p-4 text-right">Brutto</th><th className="p-4 text-right">Tax</th><th className="p-4 text-right">Netto</th><th className="p-4 text-right" /></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-white/10 text-slate-300">
              <td className="p-4">{formatDate(row.payment_date)}</td>
              <td className="p-4"><div className="font-semibold text-white">{row.assets?.symbol ?? row.asset_id}</div><div className="text-xs text-slate-500">{row.assets?.name ?? row.note ?? '—'}</div></td>
              <td className="p-4 text-right">{PLN.format(num(row.gross_amount))} {row.currency}</td>
              <td className="p-4 text-right text-amber-200">{PLN.format(num(row.tax_amount))}</td>
              <td className="p-4 text-right font-semibold text-emerald-300">{PLN.format(num(row.net_amount))}</td>
              <td className="p-4 text-right"><button disabled={saving} onClick={() => onDelete(row.id)} className="rounded-xl p-2 text-slate-500 transition hover:bg-white/10 hover:text-rose-300"><Trash2 size={16} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AllocationDriftTable({ rows }: { rows: ReturnType<typeof buildAllocationDrift> }) {
  if (rows.length === 0) return <EmptyState text="Brak aktywów lub targetów do policzenia driftu." />
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
      <table className="w-full text-sm">
        <thead className="bg-white/[0.04] text-slate-500">
          <tr><th className="p-4 text-left">Aktywo</th><th className="p-4 text-right">Current</th><th className="p-4 text-right">Target</th><th className="p-4 text-right">Drift</th><th className="p-4 text-right">Sugestia</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.name}-${row.type}`} className="border-t border-white/10 text-slate-300">
              <td className="p-4"><div className="font-semibold text-white">{row.name}</div><div className="text-xs text-slate-500">{row.type}</div></td>
              <td className="p-4 text-right">{PCT.format(row.currentPct)}</td>
              <td className="p-4 text-right">{PCT.format(row.targetPct)}</td>
              <td className={`p-4 text-right font-semibold ${Math.abs(row.driftPct) < 0.01 ? 'text-slate-400' : row.driftPct > 0 ? 'text-amber-300' : 'text-cyan-300'}`}>{PCT.format(row.driftPct)}</td>
              <td className="p-4 text-right"><span className="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">{directionLabel(row.suggestedDirection)} · {PLN.format(row.suggestedAmount)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CatalogPresetList({
  rows,
  targetAsset,
  applyingPresetId,
  emptyText,
  onApply,
}: {
  rows: InstrumentCatalogRow[]
  targetAsset: Asset | null
  applyingPresetId: string | null
  emptyText: string
  onApply: (asset: Asset | null, preset: InstrumentCatalogRow) => void
}) {
  if (rows.length === 0) return <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">{emptyText}</div>

  return (
    <div className="mt-3 space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/50 p-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-white">{row.symbol}</p>
              <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs font-semibold text-cyan-200">{row.market_symbol}</span>
            </div>
            <p className="mt-1 truncate text-sm text-slate-300">{row.name}</p>
            <p className="mt-1 text-xs text-slate-500">{catalogMeta(row)}</p>
          </div>
          <button
            type="button"
            disabled={!targetAsset || applyingPresetId === row.id}
            onClick={() => onApply(targetAsset, row)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applyingPresetId === row.id ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />}
            Zastosuj
          </button>
        </div>
      ))}
    </div>
  )
}

function BackfillResultPanel({ result, loading }: { result: BackfillResult | null; loading: boolean }) {
  if (loading) return <div className="mt-5 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400"><Loader2 className="animate-spin" size={16} /> Backfill w toku...</div>
  if (!result) return <EmptyState text="Uruchom backfill, żeby zobaczyć raport." />

  return (
    <div className="mt-5 space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <InfoLine label="Status" value={result.status} />
        <InfoLine label="Requested" value={String(result.requestedAssets)} />
        <InfoLine label="Processed" value={String(result.processedAssets)} />
        <InfoLine label="Remaining" value={String(result.remainingCount)} />
      </div>

      {result.error ? <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">{result.error}</div> : null}

      <div className="space-y-3">
        {(result.results ?? []).map((item) => (
          <div key={item.assetId} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-white">{item.symbol} · {item.sourceSymbol}</p>
                <p className="mt-1 text-xs text-slate-500">{item.provider} · latest {item.latestPriceDate ?? '—'}</p>
                {item.providerFallbackChain?.length ? <p className="mt-1 text-xs text-slate-500">Fallback: {item.providerFallbackChain.join(' -> ')}</p> : null}
                {item.providerCandidateSymbols?.length ? <p className="mt-1 text-xs text-slate-500">Candidates: {item.providerCandidateSymbols.join(' -> ')}</p> : null}
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.status === 'failed' ? 'bg-rose-500/10 text-rose-200' : item.status === 'partial' ? 'bg-amber-500/10 text-amber-100' : 'bg-emerald-500/10 text-emerald-200'}`}>{item.status}</span>
            </div>
            <div className="mt-4 grid gap-3 text-sm md:grid-cols-5">
              <InfoLine label="Fetched" value={String(item.fetchedRows)} />
              <InfoLine label="Saved" value={String(item.persistedRows)} />
              <InfoLine label="Older rows" value={String(item.remainingRows)} />
              <InfoLine label="FX missing" value={String(item.fxMissingRows)} />
              <InfoLine label="Adjusted rows" value={String(item.adjustedPriceRows ?? 0)} />
            </div>
            {item.providerMessages?.length ? <p className="mt-3 text-sm text-slate-400">{item.providerMessages.join(' ')}</p> : null}
            {item.error ? <p className="mt-3 text-sm text-amber-100">{item.error}</p> : null}
          </div>
        ))}
      </div>

      {result.remainingAssets && result.remainingAssets.length > 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
          Pozostałe aktywa do kolejnego requestu: {result.remainingAssets.map((asset) => asset.symbol).join(', ')}
        </div>
      ) : null}
    </div>
  )
}

function returnTone(value: number | null | undefined) {
  if (value == null) return 'bg-white/[0.04] text-slate-400'
  if (value >= 0.05) return 'bg-emerald-500/25 text-emerald-100'
  if (value >= 0) return 'bg-emerald-500/10 text-emerald-200'
  if (value <= -0.05) return 'bg-rose-500/25 text-rose-100'
  return 'bg-rose-500/10 text-rose-200'
}

function MonthlyReturnsGrid({ rows }: { rows: MonthlyReturnCell[] }) {
  const byYear = new Map<string, MonthlyReturnCell[]>()
  for (const row of rows) {
    const current = byYear.get(row.year) ?? []
    current.push(row)
    byYear.set(row.year, current)
  }

  return (
    <div className="space-y-4">
      {Array.from(byYear.entries()).map(([year, yearRows]) => {
        const byMonth = new Map(yearRows.map((row) => [row.month, row]))
        return (
          <div key={year} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">{year}</p>
              <p className="text-xs text-slate-500">{yearRows.length} monthly estimates</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
              {Array.from({ length: 12 }, (_, index) => {
                const month = index + 1
                const row = byMonth.get(month)
                return (
                  <div key={`${year}-${month}`} className={`rounded-xl p-3 text-sm ${returnTone(row?.returnPct)}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold opacity-80">{row?.monthLabel ?? month}</span>
                      <span className="font-bold">{row ? PCT.format(row.returnPct) : '—'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function YearlyReturnsList({ rows }: { rows: YearlyReturnPoint[] }) {
  if (rows.length === 0) return <InfoLine label="Yearly returns" value="Need more snapshots" />
  const latest = rows.slice(-3)
  return (
    <div className="space-y-2">
      {latest.map((row) => <InfoLine key={row.year} label={row.year} value={PCT.format(row.returnPct)} />)}
    </div>
  )
}

function PerformanceEngineSummary({
  performance,
  realizedPnl,
  unrealizedPnl,
  feesAndTaxes,
  baseCurrency,
}: {
  performance: PortfolioPerformance
  realizedPnl: number
  unrealizedPnl: number
  feesAndTaxes: number
  baseCurrency: SupportedCashCurrency
}) {
  return (
    <div className="mt-5 grid gap-3 md:grid-cols-2">
      <InfoLine label="Snapshot vol. est." value={metricOrReason(performance.volatilityPct, performance.volatilityReason)} />
      <InfoLine label="Snapshots" value={String(performance.snapshots.length)} />
      <InfoLine label="Realized P/L" value={PLN.format(realizedPnl)} />
      <InfoLine label="Unrealized P/L" value={PLN.format(unrealizedPnl)} />
      <InfoLine label="Fees / taxes" value={PLN.format(feesAndTaxes)} />
      <InfoLine label="Base currency" value={baseCurrency} />
      <div className="md:col-span-2">
        <YearlyReturnsList rows={performance.yearlyReturns} />
      </div>
    </div>
  )
}

function BenchmarkSummary({ result }: { result: BenchmarkPerformance }) {
  return (
    <div className="mb-5 grid gap-3 md:grid-cols-4">
      <InfoLine label="Overlap" value={result.overlapStartDate && result.overlapEndDate ? `${formatDate(result.overlapStartDate)} → ${formatDate(result.overlapEndDate)}` : '—'} />
      <InfoLine label="Portfolio" value={formatPct(result.portfolioReturnPct)} />
      <InfoLine label="Benchmark" value={formatPct(result.benchmarkReturnPct)} />
      <InfoLine label="Relative" value={formatPct(result.relativeReturnPct)} />
      <div className="md:col-span-4">
        <InfoLine label="Tracking diff est." value={formatPct(result.trackingDifferencePct)} />
      </div>
    </div>
  )
}

function SingleMonthlyReturnSummary({ row }: { row: MonthlyReturnCell }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Limited monthly history</p>
          <p className="mt-1 text-sm text-slate-500">Only one monthly return is available, so the chart will appear after another month is generated.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${row.returnPct >= 0 ? 'bg-emerald-500/10 text-emerald-200' : 'bg-rose-500/10 text-rose-200'}`}>
          {PCT.format(row.returnPct)}
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <InfoLine label="Month" value={`${row.monthLabel} ${row.year}`} />
        <InfoLine label="Date" value={formatDate(row.endDate)} />
        <InfoLine label="Start" value={PLN.format(row.startValue)} />
        <InfoLine label="End" value={PLN.format(row.endValue)} />
      </div>
    </div>
  )
}

function PortfolioHistoryResultPanel({ result, loading, snapshots }: { result: PortfolioHistoryBackfillResult | null; loading: boolean; snapshots: number }) {
  if (loading) return <div className="mt-5 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400"><Loader2 className="animate-spin" size={16} /> Portfolio valuation backfill w toku...</div>
  if (!result) {
    return (
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <InfoLine label="Current snapshots" value={String(snapshots)} />
        <InfoLine label="Mode" value="incremental" />
        <InfoLine label="Source" value="market_prices" />
      </div>
    )
  }

  const skipped = result.skippedDays ?? []
  const errors = result.errorDays ?? []

  return (
    <div className="mt-5 space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <InfoLine label="Status" value={result.status} />
        <InfoLine label="Generated" value={String(result.generatedSnapshots)} />
        <InfoLine label="Processed days" value={String(result.processedDays)} />
        <InfoLine label="Remaining" value={String(result.remainingDays)} />
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <InfoLine label="Range" value={`${result.startDate ? formatDate(result.startDate) : '—'} → ${formatDate(result.endDate)}`} />
        <InfoLine label="Existing skipped" value={String(result.skippedExistingDays)} />
        <InfoLine label="No activity" value={String(result.skippedNoActivityDays)} />
        <InfoLine label="Missing price" value={String(result.skippedMissingPriceDays)} />
      </div>

      {result.remainingDays > 0 ? <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">Zakres jest dłuższy niż limit requestu. Uruchom backfill ponownie, żeby dokończyć pozostałe dni.</div> : null}
      {result.error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{result.error}</div> : null}

      {skipped.length > 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
          <p className="font-semibold text-white">Skipped days</p>
          <div className="mt-3 space-y-2">
            {skipped.slice(0, 6).map((item) => <p key={`${item.date}-${item.reason}`}>{formatDate(item.date)} · {item.reason}</p>)}
          </div>
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">
          <p className="font-semibold">Error days</p>
          <div className="mt-3 space-y-2">
            {errors.slice(0, 6).map((item) => <p key={`${item.date}-${item.error}`}>{formatDate(item.date)} · {item.error}</p>)}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CsvImportPreviewPanel({ preview, result, loading }: { preview: CsvImportPreview; result: CsvImportResult | null; loading: boolean }) {
  const sampleRows = preview.rows.slice(0, 6)
  const sampleErrors = preview.errors.slice(0, 6)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <InfoLine label="Parsed" value={String(preview.parsedRows)} />
        <InfoLine label="Valid" value={String(preview.validRows)} />
        <InfoLine label="Invalid" value={String(preview.invalidRows)} />
        <InfoLine label="Skipped" value={String(preview.skippedRows)} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <InfoLine label="Delimiter" value={preview.delimiter} />
        <InfoLine label="Min date" value={preview.minDate ?? '—'} />
        <InfoLine label="Max date" value={preview.maxDate ?? '—'} />
      </div>

      {loading ? <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400"><Loader2 className="animate-spin" size={16} /> Import CSV w toku...</div> : null}
      {result ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
          Zapisano/upsertowano {result.savedRows} wierszy dla źródła {result.source} · {result.sourceSymbol}.
        </div>
      ) : null}

      {sampleRows.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.04] text-slate-500">
              <tr><th className="p-3 text-left">Date</th><th className="p-3 text-right">Open</th><th className="p-3 text-right">High</th><th className="p-3 text-right">Low</th><th className="p-3 text-right">Close</th></tr>
            </thead>
            <tbody>
              {sampleRows.map((row) => (
                <tr key={`${row.rowNumber}-${row.priceDate}`} className="border-t border-white/10 text-slate-300">
                  <td className="p-3">{row.priceDate}</td>
                  <td className="p-3 text-right">{row.openPrice ?? '—'}</td>
                  <td className="p-3 text-right">{row.highPrice ?? '—'}</td>
                  <td className="p-3 text-right">{row.lowPrice ?? '—'}</td>
                  <td className="p-3 text-right font-semibold text-white">{row.closePrice}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState text="Wklej CSV, żeby zobaczyć preview." />}

      {sampleErrors.length > 0 ? (
        <div className="space-y-2">
          {sampleErrors.map((error) => (
            <div key={`${error.rowNumber}-${error.raw}`} className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">
              <p className="font-semibold">Row {error.rowNumber}</p>
              <p className="mt-1 text-xs text-rose-100/70">{error.errors.join(' ')}</p>
              <p className="mt-1 truncate font-mono text-xs text-rose-100/50">{error.raw}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] p-3 text-sm"><span className="shrink-0 text-slate-500">{label}</span><span className="min-w-0 text-right font-semibold text-white">{value}</span></div>
}
