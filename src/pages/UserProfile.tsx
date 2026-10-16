import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useAuth } from '../auth/context.ts'
import { AppHeader } from '../components/AppHeader.tsx'
import { Avatar } from '../components/Avatar.tsx'
import { ConfirmAction } from '../components/ConfirmAction.tsx'
import { RelationActions } from '../components/RelationActions.tsx'
import {
  blockUser,
  notifyFriendsChanged,
  relationshipWith,
  unfriend,
  type Person,
  type RelationState,
} from '../lib/friends.ts'
import { conversationWith } from '../lib/messages.ts'
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
  // Both change the relation on the server, then show the new one.
  const then = (action: (id: string) => Promise<void>) => async () => {
    await action(person.user_id)
    onRelation(await relationshipWith(person.user_id))
    notifyFriendsChanged()
  }
  const name = <span className="text-strong">@{person.username}</span>

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
            <OpenChat key={person.user_id} userId={person.user_id} isFriend={relation.relation === 'friends'} />
            <RelationActions
              key={`${relation.relation}:${relation.request_id}`}
              userId={person.user_id}
              initial={relation}
              onChange={onRelation}
            />
            <div className="quiet-actions">
              {relation.relation === 'friends' && (
                <ConfirmAction
                  label="Unfriend"
                  explanation={
                    <>
                      Unfriend {name}? You'll both keep your messages, but neither of you can send new ones until
                      you're friends again.
                    </>
                  }
                  confirmLabel={`Unfriend @${person.username}`}
                  busyLabel="Unfriending…"
                  cancelLabel="Stay friends"
                  action={then(unfriend)}
                />
              )}
              {relation.relation !== 'blocked' && (
                <ConfirmAction
                  label="Block"
                  explanation={
                    <>
                      Block {name}? This ends your friendship and any pending request. They won't find you in search
                      or be able to send you requests. Your messages stay. You can unblock later.
                    </>
                  }
                  confirmLabel={`Block @${person.username}`}
                  busyLabel="Blocking…"
                  cancelLabel="Don't block"
                  action={then(blockUser)}
                />
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}

/** Opens your conversation, which exists from the first friendship on. */
function OpenChat({ userId, isFriend }: { userId: string; isFriend: boolean }) {
  const [conversationId, setConversationId] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    conversationWith(userId).then(
      (id) => !stale && setConversationId(id),
      () => {}, // the button just doesn't appear
    )
    return () => {
      stale = true
    }
  }, [userId, isFriend])

  if (!conversationId) return null
  return (
    <Link to={`/c/${conversationId}`} className="button button-primary button-compact open-chat">
      <span>{isFriend ? 'Message' : 'View messages'}</span>
    </Link>
  )
}
