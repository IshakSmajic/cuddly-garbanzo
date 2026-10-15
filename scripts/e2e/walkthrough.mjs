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
// React controlled inputs need the native setter plus an input event.
async function type(label, value) {
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

ws.close()
console.log(process.exitCode ? 'Some checks FAILED' : 'All checks passed')
