# Thread Buddies

A private, friends-only chat app (React + TypeScript + Vite, Supabase). The
developer is building it to learn WebSockets, relational database design,
auth and secure architecture; Claude is the implementation partner.

**Start every session by reading `docs/PROGRESS.md`.** It records what's done,
what's live, the decisions, the open items and the plan for the next
milestone. Update it at the end of each milestone.

Source of truth for product rules and the data model:
`Chat_App_Project_Specification.docx` (generated; see below). UI mockups:
`design/` (look there before building any screen).

## Working rules

- Work in the spec's milestones. Before coding a milestone, present its plan
  (scope, data model changes, security risks, tests, acceptance checklist,
  concepts to learn) and **wait for approval**. Don't build the whole app at
  once.
- Explain the reasoning, not just the code. The developer wants to understand
  each choice.
- **Never commit or push unless asked.** When asked: commit on the milestone
  branch, fast-forward `main`, push `main`, delete the merged branch. Never
  commit `.env*` files. Name commits by the feature added (e.g. "Profile
  picture functionality and upload"), not the milestone number; the body can
  say which milestone it belongs to. **No `Co-Authored-By` (or
  any Claude attribution) lines in commits or PR descriptions**; the
  developer is the sole author.
- **Ask before touching the hosted Supabase project** (`supabase db push`,
  auth or SMTP settings). Test migrations locally first.
- Enforce rules in the database (constraints, RLS, column grants,
  security-definer functions with `search_path = ''`); the UI only mirrors
  them for instant feedback.
- Design: font Manrope, accent `#f55252`, blacks/whites from the tokens in
  `src/index.css`. New screens match `design/sign-in.png`.

## Commands

```sh
npm run dev          # app at http://localhost:5173, against the local stack
npm run build        # type-check + production build (hosted project env)
npm run lint         # Oxlint
npm test             # Vitest unit tests
npm run test:e2e     # headless-Chrome walk-through (needs dev stack + Chrome)
npm run db:start     # local Supabase in Docker (Docker must be running)
npm run db:reset     # rebuild local DB from migrations
npm run db:test      # pgTAP tests in supabase/tests/database
npm run db:race      # two-session concurrency checks (friend requests, conversations)
npm run db:realtime  # Realtime delivery and private channels vs RLS, real users
npm run db:types     # regenerate src/lib/database.types.ts after migrations
npm run spec:build   # regenerate the spec .docx from scripts/spec/build_spec.py
```

Before reporting a milestone done, run build, lint, `npm test`, `db:test`,
`db:race` and `db:realtime` when the friend, message or channel rules
changed, and `test:e2e` when screens changed.

## Gotchas

- Use `npx supabase …` (CLI is a dev dependency) and append `< /dev/null`;
  some commands hang waiting on stdin. Use `git --no-pager`.
- After editing `supabase/config.toml`: `npx supabase stop && npx supabase start`,
  then `npm run db:reset`.
- Never `await` Supabase calls inside `onAuthStateChange` (deadlock).
- Edit the spec only via `scripts/spec/build_spec.py`, never the `.docx`
  directly.
