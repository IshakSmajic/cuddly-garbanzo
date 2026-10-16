import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useAuth } from '../auth/context.ts'
import { AppHeader } from '../components/AppHeader.tsx'
import { Avatar } from '../components/Avatar.tsx'
import { Button } from '../components/Button.tsx'
import { RelationActions } from '../components/RelationActions.tsx'
import {
  blockUser,
  notifyFriendsChanged,
  relationshipWith,
  type Person,
  type RelationState,
} from '../lib/friends.ts'
import { supabase } from '../lib/supabase.ts'

type Loaded =
  | { username: string; person: Person & { bio: string | null }; relation: RelationState }
  | { username: string; person: null }
  | { username: string; error: string }

/** /u/:username — someone's public profile, with request and block controls. */
export function UserProfile() {
  const { username = '' } = useParams()
  const { session } = useAuth()
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let stale = false
    async function load(): Promise<Loaded> {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, username, display_name, bio, avatar_path')
        .eq('username', username.toLowerCase())
        .maybeSingle()
      if (error) return { username, error: "Couldn't load this profile." }
      if (!data) return { username, person: null }
      try {
        return { username, person: data, relation: await relationshipWith(data.user_id) }
      } catch (e) {
        return { username, error: e instanceof Error ? e.message : "Couldn't load this profile." }
      }
    }
    void load().then((result) => !stale && setLoaded(result))
    return () => {
      stale = true
    }
  }, [username])

  const current = loaded?.username === username ? loaded : null

  return (
    <div className="home">
      <AppHeader />
      <main className="settings">
        <Link to="/people" className="settings-back">
          Back to people
        </Link>
        {!current && <p className="muted">Loading…</p>}
        {current && 'error' in current && (
          <p className="form-error" role="alert">
            {current.error}
          </p>
        )}
        {current && 'person' in current && !current.person && (
          <>
            <p className="eyebrow">Profile</p>
            <h1 className="auth-title">No one here.</h1>
            <p className="auth-subtitle">There is no user called @{username}.</p>
          </>
        )}
        {current && 'relation' in current && (
          <ProfileView
            person={current.person}
            relation={current.relation}
            isSelf={current.person.user_id === session?.user.id}
            onRelation={(relation) => setLoaded({ ...current, relation })}
          />
        )}
      </main>
    </div>
  )
}

type ViewProps = {
  person: Person & { bio: string | null }
  relation: RelationState
  isSelf: boolean
  onRelation: (next: RelationState) => void
}

function ProfileView({ person, relation, isSelf, onRelation }: ViewProps) {
  return (
    <>
      <div className="profile-head">
        <Avatar profile={person} size={88} />
        <div className="person-names">
          <h1 className="profile-name">{person.display_name}</h1>
          <span className="muted">@{person.username}</span>
        </div>
      </div>
      {person.bio && <p className="profile-bio">{person.bio}</p>}

      <div className="profile-actions">
        {isSelf ? (
          <p className="muted">
            This is you. <Link to="/settings/profile">Edit your profile</Link>
          </p>
        ) : (
          <>
            <RelationActions
              key={`${relation.relation}:${relation.request_id}`}
              userId={person.user_id}
              initial={relation}
              onChange={onRelation}
            />
            {relation.relation !== 'blocked' && (
              <BlockControl userId={person.user_id} username={person.username} onBlocked={onRelation} />
            )}
          </>
        )}
      </div>
    </>
  )
}

function BlockControl({
  userId,
  username,
  onBlocked,
}: {
  userId: string
  username: string | null
  onBlocked: (next: RelationState) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function block() {
    setBusy(true)
    setError(null)
    try {
      await blockUser(userId)
      onBlocked(await relationshipWith(userId))
      notifyFriendsChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  if (!confirming) {
    return (
      <button type="button" className="link-button block-link" onClick={() => setConfirming(true)}>
        Block
      </button>
    )
  }
  return (
    <div className="block-confirm" role="group" aria-label="Confirm block">
      <p>
        Block <span className="text-strong">@{username}</span>? This ends your friendship and any pending
        request. They won't find you in search or be able to send you requests. You can unblock later.
      </p>
      <div className="relation-actions">
        <Button className="button-compact" disabled={busy} onClick={() => void block()}>
          {busy ? 'Blocking…' : `Block @${username}`}
        </Button>
        <Button variant="secondary" className="button-compact" disabled={busy} onClick={() => setConfirming(false)}>
          Don't block
        </Button>
      </div>
      {error && (
        <p className="relation-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
