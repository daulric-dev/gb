---
sidebar_label: Developer guide
sidebar_position: 1
---

# Developer guide

Clone to running locally, then running locally to deployed. This is the path; the reference docs it links to are the detail.

The platform is four workspaces in one Bun/Turborepo monorepo, all talking to one Postgres database through the API:

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
- **Docker**, running. Postgres, Redis, S3 storage and the mail catcher run as containers from `docker-compose.dev.yml`.

You do **not** need any hosted service to develop. The local stack is a complete one.

> **TypeScript is pinned to 6 across the repo, deliberately.** TypeScript 7.0 is the native port: it ships the `tsc` executable only, without the programmatic compiler API. Two things in this stack need that API and fail without it - the Nest CLI and its `@nestjs/swagger` plugin (half the DTOs carry no `@ApiProperty` and depend on the plugin for their schemas), and `typescript-eslint`, which refuses to load at all, taking `bun run lint` and CI with it. Both upstreams expect to support **7.1**. The root pin matters as much as the workspace ones, because `@nestjs/swagger` resolves `typescript` from the hoisted copy rather than the workspace's - pinning only `backend/` is not enough.
>
> `mobile/` is also pinned by Expo rather than by us: `bunx expo install --fix` sets every React Native package to the version its SDK was built against. Upgrading them independently produces a native-runtime mismatch, not just type errors.

### 1. Install

```bash
bun install
```

Installs every workspace at once. Do not run `bun install` inside a workspace - it is one lockfile for the repo.

### 2. Configure

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

The defaults match `docker-compose.dev.yml` - nothing to fill in for local development. The frontend's default (`NEXT_PUBLIC_API_URL=http://localhost:3001`) is already right.

Mobile needs nothing: with `EXPO_PUBLIC_API_URL` unset it derives the API host from the Expo dev server it loaded from, so it follows your machine's address and survives a new DHCP lease.

### 3. Start the infrastructure and apply the schema

```bash
bun run preload
```

Starts four containers from `docker-compose.dev.yml` and waits for them to be healthy, then runs `bun run db:setup` (`prisma migrate deploy`), which applies every migration in `backend/prisma/migrations/` that the database has not seen. First run pulls images and takes a minute or two.

| Service | Address | What for |
| --- | --- | --- |
| `db` - Postgres 17 | `127.0.0.1:5432` (`gradebook` / `gradebook`) | The database (`DATABASE_URL`) |
| `redis` | `127.0.0.1:6379` | Cache, queue, chat pub/sub |
| `s3` - SeaweedFS | `http://127.0.0.1:8333` | File storage (`S3_*`) |
| `mailpit` | SMTP `127.0.0.1:1025`, inbox `http://127.0.0.1:8025` | Catches every outgoing email |

Login is a one-time emailed code, so in development you read that code out of Mailpit at `http://127.0.0.1:8025`. Nothing is sent to a real address. `bun run db:studio` opens Prisma Studio, a database browser.

Run `bun run db:setup` again whenever you pull new migrations.

### 4. Run

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

### 5. Sign in

Open `http://localhost:3000`, enter any email address - it does not have to exist - then read the 8-digit code out of Mailpit at `http://127.0.0.1:8025`.

For demo data, run `bun run seed:demo` with the API up (it signs in through the dev-only `POST /auth/dev/code`, enabled by `ALLOW_DEV_LOGIN=true` in `backend/.env`). `bun run smoke` checks the API end to end.

### Stopping

```bash
bun run postload
```

Stops the containers. Your data survives in Docker volumes; `docker compose -f docker-compose.dev.yml down -v` wipes it (then `bun run preload` recreates the schema).

---

## Part 2 - The variables

Full reference with every variable and its failure mode: **[Environment variables](./environment-variables.md)**. What follows is the shape of it and the ones that bite.

### Who holds what

**Backend** (`backend/.env`) - all the secrets. `DATABASE_URL`, the `S3_*` values and `SMTP_URL` connect it to its services. `AUTH_SECRET`, `CHAT_ENCRYPTION_KEY` and `STUDENT_CLAIM_CODE_PEPPER` are optional in development and **required in production**: the app refuses to start without them rather than silently storing plaintext messages or unhashed claim codes. Generate each with `openssl rand -base64 32`.

**Frontend** (`frontend/.env.local`) - `NEXT_PUBLIC_API_URL`, and nothing else that matters. Anything `NEXT_PUBLIC_*` is **baked into the browser bundle at build time** and is public. Never put a secret behind that prefix.

**Mobile** (`mobile/.env`) - `EXPO_PUBLIC_API_URL`, unset in development, required for a release build. Same rule: `EXPO_PUBLIC_*` is inlined at build time and public.

**Docs** - `DOCS_BASE` only, and only if you serve the site somewhere other than `/gb/`.

### The three that cause silent failures

These are worth reading twice, because each one fails in a way that does not point at itself.

**`AUTH_COOKIE_DOMAIN` must cover the API's own host and the web app's** in production. The session is one opaque HttpOnly cookie, `gb_session`, set by the API; the web proxy only checks that it is present, so it must be sent to the frontend's host too. If the domain does not cover the API, the client rejects the cookie and every request after login is unauthenticated, with no error naming the cookie. The check that proves it: sign in, restart the app, and see whether you are still signed in.

**`S3_PUBLIC_ENDPOINT` must be reachable from browsers and phones**, and the bucket needs a CORS rule for every `FRONTEND_URL` origin. Uploads go straight from the client to the store with presigned URLs; if either is wrong, every upload fails in the browser while server-side reads keep working. See [Bucket CORS](./platform-migration.md#bucket-cors-production).

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

Schema changes are Prisma Migrate migrations in `backend/prisma/migrations/` (see `backend/prisma/schema/README.md`). The backend image applies pending ones when it starts (`prisma migrate deploy`, under an advisory lock, so replicas starting together are safe). To run them as a separate release step instead, set `MIGRATE_ON_START=false` and run:

```bash
DATABASE_URL=postgresql://... bun run db:deploy
# or, with the production Compose file:
docker compose --profile release run --rm migrate
```

There is no migration step in CI.

### Backend

`infrastructure/Dockerfile` builds it: a multi-stage Bun image that installs the workspace, runs `turbo run build --filter=backend` (which runs `prisma generate` first; no database needed), and ships only the backend. Its start command applies pending migrations, then starts the API.

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

bun run db:setup         # apply pending migrations (prisma migrate deploy)
bun run db:migrate --name <change>  # create + apply a migration from .prisma edits
bun run db:pull          # introspect the database into the .prisma files
bun run db:studio        # Prisma Studio
bun run seed:demo        # demo school (API running); --fresh to replace it
bun run smoke            # end-to-end API check (API running)

bun run gb <command>     # repo CLI - status, commit, branch, PR
```

**The Prisma client is generated, not committed** (`backend/src/generated/prisma`). `bun install`, `bun test` and `build` regenerate it, and `db:migrate` does too; after pulling someone else's schema change, `bun run db:setup` applies it and `bun install` (or `bunx prisma generate` in `backend/`) refreshes the client.

### Testing

`bun test` in `backend/` runs the suite (345 tests). Note that **`bun test` does not typecheck**, and the backend build excludes test files - so a test file can have type errors that neither one catches. `npx tsc --noEmit` in the workspace is what finds those.

---

## Where things live

| | |
| --- | --- |
| `backend/prisma/schema/` | Prisma schema, one file per database schema. |
| `backend/prisma/migrations/` | Migrations, in order (`0_baseline` is the whole schema). Never edit an applied migration; add another. |
| `backend/src/<module>/` | One folder per domain, NestJS convention. |
| `frontend/app/` | Next.js App Router. `dashboard/` is staff, `portal/` is students. |
| `mobile/app/` | Expo Router. `(auth)`, `(tabs)` staff, `(portal)` students. |
| `docs/content/` | This site. A new `.md` file appears in the sidebar automatically. |
| `infrastructure/` | Dockerfile, nginx config, Compose. See the caveat above. |

Deeper reference: **[Implementation guide](./implementation-guide.md)** for the database and every API route.

## Things that will confuse you once

- **Some joins across schemas are still done in JavaScript.** The database has several schemas, and code written before Prisma joined them by hand; it still works, so not all of it has been folded into one query.
- **All authorisation is in the API.** The API connects as the schema owner and there is no row-level security; guards and service code are the only access rules, so every new query must scope itself to the caller's school and role.
- **The docs sidebar is built at compile time** from each file's frontmatter, by a Vite plugin. Add a `.md` under `docs/content/` and it appears; there is no sidebar file to edit.
- **`bun run preview` is not `bun run dev`.** It builds and serves production bundles, which is where build-time-inlined variables show their real values.
