import type { Profile } from '../auth/context.ts'
import { initials } from '../lib/avatar.ts'
import { avatarUrl } from '../lib/avatarUpload.ts'

type Props = {
  profile: Pick<Profile, 'avatar_path' | 'display_name' | 'username'> | null
  size?: number
}

/** The profile picture, or the person's initials when there is none. */
export function Avatar({ profile, size = 32 }: Props) {
  const name = profile?.display_name || profile?.username
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) }
  if (profile?.avatar_path) {
    // Decorative: the name is always shown or announced next to it.
    return <img className="avatar" src={avatarUrl(profile.avatar_path)} alt="" style={style} />
  }
  return (
    <span className="avatar avatar-initials" aria-hidden="true" style={style}>
      {initials(name)}
    </span>
  )
}
