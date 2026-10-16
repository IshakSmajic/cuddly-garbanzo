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

// Private channels (milestone 8) ------------------------------------------------
// Joins a private channel; resolves with whether Realtime let us in.
function join(person, topic, { presenceKey } = {}) {
  const got = { broadcasts: [], presence: {} }
  const channel = person.client.channel(topic, {
    config: { private: true, broadcast: { self: false }, ...(presenceKey && { presence: { key: presenceKey } }) },
  })
  channel.on('broadcast', { event: '*' }, (p) => got.broadcasts.push(p))
  channel.on('presence', { event: 'sync' }, () => (got.presence = channel.presenceState()))
  return new Promise((resolve) =>
    channel.subscribe((state, err) => {
      if (state === 'SUBSCRIBED') resolve({ channel, got, ok: true })
      if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') resolve({ channel, got, ok: false, error: err?.message })
    }),
  )
}

console.log('3. A conversation channel is for its members')
const room = `conversation:${conversation}`
const anaRoom = await join(people.ana, room)
const benRoom = await join(people.ben, room)
const caiRoom = await join(people.cai, room)
check(anaRoom.ok && benRoom.ok, 'both members can join the conversation channel')
check(!caiRoom.ok, `an outsider is refused (${caiRoom.error ?? 'no error'})`)
const malformed = await join(people.ana, 'conversation:not-a-uuid')
check(!malformed.ok, 'a malformed channel name is refused')
await benRoom.channel.send({ type: 'broadcast', event: 'typing', payload: { user_id: people.ben.id } })
await sleep(1000)
check(anaRoom.got.broadcasts.some((b) => b.event === 'typing'), 'a typing signal from ben reaches ana')

console.log('4. Read receipts come from the database')
const lastId = Number(sql(`select max(id) from public.messages where conversation_id = '${conversation}'`))
const { error: readError } = await people.ana.client.rpc('mark_read', { conversation, message: lastId })
check(!readError, 'ana marks the conversation read')
await sleep(1500)
const read = benRoom.got.broadcasts.find((b) => b.event === 'read')
check(read?.payload?.user_id === people.ana.id && read?.payload?.message_id === lastId, 'ben receives the read signal, sent by the database')
// Members may broadcast on their conversation (typing), so a member can send
// a fake "read" event. The app treats any "read" event only as a cue to
// re-read positions from conversation_members, which only mark_read changes.
const forged = await anaRoom.channel.send({ type: 'broadcast', event: 'read', payload: { user_id: people.ana.id, message_id: 1 } })
console.log(`  note: a member can broadcast a fake "read" event (${forged}); the app only re-reads positions from the table`)

console.log('5. Online status is for friends')
const benSelf = await join(people.ben, `user:${people.ben.id}`, { presenceKey: people.ben.id })
check(benSelf.ok, 'ben joins his own presence channel')
await benSelf.channel.track({ online_at: new Date().toISOString() })
const anaWatch = await join(people.ana, `user:${people.ben.id}`)
const caiWatch = await join(people.cai, `user:${people.ben.id}`)
await sleep(1500)
check(anaWatch.ok && Object.keys(anaWatch.got.presence).includes(people.ben.id), 'ana, a friend, sees ben online')
check(!caiWatch.ok, `cai, not a friend, cannot watch ben (${caiWatch.error ?? 'no error'})`)
const anaTrack = await anaWatch.channel.track({ pretend: true })
await sleep(1000)
check(anaTrack !== 'ok' || !Object.keys(benSelf.got.presence).some((k) => k !== people.ben.id), `ana cannot announce presence on ben's channel (${anaTrack})`)

console.log('6. Ending the friendship')
const { error: unfriendError } = await people.ana.client.rpc('unfriend', { other: people.ben.id })
check(!unfriendError, 'ana unfriends ben')
await sleep(1500)
check(benRoom.got.broadcasts.some((b) => b.event === 'relationship'), 'ben’s open conversation hears that the friendship changed')
// A separate client: realtime-js would hand back ana's existing channel.
const anaFresh = createClient(URL, status.PUBLISHABLE_KEY, { auth: { persistSession: false } })
await anaFresh.auth.signInWithPassword({ email: `rt-ana-${run}@example.com`, password: 'realtime-pass-1' })
anaFresh.realtime.setAuth((await anaFresh.auth.getSession()).data.session.access_token)
const anaRejoin = await join({ client: anaFresh }, `user:${people.ben.id}`)
check(!anaRejoin.ok, 'a former friend can no longer join ben’s presence channel')
// What about the channel ana joined while still a friend?
anaWatch.got.presence = {}
await benSelf.channel.track({ online_at: new Date().toISOString(), again: true })
await sleep(1500)
const stillSees = Object.keys(anaWatch.got.presence).includes(people.ben.id)
console.log(`  finding: an already-joined former friend ${stillSees ? 'STILL receives' : 'no longer receives'} presence updates until they rejoin`)
const { data: refreshed } = await people.ana.client.auth.refreshSession()
people.ana.client.realtime.setAuth(refreshed.session.access_token)
await sleep(2000)
anaWatch.got.presence = {}
await benSelf.channel.track({ online_at: new Date().toISOString(), third: true })
await sleep(1500)
const afterRefresh = Object.keys(anaWatch.got.presence).includes(people.ben.id)
console.log(`  finding: after ana's token refresh she ${afterRefresh ? 'STILL receives' : 'no longer receives'} them`)

await anaFresh.removeAllChannels()
for (const person of Object.values(people)) await person.client.removeAllChannels()
for (const person of Object.values(people)) await admin.auth.admin.deleteUser(person.id)
console.log(failed ? 'Some realtime checks FAILED' : 'All realtime checks passed')
process.exit(failed ? 1 : 0)
