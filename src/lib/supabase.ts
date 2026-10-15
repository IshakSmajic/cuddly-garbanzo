import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types.ts'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. See README → Environment.',
  )
}

export const supabase = createClient<Database>(url, key)
