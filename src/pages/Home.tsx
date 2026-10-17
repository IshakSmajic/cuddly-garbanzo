import { Link } from 'react-router'
import { chatPreview } from '../app/chatList.ts'
import { useChats } from '../app/chats.ts'
import { useAuth } from '../auth/context.ts'
import { AppHeader } from '../components/AppHeader.tsx'
import { Avatar } from '../components/Avatar.tsx'
import { listTime } from '../lib/chatTime.ts'
import type { ConversationSummary } from '../lib/messages.ts'

// Every conversation you're in: friends, and read-only ones with former
// friends or deleted accounts (their history stays readable). The list
// itself is kept live by AppShell.
export function Home() {
  const { session } = useAuth()
  const { chats, error, isOnline } = useChats()

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
              <ChatRow
                key={chat.conversation_id}
                chat={chat}
                me={session?.user.id}
                online={isOnline(chat.other_id)}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function ChatRow({ chat, me, online }: { chat: ConversationSummary; me: string | undefined; online: boolean }) {
  const deleted = chat.other_id === null
  const name = deleted ? 'Deleted user' : chat.display_name
  const preview = chatPreview(chat, me)
  const unread = chat.unread_count > 0
  return (
    <li className="person-row">
      <Link
        to={`/c/${chat.conversation_id}`}
        className={`person-link chat-row${unread ? ' is-unread' : ''}`}
        aria-label={`${name}${unread ? `, ${chat.unread_count} unread` : ''}${online ? ', online' : ''}`}
      >
        <span className="avatar-wrap">
          <Avatar profile={deleted ? null : chat} size={44} />
          {online && <span className="online-dot" />}
        </span>
        <span className="person-names">
          <span className="chat-row-top">
            <strong className="text-strong">{name}</strong>
            {!chat.is_friend && <span className="tag">Read only</span>}
          </span>
          <span className="muted chat-preview">{preview}</span>
        </span>
        <span className="chat-row-side">
          {chat.last_at && <span className="chat-row-time">{listTime(chat.last_at)}</span>}
          {unread && <span className="unread-badge">{chat.unread_count}</span>}
        </span>
      </Link>
    </li>
  )
}
