import { Link, NavLink } from 'react-router'
import { useAuth } from '../auth/context.ts'
import { supabase } from '../lib/supabase.ts'
import { useIncomingCount } from '../lib/useIncomingCount.ts'
import { Avatar } from './Avatar.tsx'
import { Logo } from './Logo.tsx'

/** Top bar of the signed-in app: logo, navigation, your profile (links to settings), sign out. */
export function AppHeader() {
  const { session, profile } = useAuth()
  const incoming = useIncomingCount(session?.user.id)

  return (
    <header className="home-bar">
      <Link to="/" className="logo-link" aria-label="Home">
        <Logo />
      </Link>
      <nav className="home-nav" aria-label="Main">
        <NavLink to="/people" className="nav-link">
          People
        </NavLink>
        <NavLink to="/requests" className="nav-link">
          Requests
          {incoming > 0 && (
            <span className="nav-badge" aria-label={`${incoming} waiting`}>
              {incoming}
            </span>
          )}
        </NavLink>
      </nav>
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
