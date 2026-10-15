import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase.ts'
import { AuthContext, type Profile } from './context.ts'

type LoadedProfile = { userId: string; profile: Profile | null; error: string | null }

async function fetchProfile(userId: string): Promise<LoadedProfile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  return {
    userId,
    profile: data,
    error: error ? error.message : data ? null : 'Profile not found.',
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // undefined = not yet known; null = signed out.
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  // Tagged with the user it was loaded for, so a stale profile is never shown
  // for a different session.
  const [loaded, setLoaded] = useState<LoadedProfile | null>(null)

  useEffect(() => {
    // getSession waits for the client to finish reading the URL, which is how
    // the email-confirmation link signs the user in.
    supabase.auth.getSession().then(({ data }) => setSession(data.session))

    // Don't await Supabase calls inside this callback: it runs while the
    // client holds an internal lock, so they would deadlock. Just record the
    // session; the effect below does the fetching.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) return
    let stale = false
    fetchProfile(userId).then((result) => {
      if (!stale) setLoaded(result)
    })
    return () => {
      stale = true
    }
  }, [userId])

  const refreshProfile = useCallback(async () => {
    if (userId) setLoaded(await fetchProfile(userId))
  }, [userId])

  const value = useMemo(() => {
    const current = userId !== null && loaded?.userId === userId ? loaded : null
    return {
      session: session ?? null,
      profile: current?.profile ?? null,
      profileError: current?.error ?? null,
      loading: session === undefined || (userId !== null && !current),
      refreshProfile,
    }
  }, [session, userId, loaded, refreshProfile])

  return <AuthContext value={value}>{children}</AuthContext>
}
