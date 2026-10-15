# Thread

A private, friends-only chat app built with React, TypeScript, Vite and Supabase.
The plan, rules and data model are in `Chat_App_Project_Specification.docx`; UI
mockups are in `design/`; progress and next steps are in `docs/PROGRESS.md`.

## Requirements

- Node.js and npm
- Docker Desktop (running) for the local Supabase stack

## Setup

```sh
npm install
npm run db:start      # starts local Supabase in Docker and applies all migrations
```

`db:start` prints the local API URL and publishable key. Put them in
`.env.development.local` (see Environment below), then:

```sh
npm run dev
```

## Environment

There are two Supabase environments, and Vite picks the file by mode:

| File | Used by | Points at |
|---|---|---|
| `.env.development.local` | `npm run dev` | local stack (`http://127.0.0.1:54321`) |
| `.env.production.local` | `npm run build` / `npm run preview` | hosted project |

Both files are git-ignored and contain:

```sh
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Only the publishable key belongs in the frontend. Never put the secret
(service-role) key in these files or in the repository.

## Database

Schema changes are SQL migrations in `supabase/migrations`, applied in order.
Migrations only move forward: to undo something, write a new migration.

```sh
npx supabase migration new <name>   # create a migration file
npm run db:reset                    # rebuild the local database from all migrations
npm run db:test                     # run pgTAP tests in supabase/tests
npm run db:types                    # regenerate src/lib/database.types.ts
npx supabase db push                # apply new migrations to the hosted project
```

Test new migrations locally (`db:reset` + `db:test`) before pushing them.

While the local stack runs:

- Studio (database dashboard): http://127.0.0.1:54323
- Mailpit (catches every email the local stack sends, including sign-up
  confirmations): http://127.0.0.1:54324

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server against the local stack |
| `npm run build` | Type-check, then production build into `dist/` |
| `npm run typecheck` | Type-check only |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Headless-Chrome walk-through of the auth flow (needs the local stack and Google Chrome) |
| `npm run spec:build` | Regenerate the spec `.docx` from `scripts/spec/build_spec.py` |
| `npm run lint` | Oxlint |
| `npm run db:stop` | Stop the local stack |
