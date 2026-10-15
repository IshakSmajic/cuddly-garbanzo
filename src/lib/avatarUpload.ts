import { AVATAR_SIZE, centreSquare } from './avatar.ts'
import { supabase } from './supabase.ts'

const bucket = () => supabase.storage.from('avatars')

export function avatarUrl(path: string): string {
  return bucket().getPublicUrl(path).data.publicUrl
}

/**
 * Crops the picked image to a centred square, scales it to 512 px and
 * re-encodes it. Re-encoding drops the file's metadata (EXIF), which on phone
 * photos can include the GPS position where the picture was taken.
 */
async function squareImage(file: File): Promise<Blob> {
  // createImageBitmap applies the EXIF rotation, so phone photos stay upright.
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That file couldn't be read as an image.")
  })
  const { x, y, side } = centreSquare(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = AVATAR_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error("Your browser couldn't process the image.")
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, x, y, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  bitmap.close()

  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85))
  // Browsers that can't encode WebP hand back a PNG instead; use JPEG then.
  const webp = await encode('image/webp')
  const blob = webp?.type === 'image/webp' ? webp : await encode('image/jpeg')
  if (!blob) throw new Error("Your browser couldn't process the image.")
  return blob
}

/**
 * Storage and Postgres don't share a transaction, so the order matters:
 * 1. upload the new file (fails → nothing changed);
 * 2. point the profile at it (fails → delete the new file again);
 * 3. delete the old file (fails → an unused file is left; harmless).
 */
export async function changeAvatar(userId: string, file: File): Promise<void> {
  const image = await squareImage(file)
  const extension = image.type === 'image/webp' ? 'webp' : 'jpg'
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
