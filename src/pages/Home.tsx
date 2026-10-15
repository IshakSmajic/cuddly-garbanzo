import { useAuth } from '../auth/context.ts'
import { Logo } from '../components/Logo.tsx'
import { supabase } from '../lib/supabase.ts'

// Placeholder: friends and conversations arrive in milestones 4–6.
export function Home() {
  const { profile } = useAuth()

  return (
    <div className="home">
      <header className="home-bar">
        <Logo />
        <div className="home-user">
          <span>
            <strong className="text-strong">{profile?.display_name}</strong>{' '}
            <span className="muted">@{profile?.username}</span>
          </span>
          <button className="link-button" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="home-empty">
        <p className="eyebrow">You're in</p>
        <h1 className="auth-title">No conversations yet.</h1>
        <p className="auth-subtitle">Finding friends and chatting arrive in the next milestones.</p>
      </main>
    </div>
  )
}
