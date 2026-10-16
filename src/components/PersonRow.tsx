import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { Person } from '../lib/friends.ts'
import { Avatar } from './Avatar.tsx'

/** Avatar and names linking to the person's profile, with actions on the right. */
export function PersonRow({ person, children }: { person: Person; children?: ReactNode }) {
  return (
    <li className="person-row">
      <Link to={`/u/${person.username}`} className="person-link">
        <Avatar profile={person} size={44} />
        <span className="person-names">
          <strong className="text-strong">{person.display_name}</strong>
          <span className="muted">@{person.username}</span>
        </span>
      </Link>
      {children}
    </li>
  )
}
