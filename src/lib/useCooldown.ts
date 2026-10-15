import { useCallback, useEffect, useState } from 'react'

export const RESEND_COOLDOWN_SECONDS = 60 // the hosted project allows one email per 60 s

/** Seconds left before another email may be requested, and a function to restart the wait. */
export function useCooldown(): [number, () => void] {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (seconds <= 0) return
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [seconds])

  const start = useCallback(() => setSeconds(RESEND_COOLDOWN_SECONDS), [])
  return [seconds, start]
}
