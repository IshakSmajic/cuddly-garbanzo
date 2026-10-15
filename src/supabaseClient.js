import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  // sessionStorage keeps each tab signed in separately, so Alice and Bob
  // can chat from two tabs of the same browser.
  { auth: { storage: window.sessionStorage } },
)
