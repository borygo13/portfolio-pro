'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3, Eye, EyeOff, KeyRound, Loader2, Mail, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { ensureUserWorkspace } from '@/lib/supabase/bootstrap'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) router.replace('/dashboard')
      else setCheckingSession(false)
    })
  }, [router])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      if (mode === 'login') {
        const { data, error: loginError } = await supabase.auth.signInWithPassword({ email, password })
        if (loginError) throw loginError
        if (data.user) await ensureUserWorkspace(data.user)
        router.replace('/dashboard')
        return
      }

      const { data, error: registerError } = await supabase.auth.signUp({ email, password })
      if (registerError) throw registerError

      if (data.user && data.session) {
        await ensureUserWorkspace(data.user)
        router.replace('/dashboard')
        return
      }

      setMessage('Konto utworzone. Sprawdź maila i potwierdź adres, jeśli Supabase wymaga potwierdzenia.')
    } catch (err: any) {
      setError(err?.message ?? 'Coś poszło nie tak. Sprawdź dane i spróbuj ponownie.')
    } finally {
      setLoading(false)
    }
  }

  if (checkingSession) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#070b1a] text-white">
        <Loader2 className="animate-spin text-violet-300" />
      </div>
    )
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#070b1a] px-4 py-10 text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(124,58,237,.30),transparent_32%),radial-gradient(circle_at_85%_20%,rgba(6,182,212,.16),transparent_30%),linear-gradient(135deg,#070b1a,#0f172a_55%,#111827)]" />

      <section className="relative grid w-full max-w-6xl overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/65 shadow-2xl shadow-black/40 backdrop-blur-xl lg:grid-cols-[1.1fr_.9fr]">
        <div className="hidden min-h-[660px] border-r border-white/10 p-10 lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="mb-10 flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-500 text-white shadow-lg shadow-violet-500/30">
                <BarChart3 size={22} />
              </div>
              <div>
                <p className="font-semibold leading-5 text-white">Portfolio PRO</p>
                <p className="text-sm text-slate-500">Prywatny tracker inwestycji</p>
              </div>
            </div>

            <h1 className="max-w-xl text-5xl font-bold leading-tight tracking-tight text-white">
              Jeden panel do long-term, CFD, crypto i obligacji EDO.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-slate-400">
              Stage B dodaje prawdziwe logowanie Supabase, sesję użytkownika i automatyczne tworzenie workspace w bazie.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              ['Auth', 'email/hasło'],
              ['RLS', 'dane prywatne'],
              ['Postgres', 'backup-ready'],
            ].map(([a, b]) => (
              <div key={a} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="font-semibold text-white">{a}</p>
                <p className="mt-1 text-xs text-slate-500">{b}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 sm:p-10">
          <div className="mb-8 lg:hidden">
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-violet-500 text-white">
              <BarChart3 size={22} />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Portfolio PRO</h1>
            <p className="mt-2 text-sm text-slate-400">Logowanie do prywatnego panelu inwestycyjnego.</p>
          </div>

          <div className="mb-8 inline-flex rounded-2xl border border-white/10 bg-white/[0.04] p-1">
            <button
              onClick={() => setMode('login')}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${mode === 'login' ? 'bg-violet-500 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Logowanie
            </button>
            <button
              onClick={() => setMode('register')}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${mode === 'register' ? 'bg-violet-500 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Rejestracja
            </button>
          </div>

          <h2 className="text-3xl font-bold tracking-tight text-white">
            {mode === 'login' ? 'Witaj z powrotem' : 'Utwórz konto'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {mode === 'login'
              ? 'Zaloguj się, żeby przejść do dashboardu.'
              : 'Na start wystarczy email i hasło. Konto będzie przypisane do Twojej bazy Supabase.'}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Email</span>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 focus-within:border-violet-400/60">
                <Mail size={18} className="text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="twoj@email.pl"
                  className="w-full bg-transparent text-white outline-none placeholder:text-slate-600"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Hasło</span>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 focus-within:border-violet-400/60">
                <KeyRound size={18} className="text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="minimum 6 znaków"
                  className="w-full bg-transparent text-white outline-none placeholder:text-slate-600"
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="text-slate-500 hover:text-white">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
            {message ? <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">{message}</div> : null}

            <button
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-5 py-4 text-sm font-bold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <ShieldCheck size={18} />}
              {mode === 'login' ? 'Zaloguj' : 'Utwórz konto'}
            </button>
          </form>

          <p className="mt-6 text-xs leading-6 text-slate-500">
            W trybie developmentu możesz w Supabase wyłączyć potwierdzanie maila, wtedy rejestracja od razu przeniesie Cię do dashboardu.
          </p>
        </div>
      </section>
    </main>
  )
}
