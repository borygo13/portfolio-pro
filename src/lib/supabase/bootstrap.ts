import type { User } from '@supabase/supabase-js'
import { supabase } from './client'

export async function ensureUserWorkspace(user: User) {
  const email = user.email ?? null

  await supabase.from('profiles').upsert({
    id: user.id,
    email,
  })

  const { data: existingPortfolio, error: portfolioCheckError } = await supabase
    .from('portfolios')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (portfolioCheckError) {
    console.warn('Nie udało się sprawdzić portfolio:', portfolioCheckError.message)
    return
  }

  if (!existingPortfolio) {
    await supabase.from('portfolios').insert({
      user_id: user.id,
      name: 'Portfel osobisty',
      currency: 'PLN',
    })
  }
}
