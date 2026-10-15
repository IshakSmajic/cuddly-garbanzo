import { describe, expect, it } from 'vitest'
import { redirectFor, type Area, type AuthState } from './access.ts'

const signedOut: AuthState = { status: 'signedOut' }
const needsUsername: AuthState = { status: 'signedIn', hasUsername: false }
const ready: AuthState = { status: 'signedIn', hasUsername: true }

describe('redirectFor', () => {
  it.each<[string, AuthState, Area, string | null]>([
    ['signed-out visitor on sign-in', signedOut, 'guest', null],
    ['signed-out visitor on onboarding', signedOut, 'onboarding', '/sign-in'],
    ['signed-out visitor in the app', signedOut, 'app', '/sign-in'],
    ['new user on sign-in', needsUsername, 'guest', '/onboarding'],
    ['new user on onboarding', needsUsername, 'onboarding', null],
    ['new user in the app', needsUsername, 'app', '/onboarding'],
    ['onboarded user on sign-in', ready, 'guest', '/'],
    ['onboarded user on onboarding', ready, 'onboarding', '/'],
    ['onboarded user in the app', ready, 'app', null],
    ['signed-out visitor on reset-password', signedOut, 'account', '/sign-in'],
    ['new user on reset-password', needsUsername, 'account', null],
    ['onboarded user on reset-password', ready, 'account', null],
  ])('%s', (_label, state, area, expected) => {
    expect(redirectFor(state, area)).toBe(expected)
  })

  it('never redirects while auth is still loading', () => {
    for (const area of ['guest', 'onboarding', 'account', 'app'] as const) {
      expect(redirectFor({ status: 'loading' }, area)).toBeNull()
    }
  })
})
