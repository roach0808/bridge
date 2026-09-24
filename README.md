# Silver Horizon

*Connecting Expertise. Expanding Perspective.* (The code keeps its original `god` package names.)

Real-time, role-based coordination of expert-consultation **Calls**, from scheduling through execution to invoicing. Everyone sees each other only by nickname and role.

The spec is [docs/SPEC.md](docs/SPEC.md).

| | |
|---|---|
| **API** | Node 22 · Express 5 · Prisma 6 · PostgreSQL 16 · Socket.IO 4 · Zod · argon2id + JWT with rotating refresh tokens |
| **Web** | React 19 · Vite · Material UI 7 (light/dark, CSS variables) · TanStack Query 5 · React Router 7 · Luxon |
| **Shared** | `@god/shared` holds the status workflow, transition rules, Zod schemas, DTO types and the recurrence engine. `@god/api-client` is a typed fetch and socket client with no browser globals, so the mobile app can reuse it |
| **Tests** | Vitest (1466 shared unit tests) · Supertest (389 API tests on `god_testsuite`) · Playwright (end-to-end workflow with a live observer) |

## Quick start

```bash
pnpm install
docker compose up -d                      # Postgres 16 on :5432 (creates god and god_testsuite)
cp apps/api/.env.example apps/api/.env
pnpm --filter api db:migrate              # prisma migrate deploy (includes the raw SQL constraints)
pnpm --filter api db:seed                 # founder, managers, associates, experts, platforms, profiles, calls
pnpm dev                                  # api on :4000, web on :5173 (Vite proxies /api and /socket.io)
```

**Hosted Postgres (Aiven or similar).** Create a dedicated database (for example `god`) on the service and set `DATABASE_URL` in `apps/api/.env` with `?sslmode=require&connection_limit=5&pool_timeout=20`. Keep the pool well under the service's connection limit. `btree_gist` must be available; the migration creates it. API tests always run against a *local* `god_testsuite` database and refuse to run against a remote host.

Open http://localhost:5173. Every seeded account uses the password `Password123!`:

| Role | Accounts |
|---|---|
| Founder | `founder@god.local` |
| Manager | `atlas@god.local` (pixel, sprout) · `beacon@god.local` (mango, comet) |
| Associate | `pixel@` · `sprout@` · `mango@` · `comet@` |
| Expert | `ember@` (Seoul) · `flint@` (London) · `quill@` (New York) |

## Commands

| Command | What it does |
|---|---|
| `pnpm typecheck` | Strict TypeScript across every package |
| `pnpm --filter @god/shared test` | Transition matrix, recurrence and DST expansion, block validation, edit scopes |
| `pnpm --filter api test` | API integration tests; they refuse to run against a non-local database |
| `pnpm --filter web e2e` | Playwright: Associate schedules → Expert finishes → Founder invoices while a Manager watches live; an Expert adds time off; the Founder creates a user, approves a profile and adds a bank from the pending tasks; a user uploads a photo. Needs the dev stack running, and changes data (reseed afterwards) |
| `pnpm --filter api build` / `pnpm --filter web build` | Production bundles |
| `docker compose -f docker-compose.prod.yml up -d --build` | Single-host deployment: Postgres + API + nginx serving the SPA |

## Layout

```
apps/api            Express + Socket.IO server
  prisma/           schema, migrations (incl. exclusion/check constraints, ends_at trigger, avatar catalog), seed
  src/auth          login, refresh rotation with reuse detection, role guards
  src/calls         access rules, service (locking, transitions, notifications), routes, messages
  src/calendar      calendar privacy (calls vs busy), schedule blocks with this/following/all edits
  src/notifications notify() is the single entry point: DB row + socket + Expo push adapter
  src/realtime      socket auth, call rooms, per-viewer call:updated broadcasts
  test/             Supertest suites + anonymity guard on every response
apps/web            React + MUI app
  src/pages/calls     dashboard cards, list, detail (transitions, thread, history), new call form
  src/pages/calendar  day/week/month, all-experts columns, time off editor, extra clocks
  src/pages/admin     profiles, platforms, team, users, invoicing, notifications, settings
  e2e/                Playwright workflow test
packages/shared     workflow rules, schemas, types, recurrence engine (+ tests)
packages/api-client typed client used by web (and the future Expo app)
```

## Design notes

- **One rule table.** `packages/shared/src/callTransitions.ts` drives server enforcement, the `allowedTransitions` and `permissions` sent with every Call, and which buttons the web app shows.
- **Defense in depth.** The database enforces what matters most: the `calls_expert_no_overlap` GiST exclusion constraint prevents double booking, check constraints cover required fields, durations, and expert-before-scheduled, and a trigger keeps `ends_at`. The API checks the same things first so it can return clear 400/409 responses.
- **Anonymity.** Only `/me` ever selects `email`. Serializers select just `id`, `nickname`, `role` and `avatarId` for other users. A test guard fails if any fixture email appears in any other response.
- **Real time.** Transitions commit first (row lock, history, notifications in one transaction), then each participant gets a `call:updated` payload computed for them, because `allowedTransitions` differs per viewer.
- **Time.** Everything is stored and sent in UTC. Experts see their own IANA zone; everyone else sees New York team time. Availability rules are wall-clock rules expanded per zone, so they stay correct across DST.
- **Sessions.** Access tokens last 15 minutes. Refresh tokens last 30 days, are stored hashed and rotated on every use, and reusing one revokes the whole token family. The web app keeps the refresh token in an httpOnly cookie; mobile passes it in the request body. Deactivating a user revokes their tokens and disconnects their sockets.
