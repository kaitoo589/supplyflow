import { createClient } from '@supabase/supabase-js'

// URL + publieke (anon/publishable) key. Bij voorkeur uit env-vars (Vercel),
// met fallback naar de bekende waarden zodat lokaal + preview altijd werken.
// De publishable key is bedoeld om publiek te zijn (beschermd door RLS) en
// belandt sowieso in de client-bundle, dus de fallback is geen lek.
const url =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://bjtpnuxjbazlbaoyflcx.supabase.co'

const anonKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_MADFdk7TZyd6j-qDq2-U_Q__7RElFQN'

export const supabase = createClient(url, anonKey)

// Edge function aanroepen NAMENS de ingelogde klant.
//
// Waarom niet gewoon supabase.functions.invoke(): de edge functions leiden de
// gebruiker af uit de Authorization-header (auth.getUser()). Staat de app een
// tijd op de achtergrond — op iOS bevriest Safari dan de timers — dan mist de
// automatische token-refresh en stuurt de client een VERLOPEN JWT mee. De
// functie ziet dan geen gebruiker en antwoordt "Not authenticated", terwijl de
// app nog het oude saldo toont. Daarom: sessie ophalen, bij (bijna) verlopen
// eerst verversen, en het token expliciet meesturen.
export async function invokeAsUser(name, body) {
  let { data: { session } } = await supabase.auth.getSession()
  const expMs = session?.expires_at ? session.expires_at * 1000 : 0
  if (!session || expMs - Date.now() < 60_000) {
    const { data } = await supabase.auth.refreshSession()
    session = data?.session ?? session
  }
  if (!session?.access_token) {
    throw new Error('Your session expired — please sign in again')
  }
  return supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
}

// Haalt de échte reden uit een mislukte functions.invoke. supabase-js geeft bij
// een non-2xx alleen "Edge Function returned a non-2xx status code"; de zinnige
// tekst staat in de response-body, en `error.context` IS die Response.
export async function functionErrorMessage(error) {
  const resp = error?.context
  if (resp && typeof resp.clone === 'function') {
    try {
      const j = await resp.clone().json()
      if (j?.error) return j.error
    } catch { /* geen JSON */ }
    try {
      const t = await resp.clone().text()
      if (t) return t
    } catch { /* niks */ }
  }
  return error?.message || 'Unknown error'
}
