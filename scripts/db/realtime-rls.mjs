// Checks against the running Realtime service that live events follow RLS:
// a member receives a new message, an outsider subscribed to the same table
// (even with the conversation's id as a filter) receives nothing, and a
// friend request reaches only the two people in it. pgTAP can't test this:
// the filtering happens in the Realtime server, per subscriber.
//
// Needs the local stack. Creates three users and deletes them at the end.
// Run with: npm run db:realtime
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'

const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { stdio: ['ignore', 'pipe', 'ignore'] }))
const URL = status.API_URL
const sql = (query) =>
  execFileSync('docker', ['exec', '-i', 'supabase_db_cuddly-garbanzo', 'psql', '-U', 'postgres', '-qtA', '-c', query])
    .toString()
    .trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const admin = createClient(URL, status.SECRET_KEY, { auth: { persistSession: false } })

let failed = false
function check(cond, label) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failed = true
}

const run = Date.now().toString(36)
const people = {}
for (const name of ['ana', 'ben', 'cai']) {
  const email = `rt-${name}-${run}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'realtime-pass-1', email_confirm: true })
  if (error) throw error
  const username = `rt_${name}_${run}`.slice(0, 20)
  sql(`update public.profiles set username = '${username}' where user_id = '${data.user.id}'`)
  const client = createClient(URL, status.PUBLISHABLE_KEY, { auth: { persistSession: false } })
  await client.auth.signInWithPassword({ email, password: 'realtime-pass-1' })
  // Realtime needs the user's token, not the anonymous key.
  client.realtime.setAuth((await client.auth.getSession()).data.session.access_token)
  people[name] = { id: data.user.id, client, messages: [], requests: [] }
}
sql(`select private.make_friends('${people.ana.id}', '${people.ben.id}')`)
const conversation = sql(
  `select conversation_id from public.direct_conversations where '${people.ana.id}' in (user_low_id, user_high_id)`,
)

// Everyone listens to every message insert and every friend request change;
// cai also tries the conversation's own filter.
const subscribed = []
for (const [name, person] of Object.entries(people)) {
  const filters = [{ event: 'INSERT', schema: 'public', table: 'messages' }]
  if (name === 'cai') filters.push({ event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation}` })
  let channel = person.client.channel(`check-${name}`)
  for (const f of filters) channel = channel.on('postgres_changes', f, (p) => person.messages.push(p.new))
  channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, (p) =>
    person.requests.push(p),
  )
  // SUBSCRIBED only means the channel joined. Database changes flow once
  // Realtime has registered the subscription in Postgres, which it announces
  // with a system message; anything inserted before that is not delivered.
  subscribed.push(
    new Promise((resolve, reject) => {
      channel
        .on('system', {}, (p) => p.extension === 'postgres_changes' && p.status === 'ok' && resolve())
        .subscribe((state, err) => err && reject(err))
    }),
  )
}
await Promise.all(subscribed)

console.log('1. A message reaches only the conversation')
const { error: sendError } = await people.ben.client
  .from('messages')
  .insert({ conversation_id: conversation, client_id: crypto.randomUUID(), content: 'live hello' })
check(!sendError, 'ben sends a message')
await sleep(2000)
check(people.ana.messages.length === 1 && people.ana.messages[0].content === 'live hello', 'ana, a member, receives it')
check(people.ben.messages.length === 1, 'ben receives his own message (the app dedupes it by id)')
check(people.cai.messages.length === 0, 'cai, an outsider, receives nothing, even filtering by the conversation id')
console.log(`  payload created_at looks like: ${people.ana.messages[0]?.created_at}`)

console.log('2. A friend request reaches only the two people in it')
const { error: requestError } = await people.cai.client.rpc('send_friend_request', { recipient: people.ana.id })
check(!requestError, 'cai sends ana a request')
await sleep(2000)
check(people.ana.requests.length === 1 && people.ana.requests[0].eventType === 'INSERT', 'ana receives the new request')
check(people.cai.requests.length === 1, 'cai receives it too (it is hers)')
check(people.ben.requests.length === 0, 'ben, not part of it, receives nothing')

for (const person of Object.values(people)) await person.client.removeAllChannels()
for (const person of Object.values(people)) await admin.auth.admin.deleteUser(person.id)
console.log(failed ? 'Some realtime checks FAILED' : 'All realtime checks passed')
process.exit(failed ? 1 : 0)
