import type { User } from '@supabase/supabase-js'
import { supabase } from './client'

const BOOTSTRAP_TIMEOUT_MS = 12000

export function withSupabaseTimeout<T>(promise: PromiseLike<T>, message: string, timeoutMs = BOOTSTRAP_TIMEOUT_MS): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })
}

export async function ensureUserWorkspace(user: User, timeoutMs = BOOTSTRAP_TIMEOUT_MS) {
  const email = user.email ?? null

  const { error: profileError } = await withSupabaseTimeout(
    supabase.from('profiles').upsert({
      id: user.id,
      email,
    }),
    'Nie udało się zapisać profilu użytkownika w Supabase.',
    timeoutMs,
  )

  if (profileError) {
    throw new Error(`Nie udało się zapisać profilu użytkownika: ${profileError.message}`)
  }

  const { data: existingPortfolio, error: portfolioCheckError } = await withSupabaseTimeout(
    supabase
      .from('portfolios')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle(),
    'Nie udało się sprawdzić portfolio użytkownika w Supabase.',
    timeoutMs,
  )

  if (portfolioCheckError) {
    throw new Error(`Nie udało się sprawdzić portfolio użytkownika: ${portfolioCheckError.message}`)
  }

  if (!existingPortfolio) {
    const { error: portfolioInsertError } = await withSupabaseTimeout(
      supabase.from('portfolios').insert({
        user_id: user.id,
        name: 'Portfel osobisty',
        currency: 'PLN',
      }),
      'Nie udało się utworzyć portfolio użytkownika w Supabase.',
      timeoutMs,
    )

    if (portfolioInsertError) {
      throw new Error(`Nie udało się utworzyć portfolio użytkownika: ${portfolioInsertError.message}`)
    }
  }
}
