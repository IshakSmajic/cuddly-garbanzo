// Deletes stored files nothing points at any more (see public.orphan_files in
// supabase/migrations/*_release_hardening.sql). Called once a day by the
// cleanup-files pg_cron job; nobody else has the secret.
//
// It runs with the service role key, which bypasses RLS and every storage
// policy, so the caller check comes first and the list of files comes from
// the database, never from the request.
import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Compares without stopping at the first difference, so timing reveals nothing. */
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

Deno.serve(async (request) => {
  const secret = Deno.env.get('CLEANUP_SECRET')
  // No secret configured means nobody may call it, not everybody.
  if (!secret || !sameSecret(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data: files, error } = await admin.rpc('orphan_files')
  if (error) return json({ error: `Listing failed: ${error.message}` }, 500)

  const byBucket = new Map<string, string[]>()
  for (const f of files ?? []) byBucket.set(f.bucket_id, [...(byBucket.get(f.bucket_id) ?? []), f.name])

  const removed: Record<string, number> = {}
  const failed: string[] = []
  for (const [bucket, names] of byBucket) {
    removed[bucket] = 0
    // The Storage API removes up to 1,000 per call; smaller batches fail smaller.
    for (let i = 0; i < names.length; i += 100) {
      const batch = names.slice(i, i + 100)
      const { data, error: removeError } = await admin.storage.from(bucket).remove(batch)
      if (removeError) failed.push(...batch)
      else removed[bucket] += data.length
    }
  }
  // At most 1,000 a run (orphan_files' limit); the next run takes the rest.
  return json({ removed, failed })
})
