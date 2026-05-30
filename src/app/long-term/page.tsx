'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Database, Loader2, Plus, RefreshCw, Save, Search, Target, Trash2, TrendingUp, Wallet, X, Zap } from 'lucide-react'
import { Shell, PageHeader, Card, StatCard, TrustBadge, FeatureNote } from '@/components/Shell'
import { AllocationChart } from '@/components/Charts'
import { PLN, PLN2, PCT } from '@/lib/format'
import { BASE_CURRENCY } from '@/lib/currency'
import { summarizeIncomeByAsset } from '@/lib/income-engine'
import {
  instrumentMeta,
  instrumentProviderCandidates,
  instrumentReadiness,
  searchInstrumentCatalogRows,
  type InstrumentSearchable,
} from '@/lib/instruments/search'
import { supabase } from '@/lib/supabase/client'
import {
  createAsset,
  deleteAsset,
  getDefaultPortfolio,
  listAssets,
  listAssetPrices,
  listIncomeEvents,
  listInstrumentCatalog,
  listTransactions,
  updateAsset,
  upsertAssetPrice,
  type Asset,
  type AssetPrice,
  type AssetType,
  type IncomeEvent,
  type InstrumentCatalogRow,
  type Portfolio,
  type Transaction,
} from '@/lib/supabase/portfolio'
import { buildPositions, portfolioSummary } from '@/lib/position-engine'

type AssetForm = {
  symbol: string
  name: string
  asset_type: AssetType
  currency: string
  target_allocation: string
  market_symbol: string
  price_source: string
}

type BackfillRange = '1Y' | '3Y' | '5Y' | 'MAX'

type SmartAssetResult = {
  symbol: string
  status: 'success' | 'warning'
  message: string
  rows?: number
  provider?: string
  sourceSymbol?: string
}

const emptyAssetForm: AssetForm = {
  symbol: '',
  name: '',
  asset_type: 'ETF',
  currency: 'PLN',
  target_allocation: '0',
  market_symbol: '',
  price_source: 'auto',
}

const assetTypes: AssetType[] = ['ETF', 'Akcje', 'Obligacje', 'Gotówka', 'Crypto', 'CFD', 'Inne']
const currencies = ['PLN', 'EUR', 'USD', 'GBP', 'CHF']
const backfillRanges: BackfillRange[] = ['1Y', '3Y', '5Y', 'MAX']
const automaticHistoryFallback = 'Nie udało się pobrać historii automatycznie. Sprawdź symbol dostawcy albo użyj importu CSV w Intelligence → Backfill.'

function toNumber(value: string) {
  return Number(String(value || '0').replace(',', '.'))
}

function isHistoryEligible(assetType: AssetType) {
  return assetType !== 'Gotówka' && assetType !== 'Obligacje'
}

function formInstrument(form: AssetForm, preset: InstrumentCatalogRow | null): InstrumentSearchable {
  return {
    id: preset?.id,
    symbol: form.symbol || preset?.symbol || '',
    name: form.name || preset?.name || 'Aktywo ręczne',
    market_symbol: form.market_symbol || preset?.market_symbol || null,
    provider: form.price_source || preset?.provider || 'auto',
    category: preset?.category ?? 'manual',
    asset_type: form.asset_type,
    currency: form.currency,
    exchange: preset?.exchange ?? null,
    country: preset?.country ?? null,
    aliases: preset?.aliases ?? null,
    benchmark_candidate: preset?.benchmark_candidate ?? false,
    is_active: true,
  }
}

function ReadinessLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] p-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 truncate font-semibold text-white">{value}</p>
    </div>
  )
}

export default function LongTermPage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [prices, setPrices] = useState<AssetPrice[]>([])
  const [incomeEvents, setIncomeEvents] = useState<IncomeEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [savingPrice, setSavingPrice] = useState<string | null>(null)
  const [refreshingPrices, setRefreshingPrices] = useState(false)
  const [savingAsset, setSavingAsset] = useState(false)
  const [deletingAsset, setDeletingAsset] = useState<string | null>(null)
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null)
  const [showAssetForm, setShowAssetForm] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({})
  const [assetForm, setAssetForm] = useState<AssetForm>(emptyAssetForm)
  const [instrumentCatalog, setInstrumentCatalog] = useState<InstrumentCatalogRow[]>([])
  const [catalogQuery, setCatalogQuery] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [fetchHistoryAfterAdd, setFetchHistoryAfterAdd] = useState(false)
  const [backfillRange, setBackfillRange] = useState<BackfillRange>('1Y')
  const [backfillLoadingAssetId, setBackfillLoadingAssetId] = useState<string | null>(null)
  const [assetFlowResult, setAssetFlowResult] = useState<SmartAssetResult | null>(null)

  const positions = useMemo(() => buildPositions(assets, transactions, prices), [assets, transactions, prices])
  const summary = useMemo(() => portfolioSummary(positions), [positions])
  const allocation = positions.filter((p) => p.currentValue > 0).map((p) => ({ name: p.asset.symbol, value: p.currentValue }))
  const catalogResults = useMemo(() => searchInstrumentCatalogRows(instrumentCatalog, catalogQuery, { limit: 8 }), [instrumentCatalog, catalogQuery])
  const selectedPreset = useMemo(() => instrumentCatalog.find((preset) => preset.id === selectedPresetId) ?? null, [instrumentCatalog, selectedPresetId])
  const readiness = useMemo(() => instrumentReadiness(formInstrument(assetForm, selectedPreset), portfolio?.currency ?? 'PLN'), [assetForm, selectedPreset, portfolio?.currency])
  const providerCandidates = useMemo(() => instrumentProviderCandidates(formInstrument(assetForm, selectedPreset)).slice(0, 8), [assetForm, selectedPreset])
  const historyFetchEnabled = !editingAssetId && fetchHistoryAfterAdd && isHistoryEligible(assetForm.asset_type)
  const incomeByAsset = useMemo(() => {
    const rows = summarizeIncomeByAsset(incomeEvents)
    return new Map(rows.map((row) => [row.assetId, row]))
  }, [incomeEvents])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getUser()
      if (!data.user) throw new Error('Brak aktywnej sesji użytkownika.')
      const defaultPortfolio = await getDefaultPortfolio(data.user)
      const [assetList, txList, priceList, incomeList] = await Promise.all([
        listAssets(defaultPortfolio.id),
        listTransactions(defaultPortfolio.id),
        listAssetPrices(defaultPortfolio.id),
        listIncomeEvents(defaultPortfolio.id),
      ])
      setPortfolio(defaultPortfolio)
      setAssets(assetList)
      setTransactions(txList)
      setPrices(priceList)
      setIncomeEvents(incomeList)
      setPriceDrafts(Object.fromEntries(priceList.map((p) => [p.asset_id, String(p.price)])))

      try {
        setInstrumentCatalog(await listInstrumentCatalog())
      } catch {
        setInstrumentCatalog([])
      }
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się pobrać pozycji.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  function resetAssetForm() {
    setAssetForm(emptyAssetForm)
    setEditingAssetId(null)
    setShowAssetForm(true)
    setSelectedPresetId(null)
    setCatalogQuery('')
    setFetchHistoryAfterAdd(false)
  }

  function startEdit(asset: Asset) {
    setAssetForm({
      symbol: asset.symbol ?? '',
      name: asset.name ?? '',
      asset_type: (asset.asset_type as AssetType) ?? 'ETF',
      currency: asset.currency ?? 'PLN',
      target_allocation: String(asset.target_allocation ?? 0),
      market_symbol: asset.market_symbol ?? '',
      price_source: asset.price_source ?? 'auto',
    })
    setEditingAssetId(asset.id)
    setShowAssetForm(true)
    setSelectedPresetId(null)
    setCatalogQuery('')
    setFetchHistoryAfterAdd(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function applyCatalogPreset(preset: InstrumentCatalogRow) {
    const presetType = preset.asset_type as AssetType
    setAssetForm((current) => ({
      ...current,
      symbol: preset.symbol,
      name: preset.name,
      asset_type: presetType,
      currency: preset.currency,
      market_symbol: preset.market_symbol,
      price_source: preset.provider,
    }))
    setCatalogQuery(`${preset.symbol} ${preset.name}`)
    setSelectedPresetId(preset.id)
    if (!isHistoryEligible(presetType)) setFetchHistoryAfterAdd(false)
  }

  async function runBackfillForCreatedAsset(created: Asset): Promise<SmartAssetResult> {
    setBackfillLoadingAssetId(created.id)
    const timeout = new AbortController()
    const timeoutId = window.setTimeout(() => timeout.abort(), 75000)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const response = await fetch('/api/prices/backfill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionData.session?.access_token ? { Authorization: `Bearer ${sessionData.session.access_token}` } : {}),
        },
        body: JSON.stringify({
          scope: 'asset',
          portfolio_id: created.portfolio_id,
          asset_id: created.id,
          range: backfillRange,
        }),
        signal: timeout.signal,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? automaticHistoryFallback)

      const item = payload?.results?.[0]
      const savedRows = Number(item?.persistedRows ?? 0)
      if (!item || item.error || item.status === 'failed') {
        return {
          symbol: created.symbol,
          status: 'warning',
          message: `${automaticHistoryFallback}${item?.error ? ` ${item.error}` : ''}`,
          rows: savedRows,
          provider: item?.provider,
          sourceSymbol: item?.sourceSymbol,
        }
      }

      return {
        symbol: created.symbol,
        status: item.status === 'partial' ? 'warning' : 'success',
        message: item.status === 'partial'
          ? `Historia częściowo pobrana dla ${created.symbol}.`
          : `Historia pobrana dla ${created.symbol}.`,
        rows: savedRows,
        provider: item.provider,
        sourceSymbol: item.sourceSymbol,
      }
    } catch (err: any) {
      return {
        symbol: created.symbol,
        status: 'warning',
        message: `${automaticHistoryFallback}${err?.name === 'AbortError' ? ' Request timed out.' : err?.message ? ` ${err.message}` : ''}`,
      }
    } finally {
      window.clearTimeout(timeoutId)
      setBackfillLoadingAssetId(null)
    }
  }

  async function saveAsset() {
    if (!portfolio) return
    setSavingAsset(true)
    setError(null)
    setSuccess(null)
    setAssetFlowResult(null)
    try {
      const target = toNumber(assetForm.target_allocation)
      if (!assetForm.symbol.trim()) throw new Error('Symbol jest wymagany.')
      if (!assetForm.name.trim()) throw new Error('Nazwa aktywa jest wymagana.')
      if (!Number.isFinite(target) || target < 0 || target > 100) throw new Error('Target alokacji musi być od 0 do 100%.')
      const shouldFetchHistory = historyFetchEnabled

      const payload = {
        symbol: assetForm.symbol,
        name: assetForm.name,
        asset_type: assetForm.asset_type,
        currency: assetForm.currency,
        target_allocation: target,
        market_symbol: assetForm.market_symbol,
        price_source: assetForm.price_source,
      }

      if (editingAssetId) {
        const updated = await updateAsset(editingAssetId, payload)
        setAssets((current) => current.map((asset) => asset.id === updated.id ? updated : asset))
        setSuccess(`Zaktualizowano ${updated.symbol}.`)
      } else {
        const created = await createAsset(portfolio.id, payload)
        setAssets((current) => [created, ...current])
        setSuccess(`Dodano ${created.symbol}.`)
        setAssetFlowResult({
          symbol: created.symbol,
          status: 'success',
          message: `Utworzono aktywo ${created.symbol}.`,
          provider: created.price_source ?? undefined,
          sourceSymbol: created.market_symbol ?? undefined,
        })
        setAssetForm(emptyAssetForm)
        setEditingAssetId(null)
        setSelectedPresetId(null)
        setCatalogQuery('')
        setFetchHistoryAfterAdd(false)

        if (shouldFetchHistory) {
          setSavingAsset(false)
          const backfillResult = await runBackfillForCreatedAsset(created)
          setAssetFlowResult(backfillResult)
          if (backfillResult.status === 'success') {
            setSuccess(`Dodano ${created.symbol}. Pobrano ${backfillResult.rows ?? 0} wierszy historii.`)
          } else {
            setSuccess(`Dodano ${created.symbol}.`)
          }
        }
      }
      setAssetForm(emptyAssetForm)
      setEditingAssetId(null)
      setSelectedPresetId(null)
      setCatalogQuery('')
      setFetchHistoryAfterAdd(false)
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się zapisać aktywa.')
    } finally {
      setSavingAsset(false)
    }
  }

  async function removeAsset(asset: Asset) {
    const relatedTx = transactions.filter((tx) => tx.asset_id === asset.id).length
    const extra = relatedTx > 0 ? `\n\nUwaga: to aktywo ma ${relatedTx} transakcji. Usunięcie aktywa usunie też powiązane transakcje.` : ''
    if (!window.confirm(`Usunąć ${asset.symbol}?${extra}`)) return

    setDeletingAsset(asset.id)
    setError(null)
    setSuccess(null)
    try {
      await deleteAsset(asset.id)
      setAssets((current) => current.filter((a) => a.id !== asset.id))
      setTransactions((current) => current.filter((tx) => tx.asset_id !== asset.id))
      setPrices((current) => current.filter((price) => price.asset_id !== asset.id))
      setSuccess(`Usunięto ${asset.symbol}.`)
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się usunąć aktywa.')
    } finally {
      setDeletingAsset(null)
    }
  }

  async function savePrice(asset: Asset) {
    if (!portfolio) return
    setSavingPrice(asset.id)
    setError(null)
    setSuccess(null)
    try {
      const price = Number(String(priceDrafts[asset.id] ?? '').replace(',', '.'))
      if (!Number.isFinite(price) || price < 0) throw new Error('Cena musi być poprawną liczbą dodatnią albo zerem.')
      const baseCurrency = portfolio.currency ?? BASE_CURRENCY
      const saved = await upsertAssetPrice(portfolio.id, asset.id, price, baseCurrency)
      setPrices((current) => [saved, ...current.filter((p) => p.asset_id !== asset.id)])
      setSuccess(`Cena ${asset.symbol} zapisana jako wycena w ${baseCurrency}.`)
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się zapisać ceny.')
    } finally {
      setSavingPrice(null)
    }
  }

  async function refreshMarketPrices() {
    if (!portfolio) return
    setRefreshingPrices(true)
    setError(null)
    setSuccess(null)
    try {
      const pricedAssets = assets.filter((asset) => asset.asset_type !== 'Obligacje' && asset.asset_type !== 'Gotówka')
      const { data: sessionData } = await supabase.auth.getSession()
      const response = await fetch('/api/prices/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionData.session?.access_token ? { Authorization: `Bearer ${sessionData.session.access_token}` } : {}),
        },
        body: JSON.stringify({ assets: pricedAssets }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error ?? 'Nie udało się pobrać cen.')

      const savedPrices: AssetPrice[] = []
      const errors: string[] = []
      for (const item of payload.prices ?? []) {
        if (item?.price && item.price > 0) {
          const saved = await upsertAssetPrice(portfolio.id, item.assetId, Number(item.price), item.currency ?? 'PLN')
          savedPrices.push(saved)
        } else if (item?.error) {
          errors.push(`${item.symbol}: ${item.error}`)
        }
      }

      if (savedPrices.length > 0) {
        setPrices((current) => {
          const savedIds = new Set(savedPrices.map((p) => p.asset_id))
          return [...savedPrices, ...current.filter((p) => !savedIds.has(p.asset_id))]
        })
        setPriceDrafts((current) => ({ ...current, ...Object.fromEntries(savedPrices.map((p) => [p.asset_id, String(Number(p.price).toFixed(4))])) }))
      }

      if (errors.length) setError(`Część cen nie weszła: ${errors.slice(0, 3).join(' | ')}`)
      setSuccess(`Odświeżono ${savedPrices.length} cen automatycznie.`)
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się odświeżyć cen.')
    } finally {
      setRefreshingPrices(false)
    }
  }

  return (
    <Shell>
      <PageHeader
        eyebrow="Stage C5.7 · Smart onboarding"
        title="Pozycje long-term"
        description="Dodawaj aktywa z katalogu albo ręcznie, a aplikacja przygotuje symbole, waluty i historię cen bez wymagania znajomości providerów."
      />

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <StatCard icon={Wallet} label="Wartość pozycji" value={PLN.format(summary.totalValue)} sub={summary.openPositions > 0 ? `${summary.openPositions} aktywnych pozycji · wycena w PLN` : 'Brak aktywnych pozycji'} tone="cyan" />
        <StatCard icon={Database} label="Koszt otwarty" value={PLN.format(summary.remainingCost)} sub={summary.investedCost > 0 ? `Wpłacone w pozycje: ${PLN.format(summary.investedCost)}` : 'Dodaj transakcję, żeby policzyć koszt'} />
        <StatCard icon={TrendingUp} label="P/L łączny" value={PLN.format(summary.totalPnl)} sub={summary.remainingCost > 0 ? `${PCT.format(summary.returnPct)} względem kosztu` : 'Za mało danych kosztowych'} tone={summary.totalPnl >= 0 ? 'emerald' : 'red'} />
        <StatCard icon={Target} label="Rebalancing" value={summary.rebalance?.asset.symbol ?? '—'} sub={summary.rebalance ? `Brakuje ${PCT.format(Math.max(summary.rebalance.allocationDiff, 0))}` : 'dodaj targety'} tone="violet" />
      </div>

      {error ? <div className="mt-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
      {success ? <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">{success}</div> : null}
      {backfillLoadingAssetId ? <div className="mt-6 flex items-center gap-2 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-100"><Loader2 className="animate-spin" size={16} /> Fetching historical prices...</div> : null}
      {assetFlowResult ? (
        <div className={`mt-6 rounded-2xl border p-4 text-sm ${assetFlowResult.status === 'success' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100' : 'border-amber-500/20 bg-amber-500/10 text-amber-100'}`}>
          <div className="flex items-start gap-2">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">{assetFlowResult.message}</p>
              <p className="mt-1 text-xs opacity-80">
                {assetFlowResult.rows !== undefined ? `${assetFlowResult.rows} zapisanych wierszy` : 'Aktywo utworzone'}
                {assetFlowResult.provider ? ` · ${assetFlowResult.provider}` : ''}
                {assetFlowResult.sourceSymbol ? ` · ${assetFlowResult.sourceSymbol}` : ''}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 2xl:grid-cols-[1.4fr_.7fr]">
        <div className="space-y-6">
          <Card>
            <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Aktywa</h3>
                <p className="mt-1 text-sm text-slate-500">Szukaj po nazwie, symbolu albo dodaj niestandardowe aktywo ręcznie.</p>
              </div>
              <button onClick={resetAssetForm} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400">
                <Plus size={16} /> Dodaj aktywo
              </button>
            </div>

            {showAssetForm ? (
              <div className="mb-5 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h4 className="font-bold text-white">{editingAssetId ? 'Edytuj aktywo' : 'Nowe aktywo'}</h4>
                  <button onClick={() => { setShowAssetForm(false); setEditingAssetId(null); setAssetForm(emptyAssetForm); setSelectedPresetId(null); setCatalogQuery(''); setFetchHistoryAfterAdd(false) }} className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white">
                    <X size={16} />
                  </button>
                </div>
                {!editingAssetId ? (
                  <div className="mb-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                    <label className="space-y-2">
                      <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><Search size={14} /> Szukaj instrumentu</span>
                      <input value={catalogQuery} onChange={(e) => { setCatalogQuery(e.target.value); setSelectedPresetId(null) }} className="input w-full px-4 py-3" placeholder="Apple, AAPL, Nasdaq, S&P 500, MSCI World, BTC, CD Projekt" />
                    </label>
                    <div className="mt-3 grid gap-2 lg:grid-cols-2">
                      {catalogResults.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => applyCatalogPreset(preset)}
                          className={`rounded-2xl border p-3 text-left transition ${selectedPresetId === preset.id ? 'border-cyan-300/50 bg-cyan-500/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-white">{preset.symbol}</span>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${instrumentReadiness(preset, portfolio?.currency ?? 'PLN').tone === 'emerald' ? 'bg-emerald-500/10 text-emerald-200' : 'bg-amber-500/10 text-amber-100'}`}>
                              {instrumentReadiness(preset, portfolio?.currency ?? 'PLN').badge}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-sm text-slate-300">{preset.name}</p>
                          <p className="mt-1 text-xs text-slate-500">{instrumentMeta(preset)} · Provider chain: {instrumentReadiness(preset, portfolio?.currency ?? 'PLN').providerChain}</p>
                        </button>
                      ))}
                    </div>
                    <p className="mt-3 text-xs text-slate-500">Wybór presetu uzupełni formularz. Nadal możesz zmienić każde pole albo użyć trybu ręcznego.</p>
                    {catalogResults.length === 0 ? <p className="mt-3 text-sm text-slate-500">Brak presetów dla tej frazy. Użyj formularza ręcznego poniżej.</p> : null}
                  </div>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Symbol</span>
                    <input value={assetForm.symbol} onChange={(e) => setAssetForm((f) => ({ ...f, symbol: e.target.value }))} className="input w-full px-4 py-3" placeholder="np. AAPL" />
                  </label>
                  <label className="space-y-2 xl:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nazwa</span>
                    <input value={assetForm.name} onChange={(e) => setAssetForm((f) => ({ ...f, name: e.target.value }))} className="input w-full px-4 py-3" placeholder="np. Apple Inc." />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Typ</span>
                    <select value={assetForm.asset_type} onChange={(e) => {
                      const nextType = e.target.value as AssetType
                      setAssetForm((f) => ({ ...f, asset_type: nextType }))
                      if (!isHistoryEligible(nextType)) setFetchHistoryAfterAdd(false)
                    }} className="input w-full px-4 py-3">
                      {assetTypes.map((type) => <option key={type}>{type}</option>)}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Waluta</span>
                    <select value={assetForm.currency} onChange={(e) => setAssetForm((f) => ({ ...f, currency: e.target.value }))} className="input w-full px-4 py-3">
                      {currencies.map((currency) => <option key={currency}>{currency}</option>)}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Target %</span>
                    <input value={assetForm.target_allocation} onChange={(e) => setAssetForm((f) => ({ ...f, target_allocation: e.target.value }))} className="input w-full px-4 py-3" inputMode="decimal" placeholder="np. 55" />
                  </label>
                </div>
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Gotowość instrumentu</p>
                      <p className="mt-1 text-xs text-slate-500">Wykres aktywa użyje waluty instrumentu, wycena portfela pozostaje w walucie bazowej.</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${readiness.tone === 'emerald' ? 'bg-emerald-500/10 text-emerald-200' : 'bg-amber-500/10 text-amber-100'}`}>{readiness.badge}</span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <ReadinessLine label="Łańcuch providerów" value={readiness.providerChain} />
                    <ReadinessLine label="Waluta wykresu" value={readiness.chartCurrency} />
                    <ReadinessLine label="Waluta wyceny portfela" value={readiness.valuationCurrency} />
                    <ReadinessLine label="Gotowość backfillu" value={readiness.backfillReady ? 'Gotowe' : 'CSV/manual'} />
                  </div>
                </div>
                <details className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-200">Zaawansowane szczegóły providera</summary>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <label className="space-y-2 xl:col-span-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Symbol dostawcy</span>
                      <input value={assetForm.market_symbol} onChange={(e) => setAssetForm((f) => ({ ...f, market_symbol: e.target.value }))} className="input w-full px-4 py-3" placeholder="bitcoin / IUSQ.DE / AAPL.US" />
                    </label>
                    <label className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preferencja cen</span>
                      <input value={assetForm.price_source} onChange={(e) => setAssetForm((f) => ({ ...f, price_source: e.target.value }))} className="input w-full px-4 py-3" placeholder="auto" />
                    </label>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    Kandydaci: {providerCandidates.length ? providerCandidates.map((candidate) => `${candidate.provider}:${candidate.symbol}`).join(' · ') : 'uzupełnij symbol, aby zobaczyć kandydatów'}
                  </p>
                </details>
                {!editingAssetId ? (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <label className="flex items-center gap-3 text-sm font-semibold text-slate-200">
                        <input
                          type="checkbox"
                          checked={fetchHistoryAfterAdd}
                          disabled={!isHistoryEligible(assetForm.asset_type)}
                          onChange={(e) => setFetchHistoryAfterAdd(e.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-slate-950 text-violet-500"
                        />
                        Pobierz historię cen po dodaniu
                      </label>
                      <select
                        value={backfillRange}
                        disabled={!fetchHistoryAfterAdd || !isHistoryEligible(assetForm.asset_type)}
                        onChange={(e) => setBackfillRange(e.target.value as BackfillRange)}
                        className="input w-full px-4 py-3 md:w-40"
                      >
                        {backfillRanges.map((range) => <option key={range}>{range}</option>)}
                      </select>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Wykres aktywa będzie w walucie instrumentu, portfel i analityka pozostaną w {portfolio?.currency ?? 'PLN'}.</p>
                    {!isHistoryEligible(assetForm.asset_type) ? <p className="mt-2 text-xs text-slate-500">Historia rynku jest dostępna dla aktywów rynkowych, nie dla gotówki ani obligacji.</p> : null}
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  {editingAssetId ? (
                    <button onClick={resetAssetForm} className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/15">Anuluj edycję</button>
                  ) : null}
                  <button onClick={saveAsset} disabled={savingAsset} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:opacity-60">
                    {savingAsset ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {editingAssetId ? 'Zapisz zmiany' : 'Zapisz aktywo'}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-white/[0.04] text-slate-500">
                  <tr>
                    <th className="p-4 text-left">Aktywo</th>
                    <th className="p-4 text-left">Typ</th>
                    <th className="p-4 text-right">Waluta</th>
                    <th className="p-4 text-right">Target</th>
                    <th className="p-4 text-right">Transakcje</th>
                    <th className="p-4 text-right">Akcje</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.length === 0 ? (
                    <tr><td colSpan={6} className="p-6 text-center text-slate-500">Brak aktywów. Dodaj pierwsze aktywo powyżej.</td></tr>
                  ) : assets.map((asset) => {
                    const txCount = transactions.filter((tx) => tx.asset_id === asset.id).length
                    return (
                      <tr key={asset.id} className="border-t border-white/10 text-slate-300 transition hover:bg-white/[0.03]">
                        <td className="p-4"><div className="font-semibold text-white">{asset.symbol}</div><div className="text-xs text-slate-500">{asset.name}</div>{asset.market_symbol ? <div className="mt-1 text-xs text-cyan-200/80">{asset.price_source ?? 'auto'} · {asset.market_symbol}</div> : null}</td>
                        <td className="p-4">{asset.asset_type}</td>
                        <td className="p-4 text-right">{asset.currency}</td>
                        <td className="p-4 text-right">{Number(asset.target_allocation ?? 0).toFixed(1)}%</td>
                        <td className="p-4 text-right">{txCount}</td>
                        <td className="p-4 text-right">
                          <div className="flex justify-end gap-2">
                            <button onClick={() => startEdit(asset)} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/15">Edytuj</button>
                            <button onClick={() => removeAsset(asset)} disabled={deletingAsset === asset.id} className="inline-flex items-center gap-1 rounded-xl bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-60">
                              {deletingAsset === asset.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Usuń
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white">Tabela pozycji</h3>
                <p className="mt-1 text-sm text-slate-500">Pozycje liczone są z transakcji. Auto ceny pobiera rynek, a ręczna cena w tej tabeli jest awaryjną wyceną w PLN/walucie portfela.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={refreshMarketPrices} disabled={refreshingPrices || loading || assets.length === 0} className="inline-flex items-center gap-2 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400 disabled:opacity-60" title="Pobierz ceny automatycznie">
                  {refreshingPrices ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />} Auto ceny
                </button>
                <button onClick={loadData} className="rounded-2xl p-3 text-slate-400 transition hover:bg-white/10 hover:text-white" title="Odśwież">
                  <RefreshCw size={18} />
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex min-h-80 items-center justify-center text-slate-400"><Loader2 className="mr-2 animate-spin" />Ładowanie pozycji...</div>
            ) : positions.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center">
                <p className="font-semibold text-white">Brak aktywów.</p>
                <p className="mt-2 text-sm text-slate-500">Dodaj aktywa i transakcje, a silnik pozycji policzy resztę.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-white/10">
                <table className="w-full min-w-[1260px] text-sm">
                  <thead className="bg-white/[0.04] text-slate-500">
                    <tr>
                      <th className="p-4 text-left">Aktywo</th>
                      <th className="p-4 text-right">Ilość</th>
                      <th className="p-4 text-right">Śr. cena PLN</th>
                      <th className="p-4 text-right">Cena teraz PLN</th>
                      <th className="p-4 text-right">Wartość PLN</th>
                      <th className="p-4 text-right">Koszt PLN</th>
                      <th className="p-4 text-right">P/L unreal. PLN</th>
                      <th className="p-4 text-right">P/L real. PLN</th>
                      <th className="p-4 text-right">Dochód PLN</th>
                      <th className="p-4 text-right">Zwrot</th>
                      <th className="p-4 text-right">Udział / target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => {
                      const income = incomeByAsset.get(p.asset.id)
                      return (
                      <tr key={p.asset.id} className="border-t border-white/10 text-slate-300 transition hover:bg-white/[0.03]">
                        <td className="p-4">
                          <div className="font-semibold text-white">{p.asset.symbol}</div>
                          <div className="text-xs text-slate-500">{p.asset.name} · {p.asset.asset_type}</div>
                          {!p.baseCostComplete ? <div className="mt-1 text-xs font-semibold text-amber-200">Wycena ograniczona: brak PLN/FX dla części transakcji</div> : null}
                        </td>
                        <td className="p-4 text-right text-white">{p.quantity.toLocaleString('pl-PL', { maximumFractionDigits: 6 })}</td>
                        <td className="p-4 text-right text-slate-400">{PLN2.format(p.avgPrice)}</td>
                        <td className="p-4 text-right">
                          <div className="flex justify-end gap-2">
                            <input value={priceDrafts[p.asset.id] ?? (p.currentPrice ? String(Number(p.currentPrice.toFixed(4))) : '')} onChange={(e) => setPriceDrafts((d) => ({ ...d, [p.asset.id]: e.target.value }))} className="input h-10 w-28 px-3 py-2 text-right" inputMode="decimal" placeholder="PLN" />
                            <button onClick={() => savePrice(p.asset)} className="rounded-xl bg-white/10 px-3 text-slate-200 hover:bg-white/15" title="Zapisz cenę">
                              {savingPrice === p.asset.id ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                            </button>
                          </div>
                        </td>
                        <td className="p-4 text-right text-white">{PLN.format(p.currentValue)}</td>
                        <td className="p-4 text-right text-slate-400">{PLN.format(p.remainingCost)}</td>
                        <td className={`p-4 text-right ${p.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{PLN.format(p.unrealizedPnl)}</td>
                        <td className={`p-4 text-right ${p.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{PLN.format(p.realizedPnl)}</td>
                        <td className="p-4 text-right">
                          <div className="font-semibold text-emerald-300">{income ? PLN.format(income.netBase) : '—'}</div>
                          {income ? <div className="text-xs text-slate-500">{income.count} zdarzeń</div> : null}
                        </td>
                        <td className={`p-4 text-right font-semibold ${p.returnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{PCT.format(p.returnPct)}</td>
                        <td className="p-4 text-right text-slate-400">{PCT.format(p.allocationPct)} / {(p.targetAllocation || 0).toFixed(1)}%</td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Alokacja</h3>
              <TrustBadge>live data</TrustBadge>
            </div>
            <p className="mb-4 text-sm text-slate-500">Udział liczony z aktualnej wartości pozycji.</p>
            <AllocationChart data={allocation} total={summary.totalValue} />
            <div className="space-y-3">
              {positions.filter((p) => p.currentValue > 0).length === 0 ? (
                <div className="rounded-2xl bg-white/[0.03] px-3 py-3 text-sm text-slate-500">Brak aktywnej wyceny. Dodaj transakcję i cenę rynkową albo uruchom backfill.</div>
              ) : positions.filter((p) => p.currentValue > 0).map((p) => (
                <div key={p.asset.id} className="flex items-center justify-between rounded-2xl bg-white/[0.03] px-3 py-2 text-sm">
                  <span className="font-semibold text-white">{p.asset.symbol}</span>
                  <span className="text-slate-400">{PCT.format(p.allocationPct)}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="text-lg font-bold text-white">Następna dopłata</h3>
            <p className="mt-1 text-sm text-slate-500">Prosty rebalancing według największego niedoważenia.</p>
            {summary.rebalance ? (
              <div className="mt-5 rounded-3xl border border-violet-400/20 bg-violet-500/10 p-5">
                <div className="flex items-center gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-500 text-white"><Target size={20} /></div>
                  <div>
                    <p className="text-sm text-slate-400">Sugerowany kierunek</p>
                    <p className="text-2xl font-bold text-white">{summary.rebalance.asset.symbol}</p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-300">Aktualnie {PCT.format(summary.rebalance.allocationPct)}, target {summary.rebalance.targetAllocation.toFixed(1)}%. Brakuje {PCT.format(Math.max(summary.rebalance.allocationDiff, 0))} do celu.</p>
              </div>
            ) : <p className="mt-4 text-sm text-slate-500">Dodaj target alokacji przy aktywach.</p>}
          </Card>
        </div>
      </div>

      <FeatureNote>
        Stage C5.7 upraszcza onboarding instrumentów: katalog podpowiada symbole i waluty, a ręczne aktywa nadal działają bez providera.
      </FeatureNote>
    </Shell>
  )
}
