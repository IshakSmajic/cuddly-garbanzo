import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/context.ts'
import { AppHeader } from '../components/AppHeader.tsx'
import { Avatar } from '../components/Avatar.tsx'
import { listTime } from '../lib/chatTime.ts'
import { timeKey, type Message } from '../lib/messageRules.ts'
import { myConversations, type ConversationSummary } from '../lib/messages.ts'
import { onResume, subscribe } from '../lib/realtime.ts'

// Every conversation you're in: friends, and read-only ones with former
// friends or deleted accounts (their history stays readable).
export function Home() {
  const { session } = useAuth()
  const userId = session?.user.id
  const [chats, setChats] = useState<ConversationSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shown = useRef(chats)
  useEffect(() => {
    shown.current = chats
  }, [chats])

  useEffect(() => {
    if (!userId) return
    let stale = false
    const load = () =>
      myConversations().then(
        (list) => !stale && setChats(list),
        (e: Error) => !stale && setError(e.message),
      )
    void load()

    // RLS sends only messages from your own conversations. A known chat gets
    // its preview updated and moves to the top; an unknown one (a friendship
    // made in another tab) means the list is out of date.
    const stopMessages = subscribe<Message>({
      table: 'messages',
      event: 'INSERT',
      onChange: (payload) => {
        const m = payload.new as Message
        if (!shown.current?.some((c) => c.conversation_id === m.conversation_id)) return void load()
        setChats((cs) => cs && withMessage(cs, m))
      },
      onReady: () => void load(),
    })
    // One of your requests accepted: a new chat exists.
    const stopRequests = subscribe({
      table: 'friend_requests',
      event: 'UPDATE',
      onChange: (payload) => (payload.new as { status: string }).status === 'accepted' && void load(),
    })
    const stopResume = onResume(() => void load())
    return () => {
      stale = true
      stopMessages()
      stopRequests()
      stopResume()
    }
  }, [userId])

  return (
    <div className="home">
      <AppHeader />
      <main className="settings page-wide">
        <p className="eyebrow">Chats</p>
        <h1 className="auth-title">Your people.</h1>
        <p className="auth-subtitle">
          Everyone you're friends with, and the history you kept with anyone you're not.
        </p>

        {error && (
          <p className="form-error list-message" role="alert">
            {error}
          </p>
        )}
        {!chats && !error && <p className="muted list-message">Loading…</p>}
        {chats?.length === 0 && (
          <p className="list-message">
            No friends yet. <Link to="/people">Find your friends</Link> and send them a request.
          </p>
        )}
        {chats && chats.length > 0 && (
          <ul className="person-list" aria-label="Chats">
            {chats.map((chat) => (
              <ChatRow key={chat.conversation_id} chat={chat} me={userId} />
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function ChatRow({ chat, me }: { chat: ConversationSummary; me: string | undefined }) {
  const deleted = chat.other_id === null
  const preview =
    chat.last_content === null
      ? 'No messages yet'
      : `${chat.last_sender_id === me ? 'You: ' : ''}${chat.last_content}`
  return (
    <li className="person-row">
      <Link to={`/c/${chat.conversation_id}`} className="person-link chat-row">
        <Avatar profile={deleted ? null : chat} size={44} />
        <span className="person-names">
          <span className="chat-row-top">
            <strong className="text-strong">{deleted ? 'Deleted user' : chat.display_name}</strong>
            {!chat.is_friend && <span className="tag">Read only</span>}
          </span>
          <span className="muted">{preview}</span>
        </span>
        {chat.last_at && <span className="chat-row-time">{listTime(chat.last_at)}</span>}
      </Link>
    </li>
  )
}

/** The list with `m` as its chat's last message, most recent chat first. */
function withMessage(chats: ConversationSummary[], m: Message): ConversationSummary[] {
  return chats
    .map((c) =>
      c.conversation_id === m.conversation_id
        ? { ...c, last_content: m.content, last_sender_id: m.sender_id, last_at: m.created_at }
        : c,
    )
    .sort((a, b) => (b.last_at ? timeKey(b.last_at) : 0) - (a.last_at ? timeKey(a.last_at) : 0))
}
