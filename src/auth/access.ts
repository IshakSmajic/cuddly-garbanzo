// Decides where a visitor may be, given their auth state. Kept free of React
// so the rules can be unit-tested.

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; hasUsername: boolean }

/** guest: sign-in/sign-up pages. onboarding: choose a username. app: everything else. */
export type Area = 'guest' | 'onboarding' | 'app'

/** Returns the path to redirect to, or null if the visitor may stay. */
export function redirectFor(state: AuthState, area: Area): string | null {
  if (state.status === 'loading') return null

  if (state.status === 'signedOut') {
    return area === 'guest' ? null : '/sign-in'
  }

  const home = state.hasUsername ? '/' : '/onboarding'
  switch (area) {
    case 'guest':
      return home
    case 'onboarding':
      return state.hasUsername ? '/' : null
    case 'app':
      return state.hasUsername ? null : '/onboarding'
  }
}
