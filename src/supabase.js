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
