---
sidebar_label: Environment Variables
---

# Environment Variables

This document lists every environment variable used across the project - backend, frontend, mobile, and CI/CD workflows.

No `.env` files are committed to the repository. You must create them manually in each workspace.

---

## Backend

**File**: `backend/.env`

| Variable                      | Required                 | Default                 | Description                                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | **Yes**                  | -                       | PostgreSQL 15+ connection string, used by Prisma (`src/prisma/prisma.service.ts`, `prisma.config.ts`). Dev: `postgresql://gradebook:gradebook@127.0.0.1:5432/gradebook` (the `db` service in `docker-compose.dev.yml`). Apply the schema with `bun run db:deploy`. Not needed by `prisma generate`. |
| `AUTH_SECRET`                 | **Prod**                 | -                       | 32+ characters (`openssl rand -base64 32`). Keys the HMAC hashes of sign-in codes and signs short-lived tokens. **Required in production** - the app refuses to boot without it. Unset in dev = an insecure development secret (with a warning). Changing it voids outstanding codes and makes the erasure-log copy in storage fail its signature check (`erasure:replay --allow-unsigned` reads it anyway). |
| `ALLOW_DEV_LOGIN`             | No (dev)                 | `false`                 | `true` turns on `POST /auth/dev/code`, which returns a sign-in code instead of mailing it, so `seed:demo` and `smoke` can sign in. Refused (404) when `NODE_ENV=production`. Never set it on a shared deployment. |
| `ALLOW_UNVERIFIED_EMAIL_DOMAINS` | No (dev)              | `false`                 | Skips the DNS TXT check for school email domains so a local stack can use made-up domains like `demo.test`. Ignored in production. |
| `API_URL`                     | For SSO / avatars        | request host            | Absolute URL of this API. SSO redirect URIs (`${API_URL}/api/auth/sso/callback`), the SAML entity ID and avatar URLs are built from it. |
| `SMTP_URL`                    | One of `SMTP_URL` or `SMTP_HOST`/`SMTP_SERVICE` (to send mail) | -   | SMTP connection URL, e.g. `smtp://127.0.0.1:1025` (Mailpit in dev, inbox at http://127.0.0.1:8025) or `smtps://user:pass@smtp.example.com:465`. The password must be URL-encoded; prefer the separate fields below for app passwords. Wins over the fields when both are set. |
| `SMTP_SERVICE`                | No                       | -                       | Preset host/port: `gmail`, `outlook`, `office365`, `yahoo`, `icloud`, `zoho`. |
| `SMTP_HOST` / `SMTP_PORT`     | No                       | port `587` (or preset)  | Any other SMTP server. Port 465 uses implicit TLS; other ports use STARTTLS. |
| `SMTP_SECURE`                 | No                       | on for port 465         | Force implicit TLS on or off. |
| `SMTP_USER`                   | No                       | -                       | SMTP login, usually the sending mailbox. |
| `SMTP_PASSWORD`               | No                       | -                       | Password or **app password**. Gmail, Outlook and Yahoo need an app password once 2-step verification is on; paste Google's as shown (`abcd efgh ijkl mnop`) - the spaces are removed. No URL-encoding needed. |
| `SMTP_PASSWORD_FILE`          | No                       | -                       | Read the password from a file (Docker/Kubernetes secret) instead of `SMTP_PASSWORD`. |
| `SMTP_ALLOW_INSECURE`         | No                       | `false`                 | `true` allows sending credentials without TLS (not recommended). |
| `MAIL_FROM`                   | No                       | `SMTP_USER`             | From address, e.g. `"GradeBook <no-reply@example.com>"`. Gmail and Outlook only send as the signed-in account or a verified alias. |
| `SSO_PROVIDERS`               | No                       | -                       | Comma-separated SSO providers to enable: `google`, `azure`, `saml`. See [Single sign-on](./sso.md). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | For Google SSO | -                    | OAuth client from Google Cloud. Redirect URI: `${API_URL}/api/auth/sso/callback`. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | For Microsoft SSO | -         | Multi-tenant app registration in Microsoft Entra. Each school's tenant is taken from its email domain. |
| `SAML_SP_ENTITY_ID`           | No                       | `${API_URL}/api/auth/sso/saml/metadata` | Our SAML entity ID. Change it only together with the frontend's `NEXT_PUBLIC_SAML_SP_ENTITY_ID`. |
| `MOBILE_SSO_RETURN_URL`       | No                       | `gradebook://sso`       | Where the mobile app picks up a finished SSO sign-in. |
| `TRUST_PROXY_HOPS`            | No                       | -                       | Number of proxies in front of the API, so rate limits see the real client IP. |
| `EXPO_ACCESS_TOKEN`           | No                       | -                       | Expo push access token, when push security is enabled on the Expo project. |
| `NODE_ENV`                    | No                       | -                       | `production` turns on the fail-closed secret checks, marks the auth cookie `Secure`, and applies `AUTH_COOKIE_DOMAIN`. Anything else is treated as development. |
| `S3_ENDPOINT`                 | Dev / non-AWS            | -                       | S3-compatible endpoint (SeaweedFS `http://127.0.0.1:8333` in dev, R2/B2/MinIO URL in production). Omit for AWS S3. |
| `S3_REGION`, `S3_BUCKET`      | Yes                      | `auto`, `gradebook`     | Region and the single bucket every object lives in, under `<area>/<path>` (`file-manager/...`, `images/...`, `report-books/...`). |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Yes         | -                       | Store credentials. |
| `S3_PUBLIC_ENDPOINT`          | No                       | `S3_ENDPOINT`           | The store's address as browsers and phones reach it; presigned upload/download URLs are signed for this host. |
| `S3_PUBLIC_URL`               | No                       | -                       | A public CDN/bucket host for avatars. Unset, avatar URLs point at the API's public route `/api/images/avatars/<file>`. |
| `S3_FORCE_PATH_STYLE`         | No                       | `true` with an endpoint | Path-style bucket addressing (needed by SeaweedFS/MinIO). |
| `AUTH_COOKIE_DOMAIN`          | No                       | derived                 | `Domain` for the `gb_session` auth cookie in production. The web proxy (`frontend/proxy.ts`) checks for this cookie on the **frontend's** domain, so it must be visible to both app and API. Derived from the last two labels of `FRONTEND_URL` when unset — set it explicitly if the API is on a different registrable domain, or the domain has a multi-part suffix (`app.example.co.uk` derives `.co.uk`, which browsers reject). `none` = host-only cookie. |
| `FRONTEND_URL`                | No                       | `http://localhost:3000` | Allowed CORS origins, **comma-separated**. The first is canonical: it is what the auth cookie domain is derived from, and the fallback for endpoints that write the CORS header by hand. In development, private/LAN origins are also accepted by shape (for the mobile app over Expo web) without being listed. |
| `PORT`                        | No                       | `3001`                  | Port the backend server listens on.                                                                                                                                                                                                                                   |
| `USE_REDIS`                   | No                       | `false`                 | Set to `true` to use Redis for caching, BullMQ queues, **and chat pub/sub fan-out**. When `false`, chat still works but delivers in-process only (single replica).                                                                                                    |
| `REDIS_URL`                   | Only if `USE_REDIS=true` | -                       | Redis connection URL (e.g., `redis://localhost:6379`).                                                                                                                                                                                                                |
| `CHAT_CHANNELS_ENABLED`       | No                       | `false`                 | Set to `true` to enable multi-participant chat channels. Direct messages are always on; see [Chat](./backend/chat.md).                                                                                                                                                |
| `CHAT_ENCRYPTION_KEY`         | **Prod**                 | -                       | Base64 of 32 random bytes (`openssl rand -base64 32`). Encrypts message content at rest (AES-256-GCM). **Required in production** — the app refuses to boot without it. Unset in dev = messages stored unencrypted (with a warning).                                  |
| `CHAT_ENCRYPTION_KEYS`        | No                       | -                       | Rotation ring: `1:<b64>,2:<b64>`. Overrides `CHAT_ENCRYPTION_KEY`. New rows use the highest version; old rows decrypt by their stored version.                                                                                                                        |
| `CHAT_ENCRYPTION_KEY_VERSION` | No                       | highest                 | Which key version to encrypt new messages with: a bare number from the ring (`2`, not `v2`). Ignored if it is not in the ring.                                                                                                                                                                                                                       |
| `STUDENT_CLAIM_CODE_PEPPER`   | **Prod**                 | -                       | Secret used to key the HMAC that hashes student claim codes (`openssl rand -base64 32`). **Required in production** - the app refuses to boot without it. Unset in dev = a well-known pepper is used (with a warning). Changing it invalidates every outstanding code.                                                  |
| `DEDICATED_DEPLOYMENT`        | No                       | `false`                 | Set to `true` for single-school dedicated instances. Blocks creation of a second school. See [Dedicated Deployment](./dedicated-deployment.md).                                                                                                                       |

### Billing

SaaS billing for the **hosted platform**: schools pay for GradeBook. **Self-hosted deployments leave `BILLING_ENABLED` unset** - billing is off by default, so there is no trial, no read-only mode, no `402`, and every `/api/billing/*` and `/api/platform/*` route answers 404 (except `GET /api/billing/status`, which reports `enabled: false` so the apps hide billing UI). See [Billing](./backend/billing.md), [Billing providers](./billing-providers.md) and the [staging checklist](./billing-staging.md).

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `BILLING_ENABLED` | No | off | `true` turns billing on. Anything else (or unset) = off. |
| `BILLING_PER_USER_CENTS` | No | `500` | Per-user plan: price per billable user per month, in minor units. |
| `BILLING_FLAT_CENTS` | No | `30000` | Flat plan: price per month, unlimited users. |
| `BILLING_CURRENCY` | No | `USD` | ISO currency code for every price and invoice. |
| `BILLING_TRIAL_DAYS` | No | `30` | Free trial for a new school (existing schools get it from the day billing is first turned on). |
| `BILLING_GRACE_DAYS` | No | `7` | How long a missed payment (past due) stays writable before the school turns read-only. |
| `PLATFORM_ADMIN_EMAILS` | With billing | - | Comma list of account emails (verified) that get the platform dashboard (`/platform`). Admins can also be rows in `billing.platform_admin`. |
| `APP_URL` | No | first `FRONTEND_URL` | Web app origin for checkout return URLs (`${APP_URL}/dashboard/settings/billing?checkout=success`). |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | With billing | - | Stripe API secret key (`sk_test_...` / `sk_live_...`) and the webhook signing secret (`whsec_...`). Stripe is the only payment provider; it is offered to schools once **both** are set. With billing on and either missing, schools see "payments are not configured yet" and the API logs a warning at startup. Payments are online only (no bank transfer / manual option). |
| `STRIPE_PRICE_PER_USER`, `STRIPE_PRICE_FLAT` | No | - | Reuse existing recurring monthly Stripe prices. Unset: inline prices built from `BILLING_*_CENTS` on two stable products (`gradebook_per_user`, `gradebook_flat`) created on first use. |

Stripe webhook URL: `${API_URL}/api/billing/webhooks/stripe`. See [Billing providers](./billing-providers.md) for the events to enable and local testing with `stripe listen`.

### Data retention and erasure log

GDPR housekeeping in the API (see `backend/src/retention/README.md`, `backend/src/erasure/README.md` and [Backups & GDPR](./backups.md)). A daily job purges rows that were soft-deleted longer ago than the retention period, and every erasure is written to `compliance.erasure_log` (ids only) and copied to object storage so it survives a database restore.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `RETENTION_PURGE_ENABLED` | No | `true` | `false` stops the daily purge (the erasure-log export still runs). `bun run retention:purge` ignores it. |
| `SOFT_DELETE_RETENTION_DAYS` | No | `30` | Days a soft-deleted file, folder, chat message or discussion reply is kept before it is purged for good. |
| `SOFT_DELETE_RETENTION_DAYS_FILES`, `_FOLDERS`, `_CHAT_MESSAGES`, `_DISCUSSION_REPLIES` | No | `SOFT_DELETE_RETENTION_DAYS` | Per-kind overrides (full names: `SOFT_DELETE_RETENTION_DAYS_FOLDERS` and so on). |
| `RETENTION_PURGE_HOUR_UTC` | No | `3` | UTC hour the daily purge starts in (with a whole-day interval). |
| `RETENTION_PURGE_INTERVAL_HOURS` | No | `24` | Hours between purges per instance. Not a multiple of 24 = run every N hours, any hour. |
| `RETENTION_PURGE_BATCH_SIZE` | No | `500` | Rows per batch (one transaction and one erasure-log entry per school per batch). |
| `RETENTION_PURGE_MAX_MINUTES` | No | `10` | Time budget per run; the next run continues where it stopped. |
| `ERASURE_LOG_S3_PREFIX` | No | `erasure-log` | Prefix in `S3_BUCKET` for the off-database copy of the erasure log (one signed JSON object per entry). `off` disables the copy - then a restore can only replay entries still in the restored database. |
| `ERASURE_LOG_RETENTION_DAYS` | No | `400` | How long erasure-log entries (rows and storage copies) are kept. Must be longer than any backup you could restore (30-day dumps + 7 days of old versions by default). |

### Example `backend/.env`

`backend/.env.example` is the full, commented template; its defaults match `docker-compose.dev.yml`.

```env
DATABASE_URL=postgresql://gradebook:gradebook@127.0.0.1:5432/gradebook
S3_ENDPOINT=http://127.0.0.1:8333
S3_REGION=us-east-1
S3_BUCKET=gradebook
S3_ACCESS_KEY_ID=gradebook
S3_SECRET_ACCESS_KEY=gradebook-secret
SMTP_URL=smtp://127.0.0.1:1025
MAIL_FROM="GradeBook <no-reply@gradebook.local>"
# Production with Gmail / Google Workspace (app password):
# SMTP_SERVICE=gmail
# SMTP_USER=office@yourschool.edu
# SMTP_PASSWORD="abcd efgh ijkl mnop"
# AUTH_SECRET=   # required in production: openssl rand -base64 32
ALLOW_DEV_LOGIN=true
FRONTEND_URL=http://localhost:3000
PORT=3001
USE_REDIS=false
# REDIS_URL=redis://localhost:6379

# Chat: DMs are always on; channels are gated off until their UI ships
# CHAT_CHANNELS_ENABLED=false
# Message encryption at rest (AES-256-GCM). Required in production.
#   openssl rand -base64 32
# CHAT_ENCRYPTION_KEY=base64-of-32-bytes


# Student claim codes: keyed hash for codes students redeem to link their
# account to a student record. Required in production.
#   openssl rand -base64 32
# STUDENT_CLAIM_CODE_PEPPER=base64-of-32-bytes

# Dedicated deployment (single-school instance)
# DEDICATED_DEPLOYMENT=true
```

### Where Each Variable Is Used

| Variable                                            | File                               | Usage                                                        |
| --------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------ |
| `DATABASE_URL`                                      | `src/prisma/prisma.service.ts`     | Prisma client (`pg` driver adapter); also `prisma.config.ts` |
| `S3_*`                                              | `src/storage/storage.service.ts`   | Object storage client and presigned URLs                     |
| `SMTP_*`, `MAIL_FROM`                               | `src/mail/`                        | Outgoing email                                               |
| `AUTH_SECRET`                                       | `src/account/secret.ts`            | Hashes of sign-in codes and session tokens                   |
| `GOOGLE_*`, `MICROSOFT_*`, `SAML_SP_ENTITY_ID`      | `src/sso/`                         | SSO adapters                                                 |
| `FRONTEND_URL`                                      | `src/createApp.ts`                 | CORS `origin` configuration                                  |
| `PORT`                                              | `src/main.ts`                      | Fastify listen port (local dev only; not used in serverless) |
| `USE_REDIS`                                         | `src/cache/cache.service.ts`       | Selects Redis store when `true`                              |
| `REDIS_URL`                                         | `src/cache/cache.service.ts`       | Redis connection URL for `ioredis`                           |
| `RETENTION_PURGE_*`, `SOFT_DELETE_RETENTION_DAYS*` | `src/retention/retention.config.ts` | Daily purge of soft-deleted data                             |
| `ERASURE_LOG_*`                                     | `src/erasure/erasure.config.ts`    | Erasure-log storage copy and retention                       |

---

## Database backups

**File**: `infrastructure/.env` (read by the `backup`, `db` and `db-backup` services in `infrastructure/docker-compose.yml`, not by the API). See [Backups & GDPR](./backups.md) and `infrastructure/BACKUPS.md`.

Daily encrypted dump (`backup` service, `infrastructure/backup/`):

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `BACKUP_S3_BUCKET` | **Yes** | - | Backup bucket, separate from `S3_BUCKET`. Same jurisdiction as the database (EU region for EU schools); versioning + Object Lock recommended. |
| `BACKUP_S3_PREFIX` | No | `postgres` | Folder in the bucket; objects are `<prefix>/daily/YYYY/MM/gradebook-<UTC timestamp>.dump.age` and `.sha256`. |
| `BACKUP_S3_ENDPOINT` | Non-AWS | - | R2/B2/MinIO/SeaweedFS endpoint. Empty for AWS S3. |
| `BACKUP_S3_REGION` | No | `us-east-1` | Bucket region (`auto` for R2). |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | **Yes** (or an instance role) | - | Key limited to the backup prefix: put, get, list, delete. `_FILE` variants read a mounted secret. |
| `BACKUP_S3_FORCE_PATH_STYLE` | No | `true` with an endpoint | Path-style addressing. |
| `BACKUP_S3_STORAGE_CLASS` | No | provider default | e.g. `STANDARD_IA`. |
| `BACKUP_AGE_RECIPIENTS` | **Yes** | - | Comma-separated age public keys (`age1...`). The backup is encrypted to them before upload. The private key stays offline; a private key here is refused. |
| `BACKUP_ALLOW_UNENCRYPTED` | No (dev) | `false` | `true` permits unencrypted dumps when no recipients are set. Development only. |
| `BACKUP_DATABASE_URL` | No | `DATABASE_URL` | Database to dump; a role with `pg_read_all_data` is enough. |
| `BACKUP_SCHEDULE` | No | `0 4 * * *` | Cron expression, evaluated in `BACKUP_TZ`. |
| `BACKUP_TZ` | No | `UTC` | Time zone for the schedules (04:00 UTC by default; `Europe/Berlin` for 04:00 local). |
| `BACKUP_RETENTION_DAYS` | No | `30` | Dumps older than this are deleted after each successful backup. |
| `BACKUP_HEALTHCHECK_URL` | No | - | healthchecks.io-style URL: pinged at `/start`, on success and at `/fail`. |
| `BACKUP_TMPFS_SIZE` | No | `2g` | Size of the tmpfs holding the encrypted dump during upload. |
| `BACKUP_VERIFY_SCHEDULE`, `BACKUP_VERIFY_DATABASE_URL`, `BACKUP_AGE_IDENTITY_FILE`, `BACKUP_VERIFY_HEALTHCHECK_URL` | No | - | Scheduled restore test (`backup-verify`), for a separate verification host that holds a verification key. |

Continuous archiving / point-in-time recovery (self-hosted `db` + `db-backup`, `infrastructure/postgres/`; managed Postgres uses the provider's PITR instead):

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `WALG_S3_PREFIX` | **Yes** (self-hosted) | - | `s3://<bucket>/<path>` for WAL and base backups, e.g. `s3://gradebook-backups/wal-g`. |
| `WALG_S3_ENDPOINT`, `WALG_S3_REGION` | Non-AWS / No | -, `us-east-1` | Endpoint and region. |
| `WALG_S3_ACCESS_KEY_ID`, `WALG_S3_SECRET_ACCESS_KEY` | **Yes** | - | Key limited to the WAL-G prefix. |
| `WALG_S3_FORCE_PATH_STYLE` | No | `true` with an endpoint | Path-style addressing. |
| `WALG_LIBSODIUM_KEY` | **Yes** | - | `openssl rand -hex 32`. Encrypts WAL and base backups; keep an offline copy. |
| `WALG_ARCHIVE_TIMEOUT` | No | `60` | Seconds; a WAL segment is shipped at least this often, bounding data loss. |
| `WALG_BACKUP_SCHEDULE` | No | `0 4 * * *` | Base backup cron, in `BACKUP_TZ`. |
| `WALG_RETAIN_FULL` | No | `7` | Base backups kept (= days of point-in-time recovery). |
| `WALG_HEALTHCHECK_URL` | No | - | Ping URL for base backups. |

---

## Frontend

**File**: `frontend/.env.local`

| Variable                           | Required | Default                 | Description                                                                                                                                                                         |
| ---------------------------------- | -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`              | No       | `http://localhost:3001` | Backend API base URL (without `/api` - that's appended automatically)                                                                                                               |
| `NEXT_PUBLIC_DEDICATED_DEPLOYMENT` | No       | `false`                 | Set to `true` for single-school dedicated instances. Hides school selector on onboarding and school switcher in the sidebar. Must match the backend `DEDICATED_DEPLOYMENT` setting. |
| `NEXT_PUBLIC_SAML_SP_ENTITY_ID`    | No       | API metadata URL        | The SAML entity ID the email-domain admin shows schools. Set it only when the backend's `SAML_SP_ENTITY_ID` is overridden, to the same value. |
| `NEXT_PUBLIC_STORAGE_URL`          | **Prod** | -                       | Origin browsers upload to with presigned URLs: the origin of the backend's `S3_PUBLIC_ENDPOINT` (or `S3_ENDPOINT`), e.g. `http://127.0.0.1:8333` in dev, `https://<account-id>.r2.cloudflarestorage.com` in production. Added to the production CSP (`connect-src`, `img-src`); without it uploads are blocked. |

### Example `frontend/.env.local`

```env
NEXT_PUBLIC_API_URL=http://localhost:3001

# Dedicated deployment (single-school instance)
# NEXT_PUBLIC_DEDICATED_DEPLOYMENT=true
```

### Where It Is Used

| Variable                           | File                                                        | Usage                                                       |
| ---------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`              | `lib/api.ts`                                                | Constructs the API base URL as `${NEXT_PUBLIC_API_URL}/api` |
| `NEXT_PUBLIC_DEDICATED_DEPLOYMENT` | `app/onboard/page.tsx`, `components/layout/app-sidebar.tsx` | Hides school selection UI on dedicated instances            |
| `NEXT_PUBLIC_STORAGE_URL`          | `next.config.ts`                                            | Allows direct uploads to object storage in the CSP          |
| `NEXT_PUBLIC_SAML_SP_ENTITY_ID`    | `lib/sso.ts`                                                | SP entity ID shown in Email domains > SAML                  |

> **Note**: The `NEXT_PUBLIC_` prefix makes this variable available in the browser bundle. Do **not** put secrets in `NEXT_PUBLIC_` variables.

---

## Mobile

**File**: `mobile/.env`

The Expo app. `EXPO_PUBLIC_*` variables are **inlined into the bundle at build time**, so they must be set when the bundle is built, not at runtime - and like `NEXT_PUBLIC_*`, they are readable by anyone with the app. Do not put secrets here.

| Variable              | Required             | Default            | Description                                                                                                                                                                                                              |
| --------------------- | -------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL` | **Standalone build** | derived from Metro | Backend base URL, **without** `/api` (appended automatically). Leave unset in development: the host is taken from the Expo dev server the app loaded from, so it follows your machine's address and survives a new DHCP lease. A standalone build has no dev server to ask and **throws on launch** if this is unset, rather than silently falling back to `localhost` - which on a phone means the phone. Must be HTTPS in production (see below). |

### Example `mobile/.env`

```env
# Development: leave unset - the host comes from the Expo dev server.
#
# Production/standalone builds: required, HTTPS, no /api suffix.
# EXPO_PUBLIC_API_URL=https://api.example.com
```

### Where It Is Used

| Variable              | File             | Usage                                                                                                  |
| --------------------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| `EXPO_PUBLIC_API_URL` | `src/lib/api.ts` | `resolveBaseUrl()` - overrides the Metro-derived host; the API base becomes `${EXPO_PUBLIC_API_URL}/api` |

### Resolution order

1. `EXPO_PUBLIC_API_URL`, if set.
2. The Expo dev server's host with port `3001` - covers `bun dev`, Expo Go, and `bun preview` (which builds production-mode but is still served by Metro).
3. Otherwise **throw**. A standalone build with no configured URL cannot work, and failing at launch is more useful than failing on every request.

### HTTPS is not optional in production

iOS App Transport Security is configured with `NSAllowsArbitraryLoads: false` and `NSAllowsLocalNetworking: true` - cleartext works on the local network and nowhere else. A production `http://` URL fails on iOS with no useful error.

### Backend variables that decide whether mobile works

The app has no secrets of its own; what breaks it lives on the backend.

| Backend variable      | Why mobile cares                                                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_COOKIE_DOMAIN`  | Auth is one httpOnly cookie, `gb_session`, stored by the platform's native cookie store. If the cookie's `Domain` does not cover the API's own host, the client **rejects it and every request after login is unauthenticated**, with no error pointing at it. |
| `NODE_ENV`            | `production` marks the cookie `Secure`, so the API must be served over HTTPS or the cookie is never stored.                                                                                                                                    |
| `API_URL`             | SSO sign-in from the app returns through `${API_URL}/api/auth/sso/callback`; avatar URLs are built from it, so it must be reachable from the phone. |
| `FRONTEND_URL`        | Only matters for the app served over **Expo web**, which is a browser origin and so subject to CORS. Native React Native sends no `Origin` header.                                                                                             |

See [Mobile in production](./mobile-production.md) for the full shipping checklist.

---

## Docs

The documentation site is a static Vite build with no runtime configuration - it holds no secrets and talks to nothing. One build-time variable exists:

```bash
# Base path the site is served from. Defaults to /gb/, which is correct for a
# GitHub Pages project page at github.io/gb. Set it to / for a custom domain or
# a root deployment, or /<name>/ for a differently-named repository.
# DOCS_BASE=/gb/
```

It must match where the site is actually served, because the router's `basename` is derived from it. A mismatch produces a site whose every link 404s. The Pages workflow sets nothing, so the default applies.

---

## GitHub Actions Secrets

These secrets must be configured in the repository's **Settings → Secrets and variables → Actions**.

| Secret                | Required For                            | Description                                                                  |
| --------------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| `CODECOV_TOKEN`       | `codecov.yml`                           | Upload token from [codecov.io](https://codecov.io) for test coverage reports |
| `DISCORD_WEBHOOK_URL` | `discord-merge-main.yml`, `success.yml` | Discord webhook URL for sending PR merge and workflow success notifications  |

### CI Build Variables

`ci.yml` sets none. Lint, tests and builds need no database: the backend's unit tests use mocks, and `prisma generate` (run by `bun install`, `pretest` and `build`) falls back to a placeholder `DATABASE_URL` when it is unset. Every other Prisma command still requires the real one.

---

## Quick Setup

### 1. Start the local services

```bash
bun run preload    # Postgres, Redis, S3 and Mailpit (docker-compose.dev.yml), then prisma migrate deploy
```

### 2. Create Backend `.env`

```bash
cd backend
cp .env.example .env   # defaults match docker-compose.dev.yml
```

### 3. Create Frontend `.env.local`

```bash
cd frontend
echo "NEXT_PUBLIC_API_URL=http://localhost:3001" > .env.local
```

### 4. Mobile

Nothing to do for local development - the app finds the backend through the Expo dev server. Only a standalone build needs `mobile/.env`:

```bash
cd mobile
echo "EXPO_PUBLIC_API_URL=https://api.example.com" > .env
```

### 5. Production secrets

Three are **required in production** and the backend refuses to boot without them:

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -base64 32   # CHAT_ENCRYPTION_KEY
openssl rand -base64 32   # STUDENT_CLAIM_CODE_PEPPER
```

A deployment also needs `DATABASE_URL`, the `S3_*` variables and email (`SMTP_URL`, or `SMTP_SERVICE`/`SMTP_HOST` with `SMTP_USER` and `SMTP_PASSWORD`).

`infrastructure/env.example` is the template for a deployed stack and lists all of them.

### 6. (Optional) Configure GitHub Secrets

For CI/CD features:

```
Repository → Settings → Secrets and variables → Actions → New repository secret
```

Add `CODECOV_TOKEN` and `DISCORD_WEBHOOK_URL` if using those workflows.

## Edge Functions

There are none. The one background job, `file-share-notify`, runs in the
backend as a BullMQ job, or inline when Redis is off
(`backend/src/queue/handlers/`).

---

## Security Notes

- **Never commit `.env` files** - they are in `.gitignore`
- `DATABASE_URL` carries a role that owns the schema - treat it like a database admin password. The API enforces every access rule in code; there is no row-level security behind it
- `AUTH_SECRET`, `S3_SECRET_ACCESS_KEY`, SMTP credentials and the SSO client secrets are server-only secrets
- Frontend variables prefixed with `NEXT_PUBLIC_` are embedded in the JavaScript bundle and visible to users
