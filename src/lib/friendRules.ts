// Friend-request rules that don't need the network. The calls are in
// friends.ts; the database functions are the real gatekeeper.
import { USERNAME_MAX } from './validation.ts'

export const SEARCH_MIN = 3

export function normalizeSearch(query: string): string {
  return query.trim().toLowerCase()
}

/** Mirrors search_users' own check, so the server is only asked valid questions. */
export function searchQueryError(query: string): string | null {
  if (query === '') return null
  if (query.length < SEARCH_MIN) return `Type at least ${SEARCH_MIN} characters.`
  if (query.length > USERNAME_MAX) return `Usernames are at most ${USERNAME_MAX} characters.`
  if (!/^[a-z0-9_]+$/.test(query)) return 'Usernames contain only letters, numbers and underscores.'
  return null
}

// The custom codes raised by the functions (listed at the top of the migration).
const MESSAGES: Record<string, string> = {
  TB001: "You can't send a request to this person.",
  TB002: "You're already friends.",
  TB003: 'This request was already answered or cancelled.',
  TB005: 'They declined your last request. You can ask again after 24 hours.',
}

export function friendErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  const known = error?.code ? MESSAGES[error.code] : undefined
  if (known) return known
  // Rate limits: the server's message says which limit and how long to wait.
  if (error?.code === 'TB004' && error.message) return error.message
  return 'Something went wrong. Please try again.'
}
