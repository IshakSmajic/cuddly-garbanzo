import { useState } from 'react'
import {
  cancelRequest,
  notifyFriendsChanged,
  relationshipWith,
  respondToRequest,
  sendRequest,
  unblockUser,
  type RelationState,
} from '../lib/friends.ts'
import { Button } from './Button.tsx'

type Props = {
  userId: string
  initial: RelationState
  /** Called with the relation after each successful action. */
  onChange?: (next: RelationState) => void
}

/**
 * The one control that fits how you relate to someone: add, cancel,
 * accept/decline, unblock, or just "Friends". After an action it asks the
 * server for the new relation rather than guessing it: sending to someone who
 * had already asked you, for example, makes you friends straight away.
 */
export function RelationActions({ userId, initial, onChange }: Props) {
  const [state, setState] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    }
    // Refresh even after an error: the request may have changed meanwhile
    // (answered by the other person, say), and the buttons should show that.
    try {
      const next = await relationshipWith(userId)
      setState(next)
      onChange?.(next)
    } catch {
      // Keep the old buttons; the error above (if any) is already shown.
    }
    notifyFriendsChanged()
    setBusy(false)
  }

  const requestId = state.request_id
  return (
    <div className="relation">
      <div className="relation-actions">
        {state.relation === 'none' && (
          <Button className="button-compact" disabled={busy} onClick={() => void run(() => sendRequest(userId))}>
            Add friend
          </Button>
        )}
        {state.relation === 'outgoing' && requestId && (
          <>
            <span className="relation-label">Request sent</span>
            <Button
              variant="secondary"
              className="button-compact"
              disabled={busy}
              onClick={() => void run(() => cancelRequest(requestId))}
            >
              Cancel
            </Button>
          </>
        )}
        {state.relation === 'incoming' && requestId && (
          <>
            <Button
              className="button-compact"
              disabled={busy}
              onClick={() => void run(() => respondToRequest(requestId, true))}
            >
              Accept
            </Button>
            <Button
              variant="secondary"
              className="button-compact"
              disabled={busy}
              onClick={() => void run(() => respondToRequest(requestId, false))}
            >
              Decline
            </Button>
          </>
        )}
        {state.relation === 'friends' && <span className="relation-label is-friends">Friends</span>}
        {state.relation === 'blocked' && (
          <>
            <span className="relation-label">Blocked</span>
            <Button
              variant="secondary"
              className="button-compact"
              disabled={busy}
              onClick={() => void run(() => unblockUser(userId))}
            >
              Unblock
            </Button>
          </>
        )}
      </div>
      {error && (
        <p className="relation-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
