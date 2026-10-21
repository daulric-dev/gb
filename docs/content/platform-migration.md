---
label: Leaving Supabase
---

# Leaving Supabase: platform-independent backend

Status: in progress on branch `feat/platform-independence`.

GradeBook depends on Supabase for its database client, authentication, file storage, email and a few edge functions. This plan replaces each with a component we own, so the app runs on any host - containers, serverless Node, or Cloudflare Workers - against any Postgres, any S3-compatible store and any SMTP server.

## Decisions

| Area | Today (Supabase) | Target |
| --- | --- | --- |
| Data access | `supabase-js` query builder via PostgREST (service-role client), 5 SQL functions via RPC | **Prisma** on plain Postgres (`DATABASE_URL`). SQL functions kept and called through `$queryRaw` until ported |
| Migrations | 58 Supabase CLI migrations | Supabase SQL stays the source of truth until phase 4, then a **Prisma Migrate baseline** of the final schema |
| Auth | Supabase Auth: email OTP, `sb-*` cookies, OAuth/SAML, `auth.users` | **Own auth module**: `app_user` table, hashed one-time codes, opaque server sessions (hashed in Postgres, cached in Redis) in our own cookie, OIDC via `openid-client`, SAML via `@node-saml/node-saml`. Same SSO adapter interface |
| Storage | Supabase Storage buckets + direct TUS uploads | **S3-compatible** adapter (`@aws-sdk/client-s3`): SeaweedFS locally (MinIO no longer publishes community images), R2/S3/any S3 in production. Uploads go straight from the client to S3 with **presigned URLs** (multipart for large files) - works on every host |
| Email | Supabase SMTP + templates | **SMTP adapter** (`nodemailer`); Mailpit locally |
| Edge functions | `file-share-notify` (others unused) | Backend services / BullMQ jobs |
| Row-level security | Defence in depth only (API uses service role) | Dropped; the API already enforces access in code |
| Background work | `setInterval` sweeps, BullMQ | Worker process **or** `POST /api/internal/cron/*` with a shared secret, for hosts without long-running processes |
| Realtime | Redis pub/sub + SSE (not Supabase) | Unchanged |

**Hosting:** one Docker image (API + worker) is the reference deployment. The API stays a plain Nest/Fastify app with no host-specific code beyond the existing thin entry points, so Vercel and Workers remain possible (Workers needs Prisma's `@prisma/adapter-pg` driver adapter and a pooled connection).

## Phases

Each phase ships on its own and keeps the app working.

### Phase 1 - Prisma on the current database

- **Prisma 7** (`prisma-client` generator, `@prisma/adapter-pg` driver adapter - the same client runs in containers, serverless Node and Workers). Config in `backend/prisma.config.ts`; client generated to `backend/src/generated/prisma` (gitignored; `postinstall`, `pretest` and `build` regenerate it).
- **Multi-file schema** in `backend/prisma/schema/`: `main.prisma` (generator, datasource) plus one file per database schema - `school`, `course`, `grading`, `student`, `files`, `chat`, `staff`, `reporting`, `auth`. See its README. `bun run db:pull` re-introspects and keeps models in their files.
- Global `PrismaService`. Every service moves to Prisma, module by module. SQL functions are called through `prisma.$queryRaw`.
- Shared helpers: `src/common/user-school.ts` (current school), `src/common/db-values.ts` (`dateOnly`, `num` and error-code checks, so responses keep their old JSON shapes - date columns as `YYYY-MM-DD`, numerics as numbers), `src/test/prisma-mock.ts` (`createMockPrisma()` for unit tests).
- Done when no service imports the Supabase client for data. Auth and storage still use Supabase.

### Phase 2 - S3 storage

- `StorageService` adapter (put, get stream, delete, presigned GET, presigned PUT / multipart).
- File manager, avatars, submissions, attendance-free reports: presigned uploads replace TUS (web `frontend/lib/files/resumable.ts`, mobile `mobile/src/lib/upload.ts`).
- One-off copy script: every object in the three Supabase buckets to S3 under the same keys.
- `file-share-notify` edge function becomes a BullMQ job.

### Phase 3 - Own authentication

Built so far (`backend/src/account/`, migration `20261021170000_account_schema.sql`, Prisma `account.prisma`):

- Tables `account.app_user` (same ids as the old auth users), `account.session`, `account.email_code`, `account.identity`; SAML columns on `school_email_domain` (`saml_entry_point`, `saml_issuer`, `saml_certificate`).
- `EmailCodeService` - 8-digit codes, HMAC-hashed with `AUTH_SECRET`, 10-minute expiry, 5 attempts, single use, one live code per address, 5 sends per 15 minutes, sent through `MailService`.
- `SessionService` - `gb_session` HttpOnly cookie carrying a random 256-bit token; only its SHA-256 is stored; 30-day sliding expiry; revoke one / all; lookups cached 60 s.
- `AccountService` - user for a proven email; user for an SSO identity, matched by (provider, subject), linking by email only when the provider vouches for it.

Cut-over (next):

1. **Auth guard / `/auth/*`**: `AuthGuard` resolves `SessionService` and sets `req.user = {id, email}` exactly as today. `POST /auth/otp/send` → `EmailCodeService.send`; `/auth/otp/verify` → verify, `AccountService.userForVerifiedEmail`, `SessionService.create`. Response shapes unchanged. `/auth/logout` → revoke. Account deletion → delete `app_user` (cascades sessions/identities) after the existing profile cleanup.
2. **SSO without a hosted auth service**: adapters implement OIDC with `openid-client` (PKCE + state + nonce, state kept in cache for 10 minutes) and SAML with `@node-saml/node-saml` (SP-initiated, `POST /auth/sso/saml/acs`, RelayState = state). Google: issuer `https://accounts.google.com`, vouches via `hd`. Microsoft: always the school's tenant authority `https://login.microsoftonline.com/<tenant>/v2.0` from the email domain's `azureTenantId`, so issuer validation is strict and other tenants cannot sign in at all; requires the email first. SAML: per-domain entry point, IdP certificate and issuer configured by the school admin - no platform operator. Env: `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`, `SAML_SP_ENTITY_ID`. Mobile handoff code stays (now a one-time code for a `gb_session`).
3. **User migration**: one SQL migration copies `auth.users` (id, lower(email), email_confirmed_at) into `account.app_user` and re-points `user_profile.id`'s foreign key to `account.app_user`. Existing sessions end; everyone signs in again once. Seed/smoke scripts mint codes through a dev-only endpoint (`POST /auth/dev/code`, refused unless `NODE_ENV !== 'production'` and `ALLOW_DEV_LOGIN=true`).
4. **Clients**: `frontend/proxy.ts` checks for the `gb_session` cookie (presence; the API validates it) instead of decoding `sb-*` cookies; the throttle tracker keys on `gb_session`. Mobile unchanged (cookies are opaque to it).
5. **Remove**: `SupabaseService`, `@supabase/*`, `SUPABASE_*` env vars, `supabase/templates`.

### Phase 4 - Leave Supabase

- `pg_dump` the app schemas from Supabase, restore into the new Postgres.
- Prisma Migrate baseline from the final schema; Supabase migrations archived.
- Remove `@supabase/*`, `supabase/` config, `SUPABASE_*` env vars, RLS policies and the `auth`/`storage` references.
- Local dev: `docker-compose.dev.yml` runs Postgres, Redis, SeaweedFS (S3) and Mailpit.

## Environment (target)

```env
DATABASE_URL=postgresql://gb:gb@localhost:5432/gb
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:8333
S3_REGION=auto
S3_BUCKET=gradebook
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_URL=            # optional CDN for public images
SMTP_URL=smtp://localhost:1025
MAIL_FROM="GradeBook <no-reply@example.com>"
SESSION_SECRET=...        # signs cookies; openssl rand -base64 32
CRON_SECRET=...           # for hosts that trigger background work over HTTP
```
