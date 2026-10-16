import { useEffect, useState } from 'react'
import { incomingRequestCount, onFriendsChanged } from './friends.ts'
import { subscribe } from './realtime.ts'

/** Pending requests waiting for you: live, and right after this tab changes one. */
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
    // Any insert or update you can see is one of your requests changing.
    const stopLive = subscribe({ table: 'friend_requests', event: '*', onChange: () => void load(), onReady: () => void load() })
    return () => {
      stale = true
      stop()
      stopLive()
    }
  }, [userId])

  return count
}
