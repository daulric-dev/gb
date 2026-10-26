---
label: Leaving Supabase
---

# Leaving Supabase: platform-independent backend

Status (2026-10-21), branch `feat/platform-independence`:

| Phase | State |
| --- | --- |
| 1. Prisma | Done - every query on Prisma 7, verified response-for-response against the old code |
| 2. S3 storage | Done - presigned uploads, edge functions removed |
| 3. Own auth | Done - email codes + `gb_session` sessions, OIDC/SAML on our server, users migrated with the same ids; no `@supabase/*` package or `SUPABASE_*` variable remains |
| 4. Leave the hosted database | Done - Prisma Migrate baseline, plain Postgres, `supabase/` and every Supabase CLI step removed; production cutover runbook below |

`bun run smoke` (backend) passes end to end after each phase, with no Supabase service running.

GradeBook depends on Supabase for its database client, authentication, file storage, email and a few edge functions. This plan replaces each with a component we own, so the app runs on any container host against any Postgres, any S3-compatible store and any SMTP server.

## Decisions

| Area | Today (Supabase) | Target |
| --- | --- | --- |
| Data access | `supabase-js` query builder via PostgREST (service-role client), 5 SQL functions via RPC | **Prisma** on plain Postgres (`DATABASE_URL`). SQL functions kept and called through `$queryRaw` until ported |
| Migrations | 58 Supabase CLI migrations | Supabase SQL stays the source of truth until phase 4, then a **Prisma Migrate baseline** of the final schema |
| Auth | Supabase Auth: email OTP, `sb-*` cookies, OAuth/SAML, `auth.users` | **Own auth module**: `app_user` table, hashed one-time codes, opaque server sessions (hashed in Postgres, cached in Redis) in our own cookie, OIDC via `openid-client`, SAML via `@node-saml/node-saml`. Same SSO adapter interface |
| Storage | Supabase Storage buckets + direct TUS uploads | **S3-compatible** adapter (`@aws-sdk/client-s3`): SeaweedFS locally (MinIO no longer publishes community images), R2/S3/any S3 in production. Uploads go straight from the client to S3 with **presigned URLs** (multipart for large files) - works on every host |
| Email | Supabase SMTP + templates | **SMTP adapter** (`nodemailer`); Mailpit locally |
| Edge functions | `file-share-notify`, `file-ingest` (others unused) | `file-share-notify` became a backend BullMQ job; `file-ingest` had no producer and was later removed - **done, all edge functions deleted** |
| Row-level security | Defence in depth only (API uses service role) | Dropped; the API already enforces access in code |
| Background work | `setInterval` sweeps, BullMQ | Unchanged: sweeps and BullMQ workers run inside the API process (no separate worker, no cron endpoint) |
| Realtime | Redis pub/sub + SSE (not Supabase) | Unchanged |

**Hosting:** one Docker image (`infrastructure/Dockerfile`, running `bun dist/src/main`) is the supported deployment. The serverless entry points (Vercel `api/index.ts`, Cloudflare Workers `src/worker.ts`, its `src/stubs/` and the `wrangler` scripts) were removed on 2026-10-25; see the [cleanup changelog](./changelog/2026-10-25/cleanup.md).

## Phases

Each phase ships on its own and keeps the app working.

### Phase 1 - Prisma on the current database (done)

- **Prisma 7** (`prisma-client` generator, `@prisma/adapter-pg` driver adapter). Config in `backend/prisma.config.ts`; client generated to `backend/src/generated/prisma` (gitignored; `postinstall`, `pretest` and `build` regenerate it).
- **Multi-file schema** in `backend/prisma/schema/`: `main.prisma` (generator, datasource) plus one file per database schema - `school`, `course`, `grading`, `student`, `files`, `chat`, `account`, `billing`, plus `discussion` (course discussions). The `auth` file went with phase 4; the empty `staff` and `reporting` schemas were dropped from the datasource list. See its README. `bun run db:pull` re-introspects and keeps models in their files.
- Global `PrismaService`. Every service moves to Prisma, module by module. SQL functions are called through `prisma.$queryRaw`.
- Shared helpers: `src/common/user-school.ts` (current school), `src/common/db-values.ts` (`dateOnly`, `num` and error-code checks, so responses keep their old JSON shapes - date columns as `YYYY-MM-DD`, numerics as numbers), `src/test/prisma-mock.ts` (`createMockPrisma()` for unit tests).
- Done when no service imports the Supabase client for data. Auth and storage still use Supabase.

### Phase 2 - S3 storage (done)

- Global `StorageService` (`backend/src/storage/storage.service.ts`, `@aws-sdk/client-s3`): `put`, `get` (stream), `getBuffer`, `exists`, `delete`, `downloadUrl` (presigned GET), `uploadUrl` (presigned PUT).
- **One bucket, keyed `<old bucket>/<old path>`** (`objectKey()` in `src/storage/keys.ts`): `file-manager/<schoolId>/<userId>/<id>-<name>`, `images/avatars/<userId>.<ext>`, `report-books/...`. `file_manager.file` rows keep `bucket` + `storage_path` unchanged.
- TUS and the upload-token signer are gone. Server-side writes (`POST /files`, `POST /portal/me/activities/:id/file`, `POST /auth/avatar`) use `put`; content, download and submission-file endpoints read the object back through the API with the same headers as before; rejected uploads are deleted.
- `file-share-notify` runs in the backend (`src/queue/handlers/`), as a BullMQ job or inline without Redis. (`file-ingest` was ported too, but nothing ever enqueued it, so it was removed.) Share notifications go to: a user share's user; a role share's holders in the school; a course share's staff (still school members) and active students' linked accounts; never the sharer. Rows are unique on (user_id, share_id) and duplicates are skipped. **Every edge function has been deleted** (`announcement-feed`, `bulk-import-preview`, `notification-summary` were unused).

#### Upload contract

Same for `POST /api/files/upload-ticket` and `POST /api/portal/me/activities/:activityId/upload-ticket`. The request body is unchanged: `{ name, sizeBytes, contentType, folderId? }`. Type and size (10 MB) are checked before a ticket is issued.

```json
{
  "fileId": "uuid",
  "method": "PUT",
  "uploadUrl": "https://<store>/<bucket>/file-manager/...?X-Amz-...",
  "headers": { "Content-Type": "application/pdf" },
  "expiresAt": "2026-10-21T18:15:00.000Z",
  "contentType": "application/pdf",
  "maxBytes": 10485760
}
```

1. `PUT uploadUrl` with the raw bytes as the body and exactly `headers`. Content-Type is signed, so nothing else may change it. The URL is valid for 15 minutes.
2. `POST .../upload-ticket/:fileId/complete` (same paths and responses as before). The API checks that the object exists, is ≤ 10 MB and matches the declared size, then runs the magic-byte and structure checks. It returns the ready file, or marks the row `failed`, deletes the object and returns 400 (`The upload did not complete`, `File too large. Maximum is 10MB.`, `The uploaded file does not match the declared size`, or the content-check reason).

**Avatars.** Clients use multipart `POST /api/auth/avatar`. `POST /api/auth/avatar/resumable` (`{ filename, contentType, totalSize }`) also returns a presigned ticket `{ path, method: "PUT", uploadUrl, headers, expiresAt }`; after the PUT, `POST /api/auth/avatar/complete { path }` checks the object and sets the avatar. New `avatar_url` values are `<API_URL>/api/images/avatars/<userId>.<ext>?t=<ms>`, or `<S3_PUBLIC_URL>/images/avatars/...` when a public CDN is configured. `GET /api/images/avatars/:file` is public, with no credentials, like the old public bucket, and streams the image. `GET /api/auth/avatar` streams the caller's own avatar.

#### Bucket CORS (production)

Browsers PUT uploads straight to the store, so the bucket needs this CORS rule. In development the API applies it at boot (`corsRule()` in `storage.service.ts`); on R2/S3, set it once by hand:

```json
[{
  "AllowedOrigins": ["https://app.example.com"],
  "AllowedMethods": ["PUT", "GET", "HEAD"],
  "AllowedHeaders": ["Content-Type"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600
}]
```

`AllowedOrigins` = every `FRONTEND_URL` origin. Presigned URLs are signed for `S3_PUBLIC_ENDPOINT` (falling back to `S3_ENDPOINT`), so that host must be reachable by browsers and phones. A phone on the LAN in development needs `S3_PUBLIC_ENDPOINT=http://<lan-ip>:8333`.

### Phase 3 - Own authentication (done)

Built so far (`backend/src/account/`, migration `20261021170000_account_schema.sql`, Prisma `account.prisma`):

- Tables `account.app_user` (same ids as the old auth users), `account.session`, `account.email_code`, `account.identity`; SAML columns on `school_email_domain` (`saml_entry_point`, `saml_issuer`, `saml_certificate`).
- `EmailCodeService` - 8-digit codes, HMAC-hashed with `AUTH_SECRET`, 5-minute expiry, 5 attempts, single use, one live code per address, 5 sends per 15 minutes, sent through `MailService`.
- `SessionService` - `gb_session` HttpOnly cookie carrying a random 256-bit token; only its SHA-256 is stored; 30-day sliding expiry; revoke one / all; lookups cached 60 s.
- `AccountService` - user for a proven email; user for an SSO identity, matched by (provider, subject), linking by email only when the provider vouches for it.

Cut-over (done):

1. **Auth guard / `/auth/*`**: `AuthGuard` resolves `SessionService` and sets `req.user = {id, email}` exactly as today. `POST /auth/otp/send` → `EmailCodeService.send`; `/auth/otp/verify` → verify, `AccountService.userForVerifiedEmail`, `SessionService.create`. Response shapes unchanged. `/auth/logout` → revoke. Account deletion → delete `app_user` (cascades sessions/identities) after the existing profile cleanup.
2. **SSO without a hosted auth service**: adapters implement OIDC with `openid-client` (PKCE + state + nonce, state kept in cache for 10 minutes) and SAML with `@node-saml/node-saml` (SP-initiated, `POST /auth/sso/saml/acs`, RelayState = state). Google: issuer `https://accounts.google.com`, vouches via `hd`. Microsoft: always the school's tenant authority `https://login.microsoftonline.com/<tenant>/v2.0` from the email domain's `azureTenantId`, so issuer validation is strict and other tenants cannot sign in at all; requires the email first. SAML: per-domain entry point, IdP certificate and issuer configured by the school admin - no platform operator. Env: `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`, `SAML_SP_ENTITY_ID`. Mobile handoff code stays (now a one-time code for a `gb_session`).
3. **User migration**: one SQL migration copies `auth.users` (id, lower(email), email_confirmed_at) into `account.app_user` and re-points `user_profile.id`'s foreign key to `account.app_user`. Existing sessions end; everyone signs in again once. Seed/smoke scripts mint codes through a dev-only endpoint (`POST /auth/dev/code`, refused unless `NODE_ENV !== 'production'` and `ALLOW_DEV_LOGIN=true`).
4. **Clients**: `frontend/proxy.ts` checks for the `gb_session` cookie (presence; the API validates it) instead of decoding `sb-*` cookies; the throttle tracker keys on `gb_session`. Mobile unchanged (cookies are opaque to it).
5. **Remove**: `SupabaseService`, `@supabase/*`, `SUPABASE_*` env vars, `supabase/templates`.

### Phase 4 - Leave Supabase (done)

What changed:

- **Schema history**: `backend/prisma/migrations/0_baseline` is the whole schema, generated from the old database with row-level security, policies and the hosted service's `auth`/`storage` references removed. Future changes go through Prisma Migrate (`bun run db:migrate --name <change>`; deploy with `bun run db:deploy`); see `backend/prisma/schema/README.md`. The 58 Supabase SQL migrations and `supabase/` (config, email templates, branches) were deleted; they remain in git history (`git show 13b14d1:supabase/migrations`).
- **Local development**: `docker-compose.dev.yml` runs Postgres (`db`), Redis, SeaweedFS (`s3`) and Mailpit. `bun run preload` starts them, waits for them to be healthy and runs `prisma migrate deploy` (`bun run db:setup`); `bun run postload` stops them. Root scripts `db:migrate`, `db:deploy`, `db:pull`, `db:studio`, `seed:demo` and `smoke` delegate to the backend. The Supabase CLI is no longer used anywhere.
- **Production image**: `infrastructure/Dockerfile` generates the Prisma client at build (no database needed) and runs `prisma migrate deploy` before starting the API, unless `MIGRATE_ON_START=false` (then `docker compose --profile release run --rm migrate` is the release step). `infrastructure/docker-compose.yml` has a commented `db` service for single-box deployments.
- **CI**: no database and no Supabase step. Backend tests are unit tests with mocks, and `prisma generate` uses a placeholder `DATABASE_URL` when none is set (`prisma.config.ts`), so `bun install` works anywhere.
- **Legacy data dropped**: the product had no real users, so no data was carried over. The class/subject/report-card tables and columns, the old auth tables and the copy tooling were removed, and `0_baseline` was regenerated from the cleaned schema (44 tables).

#### Deploying

There is no data to move: deploy the new stack fresh.

1. Provision Postgres, an S3 bucket (with the CORS rule above), SMTP and Redis.
2. Set the variables from `infrastructure/env.example`.
3. Start the image; it runs `prisma migrate deploy` before the API starts (or run the `migrate` release step).
4. Point `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STORAGE_URL` and the mobile `EXPO_PUBLIC_API_URL` at it.
5. Sign in by email code, create a school and a course, upload a file.

The old hosted project can be deleted.

## Environment

The full list is in [Environment variables](./environment-variables.md); `infrastructure/env.example` is the production template.

```env
DATABASE_URL=postgresql://gradebook:gradebook@127.0.0.1:5432/gradebook
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://127.0.0.1:8333
S3_REGION=auto
S3_BUCKET=gradebook
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_ENDPOINT=       # optional: the store as browsers/phones reach it
S3_PUBLIC_URL=            # optional CDN for public images
SMTP_URL=smtp://127.0.0.1:1025
MAIL_FROM="GradeBook <no-reply@example.com>"
AUTH_SECRET=...           # hashes sign-in codes and session tokens; openssl rand -base64 32
```
