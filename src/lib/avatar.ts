// Avatar rules that don't need the network. The storage steps are in
// avatarUpload.ts; the bucket's own limits (supabase/migrations/*_avatars.sql)
// are the real gatekeeper.

/** Types the picker accepts. The upload itself is always re-encoded WebP or JPEG. */
export const AVATAR_INPUT_TYPES = ['image/jpeg', 'image/png', 'image/webp']
/**
 * Limit on the picked file, before re-encoding. Generous so phone photos work;
 * what's uploaded is a 512 px square, far under the bucket's 2 MB limit.
 */
export const AVATAR_INPUT_MAX_BYTES = 15 * 1024 * 1024
/** Side of the square image that's uploaded. */
export const AVATAR_SIZE = 512

export function avatarFileError(file: { type: string; size: number }): string | null {
  if (!AVATAR_INPUT_TYPES.includes(file.type)) return 'Choose a JPEG, PNG or WebP image.'
  if (file.size > AVATAR_INPUT_MAX_BYTES) return 'That image is too large (15 MB at most).'
  return null
}

/** Up to two letters for the fallback circle: "Ana Test" → "AT", "ana_1" → "A". */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/[\s_]+/).filter(Boolean)
  // Spread so letters outside the basic plane (emoji, some scripts) aren't split in half.
  const letters = words.slice(0, 2).map((word) => [...word][0]?.toUpperCase() ?? '')
  return letters.join('') || '?'
}

/** The square to cut from a w×h image: the largest centred one. */
export function centreSquare(width: number, height: number) {
  const side = Math.min(width, height)
  return { x: (width - side) / 2, y: (height - side) / 2, side }
}
