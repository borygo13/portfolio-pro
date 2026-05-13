'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { Loader2, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { ensureUserWorkspace } from '@/lib/supabase/bootstrap'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function loadSession() {
      const { data } = await supabase.auth.getSession()
      const currentUser = data.session?.user ?? null

      if (!active) return

      if (!currentUser) {
        setLoading(false)
        router.replace('/login')
        return
      }

      await ensureUserWorkspace(currentUser)
      setUser(currentUser)
      setLoading(false)
    }

    loadSession()

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const currentUser = session?.user ?? null
      if (!currentUser) {
        setUser(null)
        router.replace('/login')
        return
      }

      await ensureUserWorkspace(currentUser)
      setUser(currentUser)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [router])

  if (loading) {
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
