import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient.js'
import './Chat.css'

const TEST_USERS = ['alice@test.com', 'bob@test.com']
const TEST_PASSWORD = 'password123'

function Chat() {
  const [session, setSession] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  return (
    <section className="chat">
      {session ? <ChatRoom session={session} /> : <SignIn />}
    </section>
  )
}

function SignIn() {
  const [error, setError] = useState(null)

  async function signIn(email) {
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    })
    if (error) setError(error.message)
  }

  return (
    <div className="chat-signin">
      <h2>Chat</h2>
      <p>Sign in as a test user. Open a second tab as the other one.</p>
      <div className="chat-signin-buttons">
        {TEST_USERS.map((email) => (
          <button key={email} onClick={() => signIn(email)}>
            {email}
          </button>
        ))}
      </div>
      {error && <p className="chat-error">{error}</p>}
    </div>
  )
}

function ChatRoom({ session }) {
  const [profiles, setProfiles] = useState({})
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('connecting')
  const listRef = useRef(null)
  const me = session.user.id

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, username')
      .then(({ data }) => {
        setProfiles(Object.fromEntries((data ?? []).map((p) => [p.id, p.username])))
      })

    supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setMessages((data ?? []).reverse()))

    // Realtime: Supabase pushes each new row over the websocket.
    const channel = supabase
      .channel('room:messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          setMessages((prev) =>
            prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new],
          )
        },
      )
      .subscribe((s) => setStatus(s === 'SUBSCRIBED' ? 'live' : s.toLowerCase()))

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight)
  }, [messages])

  async function send(e) {
    e.preventDefault()
    const content = draft.trim()
    if (!content) return
    setDraft('')
    const { error } = await supabase.from('messages').insert({ content })
    if (error) {
      setDraft(content)
      alert(error.message)
    }
  }

  return (
    <div className="chat-room">
      <div className="chat-bar">
        <span>
          Signed in as <strong>{profiles[me] ?? session.user.email}</strong>
        </span>
        <span className={`chat-status chat-status-${status}`}>{status}</span>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
      <ul className="chat-messages" ref={listRef}>
        {messages.map((m) => (
          <li key={m.id} className={m.sender_id === me ? 'mine' : ''}>
            <span className="chat-sender">{profiles[m.sender_id] ?? '…'}</span>
            <span className="chat-bubble">{m.content}</span>
          </li>
        ))}
      </ul>
      <form className="chat-form" onSubmit={send}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message"
          maxLength={2000}
        />
        <button type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}

export default Chat
