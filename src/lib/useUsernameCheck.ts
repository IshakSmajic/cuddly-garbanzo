import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.ts'
import { usernameError } from './validation.ts'

export type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'error'

/**
 * Format check plus a live "is it free?" lookup once typing pauses. Only a
 * hint: two people can race for the same name, and the UNIQUE constraint
 * decides (call markTaken when a save fails with 23505).
 * `current` is the user's own username, which is never reported as taken.
 */
export function useUsernameCheck(username: string, current: string | null = null) {
  // Result of the last lookup, tagged with the name it was for.
  const [lookup, setLookup] = useState<{ username: string; result: Availability } | null>(null)

  const formatError = username ? usernameError(username) : null
  const shouldCheck = username !== '' && !formatError && username !== current
  const availability: Availability = !shouldCheck
    ? 'idle'
    : lookup?.username === username
      ? lookup.result
      : 'checking'

  useEffect(() => {
    if (!shouldCheck) return
    let stale = false
    const timer = setTimeout(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('username', username)
        .maybeSingle()
      if (!stale) setLookup({ username, result: error ? 'error' : data ? 'taken' : 'available' })
    }, 400)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [username, shouldCheck])

  const markTaken = useCallback((name: string) => setLookup({ username: name, result: 'taken' }), [])

  return { formatError, availability, markTaken }
}

export function availabilityHint(username: string, availability: Availability, idle: string): string {
  return {
    idle,
    checking: 'Checking…',
    available: `@${username} is available.`,
    taken: `@${username} is taken.`,
    error: "Couldn't check availability.",
  }[availability]
}
