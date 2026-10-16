"""Builds Chat_App_Project_Specification.docx from the content below.

The spec's text lives in this file. To change the spec, edit the content
section and run (from the repo root):

    python3 scripts/spec/build_spec.py

template.docx is the original v1 document; only its styles, numbering
definitions, footer and page setup are reused. The body is replaced wholesale.
Needs only the Python standard library (works on macOS's Python 3.9).
"""
import os, re, shutil, tempfile, zipfile
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, 'template.docx')
OUTPUT = os.path.join(HERE, '..', '..', 'Chat_App_Project_Specification.docx')

UN = tempfile.mkdtemp(prefix='spec-')
with zipfile.ZipFile(TEMPLATE) as z:
    z.extractall(UN)

C = []  # content blocks
def title(t): C.append(('Title', t))
def p(t): C.append(('Normal', t))
def h1(t): C.append(('Heading1', t))
def h2(t): C.append(('Heading2', t))
def b(t): C.append(('ListBullet', t))
def n(t): C.append(('ListNumber', t))
def table(widths, rows): C.append(('table', (widths, rows)))
def brk(): C.append(('break', None))

# ---------------------------------------------------------------- content
title('Chat App — Project Specification for Claude')
p('**Status:** Revised draft v2.6, 16 October 2026. Milestones 1–4 are complete and milestone 5 is built; see docs/PROGRESS.md in the repository for detailed progress.')
p('**Purpose:** Build a real-time, friends-only chat application while learning WebSockets, relational database design, authentication, and secure application architecture.')

h1('1. Project goals')
p('Create a web-first chat application with mandatory accounts, verified email addresses, editable profiles and avatars, username-based discovery, friend requests, and private real-time direct messaging. Eventually support images in messages and a mobile-friendly experience or mobile client.')
p('**Audience and scale:** a private app for a small group of friends: roughly 5–50 accounts, with a handful online at the same time. This sizing justifies managed services and free-tier limits; revisit the architecture if usage grows well beyond it.')
p('**Learning constraint:** Claude is an implementation partner, not a substitute for understanding. Work in small milestones, explain architectural choices, identify security assumptions, and request approval before significant changes. Do not generate the entire app in one pass.')

h1('2. Technology and deployment')
b('**Frontend:** React + TypeScript, built with Vite. The existing repository uses React + Vite in JavaScript; converting it to TypeScript is part of milestone 1.')
b('**Frontend hosting:** Vercel (free Hobby plan, personal non-commercial use), serving the static build (`npm run build` → `dist/`) at a free `*.vercel.app` address; no custom domain is needed. A `vercel.json` rewrite sends every path to `index.html` for client-side routing. The browser receives only `VITE_SUPABASE_URL` and the publishable key; the secret (service-role) key never appears in frontend code, the repository, or Vercel environment variables exposed to the client.')
b('**Backend services:** Supabase Auth, PostgreSQL, Row Level Security (RLS), Realtime, Storage.')
b('**Transactional email:** Gmail SMTP (a dedicated Gmail account with 2-step verification and an app password) configured as custom SMTP for Supabase Auth. Supabase\'s built-in sender only delivers to the project team\'s own addresses and is rate-limited, so custom SMTP must be working before friends are invited. Gmail needs no domain and its daily limit (about 500 messages) is far above the expected volume. Resend with a custom domain remains an option if the app grows.')
b('**Realtime:** recommended to start with Supabase Realtime (`postgres_changes`) for the MVP. A custom Node.js WebSocket server remains an optional later learning exercise; it cannot run as a persistent server on Vercel Functions and would need separate hosting (for example Fly.io, Railway or Render).')
b('**Environments:** a local Supabase stack (`supabase start`, requires Docker) for development and automated tests; the hosted Supabase project is production. Migrations live in `supabase/migrations` and are applied with `supabase db push`. Secrets live in `.env.local`, which is git-ignored.')
b('**Free-tier limits:** hosted free projects pause after about a week without activity, and Realtime allows about 200 concurrent connections. Both are acceptable at the stated scale.')
b('**Future:** responsive web app first; PWA or dedicated mobile app later.')

h1('3. Product rules')
h2('Confirmed')
n('Registration and login are mandatory for app use. Email confirmation is required before using authenticated app features. With "Confirm email" enabled, Supabase Auth issues no session until the address is confirmed, so this is enforced by Auth configuration rather than by application code.')
n('Every account has exactly one profile row, created automatically at sign-up. A profile has a unique username, display name, optional bio, and optional avatar. Username and display name stay empty until the user completes onboarding; the app routes users without a username to onboarding, and accounts without a username cannot be found by others.')
n('Users can find others by username and send friend requests.')
n('A friendship is mutual and becomes active only when the intended recipient accepts a request.')
n('Only current friends may send direct messages to each other. Enforce this server-side/database-side, not merely in UI.')
n('A pair of users has at most one direct conversation, regardless of participant ordering.')
n('When a friendship ends, the existing conversation and all historical messages remain accessible to both original participants, but neither may send new messages. If they become friends again, the same conversation resumes.')
n('Profile pictures and eventual message images are stored in Supabase Storage; PostgreSQL stores references and metadata, not binary image content.')
n('One-to-one conversations are MVP scope; future group chats should remain feasible without prematurely building group functionality.')
h2('Decided (15 October 2026)')
n('**Blocking:** a user can block another user. Blocking ends any friendship, cancels pending requests between the two, prevents new requests in either direction, and hides the blocker from the blocked user\'s search results. The blocker still finds the blocked user in search, marked as blocked, so they can unblock; unblocking does not restore the friendship. Conversation history remains, as in rule 7.')
n('**Length limits:** messages up to 4,000 characters, bios up to 280, display names up to 50.')
n('**Out of MVP scope:** editing and deleting sent messages.')

h1('4. Core user flows')
h2('Account and profile')
n('Register with email and password.')
n('Supabase Auth sends a confirmation email through the custom SMTP sender (Gmail).')
n('A database trigger on `auth.users` creates the user\'s profile row, with username and display name empty.')
n('After confirming and signing in, the user completes onboarding by choosing a unique username and a display name.')
n('User can edit profile fields and upload, replace or remove an avatar.')
h2('Friendship')
n('Search by username (search behaviour is an open decision; see section 11).')
n('Send a request (pending). If the other user already has a pending request to you, sending one accepts theirs instead of creating a second request.')
n('The recipient accepts or declines; the requester may cancel while the request is pending.')
n('Accepting creates the friendship and, if the pair has none yet, their direct conversation, in one transaction.')
n('Accepted users appear in each other\'s friends lists.')
n('Either user can unfriend. This deletes the friendship row; the conversation and its messages remain.')
h2('Messaging')
n('Each friend pair has exactly one direct conversation, created at first acceptance and reused if they become friends again.')
n('Messages are persisted in PostgreSQL and delivered to authorized subscribers in real time.')
n('Reconnecting clients fetch missed messages from the database; delivery events are not the source of truth. Clients deduplicate messages by id.')
n('Former friends can view the same conversation history but cannot create new messages until the friendship is restored.')

h1('5. Relational data model — proposed schema, not approved migrations')
p('Use Supabase `auth.users` for authentication. Never duplicate password hashes, email addresses, or other auth-owned data in public tables.')
table([2200, 2500, 3940], [
    ['Relation', 'Attributes', 'Keys / constraints'],
    ['`profiles`', 'user_id, username, display_name, bio, avatar_path, created_at, updated_at',
     'PK user_id; FK → auth.users; username nullable, UNIQUE, stored lowercase, CHECK against `^[a-z0-9_]{3,20}$`; display_name nullable, 1–50 chars; bio ≤ 280 chars; avatar_path nullable'],
    ['`friend_requests`', 'id, requester_id, recipient_id, status, created_at, responded_at',
     'PK id; FKs → profiles; CHECK requester_id <> recipient_id; status IN (pending, accepted, declined, cancelled); CHECK (status = pending) = (responded_at IS NULL); partial UNIQUE on (least, greatest) of the two ids WHERE status = pending'],
    ['`friendships`', 'user_low_id, user_high_id, created_at',
     'PK (user_low_id, user_high_id); FKs → profiles; CHECK user_low_id < user_high_id. A row exists only while the friendship is active; unfriending deletes it'],
    ['`blocks`', 'blocker_id, blocked_id, created_at',
     'PK (blocker_id, blocked_id); FKs → profiles; CHECK blocker_id <> blocked_id. See section 3'],
    ['`conversations`', 'id, created_at',
     'PK id. No type column: a conversation is direct exactly when it has a direct_conversations row. Groups get their own table later'],
    ['`direct_conversations`', 'conversation_id, user_low_id, user_high_id',
     'PK conversation_id; FK → conversations; FKs → profiles ON DELETE SET NULL, so a deleted account leaves the other person a direct conversation with "Deleted user"; UNIQUE (user_low_id, user_high_id); CHECK user_low_id < user_high_id'],
    ['`conversation_members`', 'conversation_id, user_id, joined_at, last_read_message_id',
     'PK (conversation_id, user_id); FKs → conversations, profiles (ON DELETE CASCADE); last_read_message_id nullable, reserved for unread counts and read receipts. When the last member is removed, a trigger deletes the conversation'],
    ['`messages`', 'id, conversation_id, sender_id, client_id, content, created_at',
     'PK id (bigint identity); FK → conversations; composite FK (conversation_id, sender_id) → conversation_members; UNIQUE (sender_id, client_id); content nullable, 1–4,000 chars when present; INDEX (conversation_id, created_at DESC, id DESC)'],
    ['`message_attachments`', 'id, message_id, storage_path, mime_type, size_bytes, created_at',
     'PK id; FK → messages; UNIQUE storage_path; mime_type in an allow-list; size_bytes > 0 and under the limit'],
])
p('These tables are a proposal to be checked against the decisions in section 11, not a proven BCNF schema. Every foreign key\'s ON DELETE action follows from the account-deletion decision and must be set before the first migration.')
p('**Single source of truth for friendship.** Only `friendships` answers "are these two friends now?". `friend_requests` is workflow and history: an accepted request records how a friendship started, not whether it still exists. Keeping the fact in one table means an unfriend cannot leave the two tables disagreeing.')
p('**One direct conversation per pair.** `direct_conversations` stores each pair once, lower id first, and its UNIQUE (user_low_id, user_high_id) constraint makes a second conversation impossible even under concurrent requests. A uniqueness rule on `conversation_members` alone could not express this. The conversation is created inside the accept transaction: the function takes a transaction-scoped advisory lock on the sorted pair of user ids (a row lock cannot cover a request that does not exist yet, as when both users send at the same moment), re-reads the request, checks that the caller is the recipient and the status is pending, inserts the friendship, looks up the pair\'s conversation and creates the conversation, mapping and both membership rows only if there is none, and marks the request accepted. Under the pair lock this look-then-insert is safe; the unique constraint is the backstop. (INSERT … ON CONFLICT DO NOTHING on the mapping alone would leave an empty conversation behind, since the conversation row is inserted first.) Re-friending finds the existing conversation.')
p('**Mapping and membership agree.** Foreign keys cannot guarantee that a direct conversation\'s members are exactly its mapped pair. This holds because clients cannot write either table; only the accept function does.')
p('**Historical access versus sending.** Reading a conversation requires a membership row, and membership rows are never deleted on unfriend. Sending is checked separately: the INSERT policy on `messages` requires sender_id = auth.uid() and a `friendships` row for the pair recorded in `direct_conversations`. Unfriending deletes one row, which stops sending immediately and leaves history untouched. For future group conversations, revisit this authorization model.')
p('**Write paths.** Clients never insert, update or delete `friend_requests`, `friendships`, `blocks`, `conversations`, `direct_conversations` or `conversation_members` directly. Those privileges are revoked from the authenticated role, and every change goes through SECURITY DEFINER functions: send_friend_request, respond_to_friend_request, cancel_friend_request, unfriend, block_user and unblock_user. Username search goes through search_users, which applies the limits in section 11 and the block rule. Status transitions (pending → accepted, declined or cancelled, and nothing else) are enforced inside those functions; a CHECK constraint can restrict values but not transitions. Text messages are inserted directly by the client under RLS.')
p('**Profile provisioning.** An AFTER INSERT trigger on `auth.users` creates the profile row. Because username stays empty until onboarding, a sign-up can never fail on a username collision inside the trigger.')
p('**Messages without text.** content is nullable so image messages are possible later. "Text or at least one attachment" spans two tables, which a CHECK cannot enforce, so image messages will be created by a function that inserts the message and its attachments in one transaction.')
p('**Idempotent sends.** The client generates client_id (a UUID) before sending. A retry after a dropped connection hits UNIQUE (sender_id, client_id) instead of creating a duplicate.')
p('**Request history.** Requests are kept as history after they are accepted, declined or cancelled. The partial unique index allows at most one pending request per unordered pair, in either direction. Whether a new request may follow a decline or an unfriend is an open decision (section 11).')
p('**Avatar storage.** avatar_path identifies an object in an avatars bucket whose path begins with the owner\'s user id (`{user_id}/…`); storage policies allow writes only where the first path segment equals auth.uid(). Bucket settings restrict MIME types and file size, but they trust the type the browser reports; real content checking needs an Edge Function and is deferred. Storage and PostgreSQL do not share a transaction, so upload the new object first, then update avatar_path, then delete the old object, and remove orphans with a periodic cleanup.')

h1('6. Normalization and integrity acceptance criteria')
b('Begin by identifying functional dependencies, candidate keys, relationship cardinalities, and business invariants.')
b('Aim for BCNF where practical; at minimum justify 1NF, 2NF, and 3NF for each relation. Avoid storing sender names in messages, duplicated user details in membership records, or values implied by other rows (for example a conversation type column alongside direct_conversations).')
b('No array-of-participant IDs in a conversation column; model membership relationally.')
b('No duplicated friendship rows for reversed pairs; no self-friendships.')
b('Usernames are stored lowercase and validated by a CHECK constraint, so a plain UNIQUE constraint on the stored value is case-insensitive in effect. Restrict them to ASCII letters, digits and underscore to rule out look-alike Unicode names.')
b('Ensure one direct conversation per unordered user pair even under concurrent creation requests.')
b('Use FKs, CHECK constraints, UNIQUE constraints, transactions, and RLS together. Normalization alone does not eliminate concurrency, authorization, or integrity bugs.')
b('Define deletion and retention rules before migrations. Unfriending deletes only the `friendships` row, which nothing references, so it can never cascade into message history.')
b('If attachments or message edits/deletions are added, specify referential and retention semantics explicitly.')

h1('7. Authorization and security')
b('Require verified, authenticated users for app operations (Auth "Confirm email" setting).')
b('Enable RLS on every table in the public schema and write policies for `storage.objects`. All profile fields are currently readable by any signed-in user; email addresses stay in `auth.users` and are never exposed. RLS filters rows, not columns, so a field that should be friends-only later must move to a separate table or view.')
b('Only a request\'s recipient may accept or decline it; only its requester may cancel it while pending; either friend may unfriend.')
b('Only conversation members may read historical messages.')
b('Only current friends who are both members of the same direct conversation may send new messages.')
b('Enforce every rule on writes even if an attacker bypasses the UI or calls Supabase directly.')
b('**Realtime:** `postgres_changes` applies the table\'s SELECT policy to each subscriber, so message delivery follows read access automatically. Broadcast and Presence do not; if they are used for typing indicators or online status, they must use private channels with policies on `realtime.messages`.')
b('**Functions and policies:** SECURITY DEFINER functions must set `search_path = \'\'` and check auth.uid() themselves. Write policies with `(select auth.uid())` so the value is computed once per statement rather than once per row.')
b('**Rate limiting:** Supabase\'s data API has no per-user rate limit (Auth endpoints have their own). Enforce limits inside the write functions, for example with a counter table checked in send_friend_request, or in an Edge Function.')
b('**Username search:** search is enumeration by design. Limit it as decided in section 11, rate-limit it, and exclude blocked users and accounts without a username.')
b('Validate text lengths and uploads. Never trust client-supplied sender IDs: sender_id defaults to auth.uid() and the insert policy requires equality.')
b('**Tests:** write permission and integrity tests with pgTAP (`supabase test db`) against the local stack, covering simultaneous requests, acceptance, conversation creation, unfriending, reconnection, and blocked unauthorized writes.')

h1('8. Realtime engineering goals')
p('Understand WebSocket connection establishment, subscription authorization, events, heartbeat/connection lifecycle, reconnect behavior, deduplication, ordering limitations, and message recovery. Database persistence is authoritative; real-time events update the UI. Avoid promising exactly-once delivery beyond the client_id idempotency strategy in section 5.')
p('**Recovery after reconnecting:** message ids are assigned when an insert runs, but a row only becomes visible when its transaction commits, so a lower id can appear after a higher one. Querying only id > last_seen_id can therefore miss messages. Instead, re-fetch from slightly before the last seen message\'s created_at and deduplicate by id. Display messages ordered by (created_at, id).')
p('Potential later features: typing indicators, presence, unread counts, per-user read positions/receipts (using conversation_members.last_read_message_id), notifications, image attachments, group conversations. These are not MVP prerequisites.')

h1('9. Implementation milestones and completion gates')
n('**Project foundation:** convert the repository to TypeScript, set up the local Supabase stack and separate local and hosted environments, and remove the demo schema and test accounts; architecture agreed. Creating the Vercel project moves to milestone 10.')
n('**Auth:** sign-up, confirmation emails through custom SMTP, login/logout, protected routes, session handling, and the profile-provisioning trigger; verified with tests.')
n('**Profiles and avatars:** onboarding, username rules and uniqueness, profile editor, secure avatar upload/replace/remove.')
n('**User discovery and requests:** username search, send/cancel/accept/decline, blocking, with integrity and permission tests.')
n('**Friendships:** friend list, unfriend, canonical pair representation, transactional acceptance that also creates the direct conversation.')
n('**Direct messaging persistence:** historical access, friends-only writes, pagination, client_id idempotency, RLS tests.')
n('**Realtime messaging:** live updates, reconnect and recovery with an overlap window, duplicate prevention, concurrent client tests.')
n('**Chat UX:** optional typing indicators and presence (private channels), unread counts, read receipts.')
n('**Media:** image messages, private storage, validation and authorized retrieval.')
n('**Release and mobile preparation:** Vercel deployment and Gmail SMTP setup, security review (including the Supabase security and performance advisors), responsive UI, later PWA/mobile exploration.')
p('For each milestone, Claude should present: scope, data model changes, key security risks, tests, acceptance checklist, and explanations of concepts the developer should understand. A milestone\'s tests must pass before the next one starts. Pause for approval before implementing the next milestone.')

h1('10. Current repository state')
b('Milestones 1 (foundation), 2 (auth, including password reset), 3 (profiles and avatars) and 4 (search, friend requests and blocking) are complete; milestone 5 (friend list, unfriend, conversation on accept) is built. Detailed progress, open items and next steps live in `docs/PROGRESS.md`; working rules for Claude are in `CLAUDE.md`.')
b('Frontend: React + TypeScript (strict) with Vite, React Router, Manrope and the #f55252 accent. Screens: sign in (from `design/sign-in.png`), sign up, check email, forgot and reset password, onboarding, profile settings with avatar upload, people search, friend requests, public profiles with unfriend and block, and a home screen listing your friends.')
b('Database: `profiles` with username rules, column-level update grants, RLS and a sign-up trigger; a public `avatars` bucket with per-user folder policies and the `set_avatar` and `remove_avatar` functions; `friend_requests`, `friendships` and `blocks`, read-only to clients, changed through security-definer functions that serialise each pair with an advisory lock; `conversations`, `direct_conversations` and `conversation_members`, readable by members through a security-definer membership check, created when a request is accepted. Tests: pgTAP in `supabase/tests/database`, a two-session race check in `scripts/db/race.sh`, Vitest in `src`.')
b('A local Supabase stack runs in Docker; `npm run dev` uses it and Mailpit catches its emails. The hosted project has only the first two migrations: the later migrations and the auth settings are applied at deployment. Gmail SMTP is already configured there.')

h1('11. Decisions still open')
h2('Decided (15 October 2026)')
b('**Account deletion.** Decision: deleting an account removes the profile, memberships and friendships, while that user\'s messages remain for the other participant and show as "Deleted user" (messages.sender_id ON DELETE SET NULL). The alternative, deleting the content, breaks the other person\'s history.')
b('**Username rules.** Decision: 3–20 characters, lowercase a–z, 0–9 and underscore; usernames can be changed, since friends see display names.')
b('**Re-request policy.** Decision: a new request is allowed after a decline or an unfriend, subject to rate limiting; blocking is the way to stop someone permanently.')
b('**Blocking in the MVP.** Decision: yes, as described in section 3.')
b('**Profile visibility.** Decision: every profile field is visible to any signed-in user, so `profiles` holds no private fields.')
b('**Avatar bucket.** Decision: public bucket (anyone with an image URL can view it; object names are random). Limits: 2 MB maximum, JPEG, PNG or WebP.')
b('**App name.** Decision: Thread Buddies (earlier working name: Thread).')
b('**Search behaviour.** Decision (milestone 4): prefix match on username, minimum 3 characters, at most 20 results, 30 searches a minute per user.')
b('**Request limits.** Decision (milestone 4): at most 20 requests an hour per user; after a decline, the same requester may ask that person again after 24 hours.')
b('**Conversations after account deletion.** Decision (milestone 5): the deleted user\'s side of `direct_conversations` becomes null and their membership goes; the other person keeps the conversation, shown with "Deleted user". When both have deleted their accounts, the conversation is deleted.')
b('**Blocks and profile reads.** Decision (milestone 4): a block hides the blocker from search, but profiles stay readable by any signed-in user, so the blocked user can still open the blocker\'s profile by its address. Hiding it would also hide the name on kept conversation history.')
b('**Hosting and email.** Decision: Vercel on a free `*.vercel.app` address, and Gmail SMTP for auth emails; no domain is needed. The expected scale is two to four people.')
h2('Can wait')
b('**Supabase Realtime versus a custom WebSocket server.** Recommendation: Supabase Realtime for the MVP; a custom server later as a learning exercise.')

b('**Request expiration.** Recommendation: none for the MVP.')
p('Resolved in this revision: frontend tooling (React + TypeScript with Vite), when a conversation is created (on acceptance), and the direct-conversation pair schema (`direct_conversations`).')

h1('12. Instructions to Claude — first response')
p('Do not start coding immediately. Section 5 contains a proposed schema. The schema decisions in section 11 are decided. Check the schema against those decisions and the rules in section 3 for inconsistencies, missing functional dependencies, authorization gaps, and normalization problems. Present the resulting tables, keys, constraints, indexes, transaction boundaries, and RLS policy outline, clearly separating confirmed rules from unresolved decisions. Ask for approval before writing migrations or application code. Teach the reasoning rather than simply providing generated code.')

h1('Revision history')
b('**v2, 15 October 2026:** resolved contradictions (profile provisioning, friendship state, conversation type), added a concrete schema with blocking and idempotent sends, defined write paths and the recovery strategy, documented the current repository state, sorted open decisions by urgency with recommendations, and fixed numbered lists so each one starts at 1.')
b('**v2.1, 15 October 2026:** the developer accepted the five schema decisions in section 11 and the rules in section 3; section 10 updated after milestone 1.')
b('**v2.2, 15 October 2026:** status and section 10 updated after milestone 2.')
b('**v2.4, 15 October 2026:** status and section 10 updated after milestone 3.')
b('**v2.5, 16 October 2026:** milestone 4: search and request limits decided, blocked users stay visible to the blocker, pair locking described, section 10 updated.')
b('**v2.6, 16 October 2026:** milestone 5: delete rules for direct conversations and memberships, look-then-insert under the pair lock, empty conversations deleted, section 10 updated.')
b('**v2.3, 15 October 2026:** hosting changed from Netlify to Vercel and email from Resend to Gmail SMTP; no custom domain needed. App named Thread Buddies; public avatar bucket decided.')
b('**v1:** initial specification.')

# ---------------------------------------------------------------- render
CODE_RPR = '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr>'

def runs(text, base=''):
    out = []
    for tok in re.split(r'(\*\*.+?\*\*|`[^`]+`)', text):
        if not tok:
            continue
        if tok.startswith('**'):
            rpr, t = '<w:rPr><w:b/></w:rPr>', tok[2:-2]
        elif tok.startswith('`'):
            rpr, t = CODE_RPR, tok[1:-1]
        else:
            rpr, t = base, tok
        out.append(f'<w:r>{rpr}<w:t xml:space="preserve">{escape(t)}</w:t></w:r>')
    return ''.join(out)

body, num_ids, next_num, prev = [], [], 10, None
for kind, val in C:
    if kind == 'table':
        widths, rows = val
        grid = ''.join(f'<w:gridCol w:w="{w}"/>' for w in widths)
        trs = []
        for ri, row in enumerate(rows):
            tcs = ''.join(
                f'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="{w}"/></w:tcPr><w:p>{runs(cell)}</w:p></w:tc>'
                for w, cell in zip(widths, row))
            hdr = '<w:trPr><w:tblHeader/></w:trPr>' if ri == 0 else ''
            trs.append(f'<w:tr>{hdr}{tcs}</w:tr>')
        body.append('<w:tbl><w:tblPr><w:tblStyle w:val="LightShading-Accent1"/>'
                    f'<w:tblW w:type="dxa" w:w="{sum(widths)}"/>'
                    '<w:tblLook w:firstColumn="1" w:firstRow="1" w:lastColumn="0" w:lastRow="0" w:noHBand="0" w:noVBand="1" w:val="04A0"/>'
                    f'</w:tblPr><w:tblGrid>{grid}</w:tblGrid>{"".join(trs)}</w:tbl>')
        prev = kind
        continue
    if kind == 'ListNumber':
        if prev != 'ListNumber':
            num_ids.append(next_num); next_num += 1
        ppr = f'<w:pPr><w:pStyle w:val="ListNumber"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="{num_ids[-1]}"/></w:numPr></w:pPr>'
    elif kind == 'Normal':
        ppr = ''
    else:
        ppr = f'<w:pPr><w:pStyle w:val="{kind}"/></w:pPr>'
    body.append(f'<w:p>{ppr}{runs(val)}</w:p>')
    prev = kind

doc_path = f'{UN}/word/document.xml'
x = open(doc_path, encoding='utf-8').read()
start = x.index('<w:body>') + len('<w:body>')
sect = x.index('<w:sectPr')
x = x[:start] + ''.join(body) + x[sect:]
open(doc_path, 'w', encoding='utf-8').write(x)

# Each numbered list gets its own copy of abstractNum 7 (the ListNumber format) so it starts at 1
num_path = f'{UN}/word/numbering.xml'
nx = open(num_path, encoding='utf-8').read()
assert '<w:num w:numId="5"><w:abstractNumId w:val="7"/></w:num>' in nx
m = re.search(r'<w:abstractNum w:abstractNumId="7">.*?</w:abstractNum>', nx)
proto = re.sub(r'<w:pStyle w:val="ListNumber"/>', '', m.group(0))
absn = ''.join(
    re.sub(r'<w:tmpl w:val="[0-9A-F]+"/>', f'<w:tmpl w:val="6D{i:06X}"/>', re.sub(r'<w:nsid w:val="[0-9A-F]+"/>', f'<w:nsid w:val="5C{i:06X}"/>',
           proto.replace('w:abstractNumId="7"', f'w:abstractNumId="{i}"')))
    for i in num_ids)
last_abs = nx.rindex('</w:abstractNum>') + len('</w:abstractNum>')
nx = nx[:last_abs] + absn + nx[last_abs:]
nums = ''.join(f'<w:num w:numId="{i}"><w:abstractNumId w:val="{i}"/></w:num>' for i in num_ids)
last = nx.rindex('</w:num>') + len('</w:num>')
nx = nx[:last] + nums + nx[last:]
open(num_path, 'w', encoding='utf-8').write(nx)

core_path = f'{UN}/docProps/core.xml'
cx = open(core_path, encoding='utf-8').read()
cx = cx.replace('<dc:title/>', '<dc:title>Chat App — Project Specification</dc:title>')
cx = re.sub(r'(<dcterms:modified[^>]*>)[^<]*', r'\g<1>2026-10-15T00:00:00Z', cx)
cx = cx.replace('<cp:revision>1</cp:revision>', '<cp:revision>2</cp:revision>')
open(core_path, 'w', encoding='utf-8').write(cx)

print(f'{len(body)} blocks, {len(num_ids)} numbered lists')

with zipfile.ZipFile(OUTPUT, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _dirs, files in os.walk(UN):
        for name in files:
            full = os.path.join(root, name)
            arc = os.path.relpath(full, UN)
            # [Content_Types].xml first, as Word expects
            z.write(full, arc)
shutil.rmtree(UN)
print(f'Wrote {os.path.normpath(OUTPUT)}')
