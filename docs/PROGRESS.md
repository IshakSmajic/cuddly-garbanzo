# Thread — progress and handoff

Last updated: 15 October 2026, after milestone 2b.

This file is the running record of the project: what is done, what is live,
what was decided, and what comes next. Read it at the start of a session and
update it at the end of each milestone. The product rules and data model are
in `Chat_App_Project_Specification.docx` (the spec); working rules for Claude
are in `CLAUDE.md`.

## Milestones at a glance

| # | Milestone | Status |
|---|---|---|
| 1 | Foundation: TypeScript, local Supabase, remove demo | Done (commit `14b28b3`) |
| 2 | Auth: sign up, confirm email, sign in, onboarding, protected routes | Done (commit `c2409e4`) |
| 2b | Password reset (follow-up to milestone 2) | Done (commit "Milestone 2b: password reset") |
| 3 | Profiles and avatars: profile editor, avatar upload/replace/remove | **Next.** Plan outline below |
| 4 | User discovery and requests: search, send/cancel/accept/decline, blocking | Not started |
| 5 | Friendships: friend list, unfriend, accept creates the conversation | Not started |
| 6 | Direct messaging persistence: history, friends-only sending, paging | Not started |
| 7 | Realtime messaging: live delivery, reconnect recovery, dedupe | Not started |
| 8 | Chat UX: typing, presence, unread counts, read receipts | Not started |
| 9 | Media: image messages | Not started |
| 10 | Release: deploy, security review, mobile polish | Not started |

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

### Repository (`main` on GitHub: IshakSmajic/cuddly-garbanzo)

- React 19 + TypeScript 7 (strict) + Vite 8, React Router 8, Oxlint, Vitest.
- Supabase JS client, typed from the generated `src/lib/database.types.ts`.
- Manrope (self-hosted via `@fontsource-variable/manrope`), accent `#f55252`,
  dark theme tokens in `src/index.css`.

### Local Supabase (Docker, 12 containers)

- All three migrations applied. Auth settings in `supabase/config.toml`:
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
- **Not yet applied:** the profiles migration, the auth settings (site URL,
  redirect URLs including `/reset-password`, confirm email, password length,
  secure password change, password-changed notification), and an email
  sender (SMTP).
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

Recommendations not yet explicitly confirmed (fine to follow, but mention them
when they come up): Supabase Realtime before a custom WebSocket server; prefix
username search (min 3 chars, max 20 results); public avatar bucket, 2 MB,
JPEG/PNG/WebP; no request expiry.

Design: app name **Thread**; font **Manrope**; accent **#f55252**; blacks and
whites for everything else (tokens in `src/index.css`). Only the sign-in
screen exists as a design (`design/sign-in.png`); other screens are designed
by Claude to match it.

## Open items

1. **Password reset on hosted:** add `<live origin>/reset-password` to the
   hosted redirect allow-list along with the other auth settings (item 4).
2. **Email delivery for real users.** Supabase sends the emails, but its
   built-in sender only reaches the Supabase team's own addresses and is
   heavily rate-limited, so friends need a real mail server:
   - Now, without a domain: Gmail SMTP with an app password (needs Google
     2-step verification).
   - Later: Resend, which needs a domain. The developer plans to buy one
     (recommended: Cloudflare Registrar; turn on auto-renew and 2FA). Then:
     add the domain in Resend → copy its DNS records into Cloudflare → enter
     Resend's SMTP details in Supabase (Authentication → SMTP). No code changes.
3. **Hosting: Vercel or Netlify.** Undecided. Both free tiers work (Vercel
   Hobby is personal/non-commercial only, which fits). The spec says Netlify;
   if Vercel is chosen, update spec section 2, milestone 10 and the README.
   Either way, deployment needs: a rewrite of all paths to `index.html`
   (client-side routing), the two `VITE_` env vars in the host's settings,
   and the hosted Supabase site URL + redirect allow-list set to the live
   address (a wildcard if preview deploys should work).
4. **Hosted project setup** (at deployment): push the pending migrations,
   apply the auth settings, configure SMTP. Ask first.
5. Bundle is ~540 kB (157 kB gzipped). Fine for now; code-split later.
6. Accessibility note, left as designed: white text on `#f55252` is about
   3.2:1 contrast, below 4.5:1. Near-black text on the red would pass.

## Next phase

### Milestone 3: profiles and avatars (per spec section 5)

Plan outline to present for approval:

- **Profile editor** page (`/settings/profile` or similar): username (with the
  same availability check; changeable per decision), display name, bio.
- **Storage:** bucket `avatars` (public, if the recommendation is confirmed),
  2 MB limit, `image/jpeg`, `image/png`, `image/webp` set as bucket limits.
  Objects at `{user_id}/<random>.<ext>`. Storage policies on
  `storage.objects`: insert/update/delete only where the first path segment
  equals `auth.uid()` (`storage.foldername(name)[1]`).
- **`avatar_path`:** clients cannot update it directly (by design). Add a
  security-definer function, e.g. `set_avatar(path text)`, that checks the
  path starts with the caller's id and the object exists, then sets it. Or
  grant the column with a policy check; explain the trade-off.
- **Replace order** (Storage and Postgres don't share a transaction): upload
  new object → update `avatar_path` → delete old object. Plan orphan cleanup.
- **Remove avatar:** clear `avatar_path`, then delete the object.
- Show avatars in the home header; fallback initials when none.
- **Tests:** pgTAP for the function and storage policies (other users can't
  write in your folder); e2e for upload/replace/remove.
- Bucket settings check the browser-reported type only; real content
  checking (an Edge Function) stays deferred, per the spec.

## Tooling and gotchas

- **Supabase CLI** is a dev dependency: always `npx supabase ...`. Some
  commands wait on stdin and hang in a non-interactive shell; append
  `< /dev/null`.
- **Git pager** hangs non-interactive shells: use `git --no-pager diff`.
- Changing `supabase/config.toml` needs `npx supabase stop && npx supabase start`;
  a restart reuses the old data ("from backup"), so follow with
  `npm run db:reset` to reapply migrations.
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
  starts Vite on 5173 and headless Chrome (installed at
  `/Applications/Google Chrome.app`), then `walkthrough.mjs`. Screenshots go
  to `scripts/e2e/shots/`. It reads confirmation links through Mailpit's API.
  Run `npm run db:reset` afterwards to clear the test accounts. Emails are
  found by recipient and subject (`latestLink(email, 'Confirm' | 'Reset')`).
  The script also calls the Auth API directly (a second "device"), reading
  the URL and key from `.env.development.local`.
- **The spec** is generated: edit the content in `scripts/spec/build_spec.py`
  and run `npm run spec:build`. Don't hand-edit the `.docx`. macOS has only
  Python 3.9 and no Word/LibreOffice/pandoc; preview with
  `qlmanage -t -s 1000 -o <dir> Chat_App_Project_Specification.docx` (first
  page only) or `textutil -convert txt -stdout <file>`.
