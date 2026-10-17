// Image messages: prepare, upload, send. The rules that don't need the
// network are in images.ts; send_image_message
// (supabase/migrations/*_message_images.sql) is the real gatekeeper.
import { encodeCanvas, extensionFor, newCanvas, readImage } from './canvasImage.ts'
import { fitWithin, imagePath } from './images.ts'
import type { Message } from './messageRules.ts'
import { SendError } from './messages.ts'
import { supabase } from './supabase.ts'

const bucket = () => supabase.storage.from('message-images')

/** A picked image, re-encoded and ready to upload. */
export type PreparedImage = {
  blob: Blob
  /** A local URL for the preview, valid while this tab is open. */
  previewUrl: string
  width: number
  height: number
  extension: 'webp' | 'jpg'
}

/**
 * Scales the picked image to at most 2048 px and re-encodes it, which drops
 * its metadata (EXIF), including any GPS position.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await readImage(file)
  const { width, height } = fitWithin(bitmap.width, bitmap.height)
  const { canvas, context } = newCanvas(width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await encodeCanvas(canvas)
  return { blob, previewUrl: URL.createObjectURL(blob), width, height, extension: extensionFor(blob.type) }
}

/** The storage path for a new image in this conversation (made once per message). */
export function newImagePath(conversationId: string, image: PreparedImage): string {
  return imagePath(conversationId, image.extension)
}

/**
 * Storage and Postgres don't share a transaction, so the order matters:
 * 1. upload the file (fails → nothing to undo);
 * 2. send_image_message creates the message and its attachment together.
 * A retry repeats both with the same path and client id: an upload that
 * already went through counts as done, and the send returns the stored
 * message. If sending is no longer allowed, the upload is deleted again.
 */
export async function sendImageMessage(
  conversationId: string,
  clientId: string,
  path: string,
  image: PreparedImage,
  caption: string,
): Promise<Message> {
  const upload = await bucket().upload(path, image.blob, {
    contentType: image.blob.type,
    cacheControl: '31536000', // a year: the file at this path never changes
    upsert: false,
  })
  // 409: this path was uploaded by an earlier attempt.
  if (upload.error && !('statusCode' in upload.error && String(upload.error.statusCode) === '409')) {
    if ('statusCode' in upload.error && String(upload.error.statusCode) === '403') {
      throw new SendError("You can't send messages in this chat any more.", true)
    }
    throw new SendError("Couldn't upload the image. Check your connection and try again.")
  }

  const { data, error } = await supabase.rpc('send_image_message', {
    conversation: conversationId,
    client_id: clientId,
    path,
    width: image.width,
    height: image.height,
    caption,
  })
  // The answer can't embed the new attachment (the query reads a snapshot
  // from before the function inserted it), but we know what it holds. The id
  // is only a React key here; the next load brings the real one.
  if (!error) return { ...data, attachments: [{ id: 0, storage_path: path, width: image.width, height: image.height }] }
  if (error.code === '42501') {
    await discardImage(path)
    throw new SendError("You can't send messages in this chat any more.", true)
  }
  if (error.code === '23514') throw new SendError('Captions must be 1 to 4,000 characters.')
  throw new SendError("Couldn't send. Check your connection and try again.")
}

/** Deletes an upload no message uses (the storage policy allows nothing else). */
async function discardImage(path: string) {
  const { error } = await bucket().remove([path])
  // The file is private and unused; a leftover only wastes space.
  if (error) console.warn('Could not delete an unsent image', path, error)
}
