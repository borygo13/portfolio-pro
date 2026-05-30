'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Banknote, CalendarDays, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Shell, PageHeader, Card, StatCard, TrustBadge } from '@/components/Shell'
import { MonthlyDividendChart } from '@/components/Charts'
import { BASE_CURRENCY, SUPPORTED_TRANSACTION_CURRENCIES } from '@/lib/currency'
import { calculateIncomeAmounts, buildMonthlyIncomePoints, summarizeIncomeByAsset, summarizeIncomeEvents } from '@/lib/income-engine'
import { formatCurrencyValue } from '@/lib/format'
import { supabase } from '@/lib/supabase/client'
import {
  createIncomeEvent,
  deleteIncomeEvent,
  getDefaultPortfolio,
  listAssets,
  listIncomeEvents,
  type Asset,
  type IncomeEvent,
  type Portfolio,
} from '@/lib/supabase/portfolio'

type FxPreview = {
  status: 'idle' | 'loading' | 'ready' | 'missing' | 'error'
  rate: number | null
  rateDate: string | null
  source: string | null
  fallbackDays: number | null
  message: string | null
}

const emptyFxPreview: FxPreview = { status: 'idle', rate: null, rateDate: null, source: null, fallbackDays: null, message: null }

function today() {
  return new Date().toISOString().slice(0, 10)
}

function parseAmount(value: string) {
  const parsed = Number(String(value || '0').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' })
}

function normalizeCurrency(value: string | null | undefined, fallback: string = BASE_CURRENCY) {
  return (value || fallback).trim().toUpperCase()
}

export default function IncomePage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [events, setEvents] = useState<IncomeEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [assetId, setAssetId] = useState('')
  const [broker, setBroker] = useState('')
  const [source, setSource] = useState('manual')
  const [paymentDate, setPaymentDate] = useState(today())
  const [exDate, setExDate] = useState('')
  const [grossAmount, setGrossAmount] = useState('')
  const [withholdingTax, setWithholdingTax] = useState('')
  const [localTax, setLocalTax] = useState('')
  const [otherFees, setOtherFees] = useState('')
  const [currency, setCurrency] = useState<string>(BASE_CURRENCY)
  const [notes, setNotes] = useState('')
  const [fxPreview, setFxPreview] = useState<FxPreview>(emptyFxPreview)

  const baseCurrency = normalizeCurrency(portfolio?.currency, BASE_CURRENCY)
  const selectedAsset = useMemo(() => assets.find((asset) => asset.id === assetId) ?? null, [assets, assetId])
  const summary = useMemo(() => summarizeIncomeEvents(events, baseCurrency), [events, baseCurrency])
  const monthlyIncome = useMemo(() => buildMonthlyIncomePoints(events), [events])
  const incomeByAsset = useMemo(() => summarizeIncomeByAsset(events), [events])

  const amountPreview = useMemo(() => {
    try {
      const gross = parseAmount(grossAmount)
      if (!Number.isFinite(gross)) return { result: null, error: 'Podaj poprawną kwotę brutto.' }
      return {
        result: calculateIncomeAmounts({
          incomeType: 'DIVIDEND',
          grossAmount: gross,
          withholdingTax: parseAmount(withholdingTax),
          localTax: parseAmount(localTax),
          otherFees: parseAmount(otherFees),
          currency,
          baseCurrency,
          fxRateToBase: fxPreview.rate,
          fxRateDate: fxPreview.rateDate,
          fxRateSource: fxPreview.source,
        }),
        error: null,
      }
    } catch (err: any) {
      return { result: null, error: err?.message ?? 'Nie udało się policzyć kwoty netto.' }
    }
  }, [baseCurrency, currency, fxPreview.rate, fxPreview.rateDate, fxPreview.source, grossAmount, localTax, otherFees, withholdingTax])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getUser()
      if (!data.user) throw new Error('Brak aktywnej sesji użytkownika.')
      const defaultPortfolio = await getDefaultPortfolio(data.user)
      const [assetList, incomeList] = await Promise.all([
        listAssets(defaultPortfolio.id),
        listIncomeEvents(defaultPortfolio.id),
      ])
      setPortfolio(defaultPortfolio)
      setAssets(assetList)
      setEvents(incomeList)
      setAssetId((current) => current || assetList[0]?.id || '')
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się pobrać dochodów.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    if (!selectedAsset) return
    setCurrency(normalizeCurrency(selectedAsset.currency, baseCurrency))
  }, [baseCurrency, selectedAsset])

  useEffect(() => {
    let cancelled = false
    const incomeCurrency = normalizeCurrency(currency, baseCurrency)

    async function loadFx() {
      if (!paymentDate) {
        setFxPreview({ ...emptyFxPreview, status: 'error', message: 'Wybierz datę wypłaty.' })
        return
      }

      if (incomeCurrency === baseCurrency) {
        setFxPreview({ status: 'ready', rate: 1, rateDate: paymentDate, source: baseCurrency, fallbackDays: 0, message: null })
        return
      }

      setFxPreview({ ...emptyFxPreview, status: 'loading' })
      try {
        const params = new URLSearchParams({ currency: incomeCurrency, date: paymentDate })
        const response = await fetch(`/api/fx/transaction-rate?${params.toString()}`)
        const payload = await response.json().catch(() => ({}))
        if (cancelled) return
        if (payload?.ok && payload.rate) {
          setFxPreview({
            status: 'ready',
            rate: Number(payload.rate),
            rateDate: payload.rateDate ?? null,
            source: payload.source ?? null,
            fallbackDays: payload.fallbackDays ?? null,
            message: null,
          })
        } else {
          setFxPreview({
            status: 'missing',
            rate: null,
            rateDate: null,
            source: null,
            fallbackDays: null,
            message: payload?.message ?? `Brak kursu FX dla ${incomeCurrency}/${baseCurrency}.`,
          })
        }
      } catch (err: any) {
        if (!cancelled) {
          setFxPreview({ status: 'error', rate: null, rateDate: null, source: null, fallbackDays: null, message: err?.message ?? 'Nie udało się pobrać kursu FX.' })
        }
      }
    }

    loadFx()
    return () => { cancelled = true }
  }, [baseCurrency, currency, paymentDate])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!portfolio || !amountPreview.result) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      if (!assetId) throw new Error('Wybierz aktywo dla dywidendy.')
      const created = await createIncomeEvent(portfolio.id, {
        income_type: 'DIVIDEND',
        asset_id: assetId,
        broker,
        source,
        currency,
        gross_amount: amountPreview.result.grossAmount,
        withholding_tax: amountPreview.result.withholdingTax,
        local_tax: amountPreview.result.localTax,
        other_fees: amountPreview.result.otherFees,
        fx_rate_to_base: amountPreview.result.fxRateToBase,
        fx_rate_date: amountPreview.result.fxRateDate,
        fx_rate_source: amountPreview.result.fxRateSource,
        base_currency: amountPreview.result.baseCurrency,
        payment_date: paymentDate,
        ex_date: exDate || null,
        notes,
      })
      setEvents((current) => [created, ...current])
      setGrossAmount('')
      setWithholdingTax('')
      setLocalTax('')
      setOtherFees('')
      setNotes('')
      setSuccess(created.net_amount_base == null
        ? 'Dodano dywidendę w walucie wypłaty. Wycena PLN jest niedostępna bez FX.'
        : `Dodano dywidendę: ${formatCurrencyValue(Number(created.net_amount_base), created.base_currency, 2)} netto.`)
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się dodać dochodu.')
    } finally {
      setSaving(false)
    }
  }

  async function removeIncomeEvent(id: string) {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await deleteIncomeEvent(id)
      setEvents((current) => current.filter((item) => item.id !== id))
      setSuccess('Usunięto dochód.')
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się usunąć dochodu.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Shell>
      <PageHeader
        eyebrow="C5.9 · Dividend / Income Engine"
        title="Dochody"
        description="Ręcznie dodawaj dywidendy i inne dochody jako osobne zdarzenia. Nie zmieniają ilości aktywów ani nie są transakcjami BUY/SELL."
      />

      {error ? <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
      {success ? <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">{success}</div> : null}
      {loading ? <div className="mb-6 flex items-center gap-2 text-sm text-slate-400"><Loader2 className="animate-spin" size={16} /> Ładowanie dochodów...</div> : null}

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <StatCard icon={Banknote} label="Dochód YTD netto" value={formatCurrencyValue(summary.currentYearNetBase, baseCurrency, 0)} sub={summary.missingBaseCount ? `${summary.missingBaseCount} bez wyceny PLN` : 'wycena w walucie portfela'} />
        <StatCard icon={Banknote} label="Dochód all-time netto" value={formatCurrencyValue(summary.allTimeNetBase, baseCurrency, 0)} sub={`${summary.count} zdarzeń dochodu`} tone="cyan" />
        <StatCard icon={Banknote} label="Podatki YTD" value={formatCurrencyValue(summary.currentYearTaxBase, baseCurrency, 0)} sub="u źródła + lokalne" tone="violet" />
        <StatCard icon={CalendarDays} label="Ostatnia dywidenda" value={events[0] ? formatDate(events[0].payment_date) : '—'} sub={events[0]?.assets?.symbol ?? 'Brak dodanych dochodów'} tone="cyan" />
      </div>

      <div className="mt-6 grid gap-6 2xl:grid-cols-[.85fr_1.15fr]">
        <Card>
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-white">Dodaj dywidendę</h3>
              <p className="mt-1 text-sm text-slate-500">Kwota źródłowa jest główna. PLN pokazujemy tylko przy bezpiecznym kursie FX.</p>
            </div>
            <TrustBadge>{baseCurrency}</TrustBadge>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Aktywo</span>
              <select value={assetId} onChange={(event) => setAssetId(event.target.value)} className="input">
                {assets.length === 0 ? <option value="">Brak aktywów</option> : assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Data wypłaty"><input value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} type="date" className="input" /></Field>
              <Field label="Data ex-dividend"><input value={exDate} onChange={(event) => setExDate(event.target.value)} type="date" className="input" /></Field>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Waluta wypłaty">
                <select value={currency} onChange={(event) => setCurrency(event.target.value)} className="input">
                  {SUPPORTED_TRANSACTION_CURRENCIES.map((code) => <option key={code}>{code}</option>)}
                </select>
              </Field>
              <Field label="Broker">
                <input value={broker} onChange={(event) => setBroker(event.target.value)} placeholder="np. IBKR" className="input" />
              </Field>
              <Field label="Źródło">
                <input value={source} onChange={(event) => setSource(event.target.value)} placeholder="manual" className="input" />
              </Field>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label={`Kwota brutto (${currency})`}><input value={grossAmount} onChange={(event) => setGrossAmount(event.target.value)} inputMode="decimal" placeholder="100,00" className="input" /></Field>
              <Field label={`Podatek u źródła (${currency})`}><input value={withholdingTax} onChange={(event) => setWithholdingTax(event.target.value)} inputMode="decimal" placeholder="0" className="input" /></Field>
              <Field label={`Podatek lokalny (${currency})`}><input value={localTax} onChange={(event) => setLocalTax(event.target.value)} inputMode="decimal" placeholder="0" className="input" /></Field>
              <Field label={`Inne opłaty (${currency})`}><input value={otherFees} onChange={(event) => setOtherFees(event.target.value)} inputMode="decimal" placeholder="0" className="input" /></Field>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
              {amountPreview.result ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-slate-500">Kwota netto</p>
                    <p className="font-semibold text-white">{formatCurrencyValue(amountPreview.result.netAmount, amountPreview.result.currency, 2)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Szacunkowo w {baseCurrency}</p>
                    <p className="font-semibold text-white">{amountPreview.result.netAmountBase == null ? 'wycena PLN niedostępna' : formatCurrencyValue(amountPreview.result.netAmountBase, baseCurrency, 2)}</p>
                  </div>
                  <div className="md:col-span-2 text-xs text-slate-500">
                    {fxPreview.status === 'loading' ? 'Pobieram kurs FX...' : amountPreview.result.fxRateToBase
                      ? `Kurs FX: 1 ${amountPreview.result.currency} ≈ ${amountPreview.result.fxRateToBase.toLocaleString('pl-PL', { maximumFractionDigits: 4 })} ${baseCurrency} · ${formatDate(amountPreview.result.fxRateDate)}${fxPreview.fallbackDays ? ' · ostatni dostępny kurs' : ''}`
                      : fxPreview.message ?? 'Brak kursu FX dla tej daty.'}
                  </div>
                </div>
              ) : (
                <p className="text-amber-100">{amountPreview.error ?? 'Wpisz kwotę brutto, żeby zobaczyć podgląd.'}</p>
              )}
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Notatka</span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="np. kwartalna dywidenda ETF" className="input min-h-24 resize-none" />
            </label>

            <button disabled={saving || loading || assets.length === 0 || !amountPreview.result || fxPreview.status === 'loading'} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-5 py-4 text-sm font-bold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
              Dodaj dywidendę
            </button>
          </form>
        </Card>

        <div className="space-y-6">
          <Card>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white">Dochód miesięczny</h3>
                <p className="mt-1 text-sm text-slate-500">Wykres używa tylko zdarzeń z bezpieczną wyceną w {baseCurrency}.</p>
              </div>
              <button onClick={loadData} className="rounded-2xl p-3 text-slate-400 transition hover:bg-white/10 hover:text-white" title="Odśwież">
                <RefreshCw size={18} />
              </button>
            </div>
            {monthlyIncome.length > 0 ? <MonthlyDividendChart data={monthlyIncome} /> : <EmptyState text="Brak dochodów z wyceną w PLN. Dodaj pierwszą dywidendę albo uzupełnij FX." />}
          </Card>

          <Card>
            <h3 className="text-lg font-bold text-white">Dochód według aktywa</h3>
            <div className="mt-5 space-y-3">
              {incomeByAsset.length === 0 ? <EmptyState text="Brak dodanych dochodów." /> : incomeByAsset.slice(0, 6).map((row) => (
                <div key={row.assetId} className="flex items-center justify-between rounded-2xl bg-white/[0.04] px-4 py-3 text-sm">
                  <div>
                    <p className="font-semibold text-white">{row.symbol}</p>
                    <p className="text-xs text-slate-500">{row.count} zdarzeń · ostatnio {formatDate(row.latestPaymentDate)}</p>
                  </div>
                  <p className="font-semibold text-emerald-300">{formatCurrencyValue(row.netBase, baseCurrency, 2)}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white">Historia dochodów</h3>
            <p className="mt-1 text-sm text-slate-500">Dywidendy są osobnymi zdarzeniami dochodu. Nie zmieniają pozycji ani ilości aktywów.</p>
          </div>
          <TrustBadge>income_events</TrustBadge>
        </div>

        {events.length === 0 ? (
          <EmptyState text="Brak dodanych dochodów. Dodaj pierwszą dywidendę, żeby śledzić dochód z portfela." />
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-white/10">
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="p-4">Data</th>
                  <th className="p-4">Aktywo</th>
                  <th className="p-4">Typ</th>
                  <th className="p-4 text-right">Brutto</th>
                  <th className="p-4 text-right">Podatki/opłaty</th>
                  <th className="p-4 text-right">Netto</th>
                  <th className="p-4 text-right">Wycena PLN</th>
                  <th className="p-4 text-right">FX</th>
                  <th className="p-4 text-right" />
                </tr>
              </thead>
              <tbody>
                {events.map((item) => {
                  const taxesAndFees = Number(item.withholding_tax ?? 0) + Number(item.local_tax ?? 0) + Number(item.other_fees ?? 0)
                  return (
                    <tr key={item.id} className="border-t border-white/10 transition hover:bg-white/[0.03]">
                      <td className="p-4 text-slate-400">{formatDate(item.payment_date)}</td>
                      <td className="p-4"><p className="font-semibold text-white">{item.assets?.symbol ?? 'Aktywo'}</p><p className="text-xs text-slate-500">{item.assets?.name ?? item.notes ?? '—'}</p></td>
                      <td className="p-4"><span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-300">{item.income_type}</span></td>
                      <td className="p-4 text-right text-slate-300">{formatCurrencyValue(Number(item.gross_amount), item.currency, 2)}</td>
                      <td className="p-4 text-right text-amber-200">{formatCurrencyValue(taxesAndFees, item.currency, 2)}</td>
                      <td className="p-4 text-right font-semibold text-white">{formatCurrencyValue(Number(item.net_amount), item.currency, 2)}</td>
                      <td className="p-4 text-right">
                        <p className="font-semibold text-emerald-300">{item.net_amount_base == null ? 'niedostępna' : formatCurrencyValue(Number(item.net_amount_base), item.base_currency, 2)}</p>
                        {item.net_amount_base == null ? <p className="text-xs text-slate-500">Brak kursu FX</p> : null}
                      </td>
                      <td className="p-4 text-right text-slate-500">
                        {item.currency === item.base_currency ? '—' : item.fx_rate_to_base ? (
                          <>
                            <p>{Number(item.fx_rate_to_base).toFixed(4)}</p>
                            {item.fx_rate_date ? <p className="text-xs text-slate-600">{item.fx_rate_date}</p> : null}
                          </>
                        ) : 'brak'}
                      </td>
                      <td className="p-4 text-right">
                        <button onClick={() => removeIncomeEvent(item.id)} disabled={saving} className="rounded-xl p-2 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300" title="Usuń dochód">
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-300">{label}</span>{children}</label>
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">{text}</div>
}
