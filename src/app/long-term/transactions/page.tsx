'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, CalendarDays, Database, Loader2, Plus, RefreshCw, Trash2, Wallet } from 'lucide-react'
import { Shell, PageHeader, Card, StatCard, TrustBadge } from '@/components/Shell'
import { PLN } from '@/lib/format'
import { supabase } from '@/lib/supabase/client'
import {
  createTransaction,
  deleteTransaction,
  getDefaultPortfolio,
  listAssets,
  listTransactions,
  type Asset,
  type Portfolio,
  type Transaction,
  type TransactionType,
} from '@/lib/supabase/portfolio'

type PositionRow = {
  assetId: string
  symbol: string
  name: string
  type: string
  currency: string
  quantity: number
  cost: number
  avgPrice: number
}

function toNumber(value: string) {
  return Number(value.replace(',', '.'))
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function getAssetQuantity(assetId: string, transactions: Transaction[]) {
  return transactions
    .filter((tx) => tx.asset_id === assetId)
    .reduce((sum, tx) => {
      const qty = Number(tx.quantity)
      return tx.transaction_type === 'BUY' ? sum + qty : sum - qty
    }, 0)
}

function formatQuantity(value: number) {
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

export default function TransactionsPage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [assetId, setAssetId] = useState('')
  const [type, setType] = useState<TransactionType>('BUY')
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [fees, setFees] = useState('0')
  const [date, setDate] = useState(today())
  const [notes, setNotes] = useState('')

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getUser()
      if (!data.user) throw new Error('Brak aktywnej sesji użytkownika.')

      const defaultPortfolio = await getDefaultPortfolio(data.user)
      const [assetList, transactionList] = await Promise.all([
        listAssets(defaultPortfolio.id),
        listTransactions(defaultPortfolio.id),
      ])

      setPortfolio(defaultPortfolio)
      setAssets(assetList)
      setTransactions(transactionList)
      setAssetId((current) => current || assetList[0]?.id || '')
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się pobrać danych.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const positions = useMemo<PositionRow[]>(() => {
    const map = new Map<string, PositionRow>()
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]))

    for (const tx of [...transactions].reverse()) {
      const asset = assetMap.get(tx.asset_id)
      if (!asset) continue

      const current = map.get(tx.asset_id) ?? {
        assetId: tx.asset_id,
        symbol: asset.symbol,
        name: asset.name,
        type: asset.asset_type,
        currency: asset.currency ?? 'PLN',
        quantity: 0,
        cost: 0,
        avgPrice: 0,
      }

      const qty = Number(tx.quantity)
      const gross = Number(tx.quantity) * Number(tx.price)
      const txFees = Number(tx.fees ?? 0)

      if (tx.transaction_type === 'BUY') {
        current.quantity += qty
        current.cost += gross + txFees
      } else {
        const avg = current.quantity > 0 ? current.cost / current.quantity : 0
        current.quantity -= qty
        current.cost -= avg * qty
        if (current.quantity < 0.00000001) {
          current.quantity = 0
          current.cost = 0
        }
      }

      current.avgPrice = current.quantity > 0 ? current.cost / current.quantity : 0
      map.set(tx.asset_id, current)
    }

    return Array.from(map.values()).filter((row) => row.quantity > 0)
  }, [assets, transactions])

  const selectedAsset = assets.find((asset) => asset.id === assetId) ?? null
  const selectedAssetQuantity = useMemo(() => getAssetQuantity(assetId, transactions), [assetId, transactions])

  const totalBuyValue = transactions
    .filter((tx) => tx.transaction_type === 'BUY')
    .reduce((sum, tx) => sum + Number(tx.quantity) * Number(tx.price) + Number(tx.fees ?? 0), 0)

  const totalSellValue = transactions
    .filter((tx) => tx.transaction_type === 'SELL')
    .reduce((sum, tx) => sum + Number(tx.quantity) * Number(tx.price) - Number(tx.fees ?? 0), 0)

  const totalFees = transactions.reduce((sum, tx) => sum + Number(tx.fees ?? 0), 0)
  const openCost = positions.reduce((sum, pos) => sum + pos.cost, 0)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!portfolio) return
    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const q = toNumber(quantity)
      const p = toNumber(price)
      const f = toNumber(fees || '0')

      if (!assetId) throw new Error('Wybierz aktywo.')
      if (!q || q <= 0 || Number.isNaN(q)) throw new Error('Liczba jednostek musi być większa od zera.')
      if (!p || p <= 0 || Number.isNaN(p)) throw new Error('Cena musi być większa od zera.')
      if (Number.isNaN(f) || f < 0) throw new Error('Opłaty nie mogą być ujemne.')
      if (!date) throw new Error('Podaj datę transakcji.')

      if (type === 'SELL') {
        const availableQuantity = getAssetQuantity(assetId, transactions)
        if (availableQuantity <= 0) {
          throw new Error(`Nie możesz sprzedać ${selectedAsset?.symbol ?? 'tego aktywa'}, bo nie masz otwartej pozycji.`)
        }
        if (q > availableQuantity + 0.00000001) {
          throw new Error(`Nie możesz sprzedać ${formatQuantity(q)} szt., bo aktualnie posiadasz tylko ${formatQuantity(availableQuantity)} szt.`)
        }
      }

      const created = await createTransaction(portfolio.id, {
        asset_id: assetId,
        transaction_type: type,
        quantity: q,
        price: p,
        fees: f,
        transaction_date: date,
        notes,
      })

      setTransactions((current) => [created, ...current])
      setQuantity('')
      setPrice('')
      setFees('0')
      setNotes('')
      setDate(today())
      setSuccess('Transakcja zapisana w Supabase.')
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się dodać transakcji.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setError(null)
    setSuccess(null)
    try {
      await deleteTransaction(id)
      setTransactions((current) => current.filter((tx) => tx.id !== id))
      setSuccess('Transakcja usunięta.')
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się usunąć transakcji.')
    }
  }

  return (
    <Shell>
      <PageHeader
        eyebrow="Stage C2.1 · Transactions Fix"
        title="Transakcje long-term"
        description="Transakcje są częścią modułu Long-term. Sprzedaż ma walidację ilości, więc nie da się sprzedać więcej niż posiadasz."
      />

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <StatCard icon={Database} label="Liczba transakcji" value={String(transactions.length)} sub="zapisane w Supabase" tone="cyan" />
        <StatCard icon={ArrowUpRight} label="Zakupy brutto" value={PLN.format(totalBuyValue)} sub="quantity × price + fees" tone="emerald" />
        <StatCard icon={ArrowDownRight} label="Sprzedaż netto" value={PLN.format(totalSellValue)} sub="sell value - fees" tone="violet" />
        <StatCard icon={Wallet} label="Koszt pozycji" value={PLN.format(openCost)} sub={`opłaty: ${PLN.format(totalFees)}`} />
      </div>

      <div className="mt-6 grid gap-6 2xl:grid-cols-[.92fr_1.08fr]">
        <Card>
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-white">Dodaj transakcję</h3>
              <p className="mt-1 text-sm text-slate-500">Na start ręczne BUY/SELL. Później podepniemy import IBKR.</p>
            </div>
            <TrustBadge>Live DB</TrustBadge>
          </div>

          {assets.length === 0 ? (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
              Najpierw dodaj aktywo w zakładce Long-term, potem wróć tutaj i dodaj transakcję.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-300">Aktywo</span>
                <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className="input">
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>
                  ))}
                </select>
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-300">Typ</span>
                  <select value={type} onChange={(e) => setType(e.target.value as TransactionType)} className="input">
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-300">Data</span>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
                </label>
              </div>

              {type === 'SELL' ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                  Dostępne do sprzedaży: <span className="font-bold text-white">{formatQuantity(selectedAssetQuantity)}</span>
                  {selectedAsset ? <span className="text-slate-500"> · {selectedAsset.symbol}</span> : null}
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-3">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-300">Liczba jednostek</span>
                  <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="np. 1,25" inputMode="decimal" className="input" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-300">Cena</span>
                  <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="np. 386,54" inputMode="decimal" className="input" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-300">Opłaty</span>
                  <input value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0" inputMode="decimal" className="input" />
                </label>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-300">Notatka</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="np. miesięczny zakup IUSQ" className="input min-h-24 resize-none" />
              </label>

              {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
              {success ? <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">{success}</div> : null}

              <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-5 py-4 text-sm font-bold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60">
                {saving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                Zapisz transakcję
              </button>
            </form>
          )}
        </Card>

        <Card>
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-white">Pozycje z transakcji</h3>
              <p className="mt-1 text-sm text-slate-500">Liczymy quantity, koszt oraz średnią cenę z BUY/SELL.</p>
            </div>
            <button onClick={loadData} className="rounded-2xl p-3 text-slate-400 transition hover:bg-white/10 hover:text-white" title="Odśwież">
              <RefreshCw size={18} />
            </button>
          </div>

          {loading ? (
            <div className="flex min-h-80 items-center justify-center text-slate-400"><Loader2 className="mr-2 animate-spin" />Ładowanie...</div>
          ) : positions.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">Brak otwartych pozycji. Dodaj pierwszą transakcję BUY.</div>
          ) : (
            <div className="overflow-hidden rounded-3xl border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="p-4">Aktywo</th>
                    <th className="p-4 text-right">Ilość</th>
                    <th className="p-4 text-right">Koszt</th>
                    <th className="p-4 text-right">Śr. cena</th>
                    <th className="p-4 text-right">Waluta</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos) => (
                    <tr key={pos.assetId} className="border-t border-white/10 transition hover:bg-white/[0.03]">
                      <td className="p-4"><p className="font-semibold text-white">{pos.symbol}</p><p className="text-xs text-slate-500">{pos.name}</p></td>
                      <td className="p-4 text-right text-slate-300">{formatQuantity(pos.quantity)}</td>
                      <td className="p-4 text-right text-white">{PLN.format(pos.cost)}</td>
                      <td className="p-4 text-right text-slate-300">{pos.avgPrice.toFixed(2)}</td>
                      <td className="p-4 text-right text-slate-500">{pos.currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white">Historia transakcji</h3>
            <p className="mt-1 text-sm text-slate-500">Pełny dziennik operacji long-term.</p>
          </div>
          <TrustBadge>{portfolio?.name ?? 'Portfolio'}</TrustBadge>
        </div>

        {loading ? (
          <div className="flex min-h-52 items-center justify-center text-slate-400"><Loader2 className="mr-2 animate-spin" />Ładowanie historii...</div>
        ) : transactions.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">Nie masz jeszcze żadnych transakcji.</div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="p-4">Data</th>
                  <th className="p-4">Aktywo</th>
                  <th className="p-4">Typ</th>
                  <th className="p-4 text-right">Ilość</th>
                  <th className="p-4 text-right">Cena</th>
                  <th className="p-4 text-right">Opłaty</th>
                  <th className="p-4 text-right">Wartość</th>
                  <th className="p-4 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const value = tx.transaction_type === 'BUY' ? Number(tx.quantity) * Number(tx.price) + Number(tx.fees ?? 0) : Number(tx.quantity) * Number(tx.price) - Number(tx.fees ?? 0)
                  return (
                    <tr key={tx.id} className="border-t border-white/10 transition hover:bg-white/[0.03]">
                      <td className="p-4 text-slate-400"><CalendarDays className="mr-2 inline" size={14} />{tx.transaction_date}</td>
                      <td className="p-4"><p className="font-semibold text-white">{tx.assets?.symbol ?? 'Aktywo'}</p><p className="text-xs text-slate-500">{tx.assets?.name ?? tx.asset_id}</p></td>
                      <td className="p-4"><span className={`rounded-full px-3 py-1 text-xs font-bold ${tx.transaction_type === 'BUY' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>{tx.transaction_type}</span></td>
                      <td className="p-4 text-right text-slate-300">{formatQuantity(Number(tx.quantity))}</td>
                      <td className="p-4 text-right text-slate-300">{Number(tx.price).toFixed(2)}</td>
                      <td className="p-4 text-right text-slate-500">{PLN.format(Number(tx.fees ?? 0))}</td>
                      <td className="p-4 text-right text-white">{PLN.format(value)}</td>
                      <td className="p-4 text-right">
                        <button onClick={() => handleDelete(tx.id)} className="rounded-xl p-2 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300" title="Usuń transakcję">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Shell>
  )
}
