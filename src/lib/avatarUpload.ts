import { AVATAR_SIZE, centreSquare } from './avatar.ts'
import { encodeCanvas, extensionFor, newCanvas, readImage } from './canvasImage.ts'
import { supabase } from './supabase.ts'

const bucket = () => supabase.storage.from('avatars')

export function avatarUrl(path: string): string {
  return bucket().getPublicUrl(path).data.publicUrl
}

/**
 * Crops the picked image to a centred square, scales it to 512 px and
 * re-encodes it (which drops its metadata; see canvasImage.ts).
 */
async function squareImage(file: File): Promise<Blob> {
  const bitmap = await readImage(file)
  const { x, y, side } = centreSquare(bitmap.width, bitmap.height)
  const { canvas, context } = newCanvas(AVATAR_SIZE, AVATAR_SIZE)
  context.drawImage(bitmap, x, y, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  bitmap.close()
  return encodeCanvas(canvas)
}

/**
 * Storage and Postgres don't share a transaction, so the order matters:
 * 1. upload the new file (fails → nothing changed);
 * 2. point the profile at it (fails → delete the new file again);
 * 3. delete the old file (fails → an unused file is left; harmless).
 */
export async function changeAvatar(userId: string, file: File): Promise<void> {
  const image = await squareImage(file)
  const extension = extensionFor(image.type)
  // A new random name every time: nothing is overwritten, and no browser can
  // show a cached copy of the previous picture.
  const path = `${userId}/${crypto.randomUUID()}.${extension}`

  const upload = await bucket().upload(path, image, {
    contentType: image.type,
    cacheControl: '31536000', // a year: the file at this path never changes
    upsert: false,
  })
  if (upload.error) throw new Error("Couldn't upload the picture. Please try again.")

  const { data: oldPath, error } = await supabase.rpc('set_avatar', { new_path: path })
  if (error) {
    await bucket().remove([path])
    throw new Error("Couldn't save the picture. Please try again.")
  }
  await deleteFile(oldPath)
}

export async function removeAvatar(): Promise<void> {
  const { data: oldPath, error } = await supabase.rpc('remove_avatar')
  if (error) throw new Error("Couldn't remove the picture. Please try again.")
  await deleteFile(oldPath)
}

// The generated types say string, but the functions return null when there
// was no previous avatar.
async function deleteFile(path: string | null) {
  if (!path) return
  const { error } = await bucket().remove([path])
  // The profile is already right; a leftover file only wastes space.
  if (error) console.warn('Could not delete the previous avatar file', path, error)
}
