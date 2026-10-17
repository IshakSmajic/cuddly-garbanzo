// Deletes the caller's account, after checking their password again: a
// session left signed in on someone else's device isn't enough. What goes
// and what stays is decided by the foreign keys (spec section 11, "Account
// deletion"): profile, memberships and friendships go; messages stay for the
// other person as "Deleted user". The avatar file is removed by the next
// cleanup-files run.
import { createClient } from 'npm:@supabase/supabase-js@2'

// Called from the browser, so it answers CORS preflights. Any origin is fine:
// the request carries the user's token in a header, not a cookie, so another
// site can't make it on the user's behalf.
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // Who is asking: the Auth server checks the token, not this function.
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '')
  const { data: caller, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !caller.user?.email) return json({ error: 'Not signed in' }, 401)

  const { password } = await request.json().catch(() => ({}))
  if (typeof password !== 'string' || password === '') return json({ error: 'Password required' }, 400)

  // Checking the password means signing in with it (Auth's own rate limits
  // apply). A throwaway client, so the admin client keeps its key.
  const check = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } })
  const { error: passwordError } = await check.auth.signInWithPassword({ email: caller.user.email, password })
  if (passwordError) return json({ error: 'Wrong password' }, 403)

  const { error: deleteError } = await admin.auth.admin.deleteUser(caller.user.id)
  if (deleteError) return json({ error: `Couldn't delete the account: ${deleteError.message}` }, 500)
  return json({ deleted: true })
})
