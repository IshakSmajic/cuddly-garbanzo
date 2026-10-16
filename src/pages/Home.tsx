import { Link } from 'react-router'
import { AppHeader } from '../components/AppHeader.tsx'

// Placeholder: the friend list and conversations arrive in milestones 5–6.
export function Home() {
  return (
    <div className="home">
      <AppHeader />
      <main className="home-empty">
        <p className="eyebrow">You're in</p>
        <h1 className="auth-title">No conversations yet.</h1>
        <p className="auth-subtitle">
          <Link to="/people">Find your friends</Link> and send them a request. Chatting arrives in the next
          milestones.
        </p>
      </main>
    </div>
  )
}
