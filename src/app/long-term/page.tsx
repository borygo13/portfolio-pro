'use client'

import { useEffect, useMemo, useState } from 'react'
import { Database, Loader2, Plus, RefreshCw, Save, Target, Trash2, TrendingUp, Wallet, X, Zap } from 'lucide-react'
import { Shell, PageHeader, Card, StatCard, TrustBadge, FeatureNote } from '@/components/Shell'
import { AllocationChart } from '@/components/Charts'
import { PLN, PLN2, PCT } from '@/lib/format'
import { supabase } from '@/lib/supabase/client'
import {
  createAsset,
  deleteAsset,
  getDefaultPortfolio,
  listAssets,
  listAssetPrices,
  listTransactions,
  updateAsset,
  upsertAssetPrice,
  type Asset,
  type AssetPrice,
  type AssetType,
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
}

const emptyAssetForm: AssetForm = {
  symbol: '',
  name: '',
  asset_type: 'ETF',
  currency: 'PLN',
  target_allocation: '0',
}

const assetTypes: AssetType[] = ['ETF', 'Akcje', 'Obligacje', 'Gotówka', 'Crypto', 'CFD', 'Inne']
const currencies = ['PLN', 'EUR', 'USD', 'GBP', 'CHF']

function toNumber(value: string) {
  return Number(String(value || '0').replace(',', '.'))
}

export default function LongTermPage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [prices, setPrices] = useState<AssetPrice[]>([])
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

  const positions = useMemo(() => buildPositions(assets, transactions, prices), [assets, transactions, prices])
  const summary = useMemo(() => portfolioSummary(positions), [positions])
  const allocation = positions.filter((p) => p.currentValue > 0).map((p) => ({ name: p.asset.symbol, value: p.currentValue }))

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getUser()
      if (!data.user) throw new Error('Brak aktywnej sesji użytkownika.')
      const defaultPortfolio = await getDefaultPortfolio(data.user)
      const [assetList, txList, priceList] = await Promise.all([
        listAssets(defaultPortfolio.id),
        listTransactions(defaultPortfolio.id),
        listAssetPrices(defaultPortfolio.id),
      ])
      setPortfolio(defaultPortfolio)
      setAssets(assetList)
      setTransactions(txList)
      setPrices(priceList)
      setPriceDrafts(Object.fromEntries(priceList.map((p) => [p.asset_id, String(p.price)])))
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
  }

  function startEdit(asset: Asset) {
    setAssetForm({
      symbol: asset.symbol ?? '',
      name: asset.name ?? '',
      asset_type: (asset.asset_type as AssetType) ?? 'ETF',
      currency: asset.currency ?? 'PLN',
      target_allocation: String(asset.target_allocation ?? 0),
    })
    setEditingAssetId(asset.id)
    setShowAssetForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveAsset() {
    if (!portfolio) return
    setSavingAsset(true)
    setError(null)
    setSuccess(null)
    try {
      const target = toNumber(assetForm.target_allocation)
      if (!assetForm.symbol.trim()) throw new Error('Symbol jest wymagany.')
      if (!assetForm.name.trim()) throw new Error('Nazwa aktywa jest wymagana.')
      if (!Number.isFinite(target) || target < 0 || target > 100) throw new Error('Target alokacji musi być od 0 do 100%.')

      const payload = {
        symbol: assetForm.symbol,
        name: assetForm.name,
        asset_type: assetForm.asset_type,
        currency: assetForm.currency,
        target_allocation: target,
      }

      if (editingAssetId) {
        const updated = await updateAsset(editingAssetId, payload)
        setAssets((current) => current.map((asset) => asset.id === updated.id ? updated : asset))
        setSuccess(`Zaktualizowano ${updated.symbol}.`)
      } else {
        const created = await createAsset(portfolio.id, payload)
        setAssets((current) => [created, ...current])
        setSuccess(`Dodano ${created.symbol}.`)
      }
      setAssetForm(emptyAssetForm)
      setEditingAssetId(null)
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
      const saved = await upsertAssetPrice(portfolio.id, asset.id, price, asset.currency ?? portfolio.currency ?? 'PLN')
      setPrices((current) => [saved, ...current.filter((p) => p.asset_id !== asset.id)])
      setSuccess(`Cena ${asset.symbol} zapisana.`)
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
        eyebrow="Stage C3.2 · Asset Management Fix"
        title="Pozycje long-term"
        description="Zarządzanie aktywami wróciło do widoku pozycji: dodawanie, edycja, usuwanie, auto ceny i silnik pozycji w jednym miejscu."
      />

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <StatCard icon={Wallet} label="Wartość pozycji" value={PLN.format(summary.totalValue)} sub={`${summary.openPositions} aktywnych pozycji`} tone="cyan" />
        <StatCard icon={Database} label="Koszt otwarty" value={PLN.format(summary.remainingCost)} sub={`Wpłacone w pozycje: ${PLN.format(summary.investedCost)}`} />
        <StatCard icon={TrendingUp} label="P/L łączny" value={PLN.format(summary.totalPnl)} sub={`${PCT.format(summary.returnPct)} względem kosztu`} tone={summary.totalPnl >= 0 ? 'emerald' : 'red'} />
        <StatCard icon={Target} label="Rebalancing" value={summary.rebalance?.asset.symbol ?? '—'} sub={summary.rebalance ? `Brakuje ${PCT.format(Math.max(summary.rebalance.allocationDiff, 0))}` : 'dodaj targety'} tone="violet" />
      </div>

      {error ? <div className="mt-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
      {success ? <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">{success}</div> : null}

      <div className="mt-6 grid gap-6 2xl:grid-cols-[1.4fr_.7fr]">
        <div className="space-y-6">
          <Card>
            <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Aktywa</h3>
                <p className="mt-1 text-sm text-slate-500">Dodawaj aktywa ręcznie. Opcję PRO z autocomplete/tickerami zrobimy później jako osobny upgrade.</p>
              </div>
              <button onClick={resetAssetForm} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400">
                <Plus size={16} /> Dodaj aktywo
              </button>
            </div>

            {showAssetForm ? (
              <div className="mb-5 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h4 className="font-bold text-white">{editingAssetId ? 'Edytuj aktywo' : 'Nowe aktywo'}</h4>
                  <button onClick={() => { setShowAssetForm(false); setEditingAssetId(null); setAssetForm(emptyAssetForm) }} className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white">
                    <X size={16} />
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Symbol</span>
                    <input value={assetForm.symbol} onChange={(e) => setAssetForm((f) => ({ ...f, symbol: e.target.value }))} className="input w-full px-4 py-3" placeholder="np. iusq.de" />
                  </label>
                  <label className="space-y-2 xl:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nazwa</span>
                    <input value={assetForm.name} onChange={(e) => setAssetForm((f) => ({ ...f, name: e.target.value }))} className="input w-full px-4 py-3" placeholder="np. iShares MSCI ACWI UCITS ETF" />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Typ</span>
                    <select value={assetForm.asset_type} onChange={(e) => setAssetForm((f) => ({ ...f, asset_type: e.target.value as AssetType }))} className="input w-full px-4 py-3">
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
                        <td className="p-4"><div className="font-semibold text-white">{asset.symbol}</div><div className="text-xs text-slate-500">{asset.name}</div></td>
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
                <p className="mt-1 text-sm text-slate-500">Pozycje liczone są z transakcji. Auto ceny pobiera rynek, ręczna cena zostaje jako awaryjna korekta.</p>
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
                      <th className="p-4 text-right">Śr. cena</th>
                      <th className="p-4 text-right">Cena teraz</th>
                      <th className="p-4 text-right">Wartość</th>
                      <th className="p-4 text-right">Koszt</th>
                      <th className="p-4 text-right">P/L unreal.</th>
                      <th className="p-4 text-right">P/L real.</th>
                      <th className="p-4 text-right">Zwrot</th>
                      <th className="p-4 text-right">Udział / target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => (
                      <tr key={p.asset.id} className="border-t border-white/10 text-slate-300 transition hover:bg-white/[0.03]">
                        <td className="p-4">
                          <div className="font-semibold text-white">{p.asset.symbol}</div>
                          <div className="text-xs text-slate-500">{p.asset.name} · {p.asset.asset_type}</div>
                        </td>
                        <td className="p-4 text-right text-white">{p.quantity.toLocaleString('pl-PL', { maximumFractionDigits: 6 })}</td>
                        <td className="p-4 text-right text-slate-400">{PLN2.format(p.avgPrice)}</td>
                        <td className="p-4 text-right">
                          <div className="flex justify-end gap-2">
                            <input value={priceDrafts[p.asset.id] ?? (p.currentPrice ? String(Number(p.currentPrice.toFixed(4))) : '')} onChange={(e) => setPriceDrafts((d) => ({ ...d, [p.asset.id]: e.target.value }))} className="input h-10 w-28 px-3 py-2 text-right" inputMode="decimal" placeholder="cena" />
                            <button onClick={() => savePrice(p.asset)} className="rounded-xl bg-white/10 px-3 text-slate-200 hover:bg-white/15" title="Zapisz cenę">
                              {savingPrice === p.asset.id ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                            </button>
                          </div>
                        </td>
                        <td className="p-4 text-right text-white">{PLN.format(p.currentValue)}</td>
                        <td className="p-4 text-right text-slate-400">{PLN.format(p.remainingCost)}</td>
                        <td className={`p-4 text-right ${p.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{PLN.format(p.unrealizedPnl)}</td>
                        <td className={`p-4 text-right ${p.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{PLN.format(p.realizedPnl)}</td>
                        <td className={`p-4 text-right font-semibold ${p.returnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{PCT.format(p.returnPct)}</td>
                        <td className="p-4 text-right text-slate-400">{PCT.format(p.allocationPct)} / {(p.targetAllocation || 0).toFixed(1)}%</td>
                      </tr>
                    ))}
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
              {positions.filter((p) => p.currentValue > 0).map((p) => (
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
        Stage C3.2 łączy Asset Management z Position Engine. Możesz dodawać, edytować i usuwać aktywa, a tabela pozycji dalej liczy ilość, koszt, P/L i alokację z transakcji.
      </FeatureNote>
    </Shell>
  )
}
