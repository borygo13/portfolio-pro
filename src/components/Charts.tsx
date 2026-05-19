'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PLN, PCT } from '@/lib/format'

const COLORS = ['#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#64748b']

const tooltip = {
  background: '#020617',
  border: '1px solid rgba(255,255,255,.12)',
  borderRadius: '16px',
  color: '#fff',
}

const tooltipText = { color: '#e2e8f0' }

type ChartRange = '30D' | '90D' | '1Y' | '3Y' | '5Y' | 'MAX'

function fullDateLabel(value: unknown) {
  if (typeof value !== 'string') return String(value ?? '')
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' })
}

function axisDateLabel(value: unknown, range: ChartRange = 'MAX') {
  if (typeof value !== 'string') return String(value ?? '')
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  if (range === '30D' || range === '90D') return date.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' })
  if (range === '1Y') return date.toLocaleDateString('pl-PL', { month: 'short', year: '2-digit' })
  return date.toLocaleDateString('pl-PL', { year: 'numeric' })
}

export function AllocationChart({ data, total }: { data: { name: string; value: number }[]; total?: number }) {
  return (
    <div className="relative h-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={72} outerRadius={105} paddingAngle={4}>
            {data.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v) => PLN.format(Number(v))} contentStyle={tooltip} />
        </PieChart>
      </ResponsiveContainer>
      {total ? <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><div className="text-lg font-bold text-white">{PLN.format(total)}</div><div className="text-xs text-slate-500">łącznie</div></div></div> : null}
    </div>
  )
}

export function EquityChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height={310}>
      <AreaChart data={data} margin={{ top: 12, right: 8, left: -15, bottom: 0 }}>
        <defs>
          <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.45} />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
        <XAxis dataKey="month" stroke="#64748b" tickLine={false} axisLine={false} />
        <YAxis stroke="#64748b" tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
        <Tooltip formatter={(v) => PLN.format(Number(v))} contentStyle={tooltip} />
        <Area type="monotone" dataKey="portfolio" name="Portfel" stroke="#8b5cf6" strokeWidth={3} fill="url(#portfolioGradient)" />
        <Line type="monotone" dataKey="contribution" name="Wkład" stroke="#94a3b8" strokeWidth={2} dot={false} strokeDasharray="5 5" />
        <Line type="monotone" dataKey="benchmark" name="Benchmark" stroke="#06b6d4" strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function AssetHistoryChart({ data, range = 'MAX' }: { data: { date?: string; label: string; price: number }[]; range?: ChartRange }) {
  const chartData = data.map((item) => ({ ...item, date: item.date ?? item.label }))

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="assetHistoryGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
        <XAxis dataKey="date" tickFormatter={(value) => axisDateLabel(value, range)} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} />
        <YAxis width={58} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => Math.round(Number(v)).toLocaleString('pl-PL')} />
        <Tooltip formatter={(v) => PLN.format(Number(v))} labelFormatter={fullDateLabel} contentStyle={tooltip} labelStyle={tooltipText} itemStyle={tooltipText} />
        <Area type="monotone" dataKey="price" name="Cena" stroke="#06b6d4" strokeWidth={3} fill="url(#assetHistoryGradient)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function DividendChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.10)" />
        <XAxis dataKey="month" stroke="#64748b" tickLine={false} axisLine={false} />
        <YAxis stroke="#64748b" tickLine={false} axisLine={false} />
        <Tooltip formatter={(v) => PLN.format(Number(v))} contentStyle={tooltip} />
        <Bar dataKey="value" fill="#22c55e" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function MonthlyDividendChart({ data }: { data: { month: string; gross: number; tax: number; net: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.10)" />
        <XAxis dataKey="month" stroke="#64748b" tickLine={false} axisLine={false} />
        <YAxis stroke="#64748b" tickLine={false} axisLine={false} />
        <Tooltip formatter={(v) => PLN.format(Number(v))} contentStyle={tooltip} />
        <Bar dataKey="net" name="Netto" fill="#22c55e" radius={[8, 8, 0, 0]} />
        <Bar dataKey="tax" name="Podatek" fill="#f59e0b" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function MonthlyReturnsChart({ data, range = 'MAX' }: { data: { date?: string; month: string; returnPct: number }[]; range?: ChartRange }) {
  const chartData = data.map((item) => ({ ...item, date: item.date ?? item.month }))

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={chartData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} barCategoryGap="38%" maxBarSize={42}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.10)" />
        <XAxis dataKey="date" tickFormatter={(value) => axisDateLabel(value, range)} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} />
        <YAxis width={58} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => PCT.format(Number(v))} />
        <Tooltip formatter={(v) => PCT.format(Number(v))} labelFormatter={fullDateLabel} contentStyle={tooltip} labelStyle={tooltipText} itemStyle={tooltipText} />
        <Bar dataKey="returnPct" name="Zwrot m/m" radius={[8, 8, 0, 0]}>
          {chartData.map((entry, i) => <Cell key={i} fill={entry.returnPct >= 0 ? '#22c55e' : '#ef4444'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function BenchmarkComparisonChart({ data, range = 'MAX' }: { data: { date?: string; month: string; portfolio: number; benchmark: number }[]; range?: ChartRange }) {
  const chartData = data.map((item) => ({ ...item, date: item.date ?? item.month }))

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={chartData} margin={{ top: 12, right: 8, left: -15, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
        <XAxis dataKey="date" tickFormatter={(value) => axisDateLabel(value, range)} stroke="#64748b" tickLine={false} axisLine={false} />
        <YAxis stroke="#64748b" tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(Number(v))}`} />
        <Tooltip formatter={(v) => Number(v).toFixed(1)} labelFormatter={fullDateLabel} contentStyle={tooltip} labelStyle={tooltipText} itemStyle={tooltipText} />
        <Line type="monotone" dataKey="portfolio" name="Portfolio" stroke="#8b5cf6" strokeWidth={3} dot={false} />
        <Line type="monotone" dataKey="benchmark" name="Benchmark" stroke="#06b6d4" strokeWidth={3} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function PnlChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.10)" />
        <XAxis dataKey="day" stroke="#64748b" tickLine={false} axisLine={false} />
        <YAxis stroke="#64748b" tickLine={false} axisLine={false} />
        <Tooltip formatter={(v) => PLN.format(Number(v))} contentStyle={tooltip} />
        <Bar dataKey="pnl" radius={[8, 8, 0, 0]}>
          {data.map((entry, i) => <Cell key={i} fill={entry.pnl >= 0 ? '#22c55e' : '#ef4444'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
