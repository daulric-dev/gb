# Infrastructure services and how the backend uses them

This page explains every service in the two Compose files and exactly what the
backend (`backend/src`) does with each one: which module talks to it, what it
stores, what breaks without it, and which environment variables wire it up.

| File | Purpose |
| --- | --- |
| [`infrastructure/docker-compose.yml`](./docker-compose.yml) | Production / staging: the API image's release step, Redis, the database backup sidecar, and an optional Postgres (with continuous backup) for a single box |
| [`docker-compose.dev.yml`](../docker-compose.dev.yml) (repo root) | Local development: Postgres, Redis, S3 (SeaweedFS) and Mailpit |

The API itself is built from [`infrastructure/Dockerfile`](./Dockerfile) and run
by the hosting platform (it starts with `bun dist/src/main`). See
[The API container](#the-api-container) below.

## At a glance

| Service | Image | Dev compose | Prod compose | Required? | Backend code that uses it |
| --- | --- | --- | --- | --- | --- |
| [Postgres](#postgres-db) | `postgres:18.6-alpine` (prod: + WAL-G, `infrastructure/postgres/`) | `db` (+ optional `db-walg`, profile `walg`) | `db` + `db-backup` (commented out; use a managed Postgres) | **Yes** | `src/prisma/` (every module), billing advisory locks |
| [Redis](#redis-redis) | `redis:7.4-alpine` | `redis` | `redis` | Optional for one instance, **yes** for more than one | `src/cache/`, `src/realtime/`, `src/queue/` |
| [S3 object storage](#s3-object-storage-s3) | `chrislusf/seaweedfs:4.48` | `s3` | not included (use any S3 provider) | **Yes** | `src/storage/` → `src/file-manager/`, `src/images/` |
| [Mailpit / SMTP](#mailpit--smtp-mailpit) | `axllent/mailpit:v1.27` | `mailpit` | not included (use any SMTP server) | **Yes** (sign-in sends email) | `src/mail/` → `src/account/email-code.service.ts` |
| stripe-mock | `stripe/stripe-mock:v0.206.0` | `stripe-mock` | - | Dev/tests only | `src/billing/providers/stripe.provider.ts` via `STRIPE_API_BASE` (see `backend/src/billing/STRIPE.md`) |
| [migrate](#migrate-release-step) | the API image | - | `migrate` (profile `release`) | Only with `MIGRATE_ON_START=false` | `backend/prisma/migrations/` |
| [backup](#database-backups-backup-db-backup) | `infrastructure/backup/` (Postgres 18 client, age, rclone, supercronic) | `backup` (profile `backup`) | `backup` (runs by default) | **Yes** in production | None: reads the database, writes an S3 bucket |

Everything the API needs is configured through environment variables. The full
list is in [`docs/content/environment-variables.md`](../docs/content/environment-variables.md);
the production template is [`infrastructure/env.example`](./env.example).

---

## Postgres (`db`)

**What it is.** The only database: every school, user, course, mark, file record,
chat message, notification and billing row lives here.

**How the backend connects.**

- `DATABASE_URL` (e.g. `postgresql://gradebook:gradebook@127.0.0.1:5432/gradebook`).
- `src/prisma/prisma.service.ts` creates one Prisma 7 client with the
  `@prisma/adapter-pg` driver (a `pg` connection pool). It is a global Nest
  module, so every service gets it by injection.
- The schema is split by Postgres schema under `backend/prisma/schema/`:
  `public` (schools, profiles, roles, years, terms, announcements, email
  domains), `account` (users, sessions, sign-in codes, SSO identities),
  `course`, `grading`, `student`, `file_manager`, `chat` and `billing`.

**What uses it beyond plain queries.**

| Feature | Where | Why it matters for the database |
| --- | --- | --- |
| Quiz scoring | SQL function `grading.submit_quiz` | Scores a submission under a row lock |
| School join codes | SQL function `public.redeem_school_join_code` | Called by `src/student-account/` |
| Student duplicates / merge | SQL functions `merge_student_records`, `student_duplicate_candidates` | Called by `src/student/` |
| Search | `pg_trgm` extension (created by the baseline migration in schema `extensions`) | Fuzzy name search |
| Billing sweeps | `pg_try_advisory_xact_lock` in `src/billing/billing.scheduler.ts` | Only one API replica runs the hourly billing sweep |
| Invoice numbers | `pg_advisory_xact_lock` in `src/billing/invoice.service.ts` | `GB-YYYYMM-<seq>` numbers for invoices recorded from Stripe never collide |

**Migrations.** Hand-written SQL in `backend/prisma/migrations/`, applied with
`prisma migrate deploy` (the container does this on start; see
[migrate](#migrate-release-step)). Never run `prisma migrate reset` or
`migrate dev` against a shared database. A fresh empty database is brought fully
up to date by `migrate deploy` alone.

**Compose details.**

- Dev: `db` publishes `127.0.0.1:5432` with user/password `gradebook`. Data is
  in the `db-data-18` volume. Postgres 18 images keep data in a versioned folder
  under `/var/lib/postgresql`, so the volume mounts that folder (not
  `/var/lib/postgresql/data` as on 17 and earlier).
- Prod: the `db` service is commented out because a managed Postgres is
  recommended. To run it on a single box, uncomment it, `db-backup` and the
  `db-data` volume, add `db: { condition: service_healthy }` to the app's
  `depends_on`, set `POSTGRES_PASSWORD` and the `WALG_*` variables, and point
  `DATABASE_URL` at `db:5432`. That `db` is built from
  [`infrastructure/postgres/`](./postgres/) (Postgres 18.6 Alpine + WAL-G) and
  archives every WAL segment for point-in-time recovery; see
  [Database backups](#database-backups-backup-db-backup).
- Supported versions: PostgreSQL 15 or newer; developed and tested on 18.6.

**If it is down.** The API cannot serve anything except `/health`. Requests
fail with 500s until the database is back; the pool reconnects on its own.

---

## Database backups (`backup`, `db-backup`)

Required for production (GDPR Art. 32 expects the ability to restore). Full
guide, GDPR notes and runbook: [`BACKUPS.md`](./BACKUPS.md).

| Service | Built from | What it does | Configured by |
| --- | --- | --- | --- |
| `backup` | [`infrastructure/backup/`](./backup/) | Every day at 04:00 (`BACKUP_SCHEDULE`, in `BACKUP_TZ`, default UTC): `pg_dump --format=custom` of `BACKUP_DATABASE_URL` (defaults to `DATABASE_URL`, managed or self-hosted), encrypted with age to `BACKUP_AGE_RECIPIENTS` before upload, stored as `<prefix>/daily/YYYY/MM/gradebook-<UTC timestamp>.dump.age` plus a `.sha256` in `BACKUP_S3_BUCKET`, then deletes dumps older than `BACKUP_RETENTION_DAYS` (30). Also provides `backup-now`, `backup-restore`, `backup-verify`, `backup-list`. | `BACKUP_*` |
| `db` (self-hosted) | [`infrastructure/postgres/`](./postgres/) | Postgres with `archive_mode=on`, `archive_command='wal-g wal-push %p'`, `archive_timeout=60s`: continuous, encrypted WAL archiving to `WALG_S3_PREFIX`. | `WALG_*` |
| `db-backup` (self-hosted) | same image, data volume read-only | WAL-G base backup at 04:00 (`WALG_BACKUP_SCHEDULE`), keeps `WALG_RETAIN_FULL` (7) = the point-in-time window. | `WALG_*` |

- **It fails loudly.** `backup` runs by default; without `BACKUP_S3_BUCKET` and
  `BACKUP_AGE_RECIPIENTS` it exits with the reason and keeps restarting. It
  never uploads unencrypted data (except with `BACKUP_ALLOW_UNENCRYPTED=true`,
  for development). Both sidecars have Docker health checks (unhealthy after 26
  hours without a successful backup, or while WAL archiving fails) and optional
  healthchecks.io-style pings.
- **Managed Postgres:** turn on the provider's point-in-time recovery; keep the
  `backup` service for an independent, encrypted copy outside the provider.
- **The age private key is never on the server.** Restores and verification run
  with the key supplied at that moment.
- **Dev:** `docker compose -f docker-compose.dev.yml --profile backup ...` runs the
  sidecar against the dev database and SeaweedFS (bucket `gradebook-backups`);
  `--profile walg` starts a separate WAL-G Postgres on `127.0.0.1:5433`. The
  default `db` service and its `db-data-18` volume are unchanged.
- **Not covered:** file contents in the app bucket (use bucket versioning),
  Redis, and the application secrets (keep old `CHAT_ENCRYPTION_KEYS` versions
  as long as backups are kept, or restored chat messages cannot be read).

---

## Redis (`redis`)

**What it is.** A shared, in-memory store used for four separate jobs. It is
turned on with `USE_REDIS=true` plus `REDIS_URL`
(prod: `redis://:${REDIS_PASSWORD}@redis:6379`, set in the compose file's
`x-app-env`; dev: `redis://127.0.0.1:6379`).

With Redis **off**, each feature falls back to an in-process version. That is
fine for one API instance, and wrong for more than one: caches, realtime events
and presence would only be seen by the instance that produced them.

### 1. Cache (`src/cache/`)

`CacheService` (global) picks `RedisStore` (Bun's `RedisClient`) when
`USE_REDIS=true`, else `MemoryStore`. Its main users:

| Cached thing | Module | Notes |
| --- | --- | --- |
| Signed-in session lookups (`session:<hash>`) | `src/account/session.service.ts` | Saves a database read on every authenticated request; deleted on sign-out |
| SSO sign-in state and mobile hand-off codes | `src/sso/sso.service.ts` | Short-lived (minutes); single use |
| Effective permissions per user and school | `src/permission/` | Invalidated when roles change |
| Billing entitlement (is the school read-only?) | `src/billing/subscription.service.ts` | Read by the billing interceptor on every write; ~60 s TTL, invalidated on any billing change |
| School, academic year, term, grade-scale, announcement and student lists | the matching modules | Invalidated on writes |
| Student portal guard lookups | `src/student-portal/student.guard.ts` | Maps a signed-in user to their student record |
| Auth helpers (profile, join requests) | `src/auth/auth.service.ts`, `src/email-domain/`, `src/student-account/` | |

### 2. Realtime pub/sub (`src/realtime/`)

`RedisPubSubService` holds two ioredis connections (publisher and subscriber)
built from `redisConnectionOptions()` in `src/realtime/redis.util.ts`. Any API
replica can publish an event and every replica delivers it to its own
Server-Sent Events (SSE) connections. Without Redis, events only reach clients
connected to the same instance.

| Channel | Published by | Delivered to |
| --- | --- | --- |
| Per-user chat channel | `src/chat/chat-realtime.service.ts` (new messages, edits, deletes, request answers) | That user's open chat stream (`GET /api/chat/stream`) |
| Attendance session channel | `src/attendance/attendance.realtime.ts` (`publishStaff`) | The teacher's live attendance view (`GET /api/courses/:courseId/attendance/sessions/:sessionId/stream`): check-ins as they happen |
| Per-user portal channel | `src/attendance/attendance.realtime.ts` (`publishPortal`) | Students' portal stream (`GET /api/portal/me/stream`): "attendance is open" banners |

### 3. Presence (`src/realtime/presence.service.ts`)

Who is online in each school, for chat. Uses a per-user connection counter
(`INCR`/`DECR`, 60 s TTL refreshed by heartbeats) and a per-school sorted set
of last-seen times. Called from `src/chat/chat.controller.ts` when a chat stream
opens, heartbeats and closes, and for `GET /api/chat/presence`.

### 4. Job queue (`src/queue/`)

With Redis on, `QueueModule` registers a BullMQ queue, **`file-share-notify`**,
and its worker (`FileShareNotifyProcessor`). When a file is shared
(`src/file-manager/file-share.service.ts`), the share id is queued; the worker
then notifies the recipients (in-app notification plus a chat message) with
retries and exponential backoff. With Redis off, the same handler runs inline
in the request (errors are logged, never returned to the caller).

### Not in Redis

- **Rate limiting** (`@nestjs/throttler`, configured in `src/app.module.ts`)
  uses its default in-memory storage, so limits are per API instance.
- Billing schedules use Postgres advisory locks, not Redis.

**Compose details.**

- Prod: no published port (only containers on `appnet` reach it),
  `--requirepass ${REDIS_PASSWORD}` (required; compose refuses to start
  without it), RDB snapshots every 60 s if anything changed, no AOF. Data is in
  the `redis-data` volume. Everything in Redis can be rebuilt (caches refill,
  presence and pub/sub are live state); only queued but unprocessed
  share-notify jobs would be lost if the volume were wiped.
- Dev: `127.0.0.1:6379`, no password (loopback only).

**If it is down.** Cache reads miss and fall through to Postgres, realtime
events and presence stop, and queued notifications wait until it returns
(ioredis reconnects with backoff). Sign-in and normal pages keep working.

---

## S3 object storage (`s3`)

**What it is.** Where file contents live. The database stores only each file's
metadata and its key; the bytes are in an S3-compatible bucket. In development
this is SeaweedFS; in production any S3 provider works (AWS S3, Cloudflare R2,
Backblaze B2, MinIO, DigitalOcean Spaces...).

**How the backend connects.** `src/storage/storage.service.ts` (global) wraps
the AWS SDK v3 S3 client:

| Variable | Purpose |
| --- | --- |
| `S3_ENDPOINT` | Provider endpoint (dev `http://127.0.0.1:8333`); unset for AWS |
| `S3_PUBLIC_ENDPOINT` | Optional endpoint browsers use for presigned URLs, when it differs from the API's |
| `S3_REGION` | Default `auto` |
| `S3_BUCKET` | Default `gradebook` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Credentials (dev `gradebook` / `gradebook-secret`, from `infrastructure/dev/s3.json`) |
| `S3_FORCE_PATH_STYLE` | Path-style URLs; on by default whenever `S3_ENDPOINT` is set |
| `S3_PUBLIC_URL` | Optional public base for avatar images |

Objects are stored under one bucket with a prefix per area (`<area>/<path>`).

| Area (prefix) | Module | What is stored | How it is accessed |
| --- | --- | --- | --- |
| `file-manager/` | `src/file-manager/` | Everything in the file manager: uploads, files shared with people/roles/courses, files linked from course modules, assignment hand-ins | Uploads go **directly from the browser/app to S3** with a presigned PUT (`uploadUrl`), then the API checks the object exists (`exists`) and releases it. Downloads stream through the API (`getBuffer`/`get`) after a permission check, with `nosniff` and a sandbox CSP, so a raw bucket URL is never exposed. |
| `images/` | `src/images/` | Profile pictures | Uploaded through the API (`put`), served publicly at `GET /api/images/avatars/:name` or from `S3_PUBLIC_URL` |

Who reaches files through those modules:

- `src/grading/submission.service.ts`: students' hand-in files and staff reading them for marking.
- `src/student-portal/`: students opening files their course offers (`/api/portal/me/courses/:courseId/files/:fileId`).
- `src/course/course-file.service.ts`: staff opening files linked in their course.
- `src/chat/`: file-share messages.

The client uses `requestChecksumCalculation/responseChecksumValidation:
WHEN_REQUIRED` so presigned uploads work with S3-compatible servers that do not
implement the newest checksum headers. In development (not production, and only
with `S3_ENDPOINT` set) the API creates the bucket and a permissive CORS rule on
start, so browser uploads work immediately; in production create the bucket and
its CORS rule (allow `PUT` from your frontend origin) yourself.

**Compose details.** Dev only: SeaweedFS with its S3 gateway on
`127.0.0.1:8333`, credentials from `infrastructure/dev/s3.json`, data in the
`s3-data` volume. It is not in the production compose file: point the `S3_*`
variables at your provider.

**If it is down.** Uploads, downloads, avatars and opening course files fail;
everything that does not touch file contents keeps working.

---

## Mailpit / SMTP (`mailpit`)

**What it is.** Sign-in is by emailed code, so the API must be able to send
email. In development Mailpit accepts every message and shows it in a web inbox
instead of delivering it. In production use any SMTP server: Google Workspace /
Gmail (with an app password), Microsoft 365, Amazon SES, Postmark, Mailgun, your
school's mail server...

**How the backend connects.** `src/mail/mail.service.ts` (global) uses
nodemailer, configured by `src/mail/mail.config.ts`:

- either `SMTP_URL` (dev: `smtp://127.0.0.1:1025`), or
- `SMTP_SERVICE` (`gmail`, `outlook`, `office365`, `yahoo`, `icloud`, `zoho`) or
  `SMTP_HOST`/`SMTP_PORT`, with `SMTP_USER` and `SMTP_PASSWORD`
  (or `SMTP_PASSWORD_FILE`). Google's app passwords can be pasted with their
  spaces. Port 465 uses implicit TLS; other ports must upgrade with STARTTLS
  before credentials are sent.
- `MAIL_FROM` (defaults to `SMTP_USER`).

On start, the API checks the SMTP login once and logs a clear warning if it
fails (it never stops the API from starting).

**What sends email.** Only `src/account/email-code.service.ts`: the 8-digit
sign-in code (10-minute expiry, 5 attempts, at most 5 sends per 15 minutes per
address). It is used by `POST /api/auth/otp/send` and the sign-in/onboarding
flow in `src/auth/`. In development, `POST /api/auth/dev/code` (only with
`ALLOW_DEV_LOGIN=true`, never in production) returns the code directly so
scripts don't need the inbox.

**Compose details.** Dev only: SMTP on `127.0.0.1:1025`, inbox at
http://127.0.0.1:8025. Not in the production compose file.

**If it is down.** Nobody can receive a sign-in code. People already signed in
are unaffected, and SSO (Google, Microsoft, SAML) sign-in does not need email.

---

## `migrate` (release step)

A one-off container built from the same image as the API (the `x-app` anchor),
running `bunx prisma migrate deploy`. It exists for deployments that set
`MIGRATE_ON_START=false` on the API, so migrations run once as an explicit
release step instead of on every container start:

```bash
docker compose --profile release run --rm migrate
```

By default (`MIGRATE_ON_START` unset or `true`) the API container applies
pending migrations itself before starting, and this service is not needed.

---

## The API container

`infrastructure/docker-compose.yml` defines the API's settings once in the
`x-app` anchor (build from `infrastructure/Dockerfile`, `env_file: .env`, wait
for Redis to be healthy, health check against `GET /health`) and shared
environment in `x-app-env` (`USE_REDIS=true`, `REDIS_URL`,
`CHAT_CHANNELS_ENABLED=false`). The file itself only runs `migrate`,
`redis` and `backup`; the API is run by the hosting platform from the image that CI builds
from `infrastructure/Dockerfile`.

The image (Bun 1.4.4, Alpine):

1. installs dependencies from `bun.lock`,
2. generates the Prisma client and builds the NestJS app,
3. on start, runs `prisma migrate deploy` (unless `MIGRATE_ON_START=false`),
   then `bun --bun dist/src/main`.

It needs, at minimum: `DATABASE_URL`, the `S3_*` variables, SMTP settings,
`AUTH_SECRET`, `FRONTEND_URL` and `API_URL`, plus `REDIS_URL` when
`USE_REDIS=true`. Optional features add their own: SSO (`SSO_*`, Google and
Microsoft client ids), push notifications (Expo), chat encryption
(`CHAT_ENCRYPTION_KEY` or the `CHAT_ENCRYPTION_KEYS` ring) and hosted billing
(`BILLING_ENABLED` and the Stripe keys; leave it unset when
self-hosting).

`infrastructure/nginx/` holds an nginx config that load-balances three replicas
named `app1`-`app3` and turns off buffering for the SSE streams. No compose file
currently defines those replicas; use it as a starting point if you put nginx in
front of several API containers yourself.

---

## Running more than one API instance

| Concern | Needed |
| --- | --- |
| Shared cache, realtime events and presence | `USE_REDIS=true` with one shared Redis |
| One billing sweep at a time | Already handled by Postgres advisory locks |
| Background notifications processed once | BullMQ on the shared Redis |
| Rate limits | Per instance (in-memory); multiply the configured limits by the instance count when sizing |
| Long-lived SSE connections | The proxy must not buffer `/api/chat/stream`, `/api/portal/me/stream` or the attendance session streams (see the nginx config) |

## See also

- [`backend/README.md`](../backend/README.md): running the backend locally
- [`docs/content/environment-variables.md`](../docs/content/environment-variables.md): every variable
- [`docs/content/dedicated-deployment.md`](../docs/content/dedicated-deployment.md): deploying on your own server
- [`BACKUPS.md`](./BACKUPS.md) and [`docs/content/backups.md`](../docs/content/backups.md): backups, point-in-time recovery and GDPR
- [`backend/src/storage/README.md`](../backend/src/storage/README.md), [`backend/src/cache/README.md`](../backend/src/cache/README.md), [`backend/src/realtime/README.md`](../backend/src/realtime/README.md), [`backend/src/queue/README.md`](../backend/src/queue/README.md), [`backend/src/mail/README.md`](../backend/src/mail/README.md), [`backend/src/prisma/README.md`](../backend/src/prisma/README.md)
