'use client'

import { useEffect, useMemo, useState } from 'react'
import { Landmark, Loader2, Plus, ShieldCheck, Trash2, TrendingUp } from 'lucide-react'
import { Shell, PageHeader, Card, StatCard, FeatureNote, TrustBadge } from '@/components/Shell'
import { PLN, PLN2, PCT } from '@/lib/format'
import { supabase } from '@/lib/supabase/client'
import { createEdoBond, deleteEdoBond, getDefaultPortfolio, listEdoBonds, type EdoBond, type Portfolio } from '@/lib/supabase/portfolio'
import { projectEdoBond, summarizeEdoBonds } from '@/lib/bond-engine'

function today() { return new Date().toISOString().slice(0, 10) }
function plusYears(years: number) { const d = new Date(); d.setFullYear(d.getFullYear() + years); return d.toISOString().slice(0, 10) }
function toNumber(value: string) { return Number(value.replace(',', '.')) }

export default function BondsPage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [bonds, setBonds] = useState<EdoBond[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [inflation, setInflation] = useState('4')
  const [series, setSeries] = useState('EDO')
  const [quantity, setQuantity] = useState('10')
  const [purchasePrice, setPurchasePrice] = useState('100')
  const [purchaseDate, setPurchaseDate] = useState(today())
  const [firstRate, setFirstRate] = useState('6.55')
  const [margin, setMargin] = useState('1.50')
  const [maturityDate, setMaturityDate] = useState(plusYears(10))

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getUser()
      if (!data.user) throw new Error('Brak aktywnej sesji użytkownika.')
      const defaultPortfolio = await getDefaultPortfolio(data.user)
      const list = await listEdoBonds(defaultPortfolio.id)
      setPortfolio(defaultPortfolio)
      setBonds(list)
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się pobrać obligacji.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const projections = useMemo(() => bonds.map((bond) => projectEdoBond(bond, toNumber(inflation || '0'))), [bonds, inflation])
  const summary = useMemo(() => summarizeEdoBonds(projections), [projections])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!portfolio) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const q = toNumber(quantity)
      const pp = toNumber(purchasePrice)
      const fr = toNumber(firstRate)
      const mg = toNumber(margin)
      if (!series.trim()) throw new Error('Podaj serię obligacji, np. EDO0435.')
      if (!q || q <= 0) throw new Error('Liczba obligacji musi być większa od zera.')
      if (!pp || pp <= 0) throw new Error('Cena zakupu musi być większa od zera.')
      if (fr < 0 || mg < 0) throw new Error('Oprocentowanie i marża nie mogą być ujemne.')
      if (!purchaseDate || !maturityDate) throw new Error('Podaj datę zakupu i wykupu.')

      const created = await createEdoBond(portfolio.id, {
        series,
        quantity: q,
        purchase_price: pp,
        purchase_date: purchaseDate,
        interest_first_year: fr,
        inflation_margin: mg,
        maturity_date: maturityDate,
      })
      setBonds((current) => [created, ...current])
      setSuccess('Obligacja EDO dodana do Supabase.')
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się dodać obligacji.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setError(null)
    setSuccess(null)
    try {
      await deleteEdoBond(id)
      setBonds((current) => current.filter((bond) => bond.id !== id))
      setSuccess('Obligacja usunięta.')
    } catch (err: any) {
      setError(err?.message ?? 'Nie udało się usunąć obligacji.')
    }
  }

  return (
    <Shell>
      <PageHeader
        eyebrow="Long-term · Obligacje"
        title="Obligacje skarbowe EDO"
        description="Osobny moduł dla 10-letnich obligacji indeksowanych inflacją. Liczymy kapitał, narastające odsetki, szacunkowy podatek Belki i prognozę wykupu."
      />

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <StatCard icon={Landmark} label="Kapitał EDO" value={PLN.format(summary.principal)} sub={`${bonds.length} serii`} tone="cyan" />
        <StatCard icon={TrendingUp} label="Odsetki narastające" value={PLN.format(summary.accruedInterest)} sub="przed podatkiem" />
        <StatCard icon={ShieldCheck} label="Wartość po podatku" value={PLN.format(summary.currentValueAfterTax)} sub={`Belka est.: ${PLN.format(summary.estimatedTax)}`} tone="violet" />
        <StatCard icon={Landmark} label="Prognoza wykupu" value={PLN.format(summary.maturityValueEstimate)} sub="przy stałym CPI z formularza" />
      </div>

      {error ? <div className="mt-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
      {success ? <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">{success}</div> : null}

      <div className="mt-6 grid gap-6 2xl:grid-cols-[.78fr_1.22fr]">
        <Card>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white">Dodaj EDO</h3>
              <p className="mt-1 text-sm text-slate-500">Na start model uproszczony, ale działa na realnych danych z bazy.</p>
            </div>
            <TrustBadge>EDO engine</TrustBadge>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Seria"><input className="input" value={series} onChange={(e) => setSeries(e.target.value)} placeholder="np. EDO0435" /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Liczba sztuk"><input className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" /></Field>
              <Field label="Cena zakupu / szt."><input className="input" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} inputMode="decimal" /></Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Data zakupu"><input className="input" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></Field>
              <Field label="Data wykupu"><input className="input" type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} /></Field>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="1. rok %"><input className="input" value={firstRate} onChange={(e) => setFirstRate(e.target.value)} inputMode="decimal" /></Field>
              <Field label="Marża %"><input className="input" value={margin} onChange={(e) => setMargin(e.target.value)} inputMode="decimal" /></Field>
              <Field label="CPI do prognozy %"><input className="input" value={inflation} onChange={(e) => setInflation(e.target.value)} inputMode="decimal" /></Field>
            </div>
            <button disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400 disabled:opacity-60">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Dodaj obligację
            </button>
          </form>
        </Card>

        <Card>
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-white">Lista obligacji</h3>
              <p className="mt-1 text-sm text-slate-500">Wartości aktualizują się po zmianie CPI do prognozy.</p>
            </div>
          </div>

          {loading ? (
            <div className="flex min-h-80 items-center justify-center text-slate-400"><Loader2 className="mr-2 animate-spin" />Ładowanie obligacji...</div>
          ) : projections.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center text-sm text-slate-500">Brak obligacji EDO. Dodaj pierwszą serię po lewej.</div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-white/[0.04] text-slate-500">
                  <tr><th className="p-4 text-left">Seria</th><th className="p-4 text-right">Szt.</th><th className="p-4 text-right">Kapitał</th><th className="p-4 text-right">Akt. %</th><th className="p-4 text-right">Odsetki</th><th className="p-4 text-right">Po podatku</th><th className="p-4 text-right">Wykup est.</th><th className="p-4 text-right">Akcja</th></tr>
                </thead>
                <tbody>
                  {projections.map((p) => (
                    <tr key={p.bond.id} className="border-t border-white/10 text-slate-300 transition hover:bg-white/[0.03]">
                      <td className="p-4"><div className="font-semibold text-white">{p.bond.series}</div><div className="text-xs text-slate-500">{p.bond.purchase_date} → {p.bond.maturity_date}</div></td>
                      <td className="p-4 text-right text-white">{p.bond.quantity}</td>
                      <td className="p-4 text-right text-slate-300">{PLN.format(p.principal)}</td>
                      <td className="p-4 text-right text-slate-300">{PCT.format(p.effectiveRate)}</td>
                      <td className="p-4 text-right text-emerald-400">{PLN2.format(p.accruedInterest)}</td>
                      <td className="p-4 text-right text-white">{PLN.format(p.currentValueAfterTax)}</td>
                      <td className="p-4 text-right text-violet-300">{PLN.format(p.maturityValueEstimate)}</td>
                      <td className="p-4 text-right"><button onClick={() => handleDelete(p.bond.id)} className="rounded-xl p-2 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300"><Trash2 size={16} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <FeatureNote>
        To jest model EDO v1: pierwszy rok według wpisanego oprocentowania, kolejne lata jako CPI + marża. Później możemy dodać tabelę inflacji CPI miesiąc po miesiącu i dokładniejszy harmonogram kapitalizacji.
      </FeatureNote>
    </Shell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>{children}</label>
}
