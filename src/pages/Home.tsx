import { AppHeader } from '../components/AppHeader.tsx'

// Placeholder: friends and conversations arrive in milestones 4–6.
export function Home() {
  return (
    <div className="home">
      <AppHeader />
      <main className="home-empty">
        <p className="eyebrow">You're in</p>
        <h1 className="auth-title">No conversations yet.</h1>
        <p className="auth-subtitle">Finding friends and chatting arrive in the next milestones.</p>
      </main>
    </div>
  )
}
