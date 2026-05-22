'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, CalendarDays, Database, Loader2, Plus, RefreshCw, Trash2, Wallet } from 'lucide-react'
import { Shell, PageHeader, Card, StatCard, TrustBadge } from '@/components/Shell'
import { BASE_CURRENCY, normalizeCurrencyCode } from '@/lib/currency'
import { formatCurrencyValue, PLN } from '@/lib/format'
import { buildPositions } from '@/lib/position-engine'
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
import {
  calculateTransactionAmounts,
  transactionFeeBase,
  transactionFeesSource,
  transactionGrossSource,
  transactionHasBaseValuation,
  transactionNetBase,
  transactionNetBaseOrNull,
  transactionPriceSource,
  transactionSourceCurrency,
} from '@/lib/transaction-math'

type FxPreview = {
  status: 'idle' | 'loading' | 'ready' | 'missing' | 'error'
  rate: number | null
  rateDate: string | null
  source: string | null
  fallbackDays: number | null
  message: string | null
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

function emptyFx(status: FxPreview['status'] = 'idle'): FxPreview {
  return { status, rate: null, rateDate: null, source: null, fallbackDays: null, message: null }
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
  const [fxPreview, setFxPreview] = useState<FxPreview>(emptyFx())

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

  const selectedAsset = assets.find((asset) => asset.id === assetId) ?? null
  const baseCurrency = BASE_CURRENCY
  const sourceCurrency = normalizeCurrencyCode(selectedAsset?.currency, baseCurrency)

  useEffect(() => {
    let cancelled = false

    async function loadFx() {
      if (!date || !sourceCurrency) {
        setFxPreview(emptyFx())
        return
      }

      if (sourceCurrency === baseCurrency) {
        setFxPreview({
          status: 'ready',
          rate: 1,
          rateDate: date,
          source: baseCurrency,
          fallbackDays: 0,
          message: null,
        })
        return
      }

      setFxPreview(emptyFx('loading'))
      try {
        const params = new URLSearchParams({ currency: sourceCurrency, date })
        const response = await fetch(`/api/fx/transaction-rate?${params.toString()}`)
        const payload = await response.json()
        if (cancelled) return

        if (payload?.ok && payload?.rate) {
          setFxPreview({
            status: 'ready',
            rate: Number(payload.rate),
            rateDate: payload.rateDate ?? null,
            source: payload.source ?? null,
            fallbackDays: payload.fallbackDays ?? 0,
            message: null,
          })
        } else {
          setFxPreview({
            status: payload?.error === 'FX_MISSING' ? 'missing' : 'error',
            rate: null,
            rateDate: null,
            source: null,
            fallbackDays: null,
            message: payload?.message ?? 'Nie udało się pobrać kursu FX.',
          })
        }
      } catch (err: any) {
        if (!cancelled) {
          setFxPreview({ ...emptyFx('error'), message: err?.message ?? 'Nie udało się pobrać kursu FX.' })
        }
      }
    }

    loadFx()
    return () => { cancelled = true }
  }, [baseCurrency, date, sourceCurrency])

  const positions = useMemo(() => buildPositions(assets, transactions, []).filter((row) => row.quantity > 0.00000001), [assets, transactions])
  const selectedAssetQuantity = useMemo(() => getAssetQuantity(assetId, transactions), [assetId, transactions])
  const missingBaseTransactions = transactions.filter((tx) => !transactionHasBaseValuation(tx)).length

  const totalBuyValue = transactions
    .filter((tx) => tx.transaction_type === 'BUY')
    .reduce((sum, tx) => sum + transactionNetBase(tx), 0)

  const totalSellValue = transactions
    .filter((tx) => tx.transaction_type === 'SELL')
    .reduce((sum, tx) => sum + transactionNetBase(tx), 0)

  const totalFees = transactions.reduce((sum, tx) => sum + transactionFeeBase(tx), 0)
  const openCost = positions.reduce((sum, pos) => sum + pos.remainingCost, 0)

  const preview = useMemo(() => {
    if (!quantity && !price) return { result: null, error: null }
    try {
      return {
        result: calculateTransactionAmounts({
          transactionType: type,
          quantity: toNumber(quantity || '0'),
          priceSource: toNumber(price || '0'),
          feesSource: toNumber(fees || '0'),
          sourceCurrency,
          fxRateToBase: fxPreview.rate,
          baseCurrency,
          fxRateDate: fxPreview.rateDate,
          fxRateSource: fxPreview.source,
        }),
        error: null,
      }
    } catch (err: any) {
      return { result: null, error: err?.message ?? 'Nie udało się policzyć transakcji.' }
    }
  }, [baseCurrency, fees, fxPreview.rate, fxPreview.rateDate, fxPreview.source, price, quantity, sourceCurrency, type])
  const fxLoading = sourceCurrency !== baseCurrency && fxPreview.status === 'loading'

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!portfolio) return
    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      if (!assetId) throw new Error('Wybierz aktywo.')
      if (!date) throw new Error('Podaj datę transakcji.')
      if (fxLoading) throw new Error('Poczekaj na sprawdzenie kursu FX.')
      if (!preview.result) throw new Error(preview.error ?? 'Uzupełnij poprawne wartości transakcji.')

      const q = preview.result.quantity
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
        quantity: preview.result.quantity,
        price: preview.result.priceBase ?? preview.result.priceSource,
        fees: preview.result.feesBase ?? preview.result.feesSource,
        source_currency: preview.result.sourceCurrency,
        price_source: preview.result.priceSource,
        fees_source: preview.result.feesSource,
        fx_rate_to_base: preview.result.fxRateToBase,
        base_currency: preview.result.baseCurrency,
        price_base: preview.result.priceBase,
        fees_base: preview.result.feesBase,
        gross_amount_source: preview.result.grossAmountSource,
        gross_amount_base: preview.result.grossAmountBase,
        fx_rate_date: preview.result.fxRateDate,
        fx_rate_source: preview.result.fxRateSource,
        transaction_date: date,
        notes,
      })

      setTransactions((current) => [created, ...current])
      setQuantity('')
      setPrice('')
      setFees('0')
      setNotes('')
      setDate(today())
      setSuccess(preview.result.baseConversionAvailable
        ? 'Transakcja zapisana z wyceną w PLN.'
        : 'Transakcja zapisana w walucie instrumentu. Wycena PLN będzie ograniczona do czasu uzupełnienia FX.')
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
        eyebrow="Stage C5.8 · Multi-currency"
        title="Transakcje long-term"
        description="Cena i prowizja są wpisywane w walucie instrumentu. Portfel, P/L i snapshoty pozostają w walucie bazowej."
      />

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <StatCard icon={Database} label="Liczba transakcji" value={String(transactions.length)} sub="zapisane w Supabase" tone="cyan" />
        <StatCard icon={ArrowUpRight} label="Zakupy" value={PLN.format(totalBuyValue)} sub={missingBaseTransactions ? `${missingBaseTransactions} bez wyceny PLN` : 'w walucie portfela'} tone="emerald" />
        <StatCard icon={ArrowDownRight} label="Sprzedaż" value={PLN.format(totalSellValue)} sub="w walucie portfela" tone="violet" />
        <StatCard icon={Wallet} label="Koszt pozycji" value={PLN.format(openCost)} sub={`opłaty: ${PLN.format(totalFees)}`} />
      </div>

      <div className="mt-6 grid gap-6 2xl:grid-cols-[.92fr_1.08fr]">
        <Card>
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-white">Dodaj transakcję</h3>
              <p className="mt-1 text-sm text-slate-500">Dla AAPL wpisz USD, dla IUSQ EUR, dla GPW PLN. Kurs FX jest tylko do wyceny portfela.</p>
            </div>
            <TrustBadge>{baseCurrency}</TrustBadge>
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

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>Waluta instrumentu: <strong className="text-white">{sourceCurrency}</strong></span>
                  <span>Waluta portfela: <strong className="text-white">{baseCurrency}</strong></span>
                </div>
                {sourceCurrency !== baseCurrency ? (
                  <div className="mt-3 text-xs leading-5 text-slate-400">
                    {fxPreview.status === 'loading' ? 'Pobieram kurs FX...' : null}
                    {fxPreview.status === 'ready' && fxPreview.rate ? (
                      <>
                        Kurs FX: 1 {sourceCurrency} ≈ {fxPreview.rate.toLocaleString('pl-PL', { maximumFractionDigits: 4 })} {baseCurrency}
                        {fxPreview.rateDate ? ` · kurs z ${fxPreview.rateDate}` : null}
                        {fxPreview.fallbackDays && fxPreview.fallbackDays > 0 ? ' · ostatni dostępny kurs' : null}
                      </>
                    ) : null}
                    {fxPreview.status === 'missing' || fxPreview.status === 'error' ? (
                      <span className="text-amber-100">{fxPreview.message ?? 'Brak kursu dla tej daty.'} Transakcja zostanie zapisana w walucie instrumentu, ale wycena PLN będzie ograniczona.</span>
                    ) : null}
                  </div>
                ) : null}
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
                  <span className="mb-2 block text-sm font-semibold text-slate-300">Cena w walucie instrumentu ({sourceCurrency})</span>
                  <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder={sourceCurrency === 'PLN' ? 'np. 250,00' : 'np. 102,50'} inputMode="decimal" className="input" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-300">Prowizja ({sourceCurrency})</span>
                  <input value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0" inputMode="decimal" className="input" />
                </label>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
                {preview.result ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <span className="text-slate-500">Wartość w walucie instrumentu</span>
                      <p className="font-semibold text-white">{formatCurrencyValue(preview.result.grossAmountSource, sourceCurrency, 2)}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Szacunkowo w {baseCurrency}</span>
                      <p className="font-semibold text-white">
                        {fxLoading ? 'pobieram kurs FX...' : preview.result.netAmountBase == null ? 'brak kursu FX' : formatCurrencyValue(preview.result.netAmountBase, baseCurrency, 2)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className={preview.error ? 'text-amber-100' : 'text-slate-500'}>{preview.error ?? 'Wpisz ilość i cenę, aby zobaczyć podgląd.'}</p>
                )}
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-300">Notatka</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="np. miesięczny zakup IUSQ" className="input min-h-24 resize-none" />
              </label>

              {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
              {success ? <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">{success}</div> : null}

              <button disabled={saving || !preview.result || fxLoading} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-5 py-4 text-sm font-bold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60">
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
              <p className="mt-1 text-sm text-slate-500">Ilość zostaje w jednostkach, koszt i średnia cena są w walucie portfela.</p>
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
                    <tr key={pos.asset.id} className="border-t border-white/10 transition hover:bg-white/[0.03]">
                      <td className="p-4"><p className="font-semibold text-white">{pos.asset.symbol}</p><p className="text-xs text-slate-500">{pos.asset.name}</p></td>
                      <td className="p-4 text-right text-slate-300">{formatQuantity(pos.quantity)}</td>
                      <td className="p-4 text-right text-white">{formatCurrencyValue(pos.remainingCost, baseCurrency, 2)}</td>
                      <td className="p-4 text-right text-slate-300">{formatCurrencyValue(pos.avgPrice, baseCurrency, 2)}</td>
                      <td className="p-4 text-right text-slate-500">{pos.asset.currency ?? baseCurrency}</td>
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
            <p className="mt-1 text-sm text-slate-500">Cena źródłowa jest główna, wycena PLN jest pokazywana tylko gdy jest bezpieczny kurs FX.</p>
          </div>
          <TrustBadge>{portfolio?.name ?? 'Portfolio'}</TrustBadge>
        </div>

        {loading ? (
          <div className="flex min-h-52 items-center justify-center text-slate-400"><Loader2 className="mr-2 animate-spin" />Ładowanie historii...</div>
        ) : transactions.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">Nie masz jeszcze żadnych transakcji.</div>
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-white/10">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="p-4">Data</th>
                  <th className="p-4">Aktywo</th>
                  <th className="p-4">Typ</th>
                  <th className="p-4 text-right">Ilość</th>
                  <th className="p-4 text-right">Cena</th>
                  <th className="p-4 text-right">Prowizja</th>
                  <th className="p-4 text-right">Wartość</th>
                  <th className="p-4 text-right">Kurs FX</th>
                  <th className="p-4 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const txCurrency = transactionSourceCurrency(tx)
                  const netBase = transactionNetBaseOrNull(tx)
                  const fxRate = tx.fx_rate_to_base ? Number(tx.fx_rate_to_base) : null
                  return (
                    <tr key={tx.id} className="border-t border-white/10 transition hover:bg-white/[0.03]">
                      <td className="p-4 text-slate-400"><CalendarDays className="mr-2 inline" size={14} />{tx.transaction_date}</td>
                      <td className="p-4"><p className="font-semibold text-white">{tx.assets?.symbol ?? 'Aktywo'}</p><p className="text-xs text-slate-500">{tx.assets?.name ?? tx.asset_id}</p></td>
                      <td className="p-4"><span className={`rounded-full px-3 py-1 text-xs font-bold ${tx.transaction_type === 'BUY' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>{tx.transaction_type}</span></td>
                      <td className="p-4 text-right text-slate-300">{formatQuantity(Number(tx.quantity))}</td>
                      <td className="p-4 text-right text-slate-300">{formatCurrencyValue(transactionPriceSource(tx), txCurrency, 2)}</td>
                      <td className="p-4 text-right text-slate-500">{formatCurrencyValue(transactionFeesSource(tx), txCurrency, 2)}</td>
                      <td className="p-4 text-right">
                        <p className="font-semibold text-white">{formatCurrencyValue(transactionGrossSource(tx), txCurrency, 2)}</p>
                        <p className="text-xs text-slate-500">{netBase == null ? `brak ${baseCurrency}` : `≈ ${formatCurrencyValue(netBase, baseCurrency, 2)}`}</p>
                      </td>
                      <td className="p-4 text-right text-slate-500">
                        {txCurrency === baseCurrency ? '—' : fxRate ? (
                          <>
                            <p>{fxRate.toFixed(4)}</p>
                            {tx.fx_rate_date ? <p className="text-xs text-slate-600">{tx.fx_rate_date}</p> : null}
                          </>
                        ) : 'brak'}
                      </td>
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
