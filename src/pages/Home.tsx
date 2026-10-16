import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/context.ts'
import { AppHeader } from '../components/AppHeader.tsx'
import { PersonRow } from '../components/PersonRow.tsx'
import { friendsList, type Friend } from '../lib/friends.ts'

const since = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// Your friends. In milestone 6 each one opens your conversation.
export function Home() {
  const { session } = useAuth()
  const userId = session?.user.id
  const [friends, setFriends] = useState<Friend[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let stale = false
    friendsList(userId).then(
      (list) => !stale && setFriends(list),
      (e: Error) => !stale && setError(e.message),
    )
    return () => {
      stale = true
    }
  }, [userId])

  return (
    <div className="home">
      <AppHeader />
      <main className="settings page-wide">
        <p className="eyebrow">Friends</p>
        <h1 className="auth-title">Your people.</h1>
        <p className="auth-subtitle">Chatting with them arrives in the next milestone.</p>

        {error && (
          <p className="form-error list-message" role="alert">
            {error}
          </p>
        )}
        {!friends && !error && <p className="muted list-message">Loading…</p>}
        {friends?.length === 0 && (
          <p className="list-message">
            No friends yet. <Link to="/people">Find your friends</Link> and send them a request.
          </p>
        )}
        {friends && friends.length > 0 && (
          <section className="request-section" aria-label="Friends">
            <h2 className="section-title">
              Friends <span className="muted">{friends.length}</span>
            </h2>
            <ul className="person-list">
              {friends.map((friend) => (
                <PersonRow key={friend.user_id} person={friend}>
                  <span className="relation-label">Since {since.format(new Date(friend.since))}</span>
                </PersonRow>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
