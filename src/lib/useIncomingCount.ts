import { useEffect, useState } from 'react'
import { incomingRequestCount, onFriendsChanged } from './friends.ts'

/** Pending requests waiting for you; refreshed whenever a screen changes one. */
export function useIncomingCount(userId: string | undefined): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!userId) return
    let stale = false
    const load = () =>
      incomingRequestCount(userId).then(
        (n) => !stale && setCount(n),
        () => {}, // only a badge; the requests page shows real errors
      )
    void load()
    const stop = onFriendsChanged(() => void load())
    return () => {
      stale = true
      stop()
    }
  }, [userId])

  return count
}
