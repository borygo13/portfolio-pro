'use client'

import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, InputHTMLAttributes, ReactNode } from 'react'
import { Banknote, BarChart3, Landmark, Loader2, Percent, PieChart, Plus, Scale, Trash2, TrendingUp, Wallet } from 'lucide-react'
import { BenchmarkComparisonChart, MonthlyDividendChart, MonthlyReturnsChart } from '@/components/Charts'
import { Card, PageHeader, Shell, StatCard, TrustBadge } from '@/components/Shell'
import { projectEdoBond, summarizeEdoBonds } from '@/lib/bond-engine'
import { PLN, PCT } from '@/lib/format'
import {
  buildAllocationDrift,
  buildBenchmarkComparison,
  buildMonthlyDividendPoints,
  buildMonthlyReturnPoints,
  calculatePerformanceMetrics,
  isMarketPricedAsset,
  num,
  summarizeCashLedger,
  summarizeDividends,
} from '@/lib/portfolio-intelligence'
import { buildPositions, portfolioSummary } from '@/lib/position-engine'
import { supabase } from '@/lib/supabase/client'
import {
  createCashLedgerEntry,
  createDividend,
  deleteCashLedgerEntry,
  deleteDividend,
  getDefaultPortfolio,
  getPortfolioBenchmark,
  listAssets,
  listAssetPrices,
  listCashLedgerEntries,
  listDividends,
  listEdoBonds,
  listMarketPriceHistory,
  listPortfolioSnapshots,
  listTransactions,
  upsertPortfolioBenchmark,
  type Asset,
  type AssetPrice,
  type CashLedgerEntry,
  type CashLedgerEntryType,
  type DividendRecord,
  type EdoBond,
  type MarketPriceHistoryPoint,
  type Portfolio,
  type PortfolioBenchmark,
  type PortfolioSnapshot,
  type SupportedCashCurrency,
  type Transaction,
} from '@/lib/supabase/portfolio'

type TabId = 'overview' | 'cash' | 'dividends' | 'benchmark' | 'allocation'

const tabs: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'cash', label: 'Cash' },
  { id: 'dividends', label: 'Dividends' },
  { id: 'benchmark', label: 'Benchmark' },
  { id: 'allocation', label: 'Allocation' },
]

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

function directionLabel(value: string) {
  if (value === 'buy') return 'Dokup'
  if (value === 'trim') return 'Redukuj'
  return 'Trzymaj'
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
  const [benchmark, setBenchmark] = useState<PortfolioBenchmark | null>(null)
  const [benchmarkAssetId, setBenchmarkAssetId] = useState('')
  const [benchmarkHistory, setBenchmarkHistory] = useState<MarketPriceHistoryPoint[]>([])
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
    received_date: today(),
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
      ] = await Promise.all([
        listAssets(defaultPortfolio.id),
        listTransactions(defaultPortfolio.id),
        listAssetPrices(defaultPortfolio.id),
        listEdoBonds(defaultPortfolio.id),
        listPortfolioSnapshots(defaultPortfolio.id),
        listCashLedgerEntries(defaultPortfolio.id),
        listDividends(defaultPortfolio.id),
        getPortfolioBenchmark(defaultPortfolio.id),
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
      setBenchmark(benchmarkRow)
      setBenchmarkAssetId(benchmarkRow?.benchmark_asset_id ?? '')
      setCashForm((current) => ({ ...current, currency: baseCurrency }))
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
    listMarketPriceHistory(portfolio.id, benchmarkAssetId)
      .then((history) => {
        if (!cancelled) setBenchmarkHistory(history)
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? 'Nie udało się pobrać historii benchmarku.')
      })

    return () => { cancelled = true }
  }, [portfolio?.id, benchmarkAssetId])

  const baseCurrency = asCurrency(portfolio?.currency)
  const positions = useMemo(() => buildPositions(assets, transactions, prices), [assets, transactions, prices])
  const activePositions = useMemo(() => positions.filter((position) => position.quantity > 0.00000001), [positions])
  const marketAssets = useMemo(() => assets.filter(isMarketPricedAsset), [assets])
  const summary = useMemo(() => portfolioSummary(positions), [positions])
  const edoSummary = useMemo(() => summarizeEdoBonds(edoBonds.map((bond) => projectEdoBond(bond))), [edoBonds])
  const cashSummary = useMemo(() => summarizeCashLedger(cashEntries, baseCurrency), [cashEntries, baseCurrency])
  const dividendSummary = useMemo(() => summarizeDividends(dividendRecords, baseCurrency), [dividendRecords, baseCurrency])
  const monthlyDividends = useMemo(() => buildMonthlyDividendPoints(dividendRecords, baseCurrency), [dividendRecords, baseCurrency])
  const monthlyReturns = useMemo(() => buildMonthlyReturnPoints(snapshots), [snapshots])
  const bondsTarget = useMemo(() => {
    const explicitTarget = assets
      .filter((asset) => asset.asset_type === 'Obligacje' || asset.symbol.toUpperCase().includes('EDO'))
      .reduce((sum, asset) => sum + num(asset.target_allocation), 0)
    return explicitTarget > 0 ? explicitTarget : edoBonds.length > 0 ? 25 : 0
  }, [assets, edoBonds.length])

  const transactionFees = transactions.reduce((sum, transaction) => sum + num(transaction.fees), 0)
  const bondPnl = edoSummary.currentValueAfterTax - edoSummary.principal
  const totalValue = summary.totalValue + edoSummary.currentValueAfterTax + cashSummary.cashBalanceBase
  const totalCost = summary.remainingCost + edoSummary.principal
  const realizedPnl = summary.realizedPnl + dividendSummary.netBase - transactionFees - cashSummary.feesBase - cashSummary.taxesBase
  const unrealizedPnl = summary.unrealizedPnl + bondPnl
  const feesAndTaxes = transactionFees + cashSummary.feesBase + cashSummary.taxesBase + dividendSummary.taxBase
  const performance = useMemo(() => calculatePerformanceMetrics({
    snapshots,
    currentValue: totalValue,
    contribution: cashSummary.contributionBase,
    fallbackCost: totalCost,
    realizedPnl,
    unrealizedPnl,
  }), [snapshots, totalValue, cashSummary.contributionBase, totalCost, realizedPnl, unrealizedPnl])
  const benchmarkComparison = useMemo(() => buildBenchmarkComparison(snapshots, benchmarkHistory), [snapshots, benchmarkHistory])
  const allocationDrift = useMemo(() => buildAllocationDrift(positions, edoSummary.currentValueAfterTax, bondsTarget, cashSummary.cashBalanceBase, totalValue), [positions, edoSummary.currentValueAfterTax, bondsTarget, cashSummary.cashBalanceBase, totalValue])
  const selectedBenchmark = assets.find((asset) => asset.id === benchmarkAssetId) ?? null

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
    if (!dividendForm.asset_id || !Number.isFinite(gross) || gross <= 0 || tax < 0) {
      setError('Uzupełnij aktywo oraz dodatnią kwotę brutto dywidendy.')
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
        description="Cash ledger, dywidendy, proste metryki performance, benchmark i drift alokacji. Metryki są bazowe/estymowane, dopóki nie wdrożymy pełnego TWR/MWR."
      />

      {error ? <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
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
            <StatCard icon={TrendingUp} label="Total return" value={PLN.format(performance.totalReturnAmount)} sub={formatPct(performance.totalReturnPct)} tone={performance.totalReturnAmount >= 0 ? 'emerald' : 'red'} />
            <StatCard icon={Banknote} label="Realized P/L" value={PLN.format(performance.realizedPnl)} sub="sprzedaże + dywidendy netto - koszty" tone={performance.realizedPnl >= 0 ? 'emerald' : 'red'} />
            <StatCard icon={PieChart} label="Unrealized P/L" value={PLN.format(performance.unrealizedPnl)} sub="pozycje + EDO" tone={performance.unrealizedPnl >= 0 ? 'emerald' : 'red'} />
            <StatCard icon={Wallet} label="Contribution" value={PLN.format(performance.contribution)} sub={`ledger ${baseCurrency}`} tone="violet" />
          </div>

          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
            <StatCard icon={Percent} label="Monthly return" value={formatPct(performance.monthlyReturnPct)} sub="estimate z snapshots" tone={(performance.monthlyReturnPct ?? 0) >= 0 ? 'emerald' : 'red'} />
            <StatCard icon={BarChart3} label="YTD return" value={formatPct(performance.ytdReturnPct)} sub="estimate z snapshots" tone={(performance.ytdReturnPct ?? 0) >= 0 ? 'emerald' : 'red'} />
            <StatCard icon={Scale} label="Max drawdown" value={formatPct(performance.maxDrawdownPct)} sub={snapshots.length >= 2 ? 'z portfolio_snapshots' : 'potrzeba historii'} tone="red" />
            <StatCard icon={Landmark} label="Fees / taxes" value={PLN.format(feesAndTaxes)} sub="fees transakcyjne + tax ledger" tone="cyan" />
          </div>

          <div className="grid gap-6 2xl:grid-cols-[1fr_1fr]">
            <Card>
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-white">Monthly returns</h3>
                  <p className="mt-1 text-sm text-slate-500">Prosty zwrot m/m z `portfolio_snapshots`, korygowany o zmianę contribution.</p>
                </div>
                <TrustBadge>Estimated</TrustBadge>
              </div>
              {monthlyReturns.length > 0 ? <MonthlyReturnsChart data={monthlyReturns} /> : <EmptyState text="Brak snapshotów do policzenia monthly returns." />}
              {monthlyReturns.length > 0 ? <MonthlyReturnsTable rows={monthlyReturns} /> : null}
            </Card>

            <Card>
              <div className="mb-5">
                <h3 className="text-lg font-bold text-white">Portfolio vs benchmark</h3>
                <p className="mt-1 text-sm text-slate-500">Indeks 100 = pierwszy wspólny punkt historii.</p>
              </div>
              {benchmarkComparison.length > 0 ? <BenchmarkComparisonChart data={benchmarkComparison} /> : <EmptyState text="Wybierz benchmark i upewnij się, że ma historię w market_prices." />}
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
                  <Input type="date" value={dividendForm.received_date} onChange={(value) => setDividendForm((current) => ({ ...current, received_date: value }))} />
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
          </Card>
          <Card>
            <h3 className="text-lg font-bold text-white">Portfolio vs benchmark</h3>
            <p className="mt-1 text-sm text-slate-500">Porównanie bazowane do 100 na pierwszym wspólnym punkcie.</p>
            {benchmarkComparison.length > 0 ? <BenchmarkComparisonChart data={benchmarkComparison} /> : <EmptyState text="Potrzeba portfolio_snapshots oraz historii market_prices dla benchmarku." />}
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
            <h3 className="text-lg font-bold text-white">Snapshot readiness</h3>
            <p className="mt-1 text-sm text-slate-500">Historia alokacji zacznie się wypełniać w nowych snapshotach po migracji C5.</p>
            <div className="mt-5 space-y-3">
              <InfoLine label="Snapshots" value={String(snapshots.length)} />
              <InfoLine label="Latest contribution" value={PLN.format(num(snapshots[snapshots.length - 1]?.contribution))} />
              <InfoLine label="Current cash" value={PLN.format(cashSummary.cashBalanceBase)} />
              <InfoLine label="Active positions" value={String(activePositions.length)} />
            </div>
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

function Select({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-violet-300/60">{children}</select>
}

function SubmitButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return <button disabled={disabled} className="inline-flex items-center gap-2 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50">{children}</button>
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
              <td className="p-4">{formatDate(row.received_date)}</td>
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

function MonthlyReturnsTable({ rows }: { rows: { month: string; startValue: number; endValue: number; cashFlow: number; returnPct: number }[] }) {
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
      <table className="w-full text-sm">
        <thead className="bg-white/[0.04] text-slate-500">
          <tr><th className="p-3 text-left">Month</th><th className="p-3 text-right">Start</th><th className="p-3 text-right">End</th><th className="p-3 text-right">Flow</th><th className="p-3 text-right">Return</th></tr>
        </thead>
        <tbody>
          {rows.slice(-6).map((row) => (
            <tr key={row.month} className="border-t border-white/10 text-slate-300">
              <td className="p-3">{row.month}</td>
              <td className="p-3 text-right">{PLN.format(row.startValue)}</td>
              <td className="p-3 text-right">{PLN.format(row.endValue)}</td>
              <td className="p-3 text-right">{PLN.format(row.cashFlow)}</td>
              <td className={`p-3 text-right font-semibold ${row.returnPct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{PCT.format(row.returnPct)}</td>
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

function InfoLine({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 text-sm"><span className="text-slate-500">{label}</span><span className="font-semibold text-white">{value}</span></div>
}
