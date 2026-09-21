---
sidebar_label: Developer guide
sidebar_position: 1
---

# Developer guide

Clone to running locally, then running locally to deployed. This is the path; the reference docs it links to are the detail.

The platform is four workspaces in one Bun/Turborepo monorepo, all talking to one Supabase project:

| Workspace | What it is | Dev port | Deploys to |
| --- | --- | --- | --- |
| `backend/` | NestJS 12 on Fastify | 3001 | A container you host |
| `frontend/` | Next.js 16 | 3000 | Vercel |
| `mobile/` | Expo / React Native | 8081 (Metro) | EAS → App Store / Play |
| `docs/` | Vite + react-markdown (this site) | 3002 | GitHub Pages |

The backend is the only thing that holds secrets. The web and mobile clients talk to it over HTTP and hold none, which is why their variable lists are three lines long and the backend's is not.

---

## Part 1 - Getting it running

### Prerequisites

- **Bun 1.3.13** - the version in `packageManager`. Other 1.x versions generally work; that one is what CI and the Docker image use.
- **Docker**, running. Supabase's local stack is containers.
- **Supabase CLI** - no install needed, `bunx supabase` fetches it.

You do **not** need a hosted Supabase project to develop. The local stack is a complete one.

> **TypeScript is pinned to 6 across the repo, deliberately.** TypeScript 7.0 is the native port: it ships the `tsc` executable only, without the programmatic compiler API. Two things in this stack need that API and fail without it - the Nest CLI and its `@nestjs/swagger` plugin (half the DTOs carry no `@ApiProperty` and depend on the plugin for their schemas), and `typescript-eslint`, which refuses to load at all, taking `bun run lint` and CI with it. Both upstreams expect to support **7.1**. The root pin matters as much as the workspace ones, because `@nestjs/swagger` resolves `typescript` from the hoisted copy rather than the workspace's - pinning only `backend/` is not enough.
>
> `mobile/` is also pinned by Expo rather than by us: `bunx expo install --fix` sets every React Native package to the version its SDK was built against. Upgrading them independently produces a native-runtime mismatch, not just type errors.

### 1. Install

```bash
bun install
```

Installs every workspace at once. Do not run `bun install` inside a workspace - it is one lockfile for the repo.

### 2. Start the infrastructure

```bash
bun run preload
```

Two things: Redis (via `infrastructure/docker-compose.yml`) and the local Supabase stack. First run pulls images and takes a few minutes.

When Supabase finishes it prints a block of URLs and keys. **Keep it** - the next step needs four values from it. To see it again later, `bunx supabase status`.

| Printed as | Goes into |
| --- | --- |
| `API URL` | `SUPABASE_URL` |
| `service_role key` | `SUPABASE_SERVICE_ROLE_KEY` |
| `anon key` | `SUPABASE_PUSHABLE_KEY` |
| `JWT secret` | `SUPABASE_JWT_SECRET` |

Two of those URLs matter every day: **Studio** at `http://127.0.0.1:54323` is the database browser, and the **mail catcher** at `http://127.0.0.1:54324` holds every outgoing email (Inbucket on older CLI versions, Mailpit on newer - same port either way; `supabase status` prints whichever you have). Login is a one-time emailed code, so in development you read that code out of the mail catcher. Nothing is sent to a real address.

### 3. Configure

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Fill the four Supabase values into `backend/.env`. The frontend's default (`NEXT_PUBLIC_API_URL=http://localhost:3001`) is already right.

Mobile needs nothing: with `EXPO_PUBLIC_API_URL` unset it derives the API host from the Expo dev server it loaded from, so it follows your machine's address and survives a new DHCP lease.

### 4. Apply the schema

```bash
bunx supabase db reset
```

Runs every migration in `supabase/migrations/` against the local database from scratch. Do this on first setup and whenever you pull migrations.

### 5. Run

```bash
bun run dev
```

This is `turbo run dev start:dev`, and it starts **all four** workspaces - frontend `:3000`, backend `:3001`, docs `:3002` and Expo's Metro bundler. That is more than most tasks need, and Metro in particular is noisy. Usually you want one or two:

```bash
bun run dev:backend    # :3001
bun run dev:frontend   # :3000
bun run dev:mobile     # Metro on :8081
bun run dev:docs       # :3002
```

Check the API is up with `curl localhost:3001/health`. Swagger is at `http://localhost:3001/docs` - note there is no `/api` prefix on it, because it is mounted before `setGlobalPrefix('api')`, and that it is **not served in production** (`NODE_ENV !== 'production'` gates it). Every other route does carry the `/api` prefix.

### 6. Sign in

Open `http://localhost:3000`, enter any email address - it does not have to exist - then read the 8-digit code out of the mail catcher at `http://127.0.0.1:54324`.

### Stopping

```bash
bun run postload
```

Stops Redis and Supabase. Your database survives; `supabase db reset` is what wipes it.

---

## Part 2 - The variables

Full reference with every variable and its failure mode: **[Environment variables](./environment-variables.md)**. What follows is the shape of it and the ones that bite.

### Who holds what

**Backend** (`backend/.env`) - all the secrets. Four Supabase values are required to boot. `CHAT_ENCRYPTION_KEY` and `STUDENT_CLAIM_CODE_PEPPER` are optional in development and **required in production**: the app refuses to start without them rather than silently storing plaintext messages or unhashed claim codes. Generate each with `openssl rand -base64 32`.

**Frontend** (`frontend/.env.local`) - `NEXT_PUBLIC_API_URL`, and nothing else that matters. Anything `NEXT_PUBLIC_*` is **baked into the browser bundle at build time** and is public. Never put a secret behind that prefix.

**Mobile** (`mobile/.env`) - `EXPO_PUBLIC_API_URL`, unset in development, required for a release build. Same rule: `EXPO_PUBLIC_*` is inlined at build time and public.

**Docs** - `DOCS_BASE` only, and only if you serve the site somewhere other than `/gb/`.

### The four that cause silent failures

These are worth reading twice, because each one fails in a way that does not point at itself.

**`SUPABASE_SERVICE_ROLE_KEY` must be the JWT**, starting `eyJ`. A `sb_secret_...` key is accepted by PostgREST and rejected by the edge function gateway. Everything works except the dashboard, class reports, attendance summaries and file ingest - which look like four unrelated bugs.

**`AUTH_COOKIE_DOMAIN` must cover the API's own host** in production. If it does not, the client rejects the cookie and every request after login is unauthenticated, with no error naming the cookie. The check that proves it: sign in, restart the app, and see whether you are still signed in.

**`SUPABASE_JWT_SECRET` must belong to the same project as `SUPABASE_URL`.** If not, every file upload fails at Storage. Note that this secret signs a real `authenticated` user token, so it is not scoped to uploads - treat it as a full credential.

**`NODE_ENV=production` marks the auth cookie `Secure`**, so the API must be served over HTTPS or the cookie is never stored at all.

---

## Part 3 - Deploying

Four independent targets. Nothing deploys the whole platform in one step, and they can move at different speeds - but the database migration always goes first.

### Order

1. **Migrations** - additive changes first, so the running backend tolerates both shapes.
2. **Backend** - the API everything else talks to.
3. **Frontend** and **mobile** - in either order.
4. **Docs** - whenever.

### Database

```bash
bunx supabase link --project-ref <ref>
bunx supabase db push
```

`db push` applies pending migrations to the linked project. Review with `supabase db diff` first. There is no automated migration step in CI - this is deliberate and manual.

Edge functions deploy separately and are not covered by `db push`: see **[Edge functions](./edge-functions.md)**.

### Backend

`infrastructure/Dockerfile` builds it: a multi-stage Bun image that installs the workspace, runs `turbo run build --filter=backend`, and ships only the backend.

```bash
docker build -f infrastructure/Dockerfile -t gb-backend .
docker run --env-file infrastructure/.env -p 3001:3001 gb-backend
```

Configure it from `infrastructure/env.example`, not `backend/.env.example` - Compose supplies `PORT`, `USE_REDIS` and `REDIS_URL` itself, so the infrastructure file leaves them out.

`/health` is the readiness endpoint, and the container healthcheck already uses it.

> **`infrastructure/docker-compose.yml` does not run the application.** It brings up Redis only. It defines `x-app` and `x-app-env` anchors for API replicas, but no service uses them, and `infrastructure/nginx/default.conf` load-balances to `app1:3004`, `app2:3005` and `app3:3006` - hosts nothing defines. The Dockerfile, the nginx config and the Compose file are three-quarters of a stack, not a working one. CI builds the image (`infrastructure.yml`) but never pushes or deploys it. Treat the image as the deliverable and bring your own orchestration until those services are written.

If you run more than one replica, set `USE_REDIS=true` and point every replica at the same `REDIS_URL`. Without it the cache and chat pub/sub are in-process, and replicas will not see each other's invalidations or messages.

### Frontend → Vercel

Deploys from Vercel's own Git integration; CI reports lint status to it via `vercel/repository-dispatch`. There is no deploy step in this repo.

Set `NEXT_PUBLIC_API_URL` in the Vercel project's environment variables - it is compiled into the bundle, so **changing it needs a rebuild, not a restart**. Whatever origin Vercel serves must also appear in the backend's `FRONTEND_URL` list, or the browser is blocked by CORS.

### Mobile → EAS

```bash
eas build --profile preview    --platform ios
eas build --profile production --platform all
```

`mobile/eas.json` defines `development`, `preview` and `production`. `EXPO_PUBLIC_API_URL` is present but **empty** in the two release profiles, deliberately: a placeholder host would build an app that points confidently at the wrong server, whereas an empty value makes the app throw on launch with a message naming the variable. Fill it in, or set it as an EAS environment variable, before building.

Full checklist: **[Mobile in production](./mobile-production.md)**.

Before any release build, run `bunx expo install --check`. Mobile's dependency versions are set by the Expo SDK, not by what is newest - the native modules have to match the runtime the SDK was built against. If it reports drift, `bunx expo install --fix` puts every package back to the version Expo expects.

### Docs → GitHub Pages

Automatic. `.github/workflows/docs.yml` typechecks, builds and deploys on every push to `main` touching `docs/**`. `DOCS_BASE` defaults to `/gb/`; set it if you serve from a custom domain or a differently-named repository.

### Single-school instances

`DEDICATED_DEPLOYMENT=true` (and `NEXT_PUBLIC_DEDICATED_DEPLOYMENT=true`) pins an instance to one school and skips school selection. See **[Dedicated deployment](./dedicated-deployment.md)**.

---

## Everyday commands

```bash
bun run dev              # frontend + backend
bun run build            # every workspace, cached by Turbo
bun run test             # every workspace
bun run preview          # production-mode builds locally
bun run lint             # typecheck everything

bun run db:start         # Supabase only, without Redis
bun run db:stop
bun run db:types         # regenerate backend/src/types/database.types.ts
bun run db:diff -- <name>  # capture local schema changes as a migration

bun run gb <command>     # repo CLI - status, commit, branch, PR
```

**Run `db:types` after every migration.** The generated types are committed, and a schema change without them gives you a backend that compiles against a database it no longer matches.

### Testing

`bun test` in `backend/` runs the suite (345 tests). Note that **`bun test` does not typecheck**, and the backend build excludes test files - so a test file can have type errors that neither one catches. `npx tsc --noEmit` in the workspace is what finds those.

---

## Where things live

| | |
| --- | --- |
| `supabase/migrations/` | Schema, in order. Never edit an applied migration; add another. |
| `supabase/functions/` | Edge functions - report summaries, analytics, file ingest. |
| `backend/src/<module>/` | One folder per domain, NestJS convention. |
| `frontend/app/` | Next.js App Router. `dashboard/` is staff, `portal/` is students. |
| `mobile/app/` | Expo Router. `(auth)`, `(tabs)` staff, `(portal)` students. |
| `docs/content/` | This site. A new `.md` file appears in the sidebar automatically. |
| `infrastructure/` | Dockerfile, nginx config, Compose. See the caveat above. |

Deeper reference: **[Implementation guide](./implementation-guide.md)** for the database, RLS policies and every API route.

## Things that will confuse you once

- **PostgREST will not follow a foreign key across a schema boundary.** The database has seven schemas; joins between them are done in JavaScript, not in the query. This is why some services look like they are doing the database's job by hand.
- **Two Supabase clients, and the difference is authorisation.** The service client bypasses RLS and is authorised by application code; the user client runs as the caller under RLS. Which one a service uses tells you where its access rules live.
- **The docs sidebar is built at compile time** from each file's frontmatter, by a Vite plugin. Add a `.md` under `docs/content/` and it appears; there is no sidebar file to edit.
- **`bun run preview` is not `bun run dev`.** It builds and serves production bundles, which is where build-time-inlined variables show their real values.
