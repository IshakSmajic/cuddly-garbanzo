// Viewing message images. The bucket is private, so each file is shown
// through a signed URL: a link with a token that works for anyone holding it,
// until it expires. Storage only signs files your read policy allows
// (conversation members). Links are cached, and the ones a page of messages
// needs are signed in one request.
import { useEffect, useState } from 'react'
import { supabase } from './supabase.ts'

/** How long a signed link works (seconds). */
const LINK_SECONDS = 60 * 60
/** Stop handing out a link this long before it expires. */
const MARGIN_MS = 5 * 60 * 1000

const signed = new Map<string, { url: string; expires: number }>()
/** Your own sends, shown from the local file instead of downloading them again. */
const local = new Map<string, string>()
let batch: { paths: Set<string>; done: Promise<void> } | null = null

export function rememberLocalImage(path: string, previewUrl: string) {
  local.set(path, previewUrl)
}

function knownUrl(path: string): string | null {
  const own = local.get(path)
  if (own) return own
  const link = signed.get(path)
  return link && link.expires > Date.now() ? link.url : null
}

/** Signs `path` together with every other path asked for in the same tick. */
function sign(path: string): Promise<void> {
  if (!batch) {
    const paths = new Set<string>()
    // Runs after the current render has asked for all its images.
    const done = Promise.resolve().then(async () => {
      batch = null
      const { data, error } = await supabase.storage.from('message-images').createSignedUrls([...paths], LINK_SECONDS)
      if (error) throw error
      const expires = Date.now() + LINK_SECONDS * 1000 - MARGIN_MS
      for (const item of data) if (item.path && item.signedUrl) signed.set(item.path, { url: item.signedUrl, expires })
    })
    batch = { paths, done }
  }
  batch.paths.add(path)
  return batch.done.then(() => {
    if (!signed.has(path)) throw new Error('Image not available')
  })
}

/**
 * The URL to show `path` with, or null while it's being signed. `retry`
 * signs it again: for an <img> that failed to load (the link expired while
 * the tab slept, or the network dropped).
 */
export function useImageUrl(path: string) {
  const [attempt, setAttempt] = useState(0)
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null)
  const [, setSignedCount] = useState(0)
  const url = knownUrl(path)

  useEffect(() => {
    if (knownUrl(path)) return
    let stale = false
    sign(path).then(
      () => !stale && setSignedCount((n) => n + 1),
      () => !stale && setFailedAttempt(attempt),
    )
    return () => {
      stale = true
    }
  }, [path, attempt])

  return {
    url,
    failed: !url && failedAttempt === attempt,
    retry: () => {
      signed.delete(path)
      local.delete(path)
      setAttempt((a) => a + 1)
    },
  }
}
