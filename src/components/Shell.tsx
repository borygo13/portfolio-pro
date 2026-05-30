'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ButtonHTMLAttributes } from 'react'
import clsx from 'clsx'
import { AuthGate, AuthStatus } from '@/components/AuthGate'
import {
  AlertTriangle,
  BarChart3,
  Bell,
  BrainCircuit,
  CalendarDays,
  Coins,
  Download,
  Landmark,
  LineChart,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Wallet,
} from 'lucide-react'

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: BarChart3 },
  {
    href: '/long-term',
    label: 'Long-term',
    icon: Wallet,
    children: [
      { href: '/long-term', label: 'Pozycje', icon: Wallet },
      { href: '/long-term/transactions', label: 'Transakcje', icon: Plus },
      { href: '/long-term/bonds', label: 'Obligacje EDO', icon: Landmark },
      { href: '/long-term/intelligence', label: 'Intelligence', icon: BrainCircuit },
    ],
  },
  { href: '/trading', label: 'CFD / Trading', icon: LineChart },
  { href: '/crypto', label: 'Crypto', icon: Coins },
  { href: '/settings', label: 'Backup / Ustawienia', icon: Settings },
]

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <AuthGate>
    <div className="min-h-screen overflow-hidden bg-[#070b1a] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(124,58,237,.22),transparent_30%),radial-gradient(circle_at_85%_10%,rgba(6,182,212,.10),transparent_28%)]" />
      <div className="relative flex min-h-screen">
        <aside className="hidden w-[280px] shrink-0 border-r border-white/10 bg-slate-950/65 backdrop-blur-xl xl:block">
          <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-500 text-white shadow-lg shadow-violet-500/30"><BarChart3 size={21} /></div>
            <div>
              <div className="font-semibold leading-5 text-white">Panel</div>
              <div className="font-semibold leading-5 text-white">Inwestycyjny</div>
            </div>
          </div>

          <nav className="space-y-2 p-4">
            {nav.map((item) => {
              const Icon = item.icon
              const hasChildren = 'children' in item && item.children
              const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`)) || (pathname === '/' && item.href === '/dashboard')

              if (hasChildren) {
                return (
                  <div key={item.href} className="space-y-1">
                    <Link
                      href={item.href}
                      className={clsx(
                        'flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition',
                        active
                          ? 'border border-violet-400/50 bg-violet-500/25 text-white shadow-lg shadow-violet-950/40'
                          : 'text-slate-400 hover:bg-white/5 hover:text-white',
                      )}
                    >
                      <Icon size={18} />
                      {item.label}
                    </Link>
                    <div className="ml-5 space-y-1 border-l border-white/10 pl-3">
                      {item.children.map((child) => {
                        const ChildIcon = child.icon
                        const childActive = pathname === child.href
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={clsx(
                              'flex items-center gap-2 rounded-xl px-3 py-2 text-xs transition',
                              childActive
                                ? 'bg-white/10 text-white'
                                : 'text-slate-500 hover:bg-white/5 hover:text-slate-200',
                            )}
                          >
                            <ChildIcon size={14} />
                            {child.label}
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                )
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    'flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition',
                    active
                      ? 'border border-violet-400/50 bg-violet-500/25 text-white shadow-lg shadow-violet-950/40'
                      : 'text-slate-400 hover:bg-white/5 hover:text-white',
                  )}
                >
                  <Icon size={18} />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="absolute bottom-0 left-0 right-0 border-t border-white/10 p-4">
            <div className="mb-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-xs text-emerald-100">
              <div className="mb-1 flex items-center gap-2 font-semibold"><ShieldCheck size={14} />Supabase aktywny</div>
              Logowanie email/hasło + workspace użytkownika.
            </div>
            <AuthStatus />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <Topbar />
          <div className="p-4 md:p-7 xl:p-8">{children}</div>
        </main>
      </div>
    </div>
    </AuthGate>
  )
}

function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-white/10 bg-[#070b1a]/80 px-4 backdrop-blur-xl md:px-7 xl:px-8">
      <div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <CalendarDays size={14} />
          <span>Maj 2026</span>
          <span className="hidden h-1 w-1 rounded-full bg-slate-700 md:block" />
          <span className="hidden md:block">Dane: Supabase</span>
        </div>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-white md:text-2xl">Portfolio PRO</h1>
      </div>

      <div className="hidden min-w-[280px] max-w-md flex-1 px-8 2xl:block">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-500">
          <Search size={17} />
          <span>Szukaj aktywa, transakcji albo trade’a...</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className="hidden items-center gap-2 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400 md:flex">
          <Plus size={16} /> Dodaj
        </button>
        <button className="rounded-2xl p-3 text-slate-400 transition hover:bg-white/10 hover:text-white"><Bell size={18} /></button>
        <button className="rounded-2xl p-3 text-slate-400 transition hover:bg-white/10 hover:text-white"><RefreshCw size={18} /></button>
        <button className="hidden items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15 md:flex"><Download size={16} /> Eksport</button>
      </div>
    </header>
  )
}

export function PageHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <header className="mb-7">
      <p className="text-sm text-slate-500">{eyebrow}</p>
      <h2 className="mt-1 text-3xl font-bold tracking-tight text-white">{title}</h2>
      {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{description}</p> : null}
    </header>
  )
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={clsx('panel p-5 md:p-6', className)}>{children}</section>
}

export function StatCard({ icon: Icon, label, value, sub, tone = 'emerald' }: any) {
  const toneClass = tone === 'red' ? 'text-rose-400' : tone === 'violet' ? 'text-violet-300' : tone === 'cyan' ? 'text-cyan-300' : 'text-emerald-400'
  return (
    <Card className="group relative overflow-hidden">
      <div className="absolute right-0 top-0 h-28 w-28 rounded-full bg-white/[0.04] blur-2xl transition group-hover:bg-violet-500/10" />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-white">{value}</p>
          <p className={clsx('mt-3 text-sm font-semibold', toneClass)}>{sub}</p>
        </div>
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/10 text-slate-200"><Icon size={22} /></div>
      </div>
    </Card>
  )
}

export function FeatureNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

export function TrustBadge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300"><ShieldCheck size={14} />{children}</span>
}

export function PillButton({ children, active = false, ...props }: { children: React.ReactNode; active?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={clsx('rounded-full px-3 py-1.5 text-xs font-semibold transition', active ? 'bg-violet-500 text-white shadow-lg shadow-violet-950/40' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white', props.className)}>
      {children}
    </button>
  )
}
