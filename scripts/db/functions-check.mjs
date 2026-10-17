// Checks the Edge Functions against the running local stack, with real users
// and real files: cleanup-files deletes only orphaned files and only for the
// cron job's secret; delete-account needs the password and deletes exactly
// what the spec says. pgTAP can't do this: deleting files and users goes
// through the Storage and Auth servers.
//
// Needs the local stack (functions are served by `supabase start`) and
// supabase/functions/.env. Run with: npm run db:functions
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { stdio: ['ignore', 'pipe', 'ignore'] }))
const URL = status.API_URL
const sql = (query) =>
  execFileSync('docker', ['exec', '-i', 'supabase_db_cuddly-garbanzo', 'psql', '-U', 'postgres', '-qtA', '-c', query])
    .toString()
    .trim()
const admin = createClient(URL, status.SECRET_KEY, { auth: { persistSession: false } })
const secret = readFileSync(new globalThis.URL('../../supabase/functions/.env', import.meta.url), 'utf8').match(/^CLEANUP_SECRET=(.*)$/m)?.[1]

let failed = false
function check(cond, label) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failed = true
}

const run = Date.now().toString(36)
async function person(name) {
  const email = `fn-${name}-${run}@example.com`
  const password = `functions-pass-${name}`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  sql(`update public.profiles set username = '${`fn_${name}_${run}`.slice(0, 20)}', display_name = '${name}' where user_id = '${data.user.id}'`)
  const client = createClient(URL, status.PUBLISHABLE_KEY, { auth: { persistSession: false } })
  const { data: signedIn } = await client.auth.signInWithPassword({ email, password })
  return { id: data.user.id, email, password, client, token: signedIn.session.access_token }
}
const webp = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64')
const call = (fn, { token, body } = {}) =>
  fetch(`${URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body ?? {}),
  })
// Pretend a file was uploaded two days ago (cleanup leaves anything newer).
const age = (bucket, name) =>
  sql(`update storage.objects set created_at = now() - interval '2 days' where bucket_id = '${bucket}' and name = '${name}'`)
const exists = async (bucket, name) => !(await admin.storage.from(bucket).download(name)).error

const ana = await person('ana')
const ben = await person('ben')
sql(`select private.make_friends('${ana.id}', '${ben.id}')`)
const conversation = sql(`select conversation_id from public.direct_conversations where '${ana.id}' in (user_low_id, user_high_id)`)

console.log('1. cleanup-files deletes orphaned files only')
const avatar = () => `${ana.id}/${crypto.randomUUID()}.webp`
const usedAvatar = avatar()
const oldAvatar = avatar()
const newAvatar = avatar()
for (const path of [usedAvatar, oldAvatar, newAvatar]) {
  await ana.client.storage.from('avatars').upload(path, webp, { contentType: 'image/webp' })
}
await ana.client.rpc('set_avatar', { new_path: usedAvatar })
const sentImage = `${conversation}/${crypto.randomUUID()}.webp`
const unsentImage = `${conversation}/${crypto.randomUUID()}.webp`
for (const path of [sentImage, unsentImage]) {
  await ana.client.storage.from('message-images').upload(path, webp, { contentType: 'image/webp' })
}
const { error: sendError } = await ana.client.rpc('send_image_message', {
  conversation,
  client_id: crypto.randomUUID(),
  path: sentImage,
  width: 1,
  height: 1,
})
check(!sendError, 'ana has an avatar in use, a replaced one, a fresh upload, a sent image and an unsent one')
for (const path of [usedAvatar, oldAvatar]) age('avatars', path)
for (const path of [sentImage, unsentImage]) age('message-images', path)

check((await call('cleanup-files')).status === 401, 'without the secret: 401')
check((await call('cleanup-files', { token: 'wrong' })).status === 401, 'with a wrong secret: 401')
check((await call('cleanup-files', { token: status.PUBLISHABLE_KEY })).status === 401, 'with the public key: 401')
check((await call('cleanup-files', { token: ana.token })).status === 401, 'with a signed-in user’s token: 401')
const cleaned = await call('cleanup-files', { token: secret })
const result = await cleaned.json()
check(cleaned.status === 200 && result.failed.length === 0, `with the secret it runs (${JSON.stringify(result)})`)
check(!(await exists('avatars', oldAvatar)), 'the replaced avatar is gone')
check(!(await exists('message-images', unsentImage)), 'the unsent image is gone')
check(await exists('avatars', usedAvatar), 'the avatar in use stays')
check(await exists('avatars', newAvatar), 'a fresh upload stays (it may be mid-change)')
check(await exists('message-images', sentImage), 'the sent image stays')

console.log('2. delete-account needs the password')
await ana.client.from('messages').insert({ conversation_id: conversation, client_id: crypto.randomUUID(), content: 'bye' })
check((await call('delete-account', { body: { password: ana.password } })).status === 401, 'without a session: 401')
check((await call('delete-account', { token: ana.token, body: {} })).status === 400, 'without a password: 400')
check((await call('delete-account', { token: ana.token, body: { password: 'wrong' } })).status === 403, 'with a wrong password: 403')
check(Boolean((await admin.auth.admin.getUserById(ana.id)).data.user), '... and the account is still there')
const preflight = await fetch(`${URL}/functions/v1/delete-account`, {
  method: 'OPTIONS',
  headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' },
})
check(preflight.ok && preflight.headers.get('access-control-allow-origin') === '*', 'the browser’s CORS preflight is answered')
const deleted = await call('delete-account', { token: ana.token, body: { password: ana.password } })
check(deleted.status === 200, `with the password: deleted (${deleted.status})`)

console.log('3. What deletion removes and keeps')
check(Boolean((await admin.auth.admin.getUserById(ana.id)).error), 'the auth user is gone')
check(sql(`select count(*) from public.profiles where user_id = '${ana.id}'`) === '0', 'the profile is gone')
check(sql(`select count(*) from public.friendships where '${ana.id}' in (user_low_id, user_high_id)`) === '0', 'the friendship is gone')
const { data: history } = await ben.client.from('messages').select('content, sender_id').eq('conversation_id', conversation)
check(
  history?.length === 2 && history.every((m) => m.sender_id === null),
  'ben keeps both messages, now from "Deleted user"',
)
const { data: benImages } = await ben.client.storage.from('message-images').createSignedUrls([sentImage], 60)
check(Boolean(benImages?.[0]?.signedUrl), 'and can still view ana’s image')
const { error: benUpload } = await ben.client.storage
  .from('message-images')
  .upload(`${conversation}/${crypto.randomUUID()}.webp`, webp, { contentType: 'image/webp' })
check(Boolean(benUpload), 'but cannot send images any more (no friendship)')
age('avatars', usedAvatar)
age('avatars', newAvatar)
await call('cleanup-files', { token: secret })
check(!(await exists('avatars', usedAvatar)), 'the next cleanup removes the deleted account’s avatar')

// Ben goes too, so the conversation (and its image) becomes an orphan for
// the next daily cleanup.
await admin.auth.admin.deleteUser(ben.id)
console.log(failed ? 'Some function checks FAILED' : 'All function checks passed')
process.exit(failed ? 1 : 0)
