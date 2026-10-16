import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/context.ts'
import { AppHeader } from '../components/AppHeader.tsx'
import { PersonRow } from '../components/PersonRow.tsx'
import { RelationActions } from '../components/RelationActions.tsx'
import { pendingRequests, type PendingRequest } from '../lib/friends.ts'

type Lists = { incoming: PendingRequest[]; outgoing: PendingRequest[] }

export function Requests() {
  const { session } = useAuth()
  const userId = session?.user.id
  const [lists, setLists] = useState<Lists | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let stale = false
    pendingRequests(userId).then(
      (result) => !stale && setLists(result),
      (e: Error) => !stale && setError(e.message),
    )
    return () => {
      stale = true
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
