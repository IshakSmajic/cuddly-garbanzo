// Browser walk-through of the auth and profile flows, driving headless Chrome over the
// DevTools protocol (no extra dependencies). Run it with scripts/e2e/run.sh,
// which starts the dev server and Chrome first. Needs the local Supabase stack
// running. Screenshots land in scripts/e2e/shots/ (git-ignored).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

const SHOTS = new URL('./shots/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })
const APP = 'http://localhost:5173'
const MAILPIT = 'http://127.0.0.1:54324'
// The app's own env file, for calling the Auth API directly (a second "device").
const env = Object.fromEntries(
  readFileSync(new URL('../../.env.development.local', import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
)
async function authApi(path, body) {
  return fetch(`${env.VITE_SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const targets = await (await fetch('http://127.0.0.1:9333/json')).json()
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))

let nextId = 1
const pending = new Map()
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
  if (msg.method === 'Runtime.exceptionThrown') console.log('PAGE EXCEPTION', JSON.stringify(msg.params.exceptionDetails.exception?.description ?? msg.params))
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
    console.log('CONSOLE ERROR', msg.params.args.map((a) => a.value ?? a.description).join(' '))
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(`eval failed: ${expr}\n${r.exceptionDetails.exception?.description}`)
  return r.result.value
}
async function waitFor(expr, label, timeout = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await evaluate(`Boolean(${expr})`)) return
    await sleep(100)
  }
  throw new Error(`Timed out waiting for: ${label}`)
}
const path = () => evaluate('location.pathname')
const text = () => evaluate('document.body.innerText')

async function viewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
}
async function shot(name) {
  await sleep(250)
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${SHOTS}${name}.png`, Buffer.from(data, 'base64'))
  console.log(`  shot: ${name}.png (${await path()})`)
}
async function go(url) {
  await send('Page.navigate', { url })
  await sleep(300)
  await waitFor(`document.readyState === 'complete'`, 'load')
}
// React controlled inputs need the native setter plus an input event. Waits
// for the field first: a page can still be loading after the URL changed.
async function type(label, value) {
  await waitFor(
    `[...document.querySelectorAll('label')].some(l => l.textContent.trim().toLowerCase() === ${JSON.stringify(label.toLowerCase())})`,
    `field ${label}`,
  )
  await evaluate(`(() => {
    const l = [...document.querySelectorAll('label')].find(l => l.textContent.trim().toLowerCase() === ${JSON.stringify(label.toLowerCase())});
    if (!l) throw new Error('no label ${label}');
    const input = document.getElementById(l.htmlFor);
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
    set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
}
async function click(textContent) {
  await waitFor(
    `[...document.querySelectorAll('button, a')].some(b => b.innerText.trim().startsWith(${JSON.stringify(textContent)}))`,
    `button ${textContent}`,
  )
  await evaluate(`(() => {
    const el = [...document.querySelectorAll('button, a')].find(b => b.innerText.trim().startsWith(${JSON.stringify(textContent)}));
    if (!el) throw new Error('no button ${textContent}');
    el.click();
  })()`)
}
async function findEmail(email, subject) {
  const query = `to:${email} subject:"${subject}"`
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(query)}`)).json()
    if (list.messages?.length) return list.messages[0]
    await sleep(300)
  }
  return null
}
// Supabase's email links all go through /auth/v1/verify; the subject tells them apart.
async function latestLink(email, subject) {
  const found = await findEmail(email, subject)
  if (!found) throw new Error(`no "${subject}" email for ${email}`)
  const msg = await (await fetch(`${MAILPIT}/api/v1/message/${found.ID}`)).json()
  const href = msg.HTML.match(/href="([^"]*verify[^"]*)"/)?.[1]
  if (!href) throw new Error(`no link in "${subject}" email for ${email}`)
  return href.replaceAll('&amp;', '&')
}
// Picks a file in the page's (hidden) file input, as a user would.
async function pickFile(filePath) {
  const { root } = await send('DOM.getDocument')
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' })
  await send('DOM.setFileInputFiles', { nodeId, files: [filePath] })
}
// A gradient PNG of the given size, so the tests need no image files.
function png(width, height) {
  const row = width * 3 + 1
  const raw = Buffer.alloc(row * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw.set([(x * 255) / width, (y * 255) / height, 120], y * row + 1 + x * 3)
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // truecolour RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
// The signed-in user's files, listed through the Storage API with their own
// session (so this also exercises the "see only your own folder" policy).
async function avatarFiles() {
  const session = JSON.parse(
    await evaluate(`localStorage.getItem(Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k)))`),
  )
  const res = await fetch(`${env.VITE_SUPABASE_URL}/storage/v1/object/list/avatars`, {
    method: 'POST',
    headers: {
      apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${session.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ prefix: session.user.id, limit: 100 }),
  })
  return (await res.json()).map((file) => file.name)
}
const headerAvatarLoaded = `(() => { const i = document.querySelector('.home-bar img.avatar'); return i && i.complete && i.naturalWidth > 0 })()`

function check(cond, label) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) process.exitCode = 1
}

await send('Page.enable')
await send('Runtime.enable')
await viewport(1680, 900)

const run = Date.now().toString(36)
const ana = { email: `ana.${run}@example.com`, password: 'correct-horse-1', username: `ana_${run}`.slice(0, 20) }
const ben = { email: `ben.${run}@example.com`, password: 'correct-horse-2' }

console.log('1. Signed-out visitor')
await go(APP + '/')
await waitFor(`location.pathname === '/sign-in'`, 'redirect to /sign-in')
check(true, '/ redirects a signed-out visitor to /sign-in')
await shot('01-sign-in')

console.log('2. Sign up')
await click('Create an account')
await waitFor(`location.pathname === '/sign-up'`, '/sign-up')
await type('Email', ana.email)
await type('Password', 'short')
await shot('02-sign-up-short-password')
await click('Create account')
await waitFor(`document.body.innerText.includes('Use at least 8 characters')`, 'short password error')
check(true, 'short password is rejected before sending')
await type('Password', ana.password)
await click('Create account')
await waitFor(`location.pathname === '/check-email'`, '/check-email')
check((await text()).includes(ana.email), 'check-email page shows the address')
await shot('03-check-email')

console.log('3. Unconfirmed sign-in')
await go(APP + '/sign-in')
await type('Email', ana.email)
await type('Password', ana.password)
await click('Enter Thread Buddies')
await waitFor(`location.pathname === '/check-email'`, 'unconfirmed → /check-email')
await waitFor(`document.body.innerText.includes('Confirm your email before signing in')`, 'unconfirmed message')
check(true, 'unconfirmed sign-in explains what to do')

console.log('4. Confirm via email link')
const link = await latestLink(ana.email, 'Confirm')
await go(link)
await waitFor(`location.pathname === '/onboarding'`, 'confirmation → /onboarding', 10000)
check(true, 'confirmation link signs in and lands on onboarding')
await shot('04-onboarding-empty')

console.log('5. Onboarding')
await type('Username', 'Bad-Name')
await sleep(100)
check((await text()).includes('Use only letters, numbers and underscores.'), 'invalid username shows a rule (input lowercased to bad-name)')
await type('Username', ana.username)
await waitFor(`document.body.innerText.includes('is available')`, 'availability check')
await type('Display name', 'Ana Test')
await shot('05-onboarding-filled')
await click('Continue')
await waitFor(`location.pathname === '/'`, 'onboarding → home')
check((await text()).includes(`@${ana.username}`), 'home shows the new username')
await shot('06-home')

console.log('6. Route guards when onboarded')
await go(APP + '/onboarding')
await waitFor(`location.pathname === '/'`, '/onboarding → /')
check(true, 'onboarded user is sent away from /onboarding')
await go(APP + '/sign-in')
await waitFor(`location.pathname === '/'`, '/sign-in → /')
check(true, 'signed-in user is sent away from /sign-in')

console.log('7. Sign out and back in')
await click('Sign out')
await waitFor(`location.pathname === '/sign-in'`, 'sign out → /sign-in')
check(true, 'sign out returns to /sign-in')
await type('Email', ana.email)
await type('Password', 'wrong-password')
await click('Enter Thread Buddies')
await waitFor(`document.body.innerText.includes('Invalid email or password.')`, 'wrong password error')
check(true, 'wrong password shows a generic error')
await shot('07-sign-in-error')
await type('Password', ana.password)
await click('Enter Thread Buddies')
await waitFor(`location.pathname === '/'`, 'sign in → home')
check(true, 'correct password signs in straight to home')
await click('Sign out')
await waitFor(`location.pathname === '/sign-in'`, 'sign out')

console.log('8. Second user: username already taken')
await go(APP + '/sign-up')
await type('Email', ben.email)
await type('Password', ben.password)
await click('Create account')
await waitFor(`location.pathname === '/check-email'`, 'ben check-email')
await go(await latestLink(ben.email, 'Confirm'))
await waitFor(`location.pathname === '/onboarding'`, 'ben onboarding', 10000)
await type('Username', ana.username)
await waitFor(`document.body.innerText.includes('is taken')`, 'taken check')
check(true, "another user's username shows as taken")
await type('Display name', 'Ben Test')
await click('Continue')
await waitFor(`document.body.innerText.includes('is taken. Try another.')`, 'taken on submit')
check((await path()) === '/onboarding', 'submitting a taken username keeps you on onboarding')
await shot('08-onboarding-taken')

console.log('9. Mobile layout')
await viewport(390, 844, true)
await click('Sign out')
await waitFor(`location.pathname === '/sign-in'`, 'ben sign out')
await shot('09-sign-in-mobile')
const overflow = await evaluate('document.documentElement.scrollWidth > window.innerWidth')
check(!overflow, 'no horizontal scroll at 390px')

console.log('10. Forgot password')
await viewport(1680, 900)
await go(APP + '/sign-in')
await type('Email', ana.email)
await click('Forgot password?')
await waitFor(`location.pathname === '/forgot-password'`, '/forgot-password')
check((await evaluate(`document.querySelector('input').value`)) === ana.email, 'forgot-password keeps the typed email')
await shot('10-forgot-password')
await click('Send reset link')
await waitFor(`document.body.innerText.includes('If an account exists')`, 'reset sent')
const subtitle = (email) => evaluate(`document.querySelector('.auth-subtitle').innerText.replace(${JSON.stringify(email)}, '<email>')`)
const knownMessage = await subtitle(ana.email)
check((await text()).includes('Resend email in'), 'resend has a cooldown')
await shot('11-forgot-password-sent')
const nobody = `nobody.${run}@example.com`
await go(APP + '/forgot-password')
await type('Email', nobody)
await click('Send reset link')
await waitFor(`document.body.innerText.includes('If an account exists')`, 'unknown email sent')
check((await subtitle(nobody)) === knownMessage, 'unknown email gets the identical message (no enumeration)')

console.log('11. Reset password via email link')
// A second "device": a session made straight through the Auth API.
const other = await (await authApi('token?grant_type=password', { email: ana.email, password: ana.password })).json()
check(Boolean(other.refresh_token), 'second session signed in')
const resetLink = await latestLink(ana.email, 'Reset')
await go(resetLink)
await waitFor(`location.pathname === '/reset-password'`, 'reset link → /reset-password', 10000)
check(true, 'reset link opens the new-password form')
await shot('12-reset-password')
const newPassword = 'brand-new-horse-1'
await type('New password', newPassword)
await type('Confirm password', 'something-else')
await click('Save password')
await waitFor(`document.body.innerText.includes("The passwords don't match.")`, 'mismatch error')
check(true, 'mismatched confirmation is rejected before sending')
await type('New password', ana.password)
await type('Confirm password', ana.password)
await click('Save password')
await waitFor(`document.body.innerText.includes('That is your current password')`, 'same password error')
check(true, 'reusing the current password is refused by the server')
await shot('13-reset-password-same')
await type('New password', newPassword)
await type('Confirm password', newPassword)
await click('Save password')
await waitFor(`location.pathname === '/'`, 'reset → home', 10000)
check((await text()).includes(`@${ana.username}`), 'saving the new password lands on home')
check(Boolean(await findEmail(ana.email, 'password was changed')), '"password was changed" email is sent')
const refresh = await authApi('token?grant_type=refresh_token', { refresh_token: other.refresh_token })
check(refresh.status >= 400, `the server revoked the other device's session (refresh → ${refresh.status})`)

console.log('12. Sign in with the new password')
await click('Sign out')
await waitFor(`location.pathname === '/sign-in'`, 'sign out')
await type('Email', ana.email)
await type('Password', ana.password)
await click('Enter Thread Buddies')
await waitFor(`document.body.innerText.includes('Invalid email or password.')`, 'old password rejected')
check(true, 'the old password no longer works')
await type('Password', newPassword)
await click('Enter Thread Buddies')
await waitFor(`location.pathname === '/'`, 'new password → home')
check(true, 'the new password signs in')
await click('Sign out')
await waitFor(`location.pathname === '/sign-in'`, 'sign out')

console.log('13. Used link and direct visits')
await go(resetLink)
await waitFor(`location.pathname === '/sign-in' && document.body.innerText.includes("That link didn't work")`, 'used link → sign-in error', 10000)
check(true, 'a used reset link explains itself on sign-in')
await shot('14-reset-link-used')
await go(APP + '/reset-password')
await waitFor(`location.pathname === '/sign-in'`, '/reset-password signed out → /sign-in')
check(true, 'signed-out visitor is sent from /reset-password to /sign-in')

console.log('14. Reset for a user who has not onboarded')
await go(APP + '/forgot-password')
await type('Email', ben.email)
await click('Send reset link')
await waitFor(`document.body.innerText.includes('If an account exists')`, 'ben reset sent')
await go(await latestLink(ben.email, 'Reset'))
await waitFor(`location.pathname === '/reset-password'`, 'ben reset link', 10000)
check(true, 'reset link is not swallowed by the onboarding redirect')
await type('New password', 'brand-new-horse-2')
await type('Confirm password', 'brand-new-horse-2')
await click('Save password')
await waitFor(`location.pathname === '/onboarding'`, 'ben → onboarding', 10000)
check(true, 'after the reset, a user without a username continues to onboarding')

console.log('15. Mobile layout of the new screens')
await viewport(390, 844, true)
// Wait for the sign-out itself; navigating straight away could reload the
// page before the session is cleared, and the gate would rightly bounce us.
await click('Sign out')
await waitFor(`location.pathname === '/sign-in'`, 'signed out')
await go(APP + '/forgot-password')
await shot('15-forgot-password-mobile')
check(!(await evaluate('document.documentElement.scrollWidth > window.innerWidth')), 'forgot-password has no horizontal scroll at 390px')

console.log('16. Profile editor')
await viewport(1680, 900)
// Ben finishes onboarding, so there is a second username to collide with.
const benName = `ben_${run}`.slice(0, 20)
await go(APP + '/sign-in')
await type('Email', ben.email)
await type('Password', 'brand-new-horse-2')
await click('Enter Thread Buddies')
await waitFor(`location.pathname === '/onboarding'`, 'ben → onboarding')
await type('Username', benName)
await waitFor(`document.body.innerText.includes('is available')`, 'ben name available')
await type('Display name', 'Ben Test')
await click('Continue')
await waitFor(`location.pathname === '/'`, 'ben → home')
await click('Sign out')
await waitFor(`location.pathname === '/sign-in'`, 'ben sign out')

await type('Email', ana.email)
await type('Password', newPassword)
await click('Enter Thread Buddies')
await waitFor(`location.pathname === '/'`, 'ana → home')
check(
  (await evaluate(`document.querySelector('.home-bar .avatar-initials')?.innerText`)) === 'AT',
  'header shows initials when there is no avatar',
)
await shot('16-home-header')
await evaluate(`document.querySelector('a[href="/settings/profile"]').click()`)
await waitFor(`location.pathname === '/settings/profile'`, 'header → /settings/profile')
check(true, 'the header links to the profile editor')
check(
  (await evaluate(`document.querySelector('input[autocomplete=username]').value`)) === ana.username,
  'the editor is filled with the current profile',
)
await type('Username', benName)
await waitFor(`document.body.innerText.includes('is taken')`, 'username taken')
check(true, "another user's username shows as taken in the editor")
await type('Username', ana.username)
await sleep(500)
check(!(await text()).includes('is taken'), 'your own username is never reported as taken')
await type('Display name', 'Ana Edited')
await type('Bio', '  Hello there  ')
check((await text()).includes('11 / 280'), 'bio counter counts the trimmed text')
await type('Bio', 'x'.repeat(281))
await click('Save changes')
await waitFor(`document.body.innerText.includes('At most 280 characters.')`, 'bio too long')
check(true, 'a bio over 280 characters is rejected before sending')
await type('Bio', '  Hello there  ')
await click('Save changes')
await waitFor(`document.body.innerText.includes('Saved.')`, 'saved')
check((await evaluate(`document.querySelector('.home-bar').innerText`)).includes('Ana Edited'), 'the header shows the new display name')
await shot('17-profile-saved')
await go(APP + '/settings/profile')
await waitFor(`document.querySelector('textarea')`, 'editor reloaded')
check(
  (await evaluate(`document.querySelector('textarea').value`)) === 'Hello there',
  'after a reload the bio is stored, trimmed',
)

console.log('17. Avatars')
const files = mkdtempSync(join(tmpdir(), 'thread-e2e-'))
writeFileSync(join(files, 'landscape.png'), png(800, 600))
writeFileSync(join(files, 'portrait.png'), png(600, 1000))
writeFileSync(join(files, 'notes.txt'), 'not an image')

await pickFile(join(files, 'notes.txt'))
await waitFor(`document.body.innerText.includes('Choose a JPEG, PNG or WebP image.')`, 'wrong type error')
check((await avatarFiles()).length === 0, 'a non-image is refused before anything is uploaded')

await pickFile(join(files, 'landscape.png'))
await waitFor(headerAvatarLoaded, 'avatar shows in the header', 15000)
const size = await evaluate(`(() => { const i = document.querySelector('.home-bar img.avatar'); return [i.naturalWidth, i.naturalHeight] })()`)
check(size[0] === 512 && size[1] === 512, `the upload is cropped and scaled to 512×512 (got ${size.join('×')})`)
const first = await avatarFiles()
check(first.length === 1, `exactly one file is stored after the upload (${first.join(', ')})`)
check(/^[0-9a-f-]{36}\.(webp|jpg)$/.test(first[0] ?? ''), 'the file has a random name')
check((await text()).includes('Change photo'), 'the button now offers to change the photo')
await shot('18-avatar-uploaded')

const firstSrc = await evaluate(`document.querySelector('.home-bar img.avatar').src`)
await pickFile(join(files, 'portrait.png'))
await waitFor(`${headerAvatarLoaded} && document.querySelector('.home-bar img.avatar').src !== ${JSON.stringify(firstSrc)}`, 'avatar replaced', 15000)
await sleep(500) // the old file is deleted after the profile changes
const second = await avatarFiles()
check(second.length === 1 && second[0] !== first[0], 'replacing stores the new file and deletes the old one')

await click('Remove')
await waitFor(`!document.querySelector('.home-bar img.avatar')`, 'avatar removed', 10000)
check(
  (await evaluate(`document.querySelector('.home-bar .avatar-initials')?.innerText`)) === 'AE',
  'after removing, the header shows the new initials',
)
await sleep(500)
check((await avatarFiles()).length === 0, 'removing deletes the stored file')
check(!(await text()).includes('Remove'), 'the remove button disappears')

console.log('18. Profile editor on mobile')
await pickFile(join(files, 'landscape.png'))
await waitFor(headerAvatarLoaded, 'avatar for mobile shot', 15000)
await viewport(390, 844, true)
await shot('19-profile-mobile')
check(!(await evaluate('document.documentElement.scrollWidth > window.innerWidth')), 'the profile editor has no horizontal scroll at 390px')
rmSync(files, { recursive: true, force: true })

// Two people in one browser: sign out one, sign in the other.
async function signIn(email, password) {
  await go(APP + '/sign-in')
  await type('Email', email)
  await type('Password', password)
  await click('Enter Thread Buddies')
  await waitFor(`location.pathname === '/'`, `sign in ${email}`)
}
async function signOut() {
  await click('Sign out')
  await waitFor(`location.pathname === '/sign-in'`, 'signed out')
}
const results = () => evaluate(`document.querySelector('.person-list')?.innerText ?? ''`)
const has = (s) => `document.body.innerText.includes(${JSON.stringify(s)})`
const benUser = { email: ben.email, password: 'brand-new-horse-2' }

console.log('19. Find people')
await viewport(1680, 900)
await click('People')
await waitFor(`location.pathname === '/people'`, 'header → /people')
check(true, 'the header links to people search')
await type('Username', 'be')
await waitFor(has('Type at least 3 characters.'), 'too short hint')
check(true, 'a search under 3 characters is not sent')
await type('Username', ana.username)
await waitFor(has(`No one's username starts with @${ana.username}`), 'own name search')
check(true, 'search leaves out yourself')
await type('Username', benName.toUpperCase())
await waitFor(`document.querySelector('.person-list')?.innerText.includes('@${benName}')`, 'ben found')
check((await results()).includes('Ben Test'), 'search finds ben by username prefix, ignoring case')
await shot('20-people-search')
await click('Add friend')
await waitFor(has('Request sent'), 'request sent')
check(true, 'ana sends ben a request')

console.log('20. Accept a request')
await signOut()
await signIn(benUser.email, benUser.password)
await waitFor(`document.querySelector('.nav-badge')?.innerText === '1'`, 'badge')
check(true, 'the header shows 1 request waiting')
await click('Requests')
await waitFor(`location.pathname === '/requests' && document.querySelector('.person-list')`, '/requests')
check((await text()).includes('Ana Edited'), "ana's request is listed under Waiting for you")
await shot('21-requests')
await click('Accept')
await waitFor(`document.querySelector('.relation-label.is-friends')`, 'friends')
check(true, 'accepting shows Friends')
await waitFor(`!document.querySelector('.nav-badge')`, 'badge cleared')
check(true, 'the header badge clears')

console.log('21. Block from a profile')
await go(`${APP}/u/${ana.username}`)
await waitFor(has('Friends'), 'ana profile')
check((await text()).includes('Hello there'), "the profile page shows ana's bio")
await click('Block')
await waitFor(`document.querySelector('.confirm-box')`, 'confirm')
check(true, 'blocking asks for confirmation first')
await shot('22-block-confirm')
await click('Block @')
await waitFor(has('Unblock'), 'blocked')
check((await text()).includes('Blocked'), 'after blocking, the profile shows Blocked and Unblock')
await go(APP + '/people')
await type('Username', ana.username)
await waitFor(`document.querySelector('.person-list')`, 'ben searches ana')
check((await results()).includes('Blocked'), 'people you blocked still show in your search, marked Blocked')

console.log('22. Being blocked')
await signOut()
await signIn(ana.email, newPassword)
await go(APP + '/people')
await type('Username', benName)
await waitFor(has(`No one's username starts with @${benName}`), 'ben hidden')
check(true, 'the blocker is hidden from the blocked user’s search')
await go(`${APP}/u/${benName}`)
await waitFor(has('Add friend'), 'ben profile')
check(!(await text()).includes('Friends'), 'the friendship ended')
check(!(await text()).includes('Blocked'), 'the profile does not reveal the block')
await click('Add friend')
await waitFor(has("You can't send a request to this person."), 'refused')
check(true, 'a request to the blocker is refused with a vague message')

console.log('23. Unblock, cancel, decline')
await signOut()
await signIn(benUser.email, benUser.password)
await go(`${APP}/u/${ana.username}`)
await click('Unblock')
await waitFor(has('Add friend'), 'unblocked')
check(true, 'unblocking does not restore the friendship')
await click('Add friend')
await waitFor(has('Request sent'), 'ben sent')
await click('Cancel')
await waitFor(has('Add friend'), 'cancelled')
check(true, 'the requester can cancel')
await click('Add friend')
await waitFor(has('Request sent'), 'ben sent again')
await signOut()
await signIn(ana.email, newPassword)
await click('Requests')
await waitFor(`location.pathname === '/requests' && document.querySelector('.person-list')`, 'ana requests')
await click('Decline')
await waitFor(has('No one is waiting for an answer.'), 'declined')
check(true, 'declining removes the request from the list')

console.log('24. Re-request after a decline')
await signOut()
await signIn(benUser.email, benUser.password)
await go(`${APP}/u/${ana.username}`)
await click('Add friend')
await waitFor(has('You can ask again after 24 hours.'), 'cooldown')
check(true, 'asking again within 24 hours of a decline is refused')

console.log('25. Mobile layout of the people screens')
await viewport(390, 844, true)
await go(APP + '/people')
await type('Username', ana.username)
await waitFor(`document.querySelector('.person-list')`, 'mobile results')
await shot('23-people-mobile')
check(!(await evaluate('document.documentElement.scrollWidth > window.innerWidth')), 'people search has no horizontal scroll at 390px')
await go(APP + '/requests')
await waitFor(`document.querySelectorAll('.request-section').length === 2`, 'mobile requests')
await shot('24-requests-mobile')
check(!(await evaluate('document.documentElement.scrollWidth > window.innerWidth')), 'requests has no horizontal scroll at 390px')
await go(`${APP}/u/${ana.username}`)
await waitFor(has('Block'), 'mobile profile')
await shot('25-profile-page-mobile')
check(!(await evaluate('document.documentElement.scrollWidth > window.innerWidth')), 'profile page has no horizontal scroll at 390px')

// Rows the signed-in user can read through the API with their own session
// (so this goes through RLS, like the app).
async function rest(query) {
  const session = JSON.parse(
    await evaluate(`localStorage.getItem(Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k)))`),
  )
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${query}`, {
    headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${session.access_token}` },
  })
  return res.json()
}
// Ana asks, Ben accepts. (Ben can't ask: Ana declined him within 24 hours.)
async function makeFriends() {
  await signOut()
  await signIn(ana.email, newPassword)
  await go(`${APP}/u/${benName}`)
  await click('Add friend')
  await waitFor(has('Request sent'), 'ana asks ben')
  await signOut()
  await signIn(benUser.email, benUser.password)
  await click('Requests')
  await waitFor(`location.pathname === '/requests' && document.querySelector('.person-list')`, 'ben requests')
  await click('Accept')
  await waitFor(`document.querySelector('.relation-label.is-friends')`, 'ben accepts')
}

console.log('26. Chats on the home screen')
await viewport(1680, 900)
await go(APP + '/')
await waitFor(`document.querySelector('.person-list')`, 'chat list')
check(
  (await results()).includes('Ana Edited') && (await results()).includes('Read only'),
  'the history with ana (friends once, then blocked) is on home, read only',
)
await makeFriends()
await go(APP + '/')
await waitFor(`document.querySelector('.person-list')`, 'chat list again')
check((await results()).includes('Ana Edited') && !(await results()).includes('Read only'), 'after accepting, the chat with ana is no longer read only')
await shot('26-home-friends')
const conversations = await rest('conversations?select=id')
check(conversations.length === 1, 'accepting created one conversation, visible to ben')
const members = await rest(`conversation_members?select=user_id&conversation_id=eq.${conversations[0]?.id}`)
check(members.length === 2, 'ben can see both members of it')

console.log('27. Unfriend')
await go(`${APP}/u/${ana.username}`)
await click('Unfriend')
await waitFor(`document.querySelector('.confirm-box')`, 'unfriend confirm')
check((await text()).includes("You'll both keep your messages"), 'unfriending asks first and says messages stay')
await shot('27-unfriend-confirm')
await click('Unfriend @')
await waitFor(has('Add friend'), 'unfriended')
check(!(await text()).includes('Friends'), 'after unfriending, the profile offers Add friend')
await go(APP + '/')
await waitFor(`document.querySelector('.person-list')`, 'chat list after unfriend')
check((await results()).includes('Read only'), 'after unfriending, the chat stays on home, read only')
const afterUnfriend = await rest('conversations?select=id')
check(afterUnfriend.length === 1 && afterUnfriend[0].id === conversations[0].id, 'the conversation survives unfriending')

console.log('28. Friends again')
await makeFriends()
const again = await rest('conversations?select=id')
check(again.length === 1 && again[0].id === conversations[0].id, 're-friending reuses the same conversation')

console.log('29. Home on mobile')
await viewport(390, 844, true)
await go(APP + '/')
await waitFor(`document.querySelector('.person-list')`, 'mobile chat list')
await shot('28-home-mobile')
check(!(await evaluate('document.documentElement.scrollWidth > window.innerWidth')), 'home has no horizontal scroll at 390px')

// The composer is a textarea with an aria-label, so the label-based type() doesn't reach it.
async function compose(value) {
  await evaluate(`(() => {
    const el = document.querySelector('.chat-composer textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
}
async function pressEnter() {
  await evaluate(`document.querySelector('.chat-composer textarea').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`)
}
const bubbles = (selector = '.bubble-row') =>
  evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(b => b.querySelector('.bubble-text')?.innerText ?? null)`)
const settled = `!document.querySelector('.is-pending')`
async function restWrite(method, query, body) {
  const session = JSON.parse(
    await evaluate(`localStorage.getItem(Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k)))`),
  )
  return fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${query}`, {
    method,
    headers: {
      apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${session.access_token}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
}
// Lets the test lose the *answer* to one send: the request reaches the
// database, but the app sees a network error. Installed before the app's own
// scripts, so the Supabase client picks up this fetch.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `{
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await realFetch(input, init);
      const url = typeof input === 'string' ? input : input.url;
      const method = (init?.method ?? (typeof input === 'string' ? 'GET' : input.method)).toUpperCase();
      if (window.__dropNextSendAnswer && method === 'POST' && url.includes('/rest/v1/messages')) {
        window.__dropNextSendAnswer = false;
        throw new TypeError('Failed to fetch');
      }
      return response;
    };
    // Swallows live (WebSocket) frames containing window.__muteLive, so a
    // test can make the app miss a realtime event, as a sleeping tab would.
    const RealSocket = window.WebSocket;
    window.WebSocket = class extends RealSocket {
      constructor(...args) {
        super(...args);
        (window.__sockets ??= []).push(this);
        const handler = Object.getOwnPropertyDescriptor(RealSocket.prototype, 'onmessage');
        Object.defineProperty(this, 'onmessage', {
          get: () => handler.get.call(this),
          set: (fn) => handler.set.call(this, fn && ((event) => {
            if (window.__muteLive && String(event.data).includes(window.__muteLive)) return;
            fn.call(this, event);
          })),
        });
      }
    };
  }`,
})

console.log('30. Send messages')
await viewport(1680, 900)
await go(`${APP}/u/${ana.username}`)
await click('Message')
await waitFor(`location.pathname.startsWith('/c/')`, 'profile → chat')
check(true, 'a friend’s profile opens your chat')
await waitFor(`document.querySelector('.chat-composer')`, 'chat loaded')
const chatPath = await path()
check((await text()).includes('No messages yet. Say hello.'), 'a new chat says it is empty')
await compose('   ')
check(await evaluate(`document.querySelector('.chat-send').disabled`), 'a message of only spaces cannot be sent')
await compose('x'.repeat(3600))
check((await text()).includes('3,600 / 4,000'), 'a counter appears near the limit')
await compose('x'.repeat(4001))
check(
  (await text()).includes('Messages are at most 4,000 characters.') && (await evaluate(`document.querySelector('.chat-send').disabled`)),
  'over 4,000 characters is refused before sending',
)
await compose('  Hi Ana  ')
await pressEnter()
await waitFor(`document.querySelector('.bubble-row.is-mine') && ${settled}`, 'sent')
check(JSON.stringify(await bubbles()) === JSON.stringify(['Hi Ana']), 'Enter sends; the ends are trimmed')
check((await evaluate(`document.querySelector('.chat-composer textarea').value`)) === '', 'the composer clears after sending')
await compose('line one\nline two')
await click('Send')
await waitFor(`document.querySelectorAll('.bubble-row.is-mine').length === 2 && ${settled}`, 'second sent')
check((await bubbles())[1] === 'line one\nline two', 'line breaks inside a message are kept')
await go(APP + chatPath)
await waitFor(`document.querySelectorAll('.bubble-row').length === 2`, 'after reload')
check(true, 'after a reload, the messages are still there')
await shot('29-chat')

console.log('31. The other side')
await signOut()
await signIn(ana.email, newPassword)
await waitFor(`document.querySelector('.person-list')`, 'ana chat list')
check((await results()).includes('line one'), 'home shows the last message as a preview')
await shot('30-home-chats')
await evaluate(`document.querySelector('.chat-row').click()`)
await waitFor(`document.querySelectorAll('.bubble-row').length === 2`, 'ana opens chat')
check((await evaluate(`document.querySelectorAll('.bubble-row:not(.is-mine)').length`)) === 2, 'ben’s messages show on the other side for ana')
await compose('Hello Ben')
await pressEnter()
await waitFor(`document.querySelectorAll('.bubble-row.is-mine').length === 1 && ${settled}`, 'ana sent')
check(true, 'ana replies')

console.log('32. A lost answer and a retry')
await waitFor(`document.querySelector('.chat[data-live=live]')`, 'ana live')
await evaluate('window.__dropNextSendAnswer = true')
await compose('Did this arrive?')
await pressEnter()
await waitFor(`${settled} && !document.body.innerText.includes('Not sent')`, 'healed by the live event')
check(
  (await bubbles()).filter((b) => b === 'Did this arrive?').length === 1,
  'a lost answer heals itself: the live event delivers the stored message, shown once',
)
check((await rest(`messages?select=id&content=eq.${encodeURIComponent('Did this arrive?')}`)).length === 1, '... and it is stored once')
// Now also miss the live event, so only Retry can resolve it.
await evaluate(`window.__dropNextSendAnswer = true; window.__muteLive = 'Is this stored once?'`)
await compose('Is this stored once?')
await pressEnter()
await waitFor(has('Not sent'), 'send looks failed')
const stored = await rest(`messages?select=id&content=eq.${encodeURIComponent('Is this stored once?')}`)
check(stored.length === 1, 'with the answer and the live event both lost, the app shows Not sent, but the message is stored')
await click('Retry')
await waitFor(settled, 'retried')
check((await bubbles()).filter((b) => b === 'Is this stored once?').length === 1, 'retrying shows the message once')
await evaluate('window.__muteLive = null')
const afterRetry = await rest(`messages?select=id&content=eq.${encodeURIComponent('Is this stored once?')}`)
check(afterRetry.length === 1 && afterRetry[0].id === stored[0].id, 'the retry reused the client_id: still one message in the database')

console.log('33. Older messages')
const chatId = chatPath.split('/')[2]
const seeded = await restWrite(
  'POST',
  'messages',
  Array.from({ length: 60 }, (_, i) => ({ conversation_id: chatId, client_id: crypto.randomUUID(), content: `Seeded ${i + 1}` })),
)
check(seeded.status === 201, `60 more messages sent through the API (${seeded.status})`)
await go(APP + chatPath)
await waitFor(`document.querySelectorAll('.bubble-row').length === 50`, 'first page')
check((await text()).includes('Load older messages'), 'a chat opens with the newest 50 and offers older ones')
check((await bubbles()).at(-1) === 'Seeded 60', '... newest at the bottom')
await click('Load older messages')
await waitFor(`document.querySelectorAll('.bubble-row').length === 65`, 'all loaded')
const all = await bubbles()
check(all[0] === 'Hi Ana' && new Set(all).size === all.length, 'loading older pages brings the rest, without repeats')
check(!(await text()).includes('Load older messages'), 'the button goes once everything is loaded')

console.log('34. Read only after unfriending')
await go(`${APP}/u/${benName}`)
await click('Unfriend')
await waitFor(`document.querySelector('.confirm-box')`, 'confirm')
await click('Unfriend @')
await waitFor(has('View messages'), 'unfriended')
check(true, 'a former friend’s profile offers View messages')
await click('View messages')
await waitFor(has("aren't friends any more"), 'read-only banner')
check(!(await evaluate(`document.querySelector('.chat-composer')`)), 'the composer is replaced by a read-only note')
await click('Load older messages')
await waitFor(`document.querySelectorAll('.bubble-row').length === 65`, 'read-only history')
check(true, 'the whole history, older pages included, is still readable')
await shot('31-chat-read-only')
const refused = await restWrite('POST', 'messages', { conversation_id: chatId, client_id: crypto.randomUUID(), content: 'sneaky' })
check(refused.status === 403, `sending through the API is refused too (${refused.status})`)

console.log('35. Chat on mobile')
await makeFriends()
await viewport(390, 844, true)
await go(APP + chatPath)
await waitFor(`document.querySelector('.chat-composer') && document.querySelectorAll('.bubble-row').length === 50`, 'mobile chat')
await shot('32-chat-mobile')
check(!(await evaluate('document.documentElement.scrollWidth > window.innerWidth')), 'the chat has no horizontal scroll at 390px')
check(
  await evaluate(`(() => { const s = document.querySelector('.chat-scroll'); return s.scrollHeight - s.scrollTop - s.clientHeight < 4 })()`),
  'the chat opens scrolled to the newest message',
)

// A second, isolated browser (its own cookies and storage, so its own
// session) for live tests between two people at once.
async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((r) => socket.addEventListener('open', r, { once: true }))
  let id = 1
  const waiting = new Map()
  socket.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg)
      waiting.delete(msg.id)
    }
  })
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = id++
      waiting.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
      socket.send(JSON.stringify({ id: n, method, params }))
    })
  return { socket, call }
}
async function openSecondBrowser() {
  const { webSocketDebuggerUrl } = await (await fetch('http://127.0.0.1:9333/json/version')).json()
  const browser = await connect(webSocketDebuggerUrl)
  const { browserContextId } = await browser.call('Target.createBrowserContext')
  const { targetId } = await browser.call('Target.createTarget', { url: 'about:blank', browserContextId })
  const target = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((t) => t.id === targetId)
  const page2 = await connect(target.webSocketDebuggerUrl)
  await page2.call('Page.enable')
  // A background tab can report itself hidden; chats only mark read when visible.
  await page2.call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page2.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  const evaluate2 = async (expr) => {
    const r = await page2.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(`eval failed (second browser): ${expr}\n${r.exceptionDetails.exception?.description}`)
    return r.result.value
  }
  const waitFor2 = async (expr, label, timeout = 8000) => {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (await evaluate2(`Boolean(${expr})`)) return
      await sleep(100)
    }
    throw new Error(`Timed out waiting for (second browser): ${label}`)
  }
  return {
    evaluate: evaluate2,
    waitFor: waitFor2,
    async go(url) {
      await page2.call('Page.navigate', { url })
      await sleep(300)
      await waitFor2(`document.readyState === 'complete'`, 'load')
    },
    async type(label, value) {
      await waitFor2(
        `[...document.querySelectorAll('label')].some(l => l.textContent.trim().toLowerCase() === ${JSON.stringify(label.toLowerCase())})`,
        `field ${label}`,
      )
      await evaluate2(`(() => {
        const l = [...document.querySelectorAll('label')].find(l => l.textContent.trim().toLowerCase() === ${JSON.stringify(label.toLowerCase())});
        const input = document.getElementById(l.htmlFor);
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`)
    },
    async click(textContent) {
      await waitFor2(
        `[...document.querySelectorAll('button, a')].some(b => b.innerText.trim().startsWith(${JSON.stringify(textContent)}))`,
        `button ${textContent}`,
      )
      await evaluate2(`(() => {
        const el = [...document.querySelectorAll('button, a')].find(b => b.innerText.trim().startsWith(${JSON.stringify(textContent)}));
        if (!el) throw new Error('no button ${textContent}');
        el.click();
      })()`)
    },
    async say(value) {
      await evaluate2(`(() => {
        const el = document.querySelector('.chat-composer textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      })()`)
      await waitFor2(`!document.querySelector('.is-pending')`, `sent: ${value}`)
    },
    async pickFile(filePath) {
      const { root } = await page2.call('DOM.getDocument')
      const { nodeId } = await page2.call('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' })
      await page2.call('DOM.setFileInputFiles', { nodeId, files: [filePath] })
    },
    async close() {
      await browser.call('Target.disposeBrowserContext', { browserContextId })
      page2.socket.close()
      browser.socket.close()
    },
  }
}
const countOf = async (content) => (await bubbles()).filter((b) => b === content).length
const isLive = `document.querySelector('.chat[data-live=live]')`

console.log('36. Live chat between two browsers')
await viewport(1680, 900)
await go(APP + chatPath)
await waitFor(isLive, 'ben live')
check(true, 'ben’s chat subscribes and goes live')
const anaBrowser = await openSecondBrowser()
await anaBrowser.go(APP + '/sign-in')
await anaBrowser.type('Email', ana.email)
await anaBrowser.type('Password', newPassword)
await anaBrowser.click('Enter Thread Buddies')
await anaBrowser.waitFor(`location.pathname === '/'`, 'ana signed in (second browser)')
await anaBrowser.go(APP + chatPath)
await anaBrowser.waitFor(isLive, 'ana live')
check(true, 'ana, in a separate browser, has the same chat open and live')
await anaBrowser.say('Live from Ana')
await waitFor(`document.querySelector('.bubble-row:not(.is-mine):last-of-type .bubble-text')?.innerText === 'Live from Ana'`, 'ben receives', 5000)
check(true, 'ana’s message appears for ben without a reload')
await compose('Live from Ben')
await pressEnter()
await anaBrowser.waitFor(
  `[...document.querySelectorAll('.bubble-row:not(.is-mine) .bubble-text')].some(b => b.innerText === 'Live from Ben')`,
  'ana receives',
  5000,
)
check(true, 'ben’s reply appears for ana without a reload')
await sleep(800)
check((await countOf('Live from Ben')) === 1, 'ben’s own message shows once (the insert answer and the live event are merged by id)')
await shot('33-chat-live')

console.log('37. Home updates live')
await go(APP + '/')
await waitFor(`document.querySelector('.person-list')`, 'ben home')
await sleep(1500) // the home subscription becomes ready
await anaBrowser.say('Fresh preview')
await waitFor(`document.querySelector('.person-list')?.innerText.includes('Fresh preview')`, 'preview updates', 5000)
check(true, 'a new message updates the chat preview on home without a reload')

console.log('38. Requests update live')
await go(APP + '/requests')
await waitFor(`document.querySelectorAll('.request-section').length === 2`, 'ben requests')
await sleep(1500)
await anaBrowser.go(`${APP}/u/${benName}`)
await anaBrowser.click('Unfriend')
await anaBrowser.waitFor(`document.querySelector('.confirm-box')`, 'confirm')
await anaBrowser.click('Unfriend @')
await anaBrowser.waitFor(`document.body.innerText.includes('Add friend')`, 'unfriended')
await anaBrowser.click('Add friend')
await anaBrowser.waitFor(`document.body.innerText.includes('Request sent')`, 'ana asks again')
await waitFor(`document.querySelector('.person-list')?.innerText.includes('Ana Edited')`, 'request appears', 5000)
check(true, 'a new request appears on the requests page without a reload')
await waitFor(`document.querySelector('.nav-badge')?.innerText === '1'`, 'badge', 5000)
check(true, 'the header badge counts it live')
await anaBrowser.click('Cancel')
await waitFor(`!document.querySelector('.person-list') && !document.querySelector('.nav-badge')`, 'cancel arrives', 5000)
check(true, 'when ana cancels, the request and the badge disappear live')
await anaBrowser.click('Add friend')
await waitFor(`document.querySelector('.person-list')?.innerText.includes('Ana Edited')`, 'request again', 5000)
await click('Accept')
await waitFor(`document.querySelector('.relation-label.is-friends')`, 'friends again')

console.log('39. Catching up after missed events')
await go(APP + chatPath)
await waitFor(isLive, 'ben live again')
await anaBrowser.go(APP + chatPath)
await anaBrowser.waitFor(isLive, 'ana back in the chat')
// Ben's browser misses these events, like a sleeping tab or a dropped socket.
await evaluate(`window.__muteLive = 'Missed'`)
for (const n of [1, 2, 3]) await anaBrowser.say(`Missed ${n}`)
await sleep(1000)
check((await countOf('Missed 1')) === 0, 'with the events missed, the messages are not on screen yet')
await evaluate(`window.__muteLive = null; window.dispatchEvent(new Event('online'))`)
await waitFor(`[...document.querySelectorAll('.bubble-text')].some(b => b.innerText === 'Missed 3')`, 'caught up', 5000)
check(
  (await countOf('Missed 1')) === 1 && (await countOf('Missed 2')) === 1 && (await countOf('Missed 3')) === 1,
  'coming back online fetches what was missed, each message once',
)
const ordered = (await bubbles()).filter((b) => b.startsWith('Missed'))
check(JSON.stringify(ordered) === JSON.stringify(['Missed 1', 'Missed 2', 'Missed 3']), '... in order')

console.log('40. A long gap')
await evaluate(`window.__muteLive = 'Gap'`)
const gapSeed = await anaBrowser.evaluate(`(async () => {
  const key = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
  const session = JSON.parse(localStorage.getItem(key));
  const res = await fetch(${JSON.stringify(env.VITE_SUPABASE_URL)} + '/rest/v1/messages', {
    method: 'POST',
    headers: { apikey: ${JSON.stringify(env.VITE_SUPABASE_PUBLISHABLE_KEY)}, authorization: 'Bearer ' + session.access_token,
      'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify(Array.from({ length: 55 }, (_, i) => ({ conversation_id: ${JSON.stringify(chatId)}, client_id: crypto.randomUUID(), content: 'Gap ' + (i + 1) }))),
  });
  return res.status;
})()`)
check(gapSeed === 201, `55 messages arrive while ben misses the events (${gapSeed})`)
await sleep(1000)
await evaluate(`window.__muteLive = null; window.dispatchEvent(new Event('online'))`)
await waitFor(`[...document.querySelectorAll('.bubble-text')].some(b => b.innerText === 'Gap 55')`, 'gap caught up', 5000)
const afterGap = await bubbles()
check(afterGap.length === 50 && afterGap[0] === 'Gap 6', 'more than a page missed: the chat restarts from the newest 50, no hole in between')
check((await text()).includes('Load older messages'), '... and offers the older ones')
await click('Load older messages')
await waitFor(`[...document.querySelectorAll('.bubble-text')].some(b => b.innerText === 'Gap 5')`, 'older after gap')
check(new Set(await bubbles()).size === (await bubbles()).length, 'loading older after a gap repeats nothing')

console.log('41. Losing the connection')
// Chrome's offline emulation leaves open WebSockets alone, so drop the app's
// socket directly, as a network failure would. Realtime notices, retries
// with backoff, rejoins the channel and the chat catches up.
// Only Realtime's socket: closing Vite's dev-server socket makes Vite reload the page.
await evaluate(`window.__sockets.filter(s => s.url.includes('/realtime/') && s.readyState === WebSocket.OPEN).forEach(s => s.close(4000, 'test: connection lost'))`)
await waitFor(`document.querySelector('.chat[data-live=reconnecting]')`, 'reconnecting shown', 5000)
check((await text()).includes('Reconnecting…'), 'a dropped connection shows Reconnecting…')
await shot('34-chat-reconnecting')
await anaBrowser.say('While you were away')
await waitFor(`${isLive} && [...document.querySelectorAll('.bubble-text')].some(b => b.innerText === 'While you were away')`, 'reconnected', 30000)
check(!(await text()).includes('Reconnecting…'), 'it reconnects by itself and the notice goes')
check((await countOf('While you were away')) === 1, 'the message sent meanwhile appears once')

await send('Emulation.setFocusEmulationEnabled', { enabled: true })
check(
  (await evaluate('document.visibilityState')) === 'visible' && (await anaBrowser.evaluate('document.visibilityState')) === 'visible',
  'both browsers count as visible (chats only mark read when visible)',
)
const anaTypes = (value) =>
  anaBrowser.evaluate(`(() => {
    const el = document.querySelector('.chat-composer textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
const homeRow = `[...document.querySelectorAll('.chat-row')].find(r => r.innerText.includes('Ana Edited'))`

console.log('42. Typing')
await anaBrowser.waitFor(isLive, 'ana live for typing')
await anaTypes('I am writ')
await waitFor(`document.querySelector('.chat-typing')?.innerText === 'Ana Edited is typing…'`, 'typing shown', 5000)
check(true, 'ben sees “Ana Edited is typing…” while she types')
await shot('35-chat-typing')
await anaBrowser.say('I am writing back')
await waitFor(`!document.querySelector('.chat-typing')`, 'typing cleared', 3000)
check(true, 'the indicator goes when her message arrives')
await anaTypes('and more')
await waitFor(`document.querySelector('.chat-typing')`, 'typing right after sending', 3000)
check(true, 'typing again right after sending shows the indicator at once')
await anaBrowser.say('and more')

console.log('43. Seen')
await compose('Did you see this?')
await pressEnter()
await waitFor(settled, 'sent for seen')
await anaBrowser.waitFor(`[...document.querySelectorAll('.bubble-text')].some(b => b.innerText === 'Did you see this?')`, 'ana got it')
await waitFor(
  `(() => { const rows = [...document.querySelectorAll('.bubble-row.is-mine')]; const last = rows.at(-1); return last?.innerText.includes('Did you see this?') && last.querySelector('.bubble-seen') })()`,
  'seen',
  5000,
)
check(true, 'with ana looking at the chat, “Seen” appears under ben’s message, live')
check((await evaluate(`document.querySelectorAll('.bubble-seen').length`)) === 1, '“Seen” shows once, under the newest message she has read')
await shot('36-chat-seen')

console.log('44. Unread counts')
await go(APP + '/')
await waitFor(`${homeRow}`, 'ben home')
await anaBrowser.go(APP + '/') // ana leaves the chat, so nothing she sends is read yet
await anaBrowser.waitFor(`document.querySelector('.chat-row')`, 'ana home')
await anaBrowser.go(APP + chatPath)
await anaBrowser.waitFor(isLive, 'ana live again')
await anaBrowser.say('Unread one')
await anaBrowser.say('Unread two')
await waitFor(`${homeRow}?.querySelector('.unread-badge')?.innerText === '2'`, 'unread 2', 5000)
check(true, 'two new messages show as 2 unread on ben’s home, live')
check((await evaluate('document.title')) === '(2) Thread Buddies', 'the tab title shows the unread total')
check((await evaluate(`${homeRow}.innerText`)).includes('Unread two'), '... with the newest as the preview')
await shot('37-home-unread')
await evaluate(`${homeRow}.click()`)
await waitFor(`location.pathname.startsWith('/c/') && document.querySelectorAll('.bubble-row').length > 0`, 'open chat')
await anaBrowser.waitFor(
  `(() => { const last = [...document.querySelectorAll('.bubble-row.is-mine')].at(-1); return last?.querySelector('.bubble-seen') && last.innerText.includes('Unread two') })()`,
  'ana sees seen',
  5000,
)
check(true, 'opening the chat marks it read: ana sees “Seen” under her last message')
await go(APP + '/')
await waitFor(`${homeRow} && !${homeRow}.querySelector('.unread-badge')`, 'cleared')
check((await evaluate('document.title')) === 'Thread Buddies', 'the unread count and the title clear')

console.log('45. Online status')
await waitFor(`${homeRow}?.querySelector('.online-dot')`, 'ana online', 5000)
check(true, 'ana shows as online on ben’s home (a green dot)')
await anaBrowser.go('about:blank')
await waitFor(`${homeRow} && !${homeRow}.querySelector('.online-dot')`, 'ana offline', 10000)
check(true, 'when ana closes the app, the dot goes')
await anaBrowser.go(APP + chatPath)
await waitFor(`${homeRow}?.querySelector('.online-dot')`, 'ana back', 10000)
check(true, 'and comes back when she opens it again')

console.log('46. Read only, live')
await go(APP + chatPath)
await waitFor(`${isLive} && document.querySelector('.chat-composer')`, 'ben chat for unfriend')
check((await text()).includes('Online'), 'the chat header says ana is online')
await anaBrowser.go(`${APP}/u/${benName}`)
await anaBrowser.click('Unfriend')
await anaBrowser.waitFor(`document.querySelector('.confirm-box')`, 'confirm')
await anaBrowser.click('Unfriend @')
await anaBrowser.waitFor(`document.body.innerText.includes('View messages')`, 'unfriended')
await waitFor(`!document.querySelector('.chat-composer') && document.body.innerText.includes("aren't friends any more")`, 'read only live', 5000)
check(true, 'when ana unfriends him, ben’s open chat turns read-only without a reload')
await waitFor(`!document.body.innerText.includes('Online')`, 'online hidden', 5000)
check(true, 'and a former friend’s online status is no longer shown')
await shot('38-chat-read-only-live')

console.log('47. Mobile')
await anaBrowser.click('Add friend')
await anaBrowser.waitFor(`document.body.innerText.includes('Request sent')`, 'ana asks again')
await go(APP + '/requests')
await waitFor(`document.querySelector('.person-list')?.innerText.includes('Ana Edited')`, 'request for mobile')
await click('Accept')
await waitFor(`document.querySelector('.relation-label.is-friends')`, 'friends for mobile')
await anaBrowser.go(APP + chatPath)
await anaBrowser.waitFor(isLive, 'ana live for mobile')
await anaBrowser.say('One more for the badge')
await viewport(390, 844, true)
await go(APP + '/')
await waitFor(`${homeRow}?.querySelector('.unread-badge') && ${homeRow}?.querySelector('.online-dot')`, 'mobile home', 8000)
await shot('39-home-mobile-unread-online')
check(!(await evaluate('document.documentElement.scrollWidth > window.innerWidth')), 'home with unread and online has no horizontal scroll at 390px')

console.log('48. Image messages')
// A JPEG with an EXIF block planted in it (a description standing in for GPS
// data), so the test can check the uploaded copy no longer has it.
function withExif(jpeg, note) {
  const text = Buffer.from(`${note}\0`, 'ascii')
  const tiff = Buffer.alloc(26)
  tiff.write('II', 0) // little-endian
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(8, 4) // first directory
  tiff.writeUInt16LE(1, 8) // one entry: ImageDescription, ASCII, stored after the directory
  tiff.writeUInt16LE(0x010e, 10)
  tiff.writeUInt16LE(2, 12)
  tiff.writeUInt32LE(text.length, 14)
  tiff.writeUInt32LE(26, 18)
  tiff.writeUInt32LE(0, 22) // no next directory
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, text])
  const marker = Buffer.from([0xff, 0xe1, 0, 0])
  marker.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([jpeg.subarray(0, 2), marker, payload, jpeg.subarray(2)])
}
const canvasImage = (width, height, type) =>
  evaluate(`(() => {
    const c = document.createElement('canvas');
    c.width = ${width}; c.height = ${height};
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, ${width}, ${height});
    grad.addColorStop(0, '#f55252'); grad.addColorStop(1, '#2a6cf5');
    g.fillStyle = grad; g.fillRect(0, 0, ${width}, ${height});
    return c.toDataURL(${JSON.stringify(type)}).split(',')[1];
  })()`)
const imageFiles = mkdtempSync(join(tmpdir(), 'thread-e2e-images-'))
const secret = 'GPS 48.8584N 2.2945E'
const photo = join(imageFiles, 'holiday.jpg')
writeFileSync(photo, withExif(Buffer.from(await canvasImage(3000, 2000, 'image/jpeg'), 'base64'), secret))
check(readFileSync(photo).includes(secret), 'the test photo carries EXIF metadata')
const square = join(imageFiles, 'square.png')
writeFileSync(square, png(600, 600))
const notImage = join(imageFiles, 'animation.gif')
writeFileSync(notImage, Buffer.from('GIF89a'))

await viewport(1680, 900)
await go(APP + chatPath)
await waitFor(`${isLive} && document.querySelector('.chat-composer')`, 'ben chat for images')
await pickFile(notImage)
await waitFor(has('Choose a JPEG, PNG or WebP image.'), 'gif refused')
check(!(await evaluate(`document.querySelector('.chat-staged')`)), 'a GIF is refused before anything is uploaded')

await pickFile(photo)
await waitFor(`document.querySelector('img.chat-staged-thumb')`, 'staged')
check((await text()).includes('Image ready. Add a caption or send.'), 'a picked photo is staged in the composer')
check(!(await text()).includes('Choose a JPEG'), 'the earlier error clears')
await compose('Holiday')
await click('Send')
await waitFor(`${settled} && document.querySelector('.bubble-row.is-mine:last-of-type .bubble-image img')`, 'image sent', 15000)
check(
  (await evaluate(`document.querySelector('.bubble-row.is-mine:last-of-type .bubble-text')?.innerText`)) === 'Holiday',
  'the image is sent with its caption',
)
check(!(await evaluate(`document.querySelector('.chat-staged')`)), 'the composer is empty again')

const latestImage = `document.querySelector('.bubble-row:not(.is-mine):last-of-type .bubble-image img')`
await anaBrowser.waitFor(`${latestImage}?.complete && ${latestImage}.naturalWidth > 0`, 'ana sees image', 8000)
check(true, 'ana receives the image live and it loads')
const anaSrc = await anaBrowser.evaluate(`${latestImage}.src`)
check(anaSrc.includes('/storage/v1/object/sign/message-images/'), 'it is shown through a signed link, not a public URL')

const [attachment] = await rest('message_attachments?select=storage_path,mime_type,size_bytes,width,height&order=id.desc&limit=1')
check(
  attachment?.mime_type === 'image/webp' && attachment.width === 2048 && attachment.height === 1365,
  `the stored image is WebP, scaled to 2048 px (${JSON.stringify(attachment && [attachment.mime_type, attachment.width, attachment.height])})`,
)
const storedFile = Buffer.from(await (await fetch(anaSrc)).arrayBuffer())
check(storedFile.length === attachment?.size_bytes && storedFile.subarray(8, 12).toString() === 'WEBP', 'the signed link serves that file')
check(!storedFile.includes('Exif') && !storedFile.includes(secret), 'the uploaded file has no EXIF: the planted location is gone')
const signedOut = await fetch(`${env.VITE_SUPABASE_URL}/storage/v1/object/public/message-images/${attachment?.storage_path}`)
const anonymous = await fetch(`${env.VITE_SUPABASE_URL}/storage/v1/object/message-images/${attachment?.storage_path}`, {
  headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY },
})
check(!signedOut.ok && !anonymous.ok, `without a session or a signed link the file can't be fetched (${signedOut.status}, ${anonymous.status})`)
const tampered = new URL(anaSrc)
tampered.searchParams.set('token', `${tampered.searchParams.get('token')}x`)
check(!(await fetch(tampered)).ok, 'a signed link with a changed token is refused')

const box = await evaluate(`(() => { const b = document.querySelector('.bubble-row.is-mine:last-of-type .bubble-image').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)] })()`)
check(box[0] === 280 && Math.abs(box[1] - 187) <= 1, `the image box has the photo's shape (${box.join('×')})`)
await go(APP + chatPath)
await waitFor(`document.querySelector('.bubble-row.is-mine:last-of-type .bubble-image img')?.complete`, 'after reload')
check(
  (await evaluate(`document.querySelector('.bubble-row.is-mine:last-of-type .bubble-image img').src`)).includes('/object/sign/'),
  'after a reload, ben’s own image comes through a signed link too',
)
check(
  await evaluate(`(() => { const s = document.querySelector('.chat-scroll'); return s.scrollHeight - s.scrollTop - s.clientHeight < 4 })()`),
  'the chat still opens at the newest message with images in it',
)
await shot('40-chat-image')

await evaluate(`document.querySelector('.bubble-row.is-mine:last-of-type .bubble-image').click()`)
await waitFor(`document.querySelector('dialog.image-viewer[open] img')?.complete`, 'viewer')
await shot('41-image-viewer')
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await waitFor(`!document.querySelector('dialog.image-viewer')`, 'viewer closed')
check(true, 'tapping an image opens it full screen; Esc closes it')

// Pasting a screenshot stages it, like picking a file.
await evaluate(`(async () => {
  const blob = await (await fetch('data:image/png;base64,' + ${JSON.stringify(await canvasImage(400, 300, 'image/png'))})).blob();
  const data = new DataTransfer();
  data.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
  document.querySelector('.chat-composer textarea').dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
})()`)
await waitFor(`document.querySelector('img.chat-staged-thumb')`, 'pasted')
check(true, 'pasting an image stages it')
await click('Remove')
await waitFor(`!document.querySelector('.chat-staged')`, 'removed')
check(await evaluate(`document.querySelector('.chat-send').disabled`), 'Remove takes it out again, and there is nothing to send')

await anaBrowser.pickFile(square)
await anaBrowser.waitFor(`document.querySelector('img.chat-staged-thumb')`, 'ana staged')
await anaBrowser.click('Send')
await anaBrowser.waitFor(`!document.querySelector('.is-pending')`, 'ana sent image', 15000)
await waitFor(`${latestImage}?.complete && !document.querySelector('.bubble-row:last-of-type .bubble-text')`, 'ben gets image only', 8000)
check(true, 'an image without a caption is sent and arrives live')
await go(APP + '/')
await waitFor(`${homeRow}`, 'home for photo')
check((await evaluate(`${homeRow}.innerText`)).includes('Photo'), 'home shows “Photo” for an image without a caption')

await viewport(390, 844, true)
await go(APP + chatPath)
await waitFor(`document.querySelectorAll('.bubble-image img').length >= 2 && [...document.querySelectorAll('.bubble-image img')].every(i => i.complete)`, 'mobile images')
await shot('42-chat-images-mobile')
check(!(await evaluate('document.documentElement.scrollWidth > window.innerWidth')), 'a chat with images has no horizontal scroll at 390px')

console.log('49. Every screen on small phones')
// Tap targets under 44 px (Apple's guideline) and inputs under 16 px (iOS
// Safari zooms the page when such a field gets focus).
const mobileProblems = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' };
  const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.placeholder || el.tagName).trim().slice(0, 30);
  const small = [...document.querySelectorAll('a, button, input:not([type=file]), textarea, select')]
    .filter(visible)
    // Links inside running text are exempt (WCAG 2.5.8).
    .filter((el) => !(el.tagName === 'A' && el.closest('p')))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.height < 44 || r.width < 44 })
    .map((el) => { const r = el.getBoundingClientRect(); return label(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) });
  const tinyText = [...document.querySelectorAll('input:not([type=file]), textarea')]
    .filter(visible)
    .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
    .map(label);
  // A container that clips its overflow hides it from the scroll check.
  const offscreen = [...document.querySelectorAll('a, button, input:not([type=file]), textarea')]
    .filter(visible)
    .filter((el) => { const r = el.getBoundingClientRect(); return r.right > window.innerWidth + 0.5 || r.left < -0.5 })
    .map(label);
  return { scroll: document.documentElement.scrollWidth > window.innerWidth || offscreen.length > 0, offscreen, small, tinyText };
})()`
const screens = [
  ['home', '/'],
  ['people', '/people'],
  ['requests', '/requests'],
  ['settings', '/settings/profile'],
  ['profile', `/u/${ana.username}`],
  ['chat', chatPath],
]
for (const width of [360, 430]) {
  await viewport(width, 800, true)
  for (const [name, url] of screens) {
    await go(APP + url)
    await sleep(600)
    const found = await evaluate(mobileProblems)
    if (width === 360) await shot(`43-${name}-360`)
    check(!found.scroll, `${name} at ${width}px: no horizontal scroll, nothing cut off${found.offscreen.length ? ` (${found.offscreen.join('; ')})` : ''}`)
    check(found.small.length === 0, `${name} at ${width}px: tap targets at least 44 px${found.small.length ? ` (${found.small.join('; ')})` : ''}`)
    check(found.tinyText.length === 0, `${name} at ${width}px: input text at least 16 px${found.tinyText.length ? ` (${found.tinyText.join('; ')})` : ''}`)
  }
}

console.log('50. Delete account')
await viewport(1680, 900)
await anaBrowser.go(APP + '/settings/profile')
await anaBrowser.click('Delete account')
await anaBrowser.waitFor(`document.querySelector('.danger-zone .confirm-box')`, 'delete form')
await anaBrowser.type('Your password', 'not-my-password')
await anaBrowser.click('Delete my account')
await anaBrowser.waitFor(`document.body.innerText.includes("That password isn't right.")`, 'wrong password', 8000)
check(true, 'a wrong password is refused and nothing is deleted')
await anaBrowser.type('Your password', newPassword)
await anaBrowser.click('Delete my account')
await anaBrowser.waitFor(`location.pathname === '/sign-in' && document.body.innerText.includes('Your account was deleted.')`, 'deleted', 10000)
check(true, 'with the right password the account is deleted and ana is signed out')
await anaBrowser.type('Email', ana.email)
await anaBrowser.type('Password', newPassword)
await anaBrowser.click('Enter Thread Buddies')
await anaBrowser.waitFor(`document.body.innerText.includes('Invalid email or password.')`, 'cannot sign in', 8000)
check(true, 'signing in again fails: the account is gone')
await go(APP + '/')
await waitFor(`[...document.querySelectorAll('.chat-row')].some(r => r.innerText.includes('Deleted user'))`, 'deleted on home', 8000)
check(true, 'ben’s chat list shows the conversation with “Deleted user”')
await go(APP + chatPath)
await waitFor(`document.querySelector('.chat-readonly')`, 'read only')
check(
  (await text()).includes('This account was deleted. You can still read your messages.') &&
    (await evaluate(`document.querySelectorAll('.bubble-image img').length`)) >= 2,
  'ben keeps the history, images included, read only',
)
await anaBrowser.close()
rmSync(imageFiles, { recursive: true, force: true })

ws.close()
console.log(process.exitCode ? 'Some checks FAILED' : 'All checks passed')
