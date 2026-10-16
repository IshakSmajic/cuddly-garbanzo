import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/context.ts'
import { AppHeader } from '../components/AppHeader.tsx'
import { PersonRow } from '../components/PersonRow.tsx'
import { RelationActions } from '../components/RelationActions.tsx'
import { pendingRequests, type PendingRequest } from '../lib/friends.ts'
import type { Database } from '../lib/database.types.ts'
import { subscribe } from '../lib/realtime.ts'

type Lists = { incoming: PendingRequest[]; outgoing: PendingRequest[] }
type Request = Database['public']['Tables']['friend_requests']['Row']

export function Requests() {
  const { session } = useAuth()
  const userId = session?.user.id
  const [lists, setLists] = useState<Lists | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    const me = userId
    let stale = false
    const load = () =>
      pendingRequests(me).then(
        (result) => !stale && setLists(result),
        (e: Error) => !stale && setError(e.message),
      )
    void load()

    // Live: a new request (either way) reloads the lists. An answer from the
    // other side, or a cancel by the requester, removes the row. Our own
    // accept or decline is already shown by the row itself.
    const stop = subscribe<Request>({
      table: 'friend_requests',
      event: '*',
      onChange: (payload) => {
        if (payload.eventType === 'INSERT') return void load()
        if (payload.eventType !== 'UPDATE' || payload.new.status === 'pending') return
        if (payload.new.requester_id === me) drop('outgoing', payload.new.id)
        else if (payload.new.status === 'cancelled') drop('incoming', payload.new.id)
      },
    })
    return () => {
      stale = true
      stop()
    }
  }, [userId])

  // A declined or cancelled request leaves the list; an accepted one stays,
  // showing "Friends", so the result of the click is visible.
  function drop(key: keyof Lists, id: string) {
    setLists((l) => l && { ...l, [key]: l[key].filter((r) => r.id !== id) })
  }

  return (
    <div className="home">
      <AppHeader />
      <main className="settings page-wide">
        <p className="eyebrow">Requests</p>
        <h1 className="auth-title">Friend requests.</h1>
        <p className="auth-subtitle">
          Accept the people you know. <Link to="/people">Find someone</Link> to send your own.
        </p>

        {error && (
          <p className="form-error list-message" role="alert">
            {error}
          </p>
        )}
        {!lists && !error && <p className="muted list-message">Loading…</p>}
        {lists && (
          <>
            <RequestList
              title="Waiting for you"
              empty="No one is waiting for an answer."
              requests={lists.incoming}
              relation="incoming"
              onGone={(id) => drop('incoming', id)}
            />
            <RequestList
              title="Sent"
              empty="You have no requests waiting."
              requests={lists.outgoing}
              relation="outgoing"
              onGone={(id) => drop('outgoing', id)}
            />
          </>
        )}
      </main>
    </div>
  )
}

type ListProps = {
  title: string
  empty: string
  requests: PendingRequest[]
  relation: 'incoming' | 'outgoing'
  onGone: (id: string) => void
}

function RequestList({ title, empty, requests, relation, onGone }: ListProps) {
  return (
    <section className="request-section" aria-label={title}>
      <h2 className="section-title">
        {title} <span className="muted">{requests.length}</span>
      </h2>
      {requests.length === 0 ? (
        <p className="muted list-message">{empty}</p>
      ) : (
        <ul className="person-list">
          {requests.map((r) => (
            <PersonRow key={r.id} person={r.person}>
              <RelationActions
                userId={r.person.user_id}
                initial={{ relation, request_id: r.id }}
                onChange={(next) => next.relation === 'none' && onGone(r.id)}
              />
            </PersonRow>
          ))}
        </ul>
      )}
    </section>
  )
}
