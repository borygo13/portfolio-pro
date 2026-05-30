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
import { PLN, PCT, formatCurrencyValue } from '@/lib/format'

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
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' })
}

function axisDateLabel(value: unknown, range: ChartRange = 'MAX') {
  if (typeof value !== 'string') return String(value ?? '')
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return value
  if (range === '30D' || range === '90D') return date.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' })
  if (range === '1Y') return date.toLocaleDateString('pl-PL', { month: 'short', year: '2-digit' })
  return date.toLocaleDateString('pl-PL', { year: 'numeric' })
}

function axisBucket(value: string, range: ChartRange) {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return value
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = date.getUTCDate()
  if (range === '30D') return value
  if (range === '90D') return `${year}-${month}-w${Math.floor((day - 1) / 7)}`
  if (range === '1Y') return `${year}-${month}`
  return String(year)
}

function axisMaxTicks(range: ChartRange) {
  if (range === '30D') return 6
  if (range === '90D') return 7
  if (range === '1Y') return 8
  if (range === '3Y') return 6
  if (range === '5Y') return 7
  return 8
}

function axisMinTickGap(range: ChartRange) {
  if (range === '30D') return 42
  if (range === '90D') return 52
  if (range === '1Y') return 66
  return 78
}

function axisDateTicks(data: { date?: string }[], range: ChartRange) {
  const dates = data.map((item) => item.date).filter((date): date is string => Boolean(date)).sort()
  if (dates.length <= 2) return dates

  const byBucket = new Map<string, string>()
  for (const date of dates) {
    const bucket = axisBucket(date, range)
    if (!byBucket.has(bucket)) byBucket.set(bucket, date)
  }

  const first = dates[0]
  const last = dates[dates.length - 1]
  const candidates = Array.from(new Set([first, ...byBucket.values(), last])).sort()
  const maxTicks = axisMaxTicks(range)
  if (candidates.length <= maxTicks) return candidates

  const sampled = new Set<string>()
  for (let index = 0; index < maxTicks; index += 1) {
    const candidateIndex = Math.round(index * (candidates.length - 1) / (maxTicks - 1))
    sampled.add(candidates[candidateIndex])
  }
  sampled.add(first)
  sampled.add(last)
  return Array.from(sampled).sort()
}

function dateSpanDays(data: { date?: string }[]) {
  const dates = data.map((item) => item.date).filter((date): date is string => Boolean(date)).sort()
  if (dates.length < 2) return 0
  const first = new Date(`${dates[0]}T00:00:00.000Z`).getTime()
  const last = new Date(`${dates[dates.length - 1]}T00:00:00.000Z`).getTime()
  if (!Number.isFinite(first) || !Number.isFinite(last)) return 0
  return Math.max(0, (last - first) / (24 * 60 * 60 * 1000))
}

function effectiveAxisRange(data: { date?: string }[], range: ChartRange) {
  const span = dateSpanDays(data)
  if (span <= 45) return '30D'
  if (span <= 120) return '90D'
  if (span <= 450) return '1Y'
  return range
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

export function EquityChart({ data, range = 'MAX' }: { data: ({ date?: string; month?: string; portfolio: number; contribution: number; benchmark?: number })[]; range?: ChartRange }) {
  const chartData = data.map((item) => ({ ...item, date: item.date ?? item.month ?? '' }))
  const axisRange = effectiveAxisRange(chartData, range)
  const axisTicks = axisDateTicks(chartData, axisRange)
  const hasBenchmark = chartData.some((item) => typeof item.benchmark === 'number' && Number.isFinite(item.benchmark))

  return (
    <ResponsiveContainer width="100%" height={310}>
      <AreaChart data={chartData} margin={{ top: 12, right: 8, left: -15, bottom: 0 }}>
        <defs>
          <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.45} />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
        <XAxis dataKey="date" ticks={axisTicks} interval={0} tickFormatter={(value) => axisDateLabel(value, axisRange)} stroke="#64748b" tickLine={false} axisLine={false} minTickGap={axisMinTickGap(axisRange)} />
        <YAxis stroke="#64748b" tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
        <Tooltip formatter={(v) => PLN.format(Number(v))} labelFormatter={fullDateLabel} contentStyle={tooltip} labelStyle={tooltipText} itemStyle={tooltipText} />
        <Area type="monotone" dataKey="portfolio" name="Portfel" stroke="#8b5cf6" strokeWidth={3} fill="url(#portfolioGradient)" />
        <Line type="monotone" dataKey="contribution" name="Wkład" stroke="#94a3b8" strokeWidth={2} dot={false} strokeDasharray="5 5" />
        {hasBenchmark ? <Line type="monotone" dataKey="benchmark" name="Benchmark" stroke="#06b6d4" strokeWidth={2} dot={false} /> : null}
      </AreaChart>
    </ResponsiveContainer>
  )
}

type AssetHistoryPoint = {
  date?: string
  label: string
  price: number
  currency?: string
  basePrice?: number | null
  baseCurrency?: string | null
  fxRateToBase?: number | null
  fxRateDate?: string | null
  fxFallbackDays?: number | null
  fxMissing?: boolean
}

function AssetHistoryTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload as AssetHistoryPoint | undefined
  if (!point) return null
  const currency = point.currency ?? 'PLN'
  const baseCurrency = point.baseCurrency ?? 'PLN'
  const hasBaseEstimate = point.basePrice != null && Number.isFinite(point.basePrice) && point.basePrice > 0 && baseCurrency !== currency
  const fxDate = point.fxRateDate ?? point.date ?? label
  const fxFallback = point.fxFallbackDays != null && point.fxFallbackDays > 0
  const fxNote = hasBaseEstimate && point.fxRateToBase
    ? `Kurs FX: 1 ${currency} ≈ ${point.fxRateToBase.toLocaleString('pl-PL', { maximumFractionDigits: 4 })} ${baseCurrency} z ${fullDateLabel(fxDate)}${fxFallback ? ' (ostatni dostępny)' : ''}`
    : null

  return (
    <div style={tooltip} className="space-y-1 px-3 py-2 text-sm">
      <p className="font-semibold text-slate-200">{fullDateLabel(point.date ?? label)}</p>
      <p className="text-cyan-100">Cena: {formatCurrencyValue(point.price, currency, 2)}</p>
      {hasBaseEstimate ? <p className="text-slate-300">≈ {formatCurrencyValue(point.basePrice ?? 0, baseCurrency, 2)}</p> : null}
      {point.fxMissing ? <p className="text-amber-100">Wycena {baseCurrency} niedostępna: brak FX dla tej daty.</p> : null}
      {fxNote ? <p className="text-xs text-slate-500">{fxNote}</p> : null}
    </div>
  )
}

export function AssetHistoryChart({ data, range = 'MAX' }: { data: AssetHistoryPoint[]; range?: ChartRange }) {
  const chartData = data.map((item) => ({ ...item, date: item.date ?? item.label }))
  const axisRange = effectiveAxisRange(chartData, range)
  const axisTicks = axisDateTicks(chartData, axisRange)
  const currency = chartData[0]?.currency ?? 'PLN'

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
        <XAxis dataKey="date" ticks={axisTicks} interval={0} tickFormatter={(value) => axisDateLabel(value, axisRange)} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={axisMinTickGap(axisRange)} />
        <YAxis width={58} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => Math.round(Number(v)).toLocaleString('pl-PL')} />
        <Tooltip content={<AssetHistoryTooltip />} />
        <Area type="monotone" dataKey="price" name={`Cena ${currency}`} stroke="#06b6d4" strokeWidth={3} fill="url(#assetHistoryGradient)" />
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
  const axisRange = effectiveAxisRange(chartData, range)
  const axisTicks = axisDateTicks(chartData, axisRange)

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={chartData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} barCategoryGap="38%" maxBarSize={42}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.10)" />
        <XAxis dataKey="date" ticks={axisTicks} interval={0} tickFormatter={(value) => axisDateLabel(value, axisRange)} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={axisMinTickGap(axisRange)} />
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
  const axisRange = effectiveAxisRange(chartData, range)
  const axisTicks = axisDateTicks(chartData, axisRange)

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={chartData} margin={{ top: 12, right: 8, left: -15, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
        <XAxis dataKey="date" ticks={axisTicks} interval={0} tickFormatter={(value) => axisDateLabel(value, axisRange)} stroke="#64748b" tickLine={false} axisLine={false} minTickGap={axisMinTickGap(axisRange)} />
        <YAxis stroke="#64748b" tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(Number(v))}`} />
        <Tooltip formatter={(v) => Number(v).toFixed(1)} labelFormatter={fullDateLabel} contentStyle={tooltip} labelStyle={tooltipText} itemStyle={tooltipText} />
        <Line type="monotone" dataKey="portfolio" name="Portfolio" stroke="#8b5cf6" strokeWidth={3} dot={false} />
        <Line type="monotone" dataKey="benchmark" name="Benchmark" stroke="#06b6d4" strokeWidth={3} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function RollingReturnChart({ data, range = 'MAX' }: { data: { date: string; rollingReturnPct: number }[]; range?: ChartRange }) {
  const axisRange = effectiveAxisRange(data, range)
  const axisTicks = axisDateTicks(data, axisRange)

  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
        <XAxis dataKey="date" ticks={axisTicks} interval={0} tickFormatter={(value) => axisDateLabel(value, axisRange)} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={axisMinTickGap(axisRange)} />
        <YAxis width={58} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => PCT.format(Number(v))} />
        <Tooltip formatter={(v) => PCT.format(Number(v))} labelFormatter={fullDateLabel} contentStyle={tooltip} labelStyle={tooltipText} itemStyle={tooltipText} />
        <Line type="monotone" dataKey="rollingReturnPct" name="Rolling 12M" stroke="#22c55e" strokeWidth={3} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function DrawdownCurveChart({ data, range = 'MAX' }: { data: { date: string; drawdownPct: number }[]; range?: ChartRange }) {
  const axisRange = effectiveAxisRange(data, range)
  const axisTicks = axisDateTicks(data, axisRange)

  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
        <XAxis dataKey="date" ticks={axisTicks} interval={0} tickFormatter={(value) => axisDateLabel(value, axisRange)} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={axisMinTickGap(axisRange)} />
        <YAxis width={58} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => PCT.format(Number(v))} />
        <Tooltip formatter={(v) => PCT.format(Number(v))} labelFormatter={fullDateLabel} contentStyle={tooltip} labelStyle={tooltipText} itemStyle={tooltipText} />
        <Area type="monotone" dataKey="drawdownPct" name="Drawdown" stroke="#ef4444" strokeWidth={3} fill="url(#drawdownGradient)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function BenchmarkRelativeChart({ data, range = 'MAX' }: { data: { date: string; relativeReturnPct: number }[]; range?: ChartRange }) {
  const axisRange = effectiveAxisRange(data, range)
  const axisTicks = axisDateTicks(data, axisRange)

  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
        <XAxis dataKey="date" ticks={axisTicks} interval={0} tickFormatter={(value) => axisDateLabel(value, axisRange)} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={axisMinTickGap(axisRange)} />
        <YAxis width={58} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => PCT.format(Number(v))} />
        <Tooltip formatter={(v) => PCT.format(Number(v))} labelFormatter={fullDateLabel} contentStyle={tooltip} labelStyle={tooltipText} itemStyle={tooltipText} />
        <Line type="monotone" dataKey="relativeReturnPct" name="Relative" stroke="#06b6d4" strokeWidth={3} dot={false} />
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
