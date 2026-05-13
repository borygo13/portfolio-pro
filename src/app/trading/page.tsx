'use client'

import { Shell, PageHeader, Card, StatCard, FeatureNote } from '@/components/Shell'
import { PnlChart } from '@/components/Charts'
import { tradingByDay, tradingStats } from '@/lib/demo-data'
import { PLN, PCT } from '@/lib/format'
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, Target } from 'lucide-react'

export default function TradingPage() {
  const winrate = tradingStats.wins / tradingStats.trades
  return (
    <Shell>
      <PageHeader eyebrow="CFD / Trading" title="Trading journal" description="Osobny moduł dla aktywnego tradingu, żeby nie mieszać CFD z portfelem długoterminowym." />
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <StatCard icon={BarChart3} label="Net P/L" value={PLN.format(tradingStats.netPnl)} sub="po kosztach" />
        <StatCard icon={Target} label="Winrate" value={PCT.format(winrate)} sub={`${tradingStats.wins}W / ${tradingStats.losses}L`} />
        <StatCard icon={Activity} label="Avg per trade" value={PLN.format(tradingStats.avgTrade)} sub={`${tradingStats.trades} trade'y`} />
        <StatCard icon={ArrowDownRight} label="Max drawdown" value={PLN.format(tradingStats.maxDrawdown)} sub="kontrola ryzyka" tone="red" />
      </div>
      <div className="mt-6 grid gap-6 2xl:grid-cols-[1.3fr_.7fr]">
        <Card>
          <h3 className="text-lg font-bold text-white">P/L dzienny</h3>
          <p className="mt-1 text-sm text-slate-500">Podstawa do avg daily i kontroli limitów.</p>
          <PnlChart data={tradingByDay} />
        </Card>
        <Card>
          <h3 className="text-lg font-bold text-white">Statystyki CFD</h3>
          <div className="mt-5 space-y-4 text-sm">
            <Row label="Avg daily" value={PLN.format(tradingStats.avgDaily)} />
            <Row label="Best trade" value={PLN.format(tradingStats.bestTrade)} good />
            <Row label="Worst trade" value={PLN.format(tradingStats.worstTrade)} bad />
            <Row label="Profit factor" value={tradingStats.profitFactor.toFixed(2)} />
            <Row label="Liczba trade'ów" value={String(tradingStats.trades)} />
          </div>
          <FeatureNote>Tu później dodamy instrument, setup, screenshot wejścia, notatkę, prowizję, swap, margin i wynik według strategii.</FeatureNote>
        </Card>
      </div>
      <Card className="mt-6">
        <h3 className="text-lg font-bold text-white">Dziennik transakcji</h3>
        <div className="mt-5 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center text-sm text-slate-400">Na razie placeholder. Po Supabase dodamy formularz trade'a i import z brokera.</div>
      </Card>
    </Shell>
  )
}

function Row({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] px-4 py-3"><span className="text-slate-400">{label}</span><span className={good ? 'font-bold text-emerald-400' : bad ? 'font-bold text-rose-400' : 'font-bold text-white'}>{value}</span></div>
}
