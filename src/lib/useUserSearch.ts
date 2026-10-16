import { useEffect, useState } from 'react'
import { normalizeSearch, searchQueryError } from './friendRules.ts'
import { searchUsers, type SearchResult } from './friends.ts'

export type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'done'; results: SearchResult[] }
  | { status: 'error'; error: string }

/**
 * Searches once typing pauses. Each search counts against the server's limit
 * (30 a minute), so the pause is a little longer than the username check's.
 */
export function useUserSearch(input: string) {
  const query = normalizeSearch(input)
  const problem = searchQueryError(query)
  const shouldSearch = query !== '' && !problem
  // Result of the last search, tagged with the query it was for.
  const [lookup, setLookup] = useState<{ query: string; state: SearchState } | null>(null)

  const state: SearchState = !shouldSearch
    ? { status: 'idle' }
    : lookup?.query === query
      ? lookup.state
      : { status: 'searching' }

  useEffect(() => {
    if (!shouldSearch) return
    let stale = false
    const timer = setTimeout(async () => {
      let next: SearchState
      try {
        next = { status: 'done', results: await searchUsers(query) }
      } catch (e) {
        next = { status: 'error', error: e instanceof Error ? e.message : 'Search failed.' }
      }
      if (!stale) setLookup({ query, state: next })
    }, 500)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query, shouldSearch])

  return { query, problem, state }
}
