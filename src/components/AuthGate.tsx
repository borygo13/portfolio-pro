'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { ensureUserWorkspace, withSupabaseTimeout } from '@/lib/supabase/bootstrap'

const SESSION_TIMEOUT_MS = 8000

type GateState =
  | { status: 'loading'; user: null; error?: undefined }
  | { status: 'redirecting'; user: null; error?: undefined }
  | { status: 'ready'; user: User; error?: undefined }
  | { status: 'error'; user: null; error: string }

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [gate, setGate] = useState<GateState>({ status: 'loading', user: null })
  const [retryKey, setRetryKey] = useState(0)
  const bootstrappedUserIdRef = useRef<string | null>(null)
  const bootstrapRef = useRef<{ userId: string; promise: Promise<void> } | null>(null)
  const requestIdRef = useRef(0)

  const ensureWorkspaceOnce = useCallback((currentUser: User) => {
    if (bootstrappedUserIdRef.current === currentUser.id) return Promise.resolve()

    const existing = bootstrapRef.current
    if (existing?.userId === currentUser.id) return existing.promise

    const promise = ensureUserWorkspace(currentUser)
      .then(() => {
        bootstrappedUserIdRef.current = currentUser.id
      })
      .finally(() => {
        if (bootstrapRef.current?.promise === promise) bootstrapRef.current = null
      })

    bootstrapRef.current = { userId: currentUser.id, promise }
    return promise
  }, [])

  useEffect(() => {
    let active = true
    const initialRequestId = ++requestIdRef.current

    async function loadSession() {
      setGate({ status: 'loading', user: null })

      try {
        const { data, error } = await withSupabaseTimeout(
          supabase.auth.getSession(),
          'Sprawdzanie sesji Supabase trwa zbyt długo. Spróbuj ponownie.',
          SESSION_TIMEOUT_MS,
        )

        if (!active || requestIdRef.current !== initialRequestId) return
        if (error) throw error

        const currentUser = data.session?.user ?? null

        if (!currentUser) {
          setGate({ status: 'redirecting', user: null })
          router.replace('/login')
          return
        }

        await ensureWorkspaceOnce(currentUser)

        if (!active || requestIdRef.current !== initialRequestId) return
        setGate({ status: 'ready', user: currentUser })
      } catch (err) {
        if (!active || requestIdRef.current !== initialRequestId) return
        setGate({
          status: 'error',
          user: null,
          error: errorMessage(err, 'Nie udało się załadować sesji i workspace Supabase.'),
        })
      }
    }

    loadSession()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null

      window.setTimeout(() => {
        if (!active) return

        if (!currentUser) {
          bootstrappedUserIdRef.current = null
          bootstrapRef.current = null
          requestIdRef.current += 1
          setGate({ status: 'redirecting', user: null })
          router.replace('/login')
          return
        }

        if (bootstrappedUserIdRef.current === currentUser.id) {
          requestIdRef.current += 1
          setGate({ status: 'ready', user: currentUser })
          return
        }

        const authEventRequestId = ++requestIdRef.current
        setGate({ status: 'loading', user: null })

        ensureWorkspaceOnce(currentUser)
          .then(() => {
            if (!active || requestIdRef.current !== authEventRequestId) return
            setGate({ status: 'ready', user: currentUser })
          })
          .catch((err) => {
            if (!active || requestIdRef.current !== authEventRequestId) return
            setGate({
              status: 'error',
              user: null,
              error: errorMessage(err, 'Nie udało się przygotować workspace Supabase.'),
            })
          })
      }, 0)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [ensureWorkspaceOnce, retryKey, router])

  if (gate.status === 'loading' || gate.status === 'redirecting') {
    return (
      <div className="grid min-h-screen place-items-center bg-[#070b1a] text-slate-100">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl shadow-black/30">
          <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-violet-500/20 text-violet-200">
            <Loader2 className="animate-spin" />
          </div>
          <p className="font-semibold text-white">Ładowanie portfela...</p>
          <p className="mt-2 text-sm text-slate-500">Sprawdzam sesję i workspace Supabase.</p>
        </div>
      </div>
    )
  }

  if (gate.status === 'error') {
    return (
      <div className="grid min-h-screen place-items-center bg-[#070b1a] px-4 text-slate-100">
        <div className="max-w-md rounded-3xl border border-rose-500/20 bg-rose-500/10 p-8 text-center shadow-2xl shadow-black/30">
          <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-rose-500/20 text-rose-100">
            <AlertTriangle />
          </div>
          <p className="font-semibold text-white">Nie udało się załadować portfela.</p>
          <p className="mt-3 text-sm leading-6 text-rose-100/90">{gate.error}</p>
          <button
            onClick={() => setRetryKey((value) => value + 1)}
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-2xl bg-white/10 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/15"
          >
            <RefreshCw size={16} /> Spróbuj ponownie
          </button>
        </div>
      </div>
    )
  }

  const user = gate.user
  if (!user) return null
  return <>{children}</>
}

export function AuthStatus() {
  const [email, setEmail] = useState<string>('')
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''))
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/[0.04] p-3">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 text-sm font-bold text-white">
        {email ? email.slice(0, 2).toUpperCase() : <ShieldCheck size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{email || 'Zalogowany'}</p>
        <button onClick={signOut} className="text-xs font-semibold text-slate-500 transition hover:text-white">
          Wyloguj
        </button>
      </div>
    </div>
  )
}
