import type { Session } from '@supabase/supabase-js'
import { createContext, use } from 'react'
import type { Database } from '../lib/database.types.ts'

export type Profile = Database['public']['Tables']['profiles']['Row']

export type AuthContextValue = {
  session: Session | null
  profile: Profile | null
  profileError: string | null
  loading: boolean
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = use(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
