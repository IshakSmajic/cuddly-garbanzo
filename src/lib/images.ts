// Image message rules that don't need the network. The upload and send are
// in imageUpload.ts; the bucket limits and send_image_message
// (supabase/migrations/*_message_images.sql) are the real gatekeeper.

/** Types the picker accepts. What's uploaded is always re-encoded WebP or JPEG. */
export const IMAGE_INPUT_TYPES = ['image/jpeg', 'image/png', 'image/webp']
/** Limit on the picked file, before re-encoding; phone photos fit easily. */
export const IMAGE_INPUT_MAX_BYTES = 20 * 1024 * 1024
/** Longest side of the uploaded image. Keeps files well under the bucket's 5 MB. */
export const IMAGE_MAX_SIDE = 2048

export function imageFileError(file: { type: string; size: number }): string | null {
  if (!IMAGE_INPUT_TYPES.includes(file.type)) return 'Choose a JPEG, PNG or WebP image.'
  if (file.size > IMAGE_INPUT_MAX_BYTES) return 'That image is too large (20 MB at most).'
  return null
}

/** Scales w×h down so neither side exceeds `max`, keeping the shape. Never scales up. */
export function fitWithin(width: number, height: number, max = IMAGE_MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Shown size in the chat, at most 280 wide and 320 tall. CSS keeps the shape. */
export function bubbleImageWidth(width: number, height: number): number {
  return Math.round(Math.min(width, 280, (320 * width) / height))
}

/** Where an image goes: the conversation's folder, under a new random name. */
export function imagePath(conversationId: string, extension: 'webp' | 'jpg'): string {
  return `${conversationId}/${crypto.randomUUID()}.${extension}`
}
