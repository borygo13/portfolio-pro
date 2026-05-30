'use client'

import { Shell, PageHeader, Card, StatCard, FeatureNote } from '@/components/Shell'
import { Activity, BarChart3, BookOpen, ShieldAlert } from 'lucide-react'

export default function TradingPage() {
  return (
    <Shell>
      <PageHeader
        eyebrow="CFD / Trading"
        title="Trading journal"
        description="Osobny moduł dla aktywnego tradingu, żeby nie mieszać CFD, marginu i dźwigni z portfelem długoterminowym."
      />

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <StatCard icon={BarChart3} label="Net P/L" value="—" sub="brak realnych trade'ów" tone="cyan" />
        <StatCard icon={Activity} label="Winrate" value="—" sub="sekcja w budowie" tone="violet" />
        <StatCard icon={BookOpen} label="Dziennik" value="C7" sub="planowany osobny moduł" />
        <StatCard icon={ShieldAlert} label="Ryzyko" value="—" sub="nie liczymy placeholderów" tone="red" />
      </div>

      <div className="mt-6 grid gap-6 2xl:grid-cols-[1.1fr_.9fr]">
        <Card>
          <h3 className="text-lg font-bold text-white">Brak realnych danych tradingowych</h3>
          <div className="mt-5 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-sm leading-6 text-slate-400">
            Ten widok nie pokazuje już przykładowych wyników CFD jako prawdziwych statystyk. Dziennik tradingowy, import z brokera, prowizje, swap, margin i wyniki strategii będą osobnym etapem.
          </div>
        </Card>

        <Card>
          <h3 className="text-lg font-bold text-white">Status modułu</h3>
          <div className="mt-5 space-y-3 text-sm">
            <Row label="Dane użytkownika" value="Brak" />
            <Row label="Wartości demo" value="Wyłączone" good />
            <Row label="Long-term portfolio" value="Oddzielone" good />
            <Row label="Planowany etap" value="C7" />
          </div>
          <FeatureNote>Trading będzie osobnym dziennikiem. Ten PR nie dodaje CFD, futures, dźwigni ani broker importu.</FeatureNote>
        </Card>
      </div>
    </Shell>
  )
}

function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] px-4 py-3">
      <span className="text-slate-400">{label}</span>
      <span className={good ? 'font-bold text-emerald-400' : 'font-bold text-white'}>{value}</span>
    </div>
  )
}
