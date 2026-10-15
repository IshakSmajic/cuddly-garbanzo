import { Link } from 'react-router'
import { useAuth } from '../auth/context.ts'
import { supabase } from '../lib/supabase.ts'
import { Avatar } from './Avatar.tsx'
import { Logo } from './Logo.tsx'

/** Top bar of the signed-in app: logo, your profile (links to settings), sign out. */
export function AppHeader() {
  const { profile } = useAuth()

  return (
    <header className="home-bar">
      <Link to="/" className="logo-link" aria-label="Home">
        <Logo />
      </Link>
      <div className="home-user">
        <Link to="/settings/profile" className="profile-link" aria-label="Edit your profile">
          <Avatar profile={profile} size={32} />
          <span className="profile-link-name">
            <strong className="text-strong">{profile?.display_name}</strong>{' '}
            <span className="muted">@{profile?.username}</span>
          </span>
        </Link>
        <button className="link-button" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </header>
  )
}
