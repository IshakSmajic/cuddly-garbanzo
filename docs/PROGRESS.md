# Thread Buddies — progress and handoff

Last updated: 17 October 2026. Milestone 9 is committed and pushed
(`3dc17ee`). Milestone 10a (local hardening) is built on the branch
`milestone-10-release`, not committed; 10b (deploy) is next.

This file is the running record of the project: what is done, what is live,
what was decided, and what comes next. Read it at the start of a session and
update it at the end of each milestone. The product rules and data model are
in `Chat_App_Project_Specification.docx` (the spec); working rules for Claude
are in `CLAUDE.md`.

## Milestones at a glance

| # | Milestone | Status |
|---|---|---|
| 1 | Foundation: TypeScript, local Supabase, remove demo | Done (commit `9b3b557`) |
| 2 | Auth: sign up, confirm email, sign in, onboarding, protected routes | Done (commit `ccac84b`) |
| 2b | Password reset (follow-up to milestone 2) | Done (commit "Milestone 2b: password reset") |
| 3 | Profiles and avatars: profile editor, avatar upload/replace/remove, rename to Thread Buddies | Done (commits "Profile picture functionality and upload", "Avatar delete guard and error code fix") |
| 4 | User discovery and requests: search, send/cancel/accept/decline, blocking (+ the `friendships` table) | Done (commit `6632ad1`, message typo "Fruend") |
| 5 | Friendships: friend list, unfriend, accept creates the conversation | Done (commit `d14a37c`) |
| 6 | Direct messaging persistence: history, friends-only sending, paging | Done (commit `791cfe9`) |
| 7 | Realtime messaging: live delivery, reconnect recovery, dedupe | Done (commit `da52688`) |
| 8 | Chat UX: typing, presence, unread counts, read receipts | Done (commit `4969d4e`) |
| 9 | Media: image messages | Done (commit `3dc17ee`) |
| 10 | Release. **10a** security review, file cleanup, account deletion, mobile polish: built (branch `milestone-10-release`). **10b** deploy: next | In progress |

Milestones 1–7 make the app usable by friends; 8–10 improve it.

## How each milestone runs (the developer's process)

1. Claude presents a plan: scope, data model changes, security risks, tests,
   acceptance checklist, and the concepts the developer should understand.
2. The developer approves (or changes) the plan. **No code before approval.**
3. Claude builds it on a branch named `milestone-N-<topic>`.
4. Claude runs every check: `npm run build` (type-checks), `npm run lint`,
   `npm test`, `npm run db:test`, and `npm run test:e2e` when screens change.
   For UI, Claude compares screenshots against `design/`.
5. Claude reports results honestly and explains what was built.
6. Commit only when the developer asks; then fast-forward `main`, push, and
   delete the merged branch.

## Current state

### Repository (`main` on GitHub: IshakSmajic/treads-buddies)

- React 19 + TypeScript 7 (strict) + Vite 8, React Router 8, Oxlint, Vitest.
- Supabase JS client, typed from the generated `src/lib/database.types.ts`.
- Manrope (self-hosted via `@fontsource-variable/manrope`), accent `#f55252`,
  dark theme tokens in `src/index.css`.
- The GitHub repo was renamed from `cuddly-garbanzo`; the Supabase
  `project_id` in `config.toml` is still `cuddly-garbanzo`, so local Docker
  containers are named `supabase_*_cuddly-garbanzo`. Harmless.

### Development machines

- The developer works from two machines; pull before starting.
- macOS (the original): Docker Desktop (start it with `open -a Docker`),
  Chrome in `/Applications`, both `.env*.local` files present.
- Arch Linux (since 15 Oct 2026): Docker installed and enabled; the user is in
  the `docker` group. Chrome at `/usr/bin/google-chrome-stable`.
- `.env.development.local` recreated for the local stack.
  **`.env.production.local` is missing on this machine**: recreate it from the
  hosted project's URL and publishable key before deploying (a build without
  it succeeds but the app throws on start).

### Arch machine: catch-up after the history rewrite (done)

On 16 Oct 2026 the history on GitHub was rewritten (open item 9) and
force-pushed. **Git part done on 17 Oct 2026:** Arch's `main` was reset to
`origin/main` (0 co-author lines), and the remote already pointed at
`treads-buddies`. Arch turned out to have unpushed work the Mac never saw,
now kept for reference only (GitHub replaced it with the Mac's milestones 4–8):

- Branch `arch-backup` (`31bb295` "Friend requests, user search and
  blocking", 15 Oct): a separate milestone 4 with its own
  `20261015210138_friend_requests.sql`.
- `~/old-friendships.sql`: an untracked milestone 5 draft migration
  (`20261015212000_friendships_and_conversations.sql`), moved out of
  `supabase/migrations` so `db:reset` doesn't apply it.

**Setup done on 17 Oct 2026:** `npm install`, then `db:reset` (all 10
migrations; Arch's old local accounts are gone), then `db:test` (218 passing).
The edge runtime container had stopped and needed a `docker start`.

Once nothing in them is needed, `git branch -D arch-backup`, delete
`~/old-friendships.sql` and remove this section. "Pull before starting"
applies again already.

### Local Supabase (Docker, 12 containers)

- All twelve migrations applied (through `release_hardening`). Vault holds
  `project_url` and `cleanup_secret` (from `supabase/seed.sql`, which runs
  on `db:reset`; on an existing database run it once by hand).
- Edge Functions (`supabase/functions/`) are served by `supabase start`.
  They need `supabase/functions/.env` (git-ignored) with
  `CLEANUP_SECRET=local-cleanup-secret`, matching the seed. **On the Mac:**
  create that file, then `npx supabase stop && npx supabase start` (the
  functions folder is mounted only at start). Auth settings in `supabase/config.toml`:
  email confirmation on, minimum password 8, site URL `http://localhost:5173`,
  redirect allow-list (exact URLs) `http://localhost:5173`,
  `http://localhost:5173/reset-password` and the same two on `127.0.0.1`,
  `secure_password_change = true`, "password changed" notification email on.
- Studio: http://127.0.0.1:54323 · Mailpit (catches all emails):
  http://127.0.0.1:54324
- The developer chose to keep every container on (don't disable analytics or
  edge runtime).

### Hosted Supabase project `cuddly-garbanzo` (ref `izshntiffhekuvpirixf`)

- Linked to the repo. Has migrations 1 and 2 only, so the public schema is
  **empty**. The demo tables and the demo accounts (alice/bob) are deleted.
- **Not yet applied:** the profiles, avatars, avatar-fixes, friend-requests, conversations, messages, realtime, chat-ux, message-images and release-hardening migrations, the two Edge Functions, the Vault secrets, the auth settings (site URL,
  redirect URLs including `/reset-password`, confirm email, password length,
  secure password change, password-changed notification). Custom SMTP
  (Gmail) **is** configured (open item 2).
  These are done at deployment time, with the developer's go-ahead.
- No frontend is deployed anywhere yet.

## What has been built

### Before the spec (removed in milestone 1)

A demo chat to show how Supabase Realtime works: one global room, two seeded
accounts, a websocket subscription to new rows. Its migration
(`20261015072006_chat_and_test_users.sql`) stays in history because
migrations only move forward; `20261015080902_remove_demo_chat.sql` removed it.
That old migration contains the test password `password123` in the public Git
history; harmless, since the accounts are deleted.

### Milestone 1: foundation

- TypeScript conversion with strict config (`tsconfig.app.json`,
  `tsconfig.node.json`).
- `src/lib/supabase.ts`: typed client; throws a clear error if env vars are
  missing.
- Two environments: `.env.development.local` (local stack, used by
  `npm run dev`) and `.env.production.local` (hosted project, used by
  `npm run build`). Both git-ignored. Only the publishable key ever goes in
  them.
- `supabase/tests/database/demo_removed.test.sql`: checks the demo is gone.

### Milestone 2: auth

**Database** (`supabase/migrations/20261015083155_profiles.sql`):

- `profiles(user_id, username, display_name, bio, avatar_path, created_at, updated_at)`.
  `username` null until onboarding, then unique and `^[a-z0-9_]{3,20}$`
  (stored lowercase). `display_name` 1–50 chars, trimmed. `bio` ≤ 280.
- Privileges: everything revoked from `anon`/`authenticated`, then
  `select` granted to `authenticated` and `update (username, display_name, bio)`
  only. No insert/delete grants. **`avatar_path` is deliberately not
  updatable by clients**; milestone 3 must add a safe path for it.
- RLS: authenticated users read all profiles; update only their own row.
- Triggers: `handle_new_user` (security definer, `search_path = ''`) creates
  an empty profile on every `auth.users` insert; `set_updated_at` keeps
  `updated_at` current.
- Tests: `supabase/tests/database/profiles.test.sql` (20 checks).

**Frontend:**

| File | Role |
|---|---|
| `src/App.tsx` | Routes grouped under `Gate` (guest / onboarding / app) |
| `src/auth/access.ts` | Pure `redirectFor(state, area)` routing rules (+ tests) |
| `src/auth/AuthProvider.tsx`, `context.ts` | Session + profile state, `useAuth()` |
| `src/auth/Gate.tsx` | Redirects, loading and profile-error screens |
| `src/lib/validation.ts` | Username/display-name rules mirroring the DB (+ tests) |
| `src/lib/linkError.ts` | Reads a failed email link's error from the URL hash at startup |
| `src/lib/urls.ts` | `emailRedirectUrl()` for confirmation links |
| `src/components/` | `AuthLayout` (split screen from the design), `Field`, `Button`, `Logo`, `FullScreenMessage` |
| `src/pages/` | `SignIn`, `SignUp`, `CheckEmail`, `Onboarding`, `Home` (placeholder) |

Behaviour worth knowing:

- Sign-up shows the same result whether or not the email exists (no account
  enumeration). Sign-in errors are generic ("Invalid email or password.").
- Unconfirmed sign-in goes to the check-email page with a resend button
  (60-second cooldown, matching the hosted rate limit).
- Onboarding checks username availability after a 400 ms pause; the UNIQUE
  constraint is the real arbiter (`23505` → "taken").
- Buttons stay full red (as in the design) and are disabled only while a
  request is in flight; validation messages appear on submit.
- Below 900 px the brand panel is hidden and the form fills the screen.

### Milestone 2b: password reset

No migration (passwords live in `auth.users`). Config changes listed under
"Local Supabase" above.

| File | Role |
|---|---|
| `src/pages/ForgotPassword.tsx` | `/forgot-password` (guest): sends the reset email; same message for any address; 60 s resend cooldown |
| `src/pages/ResetPassword.tsx` | `/reset-password` (account): new password + confirm → `updateUser({ password })` → home |
| `src/auth/access.ts` | New `account` area: needs a session, ignores the username, so the reset page works before onboarding |
| `src/lib/useCooldown.ts` | Resend cooldown shared by check-email and forgot-password |
| `src/lib/validation.ts` | `PASSWORD_MIN`, `newPasswordError` (+ tests) |
| `src/lib/urls.ts` | `passwordResetUrl()` |

Behaviour worth knowing:

- The reset link signs the user in with an ordinary session (implicit flow,
  tokens in the URL hash). The page is not a security boundary; the server
  rule is `secure_password_change`, which needs a sign-in from the last
  ~24 h or a reauthentication code. A recovery session is always fresh.
  **A future "change password" in settings will need the reauthentication
  flow** (`supabase.auth.reauthenticate()` + nonce) for older sessions.
- Supabase Auth (v2.197) **revokes every other session's refresh token when
  the password changes**. We checked this with a control test, so the app
  makes no extra `signOut({ scope: 'others' })` call. Access tokens already
  issued stay valid until they expire (≤ 1 h).
- A used or expired link lands on sign-in with the link error (existing
  `linkError`).
- Error codes handled: `same_password`, `weak_password`,
  `reauthentication_needed`, rate limits.

### Milestone 3: profiles, avatars and the rename

**Database** (`supabase/migrations/20261015203116_avatars.sql`):

- Bucket `avatars`, created in the migration (not `config.toml`, which is
  local only), so `db push` creates it on hosted too: public, 2 MB,
  `image/jpeg`, `image/png`, `image/webp`.
- Storage policies on `storage.objects` (authenticated, bucket `avatars`,
  first folder = `auth.uid()`): insert, select, delete. **No update policy**:
  every upload gets a new random name, so nothing is overwritten and caching
  is never stale. Select is limited to your own folder, so nobody can list
  others' files; public URLs need no policy.
- `set_avatar(new_path)` and `remove_avatar()`: security definer,
  `search_path = ''`, executable by `authenticated` only. `set_avatar` checks
  the path is `{uid}/{uuid}.(jpg|png|webp)` and that the file exists with
  `owner_id` = the caller, locks the profile row (`for update`, so concurrent
  changes can't both read the same old path), sets it and returns the old
  path. `avatar_path` still has no client update grant.
- Tests: `supabase/tests/database/avatars.test.sql` (24 checks; 27 after the avatar fixes). Direct SQL
  deletes on `storage.objects` are blocked by Supabase's `protect_delete`
  trigger; the test sets `storage.allow_delete_query` to test the policy.
  The generated types say these functions return `string`; they return
  `null` when there was no previous avatar.

**Frontend:**

| File | Role |
|---|---|
| `src/pages/ProfileSettings.tsx` | `/settings/profile` (app area): username, display name, bio (counter), avatar editor |
| `src/lib/avatar.ts` | Pure rules: accepted types, 15 MB input limit, `initials`, `centreSquare` (+ tests) |
| `src/lib/avatarUpload.ts` | Crop to a 512 px square, re-encode WebP (JPEG fallback), upload → `set_avatar` → delete old; `removeAvatar` |
| `src/lib/useUsernameCheck.ts` | Availability hook shared by onboarding and the editor; your own name is never "taken" |
| `src/lib/validation.ts` | `BIO_MAX`, `bioError`, `bioLength` (+ tests) |
| `src/components/` | `Avatar` (picture or initials), `AppHeader` (logo, avatar + name → settings, sign out), `TextAreaField` |

Behaviour worth knowing:

- Re-encoding in the browser strips EXIF metadata (phone photos can carry GPS
  location) and keeps uploads small; the bucket limits are the real check.
  The browser-reported type can be faked; content checking stays deferred.
- Replace order: upload → `set_avatar` (on failure the new file is deleted)
  → delete the old file (on failure an unused file is left; harmless).
- Empty bio is stored as null; bio and display name are trimmed.
- Fix to milestone 2: a browser holding the token of a deleted account
  (e.g. after `db:reset`) used to be stuck on "Couldn't load your profile"
  on every page. A missing profile row now means the account is gone, so
  `AuthProvider` signs out locally; the error screen also offers Sign out.
- Rename: logo, page title, sign-in/sign-up text, "password changed" email
  subject. The sign-in button says "Enter Thread Buddies".
- e2e: 51 checks (new sections 16–18: editor, avatars, mobile). `run.sh`
  finds Chrome on Linux or macOS (or `CHROME=...`). Fixed a race where the
  test navigated before sign-out had finished.

### Avatar fixes (16 Oct 2026, follow-up to milestone 3)

`supabase/migrations/20261016062346_avatar_fixes.sql`, no frontend changes:

- `set_avatar` reports a missing file with `22023` instead of `P0002`.
  PostgREST maps `P0` codes other than `P0001` to HTTP 500; `22023` gives 400
  (checked through the API).
- The storage delete policy now refuses the file your profile points at
  (`name is distinct from` your `avatar_path`), so a direct API call can't
  leave a broken avatar. The app already repoints the profile before
  deleting, so its flows are unchanged (e2e passes).
- `avatars.test.sql`: 27 checks (current file protected, deletable once
  replaced, only the guarded delete policy exists).

Background: milestone 3 was built twice, once on each machine. The pushed
version was kept; the other one is in a local git stash on the Mac
("Mac-side Milestone 3 …") and these two fixes were the only things in it
worth carrying over.

### Milestone 4: search, friend requests and blocking

**Database** (`supabase/migrations/20261016062930_friend_requests.sql`):

- Tables as in spec section 5: `friend_requests` (history kept; partial
  unique index on the sorted pair WHERE pending, so one pending request per
  pair in either direction), `friendships` (lower id first; a row exists only
  while the friendship is active), `blocks`. Plus `search_events` (rate
  limit, invisible to clients) and a `text_pattern_ops` index on
  `profiles.username` for prefix search.
- Clients: select only, RLS to rows you're part of; `blocks` shows only the
  blocks *you* made, so nobody can find out who blocked them.
- Functions (security definer, `search_path = ''`, `authenticated` only):
  `search_users(query)`, `send_friend_request(recipient)` (accepts theirs if
  they had already asked; returns `pending` or `friends`),
  `respond_to_friend_request(request_id, accept)`,
  `cancel_friend_request(request_id)`, `block_user(target)` (ends the
  friendship, cancels pending requests), `unblock_user(target)` (friendship
  does not come back). `relationship_with(other)` is security *invoker*: it
  reads only what RLS shows, so it can't reveal that someone blocked you.
- Helpers in a `private` schema (not exposed by the API, no grants):
  `require_user` (signed in and onboarded), `lock_pair`,
  `blocked_between`, `are_friends`, `make_friends`. **Milestone 5 adds the
  direct conversation to `make_friends`.**
- **Concurrency:** every function that touches a pair first takes
  `pg_advisory_xact_lock` on the hashed sorted pair. A row lock can't cover a
  request that doesn't exist yet (both users sending at once). Respond and
  cancel read the request, lock, then re-read it, since the first read can
  be stale. Control run with the lock disabled: the second simultaneous send
  failed with a unique-index error instead of making them friends.
- Error codes: `42501` (not signed in / not onboarded / not your request),
  `22023` (bad argument), and custom `TB001` blocked, `TB002` already
  friends, `TB003` no longer pending, `TB004` rate limit, `TB005` 24 h after
  a decline. PostgREST answers the custom ones with HTTP 400 (checked).
- Limits: search 3–20 characters of `[a-z0-9_]` (so `_` is the only LIKE
  wildcard possible; it's escaped), 20 results, 30 searches/minute; 20
  requests/hour; 24 h before re-asking someone who declined. The counts aren't
  locked, so parallel calls could overshoot by one or two (harmless).
- Tests: `friend_requests.test.sql` (66 checks); `npm run db:race`
  (`scripts/db/race.sh`, two real sessions: simultaneous sends, accept vs
  block in both orders).

**Frontend:**

| File | Role |
|---|---|
| `src/pages/People.tsx` | `/people`: search box (500 ms pause), results with actions |
| `src/pages/Requests.tsx` | `/requests`: waiting for you / sent; declined or cancelled rows leave the list |
| `src/pages/UserProfile.tsx` | `/u/:username`: profile, actions, block with confirmation |
| `src/components/RelationActions.tsx` | Add / Cancel / Accept·Decline / Friends / Unblock; asks the server for the new relation after each action |
| `src/components/PersonRow.tsx` | Avatar + names linking to the profile |
| `src/components/AppHeader.tsx` | Adds People and Requests links, red badge with the incoming count |
| `src/lib/friends.ts` | RPC wrappers, pending lists, incoming count, a window event so the badge refreshes |
| `src/lib/friendRules.ts` | Search validation and error messages (+ tests) |
| `src/lib/useUserSearch.ts`, `useIncomingCount.ts` | Hooks |

Behaviour worth knowing:

- No realtime yet (milestone 7): another person's action shows after a
  reload or navigation.
- A requester can read their own request's status, so they can tell they
  were declined (and the 24 h message says so). Acceptable for a friends app.
- The blocked user can still open the blocker's profile at `/u/<name>`
  (decision below); it shows "Add friend", and sending gives a vague error.
- e2e: 75 checks (new sections 19–25, two users in one browser).

### Milestone 5: friendships and the direct conversation

**Database** (`supabase/migrations/20261016070423_conversations.sql`):

- `conversations` (id, created_at), `direct_conversations` (pair, lower id
  first, UNIQUE), `conversation_members` (`last_read_message_id` reserved for
  milestone 8, no FK yet). Clients: select only.
- **Reading:** all three use `private.is_conversation_member(id)` (security
  definer) in their policy. A members policy that queried
  `conversation_members` directly would recurse forever. `authenticated` has
  `usage` on `private` and execute on this one function only; default
  privileges now revoke execute from PUBLIC for any new function in
  `private`, so new helpers start locked.
- **Accept creates the conversation:** `private.make_friends` (called only
  under the pair lock) inserts the friendship, looks up the pair's
  conversation, creates conversation + mapping if none, and inserts both
  memberships `on conflict do nothing`. Re-friending reuses everything. The
  migration backfills conversations for existing friendships (checked by
  applying it to a database that had one).
- `unfriend(other)`: deletes the friendship row only, under the pair lock;
  twice is harmless. Unfriend and block both leave conversation and
  memberships in place.
- **Account deletion:** the deleted side of `direct_conversations` becomes
  null (the row stays, so the conversation is still direct → "Deleted user");
  their membership row cascades. A trigger
  (`private.delete_empty_conversation`, security definer) deletes a
  conversation when its last member goes, so nothing unreadable stays behind.
  Checked through the real Auth admin API, not only as the table owner.
- **Concurrency finding:** with the pair lock disabled, two simultaneous
  `make_friends` still made one conversation: the second session's insert
  into `friendships` waits on the first's uncommitted row (same primary key)
  and then sees its conversation. The UNIQUE pair is a third layer.
- Tests: `conversations.test.sql` (36 checks); `race.sh` now also counts the
  pair's conversation and memberships.

**Frontend:**

| File | Role |
|---|---|
| `src/pages/Home.tsx` | Friend list (sorted by name, "Since" date), or a pointer to People |
| `src/components/ConfirmAction.tsx` | Quiet link → confirmation box; used for Unfriend and Block |
| `src/pages/UserProfile.tsx` | Unfriend (when friends) and Block, both confirmed |
| `src/lib/friends.ts` | `friendsList`, `unfriend` |

- "Since" is the current friendship's start: re-friending resets it.
- e2e: 85 checks (new sections 26–29: friend list, unfriend keeps the
  conversation, re-friending reuses it, checked through the API with the
  user's own session).

### Milestone 6: direct messages

**Database** (`supabase/migrations/20261016072611_messages.sql`):

- `messages`: bigint identity id, `conversation_id` (cascade with the
  conversation), `sender_id` (default `auth.uid()`), `client_id`, `content`
  (1–4,000 characters with at least one non-space; nullable for images
  later), `created_at`. UNIQUE (sender_id, client_id). Composite FK
  (conversation_id, sender_id) → `conversation_members` with
  `ON DELETE SET NULL (sender_id)`: account deletion keeps the messages as
  "Deleted user"; when both accounts are gone, the empty-conversation trigger
  removes the conversation and its messages (checked through the Auth API).
- **Writes:** clients insert directly. Grant `insert (conversation_id,
  client_id, content)` only, so sender, time and id always come from the
  database. Insert policy: sender is you, content not null, and a
  `friendships` row exists for the conversation's pair. No update/delete
  grants (editing/deleting is out of scope).
- **Reads:** members (`is_conversation_member`).
- `messages_page(conversation, before_created_at, before_id, page_size)`:
  keyset paging on (created_at, id), 50 by default, at most 100. Security
  invoker.
- `my_conversations(only_conversation)`: the chat list (other person or null,
  `is_friend`, last message), newest activity first. Security invoker.
- Tests: `messages.test.sql` (35 checks, including paging through 120
  messages with duplicate timestamps). `demo_removed.test.sql` now checks the
  new table isn't the demo's.

**Frontend:**

| File | Role |
|---|---|
| `src/pages/Chat.tsx` | `/c/:conversationId`: history, "Load older", composer (Enter sends, Shift+Enter new line, counter from 3,500), pending/failed bubbles with Retry, read-only note |
| `src/pages/Home.tsx` | The chat list: every conversation, preview ("You: …"), time, "Read only" |
| `src/pages/UserProfile.tsx` | "Message" (friends) / "View messages" (former friends) |
| `src/lib/messages.ts` | RPC and insert wrappers; `sendMessage` treats `23505` as "already stored" and fetches the row by client_id |
| `src/lib/messageRules.ts` | Limits, trimming, `timeKey` (microseconds from PostgREST timestamps), ordering and merge-by-id (+ tests) |
| `src/lib/chatTime.ts` | Today/Yesterday/weekday/date labels (+ tests) |

Behaviour worth knowing:

- No live updates yet: the other person's messages appear on reload or
  when you open the chat again (milestone 7).
- Below 480 px the app header is hidden on the chat screen (the chat header
  has a back button).
- e2e: 111 checks. Section 32 installs a fetch wrapper before the app loads
  (`Page.addScriptToEvaluateOnNewDocument`) to drop the *answer* to one send,
  then checks Retry leaves exactly one message in the database.

### Milestone 7: realtime messaging

**Database** (`supabase/migrations/20261016083136_realtime.sql`): adds
`messages` and `friend_requests` to the `supabase_realtime` publication.
Nothing else.

- Realtime checks inserts and updates against the subscriber's SELECT policy
  (it runs `select exists(... where pk = ...)` as the subscriber), so events
  follow `is_conversation_member` and the request policy.
- **Deletes can't be checked:** Realtime sends the old primary key to every
  subscriber of the table. So `friendships`, `conversation_members` and
  `blocks` (keys are user ids) are never published;
  `supabase/tests/database/realtime.test.sql` pins the exact list.
- `npm run db:realtime` (`scripts/db/realtime-rls.mjs`): three real users
  against the running Realtime service; a member receives a message, an
  outsider (even filtering by the conversation id) does not; requests reach
  only their two people.

**Frontend:**

| File | Role |
|---|---|
| `src/lib/realtime.ts` | `subscribe()` (one channel per call, `onReady` when changes really flow, `onState` live/reconnecting), `onResume()` (tab visible / back online) |
| `src/pages/Chat.tsx` | Live inserts for the conversation; catch-up on ready and resume; "Reconnecting…"; `data-live` attribute for tests |
| `src/pages/Home.tsx` | Live previews and order; reload on accepted requests, unknown conversations and resume |
| `src/pages/Requests.tsx`, `src/lib/useIncomingCount.ts` | Live requests list and badge |
| `src/lib/messageRules.ts` | `catchUp()`: merge the newest page, or restart from it when more than a page was missed (+ tests) |

Behaviour worth knowing:

- **`SUBSCRIBED` is not "ready".** The channel joins first; database changes
  flow only after Realtime registers the subscription in Postgres and sends a
  `system` message (`extension: postgres_changes, status: ok`). Inserts in
  between are not delivered, so catch-up runs on that message, not on
  `SUBSCRIBED`. (Found when the first RLS check sent too early.)
- Catch-up re-fetches the newest page and merges by id, not "id > last":
  ids are taken at insert, rows appear at commit.
- Own messages arrive twice (insert answer + event); merged by id, and the
  event also clears the pending bubble. So a lost answer now heals itself.
- Becoming read-only after an unfriend was not live in milestone 7; milestone
  8 announces friendship changes on a private channel instead.
- e2e: 132 checks. A second isolated browser (`Target.createBrowserContext`)
  plays Ana. A WebSocket wrapper injected before the app loads can swallow
  frames containing `window.__muteLive` (a missed event) and records sockets
  in `window.__sockets`.

### Milestone 8: unread counts, read receipts, typing, online status

**Database** (`supabase/migrations/20261016093340_chat_ux.sql`):

- `conversation_members.last_read_message_id` → FK to `messages` (set null).
  `mark_read(conversation, message)`: security definer; checks membership
  *first* (an outsider learns nothing about which messages exist), locks
  your row, moves the position only forward in (created_at, id), then
  `realtime.send(…, 'read', 'conversation:<id>', true)` from the database.
- `my_conversations` gains `unread_count` (others' messages after your
  position; dropped and recreated since the return type changed).
- **Private channels:** policies on `realtime.messages` (RLS was on with no
  policies, so all private channels were closed):
  `conversation:<id>`: members listen (broadcast); members who are still
  friends send (`private.can_send_in`). `user:<id>`: that user and current
  friends see presence; only that user announces. `private.topic_id(kind)`
  parses the channel name (malformed → null → refused). `authenticated`
  may execute `topic_id`, `can_send_in`, `are_friends` (policies run as the
  subscriber).
- Trigger `friendships_announce` (insert/delete on `friendships`) sends a
  `relationship` event on the pair's conversation channel: open chats turn
  read-only or writable live (fixes milestone 7's limitation).
- Tests: `chat_ux.test.sql` (29 checks; channel policies tested the way
  Realtime does: as the user, read/insert rows on the topic).
  `npm run db:realtime` now also covers private channels against the running
  service.

**Findings worth remembering:**

- Members may broadcast on their conversation (typing), so a member *can*
  send a fake `read` event. The app treats `read` events only as a cue and
  re-reads positions from `conversation_members` (only `mark_read` writes
  them), so a fake changes nothing on screen.
- Realtime checks channel policies **on join and on token refresh**. An
  already-joined former friend keeps receiving presence until they rejoin or
  their token refreshes (≤ 1 h). The app leaves a former friend's channel
  when its chat list reloads; a modified client could watch online status
  (not messages) for up to an hour. Accepted.
- realtime-js returns the existing channel for a name that is still leaving;
  `joinPrivate` shares one channel per name with a delayed removal, so React
  StrictMode remounts work.
- Typing throttle (3 s) is reset when you send; otherwise typing right after
  sending showed nothing (found by a flaky e2e run).

**Frontend:**

| File | Role |
|---|---|
| `src/app/AppShell.tsx`, `chats.ts` | Layout route for all signed-in pages: one live chat list (with unread counts), own presence on `user:<me>`, friends' presence, tab title "(n) Thread Buddies"; `useChats()` |
| `src/app/chatList.ts` | `withMessage` (preview, unread, order) (+ tests) |
| `src/lib/realtime.ts` | `joinPrivate()` for Broadcast/Presence channels |
| `src/lib/messages.ts` | `markRead`, `otherReadPosition` |
| `src/lib/messageRules.ts` | `isReadAt`, `seenMessageId` (+ tests) |
| `src/pages/Chat.tsx` | Typing (send ≤ every 3 s, show 5 s), mark read when visible and at the bottom, "Seen", online in the header, live read-only |
| `src/pages/Home.tsx` | Uses `useChats()`; unread badge, online dot |
| `src/pages/Requests.tsx` | A live INSERT for a request already shown no longer reloads (it dropped a just-accepted row) |

- e2e: 150 checks, passed three runs in a row. `click()` and `type()` wait
  for their element. Both browsers use `Emulation.setFocusEmulationEnabled`
  so they count as visible.

### Milestone 9: image messages

**Database** (`supabase/migrations/20261017090000_message_images.sql`):

- Private bucket `message-images`: 5 MB, JPEG or WebP. Paths
  `{conversation_id}/{uuid}.{jpg|webp}`; `private.image_conversation(name)`
  parses the folder (anything else → null → every policy refuses).
- Storage policies: members read (`is_conversation_member`), so former
  friends keep their images; uploads need `can_send_in` (a current
  friendship); the uploader may delete a file **no message uses**
  (`private.image_attached`, security definer); no update policy.
- `message_attachments` (spec section 5 plus `width`, `height`: a layout hint
  so the chat reserves the space and doesn't jump). Read-only to clients;
  visible where the message is. Cascades with its message.
- `send_image_message(conversation, client_id, path, width, height, caption)`,
  security definer: same-`client_id` retry returns the stored message;
  checks `can_send_in`, the folder, that the file exists and is the caller's,
  that its stored type matches the extension and that it isn't attached
  yet; **type and size come from `storage.objects.metadata`**, not the
  client; message and attachment in one transaction. The text insert policy
  still requires content.
- Tests: `message_images.test.sql` (37 checks). `npm run db:realtime` gained
  11 image checks against the real Storage server. `avatars.test.sql`'s
  "only one delete policy" check now looks at avatar policies only.

**Findings worth remembering:**

- **An embedded select can't see what the RPC just inserted.**
  `rpc('send_image_message').select('*, attachments:…')` returns
  `attachments: []`: PostgREST runs the function and the embed as one
  statement, which reads a snapshot from before the function's insert. The
  app builds the attachment from what it sent (id 0, only a React key).
- Storage API error shapes (local stack, checked by `db:realtime`): an
  existing path → `statusCode` `'409'` (a retry treats it as done); RLS
  refusal on upload → `'403'`; outsider download or signed link → `404`
  ("Object not found", which doesn't reveal that the file exists); a type
  outside the bucket list → `415`.
- A modal `<dialog>` must not be closed in an effect cleanup: StrictMode
  re-runs the effect, `close()` fires the close event, and the viewer shut
  itself at once (found by e2e).
- A pgTAP fixture matching `%@example.com` also caught the accounts e2e
  leaves behind; fixtures must name their own ids.

**Frontend:**

| File | Role |
|---|---|
| `src/lib/canvasImage.ts` | Decode, canvas, WebP/JPEG encode; shared with avatars (`avatarUpload.ts` now uses it) |
| `src/lib/images.ts` | Picker limits (JPEG/PNG/WebP, 20 MB), `fitWithin` (2048 px), `bubbleImageWidth` (280 × 320 max), `imagePath` (+ tests) |
| `src/lib/imageUpload.ts` | `prepareImage` (re-encode → strips EXIF), `sendImageMessage` (upload, then the function; deletes the upload if sending is no longer allowed) |
| `src/lib/imageUrls.ts` | `useImageUrl`: signed links (1 h, reused until 5 min before expiry), signed in one batch per render, re-signed when an `<img>` fails; your own sends show the local file |
| `src/lib/messages.ts` | History embeds `attachments`; `messageWithAttachments(id)` for live events |
| `src/lib/messageRules.ts` | `Attachment`; `mergeMessages` keeps loaded attachments when a live copy without them arrives (+ test) |
| `src/components/MessageImage.tsx`, `ImageViewer.tsx` | Image in a bubble (fixed shape, retry on failure); full-screen `<dialog>` (Esc, backdrop click) |
| `src/pages/Chat.tsx` | Attach button, paste, staged preview with Remove, caption optional, pending bubble with the local image, Retry reuses path and client id |
| `src/app/chatList.ts`, `src/pages/Home.tsx` | `chatPreview`: "Photo" for an image without a caption (+ tests) |

- e2e step 48 (22 checks): EXIF planted in a 3000×2000 JPEG is gone from the
  stored WebP (2048×1365); live delivery through a signed link; signed-out
  and tampered-token requests refused; GIF refused; paste and Remove;
  viewer and Esc; image-only message and "Photo" on Home; 390 px layout.
  Whole walkthrough: 172 checks, passed twice in a row.

### Milestone 10a: security review, file cleanup, account deletion, mobile

**Database** (`supabase/migrations/20261017140000_release_hardening.sql`):

- Advisor fixes: indexes `conversation_members_last_read` and
  `messages_sender_member` (FKs checked on delete), `search_events.id`
  primary key. Left as is, on purpose: `search_events` has RLS and no
  policies (clients must see nothing). `search_events` doesn't need pruning:
  `search_users` deletes each user's old rows itself.
- Trigger functions no longer executable by clients (execute is checked when
  a trigger is created, not when it fires).
- `public.orphan_files(min_age default 1 day)`: files no `avatar_path` or
  `message_attachments` row points at, older than a day (an upload may be
  mid-send). Executable by `service_role` only.
- `pg_cron` job `cleanup-files`, daily 03:17 UTC: `pg_net` POSTs to the
  Edge Function; address and secret read from **Vault** at run time, so
  neither is in a migration.
- Tests: `release_hardening.test.sql` (13 checks).

**Edge Functions** (`supabase/functions/`):

- `cleanup-files`: `verify_jwt = false` (config.toml), checks its own
  `CLEANUP_SECRET` (constant-time); lists through `orphan_files`, deletes
  through the Storage API in batches of 100. SQL can't delete files
  (`storage.protect_delete`; deleting the row would orphan the bytes).
- `delete-account`: the caller's token checked by Auth (`getUser`), then the
  **password again** (a throwaway sign-in), then `auth.admin.deleteUser`.
  The foreign keys do the rest; the avatar goes on the next cleanup.
- `npm run db:functions` (`scripts/db/functions-check.mjs`, 24 checks):
  wrong or missing secrets (including the public key and a user token) get
  401; only orphans are deleted; deletion needs the password; afterwards the
  other person keeps messages and images as "Deleted user" and can't send.

**Security review** (manual, beyond the advisors): every security-definer
function pins `search_path = ''`; `anon` has no table grants and no usage
on `private`; every public table has RLS; column grants only on
`messages (conversation_id, client_id, content)` and `profiles (username,
display_name, bio)`; no `dangerouslySetInnerHTML`; no secret in `dist`.
One fix: the sign-in page showed `error_description` from the URL hash word
for word, so anyone could link to our page with their own message (content
injection). It now shows a fixed text.

**Frontend:**

| File | Role |
|---|---|
| `src/components/DeleteAccount.tsx`, `src/lib/account.ts` | Settings → Delete account: password, explanation, then the function; sign-in says "Your account was deleted." (a module flag: signing out swaps the page out before it could navigate) |
| `index.html` | `viewport-fit=cover`, `interactive-widget=resizes-content` |
| `src/index.css` | On phones and touch screens: 44 px tap targets, 16 px input text (iOS zooms below that), safe-area insets, `100dvh` chat |
| `src/lib/linkError.ts`, `src/pages/SignIn.tsx` | Fixed text for failed email links |

- e2e: step 49 checks six screens at 360 and 430 px (no overflow, nothing
  cut off, 44 px targets, 16 px inputs) with screenshots; step 50 deletes
  an account. Whole walkthrough: 213 checks.
- Found by looking at the screenshots, not by the checks at first: the Send
  button was clipped at 360 px (grid `1fr` can't shrink below the textarea's
  natural width; now `minmax(0, 1fr)`), so the audit now also fails on
  controls cut off at the edge.

## Decisions

Accepted by the developer (spec section 11):

- **Account deletion:** profile, memberships and friendships go; that user's
  messages stay for the other person as "Deleted user"
  (`messages.sender_id ON DELETE SET NULL`).
- **Usernames:** 3–20 chars, lowercase a–z, 0–9, underscore; changeable.
- **Re-requests:** allowed after a decline or unfriend, rate-limited; blocking
  is the permanent stop.
- **Blocking:** in the MVP.
- **Profile visibility:** every profile field visible to any signed-in user.

Also decided: **Vercel** hosting on a `*.vercel.app` address and **Gmail
SMTP** for auth emails, no domain (setup in open items 2–3).

Also decided: **public avatar bucket** with 2 MB, JPEG/PNG/WebP (milestone 3).

Also decided (milestone 4, 16 Oct 2026): build `friendships` in milestone 4;
search is a username prefix, 3+ characters, 20 results, 30/minute; 20
requests/hour, 24 h before re-asking after a decline; a block hides the
blocker from search but not from a direct profile read; people you blocked
stay in your search, marked blocked.

Also decided (milestone 5, 16 Oct 2026): friend list on Home; deleting an
account nulls that side of `direct_conversations` and removes their
membership; a conversation with no members left is deleted.

Also decided (milestone 6): Home is the chat list, including read-only
conversations; no message rate limit for now.

Also decided (milestone 7): Supabase Realtime `postgres_changes`; publish
only `messages` and `friend_requests`.

Also decided (milestone 8): read receipts always on (no setting); online
status for current friends only, no "last seen"; friendship changes
announced live on the conversation channel.

Recommendations not yet explicitly confirmed (fine to follow, but mention them
when they come up): no request expiry.

- **Account deletion in the app (milestone 10, 17 Oct 2026):** Settings →
  Delete account, with the password asked again.
- **Message images (milestone 9, 17 Oct 2026):** one image per message,
  optional caption; JPEG/PNG/WebP up to 20 MB picked, scaled to 2048 px and
  re-encoded to WebP or JPEG (strips EXIF); bucket limit 5 MB; no GIFs;
  private bucket, signed links valid 1 hour; file cleanup in milestone 10.

Design: app name **Thread Buddies** (renamed from "Thread" on 15 Oct 2026,
in the UI since milestone 3); font **Manrope**; accent **#f55252**; blacks
and whites for everything else (tokens in `src/index.css`). Only the sign-in
screen exists as a design (`design/sign-in.png`); other screens are designed
by Claude to match it.

## Open items

1. **Password reset on hosted:** add `<vercel address>/reset-password` to the
   hosted redirect allow-list along with the other auth settings (item 4).
2. **Email delivery: Gmail SMTP (decided 15 Oct 2026).** Supabase's
   built-in sender only reaches the project team's own addresses, so friends
   need custom SMTP. The app is for two to four people, so a domain and
   Resend aren't needed. **Done on the hosted project (15 Oct 2026):**
   sender `threadbuddiesapp@gmail.com`, name "Thread Buddies", port 587; a
   test invite was delivered. A `535 BadCredentials` error means the app
   password was created in a different Google account. Setup steps, for
   reference:
   - Create a dedicated Gmail account for the app (its address is the
     sender friends see), turn on 2-step verification, then create an app
     password at https://myaccount.google.com/apppasswords.
   - Supabase dashboard → Authentication → Emails → SMTP Settings → enable
     custom SMTP: host `smtp.gmail.com`, port `587`, username = the full
     Gmail address, password = the 16-character app password (no spaces),
     sender email = the same address, sender name `Thread Buddies`.
   - Then raise the email rate limit under Authentication → Rate Limits if
     needed (custom SMTP starts at a low default).
   - The app password is a secret: it goes only in the Supabase dashboard,
     never in the repo or `.env*` files.
   Resend + a domain stays an option if the app grows.
3. **Hosting: Vercel (decided 15 Oct 2026),** free Hobby plan on a
   `*.vercel.app` address; no domain needed. Setup (milestone 10):
   - Add `vercel.json` with a rewrite of all paths to `/index.html`
     (client-side routing).
   - Import the GitHub repo in Vercel (framework preset: Vite, build
     `npm run build`, output `dist`).
   - Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the same
     values as `.env.production.local`) in Project → Settings → Environment
     Variables.
   - Hosted Supabase → Authentication → URL Configuration: site URL = the
     `.vercel.app` address; redirect allow-list = that address and
     `<address>/reset-password` (add a wildcard only if preview deploys
     should be able to sign in).
   Spec sections 2, 4 and 9 updated (spec v2.3).
4. **Hosted project setup** (at deployment): push the pending migrations
   (profiles, avatars, avatar fixes, friend requests, conversations, messages, realtime, chat ux), apply the auth settings. SMTP is done. Ask first.
5. Bundle is ~261 kB (83 kB gzipped). Fine for now; code-split later.
6. Accessibility note, left as designed: white text on `#f55252` is about
   3.2:1 contrast, below 4.5:1. Near-black text on the red would pass.
7. **Leftover files. Done in milestone 10a** (cleanup-files, daily). A failed
   delete of an old avatar leaves an unused object; so will account deletion
   (profiles cascade, Storage objects don't). Message images: a send that
   fails after the upload, or a conversation deleted once both accounts are
   gone, leaves files no row points at. They stay private (only members, or
   nobody, can read them), so the cost is storage only. SQL can't delete
   Storage files (`storage.protect_delete`), so cleanup needs an Edge
   Function on a schedule: delete avatar files not referenced by any
   `avatar_path`, and message images not in `message_attachments` and older
   than a day (so an upload mid-send isn't removed).
8. **Git remote URL.** Done on the Mac (16 Oct 2026): `origin` now points at
   `https://github.com/IshakSmajic/treads-buddies.git`. If another machine
   still uses the old `cuddly-garbanzo` URL, run
   `git remote set-url origin https://github.com/IshakSmajic/treads-buddies.git`.
9. **Commit attribution. Done 16 Oct 2026.** GitHub listed Claude as a
   contributor because commit messages ended with
   `Co-Authored-By: Claude … <noreply@anthropic.com>`. Commits no longer
   carry it (rule in `CLAUDE.md`), and the history was rewritten to remove it
   from the 11 commits that had it (messages only, with the same file trees,
   authors and dates, verified commit by commit), then force-pushed to
   `main`. Because each commit includes its parent's hash, every commit after
   `f0368aa` got a new hash; the hashes in this file are the new ones. **The other machine must run**
   `git fetch && git reset --hard origin/main` (check first that it has no
   uncommitted work); a plain `git pull` would merge the old history back in.
   The Mac keeps the old history in the local branch
   `backup/before-coauthor-rewrite` until it's deleted.

## Next phase

### Milestone 10b: deploy (ask before every hosted step)

1. **`.env.production.local`** on Arch: `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` of the hosted project (dashboard →
   Project Settings → API). Build and check `dist` has no secret.
2. **`vercel.json`**: rewrite every path to `/index.html`.
3. **Vercel** (developer, in the browser): import the repo (preset Vite),
   add the two `VITE_` variables. Note the `*.vercel.app` address.
4. **Hosted Supabase** (`izshntiffhekuvpirixf`):
   - `npx supabase db push --dry-run`, then `db push` (migrations 3–12).
   - Auth: site URL = the Vercel address; redirect allow-list = the address
     and `<address>/reset-password`; confirm email on; minimum password 8;
     secure password change; password-changed email. Check the email rate
     limit with Gmail SMTP.
   - `npx supabase functions deploy cleanup-files delete-account`;
     `npx supabase secrets set CLEANUP_SECRET=<new random value>`.
   - Vault (SQL editor): `select vault.create_secret('https://<ref>.supabase.co', 'project_url');`
     and the same `CLEANUP_SECRET` as `cleanup_secret`.
   - Advisors on the hosted project (`db advisors --linked`).
5. **Smoke test on the real address:** sign up (Gmail delivers), onboarding,
   friend request, messages live between two devices, an image, password
   reset, delete a test account; a real phone. Then trigger the cron job's
   request once and check `net._http_response`.

## Tooling and gotchas

- **Supabase CLI** is a dev dependency: always `npx supabase ...`. Some
  commands wait on stdin and hang in a non-interactive shell; append
  `< /dev/null`.
- **Git pager** hangs non-interactive shells: use `git --no-pager diff`.
- Changing `supabase/config.toml` needs `npx supabase stop && npx supabase start`;
  a restart reuses the old data ("from backup"), so follow with
  `npm run db:reset` to reapply migrations.
- **`npm run db:realtime`** checks Realtime delivery against RLS with real
  users (needs the stack running).
- **e2e harness:** don't close Vite's dev-server WebSocket in tests (Vite
  reloads the page); Chrome's offline emulation does not close open
  WebSockets. `type()` waits for its field to exist.
- **`npm run db:race`** runs the two-session concurrency checks
  (`scripts/db/race.sh`, via `docker exec psql`). Run it with `db:test` when
  the friend functions change.
- `oxfmt` has no config file: running it by hand formats with double quotes
  and semicolons. Only `db:types` uses it; don't run it on `src`.
- `npm run db:types` regenerates and formats `src/lib/database.types.ts`; run
  it after every migration.
- **Supabase auth callback:** never `await` Supabase calls inside
  `onAuthStateChange`; it deadlocks. `AuthProvider` records the session and
  fetches in an effect.
- **Oxlint** flags `setState` called synchronously in effects; derive values
  during render instead (see `Onboarding.tsx`, `AuthProvider.tsx`).
- **React Router v8** exports the same APIs used here as v7
  (`createBrowserRouter`, `RouterProvider`, `Navigate`, `Outlet`, …).
- **TypeScript 7** (the native compiler) is installed; `tsc -b` works.
- **Browser checks:** `npm run test:e2e` runs `scripts/e2e/run.sh`, which
  starts Vite on 5173 (stop `npm run dev` first; the port must be free) and
  headless Chrome (found on Linux or macOS, or set `CHROME=`), then
  `walkthrough.mjs`. File inputs are driven with CDP `DOM.setFileInputFiles`;
  test images are generated in the script. Screenshots go
  to `scripts/e2e/shots/`. It reads confirmation links through Mailpit's API.
  It leaves its test accounts behind (harmless). `npm run db:reset` clears
  them but **also deletes any account the developer made by hand**; don't
  run it without saying so. (A browser still signed in to a deleted account
  is now signed out automatically; see milestone 3.) Emails are
  found by recipient and subject (`latestLink(email, 'Confirm' | 'Reset')`).
  The script also calls the Auth API directly (a second "device"), reading
  the URL and key from `.env.development.local`.
- **The spec** is generated: edit the content in `scripts/spec/build_spec.py`
  and run `npm run spec:build`. Don't hand-edit the `.docx`. It needs only
  the Python standard library. (On the old Mac, preview with `qlmanage` or
  `textutil`; on Linux there is no previewer installed.)
