import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router'
import { useChats } from '../app/chats.ts'
import { useAuth } from '../auth/context.ts'
import { AppHeader } from '../components/AppHeader.tsx'
import { Avatar } from '../components/Avatar.tsx'
import { dayLabel, messageTime, sameDay } from '../lib/chatTime.ts'
import {
  canSend,
  catchUp,
  COUNTER_FROM,
  MESSAGE_MAX,
  messageError,
  messageLength,
  mergeMessages,
  prepareMessage,
  seenMessageId,
  type Message,
  type ReadMark,
} from '../lib/messageRules.ts'
import {
  conversationSummary,
  markRead,
  messagesPage,
  otherReadPosition,
  PAGE_SIZE,
  SendError,
  sendMessage,
  type ConversationSummary,
} from '../lib/messages.ts'
import { joinPrivate, onResume, subscribe, type LiveState, type PrivateChannel } from '../lib/realtime.ts'

/** A message on its way: shown at the end until the server has it. */
type Pending = { clientId: string; content: string; failed: string | null }

type Loaded =
  | { id: string; summary: ConversationSummary; messages: Message[]; hasOlder: boolean }
  | { id: string; missing: true }
  | { id: string; error: string }

/** /c/:conversationId — one conversation: history, older pages, composer. */
export function Chat() {
  const { conversationId = '' } = useParams()
  const { session } = useAuth()
  const me = session?.user.id
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let stale = false
    Promise.all([conversationSummary(conversationId), messagesPage(conversationId)]).then(
      ([summary, messages]): void => {
        if (stale) return
        if (!summary) setLoaded({ id: conversationId, missing: true })
        else setLoaded({ id: conversationId, summary, messages, hasOlder: messages.length === PAGE_SIZE })
      },
      (e: Error) => !stale && setLoaded({ id: conversationId, error: e.message }),
    )
    return () => {
      stale = true
    }
  }, [conversationId])

  const current = loaded?.id === conversationId ? loaded : null

  return (
    <div className="home chat-page">
      <AppHeader />
      {!current && <p className="muted chat-status">Loading…</p>}
      {current && 'error' in current && (
        <p className="form-error chat-status" role="alert">
          {current.error}
        </p>
      )}
      {current && 'missing' in current && (
        <div className="settings">
          <p className="eyebrow">Chat</p>
          <h1 className="auth-title">No chat here.</h1>
          <p className="auth-subtitle">
            This conversation doesn't exist or isn't yours. <Link to="/">Back to your chats</Link>
          </p>
        </div>
      )}
      {current && 'summary' in current && me && (
        // Keyed so moving to another chat starts with fresh state.
        <Conversation key={current.id} me={me} initial={current} />
      )}
    </div>
  )
}

type ConversationProps = {
  me: string
  initial: { id: string; summary: ConversationSummary; messages: Message[]; hasOlder: boolean }
}

function Conversation({ me, initial }: ConversationProps) {
  const conversationId = initial.id
  const [summary, setSummary] = useState(initial.summary)
  const [messages, setMessages] = useState(initial.messages)
  const [hasOlder, setHasOlder] = useState(initial.hasOlder)
  const [olderState, setOlderState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [pending, setPending] = useState<Pending[]>([])
  const [text, setText] = useState('')
  const [live, setLive] = useState<LiveState>('connecting')
  const [otherRead, setOtherRead] = useState<ReadMark | null>(null)
  const [typing, setTyping] = useState(false)
  const { isOnline, markedRead, reload: reloadChats } = useChats()
  const room = useRef<PrivateChannel | null>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const lastTypingSent = useRef(0)
  const lastMarked = useRef(0)
  // The messages on screen, for callbacks that outlive a render.
  const shown = useRef(messages)
  useEffect(() => {
    shown.current = messages
  }, [messages])

  const scroller = useRef<HTMLDivElement>(null)
  // What the next layout pass should do with the scroll position.
  const scrollIntent = useRef<{ kind: 'bottom' } | { kind: 'keep'; fromBottom: number } | null>({ kind: 'bottom' })

  useLayoutEffect(() => {
    const el = scroller.current
    const intent = scrollIntent.current
    if (!el || !intent) return
    // Older messages were added above: keep the same messages in view.
    el.scrollTop = intent.kind === 'bottom' ? el.scrollHeight : el.scrollHeight - intent.fromBottom
    scrollIntent.current = null
  }, [messages, pending])

  // Follow new messages only if the reader is already at the bottom.
  function atBottom() {
    const el = scroller.current
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useEffect(() => {
    // After a reconnect or a sleeping tab: fetch the newest page and merge.
    // Not "everything after the last id": ids are taken when an insert starts
    // but rows appear when it commits, so a lower id can show up later.
    async function refresh() {
      try {
        const [latest, fresh] = await Promise.all([messagesPage(conversationId), conversationSummary(conversationId)])
        const { gap } = catchUp(shown.current, latest, PAGE_SIZE)
        if (atBottom()) scrollIntent.current = { kind: 'bottom' }
        setMessages((ms) => catchUp(ms, latest, PAGE_SIZE).messages)
        if (gap) setHasOlder(true)
        if (fresh) setSummary(fresh)
      } catch {
        // The next resume or reconnect tries again.
      }
    }

    const stop = subscribe<Message>({
      table: 'messages',
      event: 'INSERT',
      filter: `conversation_id=eq.${conversationId}`,
      onChange: (payload) => {
        const message = payload.new as Message
        if (atBottom() || message.sender_id === me) scrollIntent.current = { kind: 'bottom' }
        setMessages((ms) => mergeMessages(ms, [message]))
        // Our own send can arrive here before its insert returns.
        setPending((ps) => ps.filter((p) => p.clientId !== message.client_id))
        if (message.sender_id !== me) setTyping(false)
      },
      onReady: () => void refresh(),
      onState: setLive,
    })
    const stopResume = onResume(() => void refresh())
    return () => {
      stop()
      stopResume()
    }
  }, [conversationId, me])

  // The conversation's private channel: typing, and two events sent by the
  // database: "read" (someone's reading position moved) and "relationship"
  // (the friendship started or ended).
  useEffect(() => {
    let stale = false
    // A "read" event is only a cue: members can broadcast too, so the
    // position itself always comes from the table, which only mark_read moves.
    const loadRead = () =>
      otherReadPosition(conversationId, me).then(
        (position) => !stale && setOtherRead(position),
        () => {},
      )
    void loadRead()
    const channel = joinPrivate(`conversation:${conversationId}`, {
      onBroadcast: (event, payload) => {
        if (payload.user_id === me) return
        if (event === 'typing') {
          setTyping(true)
          clearTimeout(typingTimer.current)
          typingTimer.current = setTimeout(() => setTyping(false), 5000)
        }
        if (event === 'read') void loadRead()
        if (event === 'relationship') {
          void conversationSummary(conversationId).then((fresh) => !stale && fresh && setSummary(fresh))
          reloadChats()
        }
      },
    })
    room.current = channel
    return () => {
      stale = true
      clearTimeout(typingTimer.current)
      room.current = null
      channel.leave()
    }
  }, [conversationId, me, reloadChats])

  // Mark read while you can see the newest message: tab visible and
  // scrolled to the bottom. The database only moves the position forward.
  function markIfSeen() {
    const newest = shown.current.at(-1)
    if (!newest || newest.id === lastMarked.current) return
    if (document.visibilityState !== 'visible' || !atBottom()) return
    lastMarked.current = newest.id
    markRead(conversationId, newest.id).then(
      () => markedRead(conversationId),
      () => (lastMarked.current = 0), // try again next time
    )
  }
  useEffect(markIfSeen)
  useEffect(() => onResume(markIfSeen))

  // At most one typing signal every 3 seconds; the other side shows it for 5.
  function signalTyping(value: string) {
    if (!summary.is_friend || !value.trim()) return
    const now = Date.now()
    if (now - lastTypingSent.current < 3000) return
    lastTypingSent.current = now
    room.current?.send('typing', { user_id: me })
  }

  const name = summary.display_name ?? 'Deleted user'
  const deleted = summary.other_id === null
  const online = isOnline(summary.other_id)
  const seenId = seenMessageId(messages, me, otherRead)

  async function loadOlder() {
    const oldest = messages[0]
    if (!oldest) return
    setOlderState('loading')
    try {
      const older = await messagesPage(conversationId, oldest)
      const el = scroller.current
      if (el) scrollIntent.current = { kind: 'keep', fromBottom: el.scrollHeight - el.scrollTop }
      setMessages((ms) => mergeMessages(ms, older))
      setHasOlder(older.length === PAGE_SIZE)
      setOlderState('idle')
    } catch {
      setOlderState('error')
    }
  }

  async function deliver(clientId: string, content: string) {
    setPending((ps) => ps.map((p) => (p.clientId === clientId ? { ...p, failed: null } : p)))
    try {
      const sent = await sendMessage(conversationId, clientId, content)
      scrollIntent.current = { kind: 'bottom' }
      setMessages((ms) => mergeMessages(ms, [sent]))
      setPending((ps) => ps.filter((p) => p.clientId !== clientId))
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Couldn't send."
      setPending((ps) => ps.map((p) => (p.clientId === clientId ? { ...p, failed: reason } : p)))
      // Unfriended or blocked meanwhile: show the read-only state.
      if (e instanceof SendError && e.notAllowed) {
        const fresh = await conversationSummary(conversationId).catch(() => null)
        if (fresh) setSummary(fresh)
      }
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!canSend(text)) return
    const content = prepareMessage(text)
    // Made once per message and reused by every retry (see sendMessage).
    const clientId = crypto.randomUUID()
    setText('')
    // The other side hides "typing…" when this arrives, so the next keystroke
    // should signal again at once rather than wait out the 3 seconds.
    lastTypingSent.current = 0
    scrollIntent.current = { kind: 'bottom' }
    setPending((ps) => [...ps, { clientId, content, failed: null }])
    void deliver(clientId, content)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter is a new line; not while an IME is composing.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  const length = messageLength(text)
  const tooLong = messageError(text)

  return (
    <main className="chat" data-live={live}>
      <div className="chat-head">
        <Link to="/" className="chat-back" aria-label="Back to your chats">
          ‹
        </Link>
        <span className="avatar-wrap">
          <Avatar profile={deleted ? null : summary} size={36} />
          {online && <span className="online-dot" />}
        </span>
        <div className="person-names">
          {deleted ? (
            <strong className="text-strong">Deleted user</strong>
          ) : (
            <Link to={`/u/${summary.username}`} className="text-strong chat-name">
              {name}
            </Link>
          )}
          {!deleted && (
            <span className="muted">
              @{summary.username}
              {online && <span className="online-label"> · Online</span>}
            </span>
          )}
        </div>
        {!summary.is_friend && <span className="tag">Read only</span>}
      </div>

      {live === 'reconnecting' && (
        <p className="chat-live" role="status">
          Reconnecting…
        </p>
      )}

      <div className="chat-scroll" ref={scroller} onScroll={markIfSeen}>
        <div className="chat-log" role="log" aria-label={`Messages with ${name}`}>
          {hasOlder && (
            <button
              type="button"
              className="link-button chat-older"
              disabled={olderState === 'loading'}
              onClick={() => void loadOlder()}
            >
              {olderState === 'loading'
                ? 'Loading…'
                : olderState === 'error'
                  ? "Couldn't load. Try again"
                  : 'Load older messages'}
            </button>
          )}
          {messages.length === 0 && pending.length === 0 && (
            <p className="muted chat-empty">No messages yet. Say hello.</p>
          )}
          {messages.map((m, i) => {
            const previous = messages[i - 1]
            const mine = m.sender_id === me
            return (
              <Fragment key={m.id}>
                {(!previous || !sameDay(previous.created_at, m.created_at)) && (
                  <p className="chat-day">{dayLabel(m.created_at)}</p>
                )}
                <div className={`bubble-row${mine ? ' is-mine' : ''}`}>
                  <div className="bubble">
                    <p className="bubble-text">{m.content}</p>
                    <time className="bubble-time" dateTime={m.created_at}>
                      {messageTime(m.created_at)}
                    </time>
                  </div>
                  {m.id === seenId && <span className="bubble-seen">Seen</span>}
                </div>
              </Fragment>
            )
          })}
          {pending.map((p) => (
            <div key={p.clientId} className="bubble-row is-mine is-pending">
              <div className="bubble">
                <p className="bubble-text">{p.content}</p>
                <span className="bubble-time">{p.failed ? 'Not sent' : 'Sending…'}</span>
              </div>
              {p.failed && (
                <p className="bubble-error" role="alert">
                  {p.failed}{' '}
                  {summary.is_friend && (
                    <button type="button" className="link-button" onClick={() => void deliver(p.clientId, p.content)}>
                      Retry
                    </button>
                  )}
                </p>
              )}
            </div>
          ))}
          {typing && summary.is_friend && (
            <p className="chat-typing" role="status">
              {name} is typing…
            </p>
          )}
        </div>
      </div>

      {summary.is_friend ? (
        <form className="chat-composer" onSubmit={submit}>
          <div className={`field-control is-multiline chat-input${tooLong ? ' is-invalid' : ''}`}>
            <textarea
              className="field-input"
              aria-label={`Message ${name}`}
              placeholder={`Message ${name}`}
              rows={1}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                signalTyping(e.target.value)
                // Grow with the text, up to the CSS max-height.
                e.target.style.height = 'auto'
                e.target.style.height = `${e.target.scrollHeight}px`
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <button type="submit" className="button button-primary chat-send" disabled={!canSend(text)}>
            Send
          </button>
          {(length >= COUNTER_FROM || tooLong) && (
            <p className={`chat-counter${tooLong ? ' is-invalid' : ''}`}>
              {tooLong ?? `${length.toLocaleString('en')} / ${MESSAGE_MAX.toLocaleString('en')}`}
            </p>
          )}
        </form>
      ) : (
        <p className="chat-readonly" role="status">
          {deleted
            ? 'This account was deleted. You can still read your messages.'
            : `You and ${name} aren't friends any more. You can read your history, but neither of you can send new messages.`}
        </p>
      )}
    </main>
  )
}
