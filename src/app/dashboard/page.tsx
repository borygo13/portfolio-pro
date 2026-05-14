'use client'

import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, Banknote, CheckCircle2, Database, Landmark, Loader2, RefreshCw, ShieldCheck, Target, TrendingUp, Wallet, Zap } from 'lucide-react'
import { Shell, PageHeader, Card, StatCard, TrustBadge, PillButton } from '@/components/Shell'
import { AllocationChart, AssetHistoryChart, DividendChart, EquityChart } from '@/components/Charts'
import { dividends, tradingStats } from '@/lib/demo-data'
import { PLN, PCT } from '@/lib/format'
import { supabase } from '@/lib/supabase/client'
import {
  getLatestPriceRefreshRun,
  getDefaultPortfolio,
  CHART_RANGES,
  listAssets,
  listAssetPrices,
  listEdoBonds,
  listMarketPriceHistory,
  listPortfolioSnapshots,
  listTransactions,
  type Asset,
  type AssetPrice,
  type ChartRange,
  type EdoBond,
  type MarketPriceHistoryPoint,
  type Portfolio,
  type PortfolioSnapshot,
  type PriceRefreshRun,
  type Transaction,
} from '@/lib/supabase/portfolio'
import { buildPositions, buildSimpleEquityCurve, portfolioSummary, type Position } from '@/lib/position-engine'
import { projectEdoBond, summarizeEdoBonds } from '@/lib/bond-engine'

type AllocationItem = {
  name: string
  value: number
  target: number
  type: string
}

type RebalanceCandidate = {
  symbol: string
  type: string
  currentPct: number
  targetPct: number
  diffPct: number
  suggestedAmount: number
}

type PriceWarning = {
  asset: Asset
  reason: 'missing' | 'stale'
  lastPricedAt?: string | null
}

const chartRangeLabels: Record<ChartRange, string> = {
  '30D': '30D',
  '90D': '90D',
  '1Y': '1Y',
  '3Y': '3Y',
  '5Y': '5Y',
  MAX: 'MAX',
}

function n(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function groupAllocation(positions: Position[], bondsValue: number, bondsTarget: number, totalValue: number): AllocationItem[] {
  const map = new Map<string, AllocationItem>()

  for (const p of positions.filter((item) => item.currentValue > 0)) {
    const key = p.asset.asset_type || 'Inne'
    const current = map.get(key) ?? { name: key, value: 0, target: 0, type: key }
    current.value += p.currentValue
    current.target += n(p.asset.target_allocation)
    map.set(key, current)
  }

  if (bondsValue > 0) {
    const current = map.get('Obligacje EDO') ?? { name: 'Obligacje EDO', value: 0, target: 0, type: 'Obligacje' }
    current.value += bondsValue
    current.target += bondsTarget
    map.set('Obligacje EDO', current)
  }

  return Array.from(map.values()).sort((a, b) => b.value - a.value)
}

function buildRebalanceCandidates(positions: Position[], bondsValue: number, bondsTarget: number, totalValue: number): RebalanceCandidate[] {
  const candidates: RebalanceCandidate[] = positions
    .filter((p) => p.targetAllocation > 0)
    .map((p) => {
      const currentPct = totalValue > 0 ? p.currentValue / totalValue : 0
      const targetPct = p.targetAllocation / 100
      const diffPct = targetPct - currentPct
      return {
        symbol: p.asset.symbol,
        type: p.asset.asset_type,
        currentPct,
        targetPct,
        diffPct,
        suggestedAmount: Math.max(0, diffPct * totalValue),
      }
    })

  if (bondsTarget > 0) {
    const currentPct = totalValue > 0 ? bondsValue / totalValue : 0
    const targetPct = bondsTarget / 100
    const diffPct = targetPct - currentPct
    candidates.push({
      symbol: 'Obligacje EDO',
      type: 'Obligacje',
      currentPct,
      targetPct,
      diffPct,
      suggestedAmount: Math.max(0, diffPct * totalValue),
    })
  }

  return candidates.sort((a, b) => b.diffPct - a.diffPct)
}

function positionStatus(p: Position) {
  if (p.quantity <= 0) return 'Watchlista / target'
  if (p.currentValue <= 0) return 'Brak ceny'
  return 'Aktywna'
}

function isMarketPricedAsset(asset: Asset) {
  const type = (asset.asset_type ?? '').toLowerCase()
  return !type.includes('got') && !type.includes('oblig')
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('pl-PL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function snapshotLabel(snapshotDate: string) {
  const date = new Date(`${snapshotDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return snapshotDate
  return date.toLocaleDateString('pl-PL', { month: 'short', day: '2-digit' })
}

function buildSnapshotEquityCurve(snapshots: PortfolioSnapshot[]) {
  return snapshots.map((snapshot) => {
    const contribution = n(snapshot.contribution) || n(snapshot.invested_cost)
    return {
      date: snapshot.snapshot_date,
      month: snapshotLabel(snapshot.snapshot_date),
      portfolio: n(snapshot.total_value),
      contribution,
      benchmark: contribution,
    }
  })
}

function chartRangeStartDate(range: ChartRange) {
  if (range === 'MAX') return null
  const days = range === '30D' ? 30 : range === '90D' ? 90 : range === '1Y' ? 365 : range === '3Y' ? 365 * 3 : 365 * 5
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function filterByChartRange<T extends { date?: string }>(points: T[], range: ChartRange) {
  const startDate = chartRangeStartDate(range)
  if (!startDate) return points
  return points.filter((point) => !point.date || point.date >= startDate)
}

function buildPriceWarnings(assets: Asset[], prices: AssetPrice[]): PriceWarning[] {
  const priceByAsset = new Map(prices.map((price) => [price.asset_id, price]))
  const staleAfter = Date.now() - 24 * 60 * 60 * 1000
  const warnings: PriceWarning[] = []

  for (const asset of assets.filter(isMarketPricedAsset)) {
    const latestPrice = priceByAsset.get(asset.id)
    if (!latestPrice || n(latestPrice.price) <= 0) {
      warnings.push({ asset, reason: 'missing' })
      continue
    }

    const pricedAt = latestPrice.priced_at ?? latestPrice.updated_at ?? latestPrice.created_at
    const pricedTime = pricedAt ? new Date(pricedAt).getTime() : NaN
    if (Number.isNaN(pricedTime) || pricedTime < staleAfter) {
      warnings.push({ asset, reason: 'stale', lastPricedAt: pricedAt })
    }
  }

  return warnings
}

function buildAssetHistoryCurve(history: MarketPriceHistoryPoint[]) {
  return history.map((point) => ({
    label: snapshotLabel(point.price_date),
    price: point.close_price_base == null ? n(point.close_price) : n(point.close_price_base),
  }))
}

function refreshStatusLabel(status: PriceRefreshRun['status']) {
  if (status === 'partial_success') return 'partial'
  return status
}

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [prices, setPrices] = useState<AssetPrice[]>([])
  const [edoBonds, setEdoBonds] = useState<EdoBond[]>([])
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([])
  const [latestRefreshRun, setLatestRefreshRun] = useState<PriceRefreshRun | null>(null)
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [portfolioRange, setPortfolioRange] = useState<ChartRange>('1Y')
  const [assetHistoryRange, setAssetHistoryRange] = useState<ChartRange>('1Y')
  const [assetHistory, setAssetHistory] = useState<MarketPriceHistoryPoint[]>([])
  const [assetHistoryLoading, setAssetHistoryLoading] = useState(false)
  const [assetHistoryError, setAssetHistoryError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getUser()
      if (!data.user) throw new Error('Brak aktywnej sesji użytkownika.')
      const defaultPortfolio = await getDefaultPortfolio(data.user)
      const [assetList, txList, priceList, bondList, snapshotList, refreshRun] = await Promise.all([
        listAssets(defaultPortfolio.id),
        listTransactions(defaultPortfolio.id),
        listAssetPrices(defaultPortfolio.id),
        listEdoBonds(defaultPortfolio.id),
        listPortfolioSnapshots(defaultPortfolio.id),
        getLatestPriceRefreshRun(defaultPortfolio.id),
      ])
      setPortfolio(defaultPortfolio)
      setAssets(assetList)
      setTransactions(txList)
      setPrices(priceList)
      setEdoBonds(bondList)
      setSnapshots(snapshotList)
      setLatestRefreshRun(refreshRun)
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się pobrać danych dashboardu.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const positions = useMemo(() => buildPositions(assets, transactions, prices), [assets, transactions, prices])
  const activePositions = useMemo(() => positions.filter((p) => p.quantity > 0.00000001), [positions])
  const marketActivePositions = useMemo(() => activePositions.filter((p) => isMarketPricedAsset(p.asset)), [activePositions])
  const watchlistPositions = useMemo(() => positions.filter((p) => p.quantity <= 0.00000001), [positions])
  const summary = useMemo(() => portfolioSummary(positions), [positions])
  const edoProjections = useMemo(() => edoBonds.map((bond) => projectEdoBond(bond)), [edoBonds])
  const edoSummary = useMemo(() => summarizeEdoBonds(edoProjections), [edoProjections])

  const bondsTarget = useMemo(() => {
    const explicitTarget = assets
      .filter((asset) => asset.asset_type === 'Obligacje' || asset.symbol.toUpperCase().includes('EDO'))
      .reduce((sum, asset) => sum + n(asset.target_allocation), 0)
    return explicitTarget > 0 ? explicitTarget : edoBonds.length > 0 ? 25 : 0
  }, [assets, edoBonds.length])

  const totalLongTermValue = summary.totalValue + edoSummary.currentValueAfterTax
  const totalLongTermCost = summary.remainingCost + edoSummary.principal
  const totalLongTermPnl = summary.totalPnl + (edoSummary.currentValueAfterTax - edoSummary.principal)
  const allocation = useMemo(() => groupAllocation(positions, edoSummary.currentValueAfterTax, bondsTarget, totalLongTermValue), [positions, edoSummary.currentValueAfterTax, bondsTarget, totalLongTermValue])
  const rebalance = useMemo(() => buildRebalanceCandidates(positions, edoSummary.currentValueAfterTax, bondsTarget, totalLongTermValue)[0] ?? null, [positions, edoSummary.currentValueAfterTax, bondsTarget, totalLongTermValue])
  const snapshotEquityCurve = useMemo(() => buildSnapshotEquityCurve(snapshots), [snapshots])
  const fallbackEquityCurve = useMemo(() => buildSimpleEquityCurve(transactions, totalLongTermValue), [transactions, totalLongTermValue])
  const equityCurve = snapshotEquityCurve.length > 0 ? filterByChartRange(snapshotEquityCurve, portfolioRange) : fallbackEquityCurve
  const priceWarnings = useMemo(() => buildPriceWarnings(assets, prices), [assets, prices])
  const selectedAsset = useMemo(() => marketActivePositions.find((p) => p.asset.id === selectedAssetId)?.asset ?? null, [marketActivePositions, selectedAssetId])
  const assetHistoryCurve = useMemo(() => buildAssetHistoryCurve(assetHistory), [assetHistory])
  const dividendSum = dividends.reduce((s, d) => s + d.value, 0)
  const bondPnl = edoSummary.currentValueAfterTax - edoSummary.principal

  useEffect(() => {
    setSelectedAssetId((current) => {
      if (current && marketActivePositions.some((position) => position.asset.id === current)) return current
      return marketActivePositions[0]?.asset.id ?? ''
    })
  }, [marketActivePositions])

  useEffect(() => {
    if (!portfolio?.id || !selectedAssetId) {
      setAssetHistory([])
      setAssetHistoryError(null)
      setAssetHistoryLoading(false)
      return
    }

    let cancelled = false
    setAssetHistoryLoading(true)
    setAssetHistoryError(null)

    listMarketPriceHistory(portfolio.id, selectedAssetId, assetHistoryRange)
      .then((history) => {
        if (!cancelled) setAssetHistory(history)
      })
      .catch((err: any) => {
        if (!cancelled) {
          setAssetHistory([])
          setAssetHistoryError(err?.message ?? 'Nie udało się pobrać historii cen aktywa.')
        }
      })
      .finally(() => {
        if (!cancelled) setAssetHistoryLoading(false)
      })

    return () => { cancelled = true }
  }, [portfolio?.id, selectedAssetId, assetHistoryRange])

  return (
    <Shell>
      <PageHeader eyebrow="Stage C3.3 · Portfolio Dashboard Upgrade" title="Dashboard główny" description="Dashboard łączy aktywne pozycje, targety/watchlistę oraz obligacje EDO. Ceny są z Price Engine, a ręczne ceny zostają jako awaryjny override." />

      {error ? <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
      {loading ? <div className="mb-6 flex items-center gap-2 text-sm text-slate-400"><Loader2 className="animate-spin" size={16} /> Ładowanie danych z Supabase...</div> : null}

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <StatCard icon={Wallet} label="Całość majątku" value={PLN.format(totalLongTermValue)} sub={`${activePositions.length} aktywnych pozycji + EDO`} />
        <StatCard icon={Target} label="Wkład / koszt" value={PLN.format(totalLongTermCost)} sub={`${PLN.format(totalLongTermPnl)} P/L long-term`} tone={totalLongTermPnl >= 0 ? 'emerald' : 'red'} />
        <StatCard icon={Landmark} label="Obligacje EDO" value={PLN.format(edoSummary.currentValueAfterTax)} sub={`${PLN.format(bondPnl)} zysku po szac. podatku`} tone={bondPnl >= 0 ? 'emerald' : 'red'} />
        <StatCard icon={ShieldCheck} label="Portfolio" value={portfolio?.name ?? '—'} sub="Supabase live data" tone="violet" />
      </div>

      <div className="mt-6 grid gap-4 2xl:grid-cols-[.95fr_1.05fr]">
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-400"><RefreshCw size={16} /> Ostatni refresh cen</div>
              <p className="mt-3 text-2xl font-bold text-white">{latestRefreshRun ? formatDateTime(latestRefreshRun.finished_at ?? latestRefreshRun.started_at) : 'Brak refreshu'}</p>
              <p className="mt-2 text-sm text-slate-500">{latestRefreshRun ? `${latestRefreshRun.trigger_type} · ${refreshStatusLabel(latestRefreshRun.status)}` : 'Uruchom manualny refresh, żeby wypełnić historię cen.'}</p>
            </div>
            {latestRefreshRun ? (
              <span className="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">{latestRefreshRun.status}</span>
            ) : null}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-2xl bg-white/[0.04] p-3"><p className="text-xs text-slate-500">Żądane</p><p className="mt-1 font-bold text-white">{latestRefreshRun?.requested_assets ?? 0}</p></div>
            <div className="rounded-2xl bg-emerald-500/10 p-3"><p className="text-xs text-emerald-200/70">Odświeżone</p><p className="mt-1 font-bold text-emerald-200">{latestRefreshRun?.refreshed_assets ?? 0}</p></div>
            <div className="rounded-2xl bg-rose-500/10 p-3"><p className="text-xs text-rose-200/70">Błędy</p><p className="mt-1 font-bold text-rose-200">{latestRefreshRun?.failed_assets ?? 0}</p></div>
          </div>
        </Card>

        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-400">
                {priceWarnings.length > 0 ? <AlertTriangle size={16} className="text-amber-300" /> : <CheckCircle2 size={16} className="text-emerald-300" />}
                Aktualność cen
              </div>
              <p className="mt-3 text-2xl font-bold text-white">{priceWarnings.length > 0 ? `${priceWarnings.length} do sprawdzenia` : 'Ceny aktualne'}</p>
              <p className="mt-2 text-sm text-slate-500">Sprawdzamy aktywa rynkowe bez ceny albo z ceną starszą niż 24h.</p>
            </div>
          </div>
          <div className="mt-5 space-y-2">
            {priceWarnings.length === 0 ? (
              <div className="rounded-2xl bg-emerald-500/10 p-3 text-sm text-emerald-100">Brak brakujących lub przestarzałych cen w aktywach rynkowych.</div>
            ) : priceWarnings.slice(0, 5).map((warning) => (
              <div key={`${warning.asset.id}-${warning.reason}`} className="flex items-center justify-between gap-3 rounded-2xl bg-amber-500/10 p-3 text-sm">
                <div>
                  <p className="font-semibold text-amber-100">{warning.asset.symbol}</p>
                  <p className="text-xs text-amber-100/60">{warning.reason === 'missing' ? 'Brak latest price' : `Ostatnia cena: ${formatDateTime(warning.lastPricedAt)}`}</p>
                </div>
                <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-100">{warning.reason === 'missing' ? 'missing' : 'stale'}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 2xl:grid-cols-[1.45fr_.7fr]">
        <Card>
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-lg font-bold text-white">Portfel vs wkład</h3>
              <p className="mt-1 text-sm text-slate-500">Krzywa używa dziennych snapshotów portfolio, a przy ich braku wraca do prostego modelu z transakcji.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {CHART_RANGES.map((range) => (
                <PillButton key={range} type="button" active={portfolioRange === range} onClick={() => setPortfolioRange(range)}>
                  {chartRangeLabels[range]}
                </PillButton>
              ))}
            </div>
          </div>
          <div className="mb-4 flex flex-wrap gap-4 text-xs text-slate-400">
            <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-violet-500" />Portfel</span>
            <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-slate-400" />Wkład</span>
            <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-cyan-400" />Benchmark placeholder</span>
          </div>
          <EquityChart data={equityCurve} />
        </Card>

        <Card>
          <h3 className="text-lg font-bold text-white">Alokacja majątku</h3>
          <p className="mt-1 text-sm text-slate-500">Aktywne pozycje + obligacje EDO, pogrupowane po typach aktywów.</p>
          <AllocationChart data={allocation.map((item) => ({ name: item.name, value: item.value }))} total={totalLongTermValue} />
          <div className="space-y-3">
            {allocation.length === 0 ? <div className="text-sm text-slate-500">Brak aktywnej alokacji. Dodaj transakcję albo obligację EDO.</div> : allocation.map((item) => (
              <div key={item.name} className="flex items-center justify-between text-sm">
                <span className="text-slate-300">{item.name}</span>
                <span className="text-slate-500">{PCT.format(totalLongTermValue > 0 ? item.value / totalLongTermValue : 0)} / {item.target.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">Historia aktywa</h3>
            <p className="mt-1 text-sm text-slate-500">Dzienna historia z `market_prices` dla wybranego aktywnego aktywa.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="min-w-[220px] rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-cyan-300/60"
              value={selectedAssetId}
              onChange={(event) => setSelectedAssetId(event.target.value)}
              disabled={marketActivePositions.length === 0}
            >
              {marketActivePositions.length === 0 ? <option value="">Brak aktywnych aktywów</option> : marketActivePositions.map((position) => (
                <option key={position.asset.id} value={position.asset.id}>{position.asset.symbol} · {position.asset.name}</option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              {CHART_RANGES.map((range) => (
                <PillButton key={range} type="button" active={assetHistoryRange === range} onClick={() => setAssetHistoryRange(range)}>
                  {chartRangeLabels[range]}
                </PillButton>
              ))}
            </div>
          </div>
        </div>
        {marketActivePositions.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-500">Brak aktywnych aktywów rynkowych do pokazania historii.</div>
        ) : assetHistoryLoading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400"><Loader2 className="animate-spin" size={16} /> Ładowanie historii cen...</div>
        ) : assetHistoryError ? (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-6 text-sm text-rose-100">{assetHistoryError}</div>
        ) : assetHistoryCurve.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-500">{selectedAsset ? `Brak historii market_prices dla ${selectedAsset.symbol}.` : 'Brak historii cen.'}</div>
        ) : (
          <AssetHistoryChart data={assetHistoryCurve} />
        )}
      </Card>

      <div className="mt-6 grid gap-6 2xl:grid-cols-[.75fr_1.25fr]">
        <Card>
          <h3 className="text-lg font-bold text-white">Dywidendy miesięczne</h3>
          <p className="mt-1 text-sm text-slate-500">Jeszcze demo. Prawdziwe dywidendy dodamy w osobnym etapie.</p>
          <DividendChart data={dividends} />
        </Card>

        <Card>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white">Aktywne pozycje</h3>
              <p className="mt-1 text-sm text-slate-500">Pokazujemy tylko aktywa z ilością większą od zera. Targety bez zakupu są niżej jako watchlista.</p>
            </div>
            <TrustBadge>Live data</TrustBadge>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.04] text-slate-500">
                <tr><th className="p-4 text-left">Nazwa</th><th className="p-4 text-left">Typ</th><th className="p-4 text-right">Ilość</th><th className="p-4 text-right">Wartość</th><th className="p-4 text-right">Koszt</th><th className="p-4 text-right">P/L</th><th className="p-4 text-right">Status</th></tr>
              </thead>
              <tbody>
                {activePositions.length === 0 && edoBonds.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-slate-500">Brak aktywnych pozycji. Dodaj transakcję albo obligację EDO.</td></tr>
                ) : <>
                  {activePositions.map((p) => (
                    <tr key={p.asset.id} className="border-t border-white/10 text-slate-300 transition hover:bg-white/[0.03]">
                      <td className="p-4"><div className="font-semibold text-white">{p.asset.symbol}</div><div className="text-xs text-slate-500">{p.asset.name}</div></td>
                      <td className="p-4 text-slate-400">{p.asset.asset_type}</td>
                      <td className="p-4 text-right text-slate-300">{p.quantity.toLocaleString('pl-PL', { maximumFractionDigits: 6 })}</td>
                      <td className="p-4 text-right text-white">{PLN.format(p.currentValue)}</td>
                      <td className="p-4 text-right text-slate-400">{PLN.format(p.remainingCost)}</td>
                      <td className={`p-4 text-right ${p.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{PLN.format(p.totalPnl)}</td>
                      <td className="p-4 text-right"><span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">{positionStatus(p)}</span></td>
                    </tr>
                  ))}
                  {edoSummary.currentValueAfterTax > 0 ? (
                    <tr className="border-t border-white/10 text-slate-300 transition hover:bg-white/[0.03]">
                      <td className="p-4"><div className="font-semibold text-white">Obligacje EDO</div><div className="text-xs text-slate-500">{edoBonds.length} seria(e), wycena szacunkowa</div></td>
                      <td className="p-4 text-slate-400">Obligacje</td>
                      <td className="p-4 text-right text-slate-300">{edoBonds.reduce((sum, b) => sum + n(b.quantity), 0).toLocaleString('pl-PL')}</td>
                      <td className="p-4 text-right text-white">{PLN.format(edoSummary.currentValueAfterTax)}</td>
                      <td className="p-4 text-right text-slate-400">{PLN.format(edoSummary.principal)}</td>
                      <td className={`p-4 text-right ${bondPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{PLN.format(bondPnl)}</td>
                      <td className="p-4 text-right"><span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-300">Aktywna · EDO</span></td>
                    </tr>
                  ) : null}
                </>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 2xl:grid-cols-[1.1fr_.9fr]">
        <Card>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white">Watchlista / targety</h3>
              <p className="mt-1 text-sm text-slate-500">Aktywa dodane w Pozycjach, ale bez zakupu. Nie wpływają na wartość portfela, ale pomagają w planowaniu.</p>
            </div>
            <span className="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-slate-400">{watchlistPositions.length} pozycji</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {watchlistPositions.length === 0 ? <div className="text-sm text-slate-500">Brak watchlisty. Wszystkie dodane aktywa mają już transakcje.</div> : watchlistPositions.map((p) => (
              <div key={p.asset.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{p.asset.symbol}</p>
                    <p className="mt-1 text-xs text-slate-500">{p.asset.name}</p>
                  </div>
                  <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-semibold text-violet-300">{n(p.asset.target_allocation).toFixed(1)}%</span>
                </div>
                <p className="mt-3 text-xs text-slate-500">Status: target bez transakcji</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h3 className="text-lg font-bold text-white">Najbliższa dopłata</h3>
          <p className="mt-1 text-sm text-slate-500">Prosty rebalancing według największego niedoważenia. Uwzględnia też EDO.</p>
          <div className="mt-5 rounded-3xl border border-violet-400/20 bg-violet-500/10 p-5">
            {rebalance ? (
              <div className="flex items-start gap-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-500 text-white"><Zap size={22} /></div>
                <div>
                  <p className="text-sm text-slate-400">Sugerowany kierunek</p>
                  <p className="mt-1 text-2xl font-bold text-white">{rebalance.symbol}</p>
                  <p className="mt-2 text-sm text-amber-100">Aktualnie {PCT.format(rebalance.currentPct)}, target {PCT.format(rebalance.targetPct)}. Brakuje {PCT.format(Math.max(rebalance.diffPct, 0))} do celu.</p>
                  <p className="mt-1 text-sm text-slate-400">Szacowana kwota do wyrównania: {PLN.format(rebalance.suggestedAmount)}</p>
                </div>
              </div>
            ) : <p className="text-sm text-slate-500">Dodaj targety alokacji w Pozycjach lub EDO.</p>}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <Card><div className="flex items-center gap-3"><TrendingUp className="text-emerald-400" /><div><p className="text-sm text-slate-500">CFD net P/L</p><p className="text-2xl font-bold text-white">{PLN.format(tradingStats.netPnl)}</p></div></div></Card>
        <Card><div className="flex items-center gap-3"><Activity className="text-cyan-400" /><div><p className="text-sm text-slate-500">Winrate</p><p className="text-2xl font-bold text-white">{PCT.format(tradingStats.wins / tradingStats.trades)}</p></div></div></Card>
        <Card><div className="flex items-center gap-3"><Database className="text-violet-300" /><div><p className="text-sm text-slate-500">Long-term P/L</p><p className="text-2xl font-bold text-white">{PLN.format(totalLongTermPnl)}</p></div></div></Card>
        <Card><div className="flex items-center gap-3"><Banknote className="text-amber-300" /><div><p className="text-sm text-slate-500">Dywidendy YTD</p><p className="text-2xl font-bold text-white">{PLN.format(dividendSum)}</p></div></div></Card>
      </div>
    </Shell>
  )
}
