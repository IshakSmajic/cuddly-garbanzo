// Mirrors the CHECK constraints on public.profiles and Auth's password rule.
// The server is the real gatekeeper; these give instant feedback while typing.

export const USERNAME_MIN = 3
export const USERNAME_MAX = 20
export const DISPLAY_NAME_MAX = 50
export const BIO_MAX = 280
export const PASSWORD_MIN = 8 // matches auth.minimum_password_length in supabase/config.toml

/** Lowercases as the user types, since usernames are stored lowercase. */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase()
}

export function usernameError(username: string): string | null {
  if (username.length < USERNAME_MIN) return `At least ${USERNAME_MIN} characters.`
  if (username.length > USERNAME_MAX) return `At most ${USERNAME_MAX} characters.`
  if (!/^[a-z0-9_]+$/.test(username)) return 'Use only letters, numbers and underscores.'
  return null
}

export function displayNameError(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'Enter a display name.'
  // Count characters the way PostgreSQL's char_length does (code points).
  if ([...trimmed].length > DISPLAY_NAME_MAX) return `At most ${DISPLAY_NAME_MAX} characters.`
  return null
}

/** Counted on the trimmed text, which is what gets saved. */
export function bioLength(bio: string): number {
  return [...bio.trim()].length
}

export function bioError(bio: string): string | null {
  if (bioLength(bio) > BIO_MAX) return `At most ${BIO_MAX} characters.`
  return null
}

/** For choosing a new password: long enough, and typed the same twice. */
export function newPasswordError(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters for your password.`
  if (password !== confirm) return "The passwords don't match."
  return null
}
