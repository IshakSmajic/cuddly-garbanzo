import { Navigate, Outlet } from 'react-router'
import { FullScreenMessage } from '../components/FullScreenMessage.tsx'
import { supabase } from '../lib/supabase.ts'
import { redirectFor, type Area, type AuthState } from './access.ts'
import { useAuth } from './context.ts'

/** Route wrapper: renders the child route only if the visitor belongs in `area`. */
export function Gate({ area }: { area: Area }) {
  const { session, profile, profileError, loading, refreshProfile } = useAuth()

  if (loading) return <FullScreenMessage title="Loading…" />

  if (session && profileError) {
    return (
      <FullScreenMessage
        title="Couldn't load your profile."
        detail={profileError}
        actions={[
          { label: 'Try again', onClick: () => void refreshProfile() },
          // Never leave someone stuck here: they can always start over.
          { label: 'Sign out', onClick: () => void supabase.auth.signOut({ scope: 'local' }) },
        ]}
      />
    )
  }

  const state: AuthState = session
    ? { status: 'signedIn', hasUsername: Boolean(profile?.username) }
    : { status: 'signedOut' }

  const to = redirectFor(state, area)
  return to ? <Navigate to={to} replace /> : <Outlet />
}
