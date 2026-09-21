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
| `SUPABASE_URL`                | **Yes**                  | -                       | Your Supabase project URL (e.g., `https://abcdef.supabase.co`)                                                                                                                                                                                                        |
| `SUPABASE_SERVICE_ROLE_KEY`   | **Yes**                  | -                       | Supabase service role **JWT** (starts `eyJ`). Full database access, bypasses RLS. **Keep secret.** A `sb_secret_…` key is accepted by PostgREST but **rejected by the edge function gateway**, which silently disables the dashboard, class summary, grade analytics, attendance summary and file ingest while ordinary queries keep working. |
| `SUPABASE_JWT_SECRET`         | **Prod**                 | -                       | The project's JWT secret (Supabase dashboard → Settings → API → JWT Secret). Signs the short-lived tokens clients use to upload directly to Storage over TUS, and **must belong to the same project as `SUPABASE_URL`** or Storage rejects every upload. **Required in production** — the app refuses to boot without it. Unset in dev = resumable uploads fail (with a warning at boot). |
| `SUPABASE_PUSHABLE_KEY`       | **Yes**                  | -                       | Supabase anon/public key. Used for user-context clients that respect RLS policies.                                                                                                                                                                                    |
| `NODE_ENV`                    | No                       | -                       | `production` turns on the fail-closed secret checks, marks the auth cookie `Secure`, and applies `AUTH_COOKIE_DOMAIN`. Anything else is treated as development. |
| `SUPABASE_PUBLIC_URL`         | No                       | derived                 | The Storage origin handed to clients for direct (TUS) uploads. Unset, it is derived from the request's `Host` when `SUPABASE_URL` is loopback, so a phone gets a routable address in development; a hosted `SUPABASE_URL` is used as-is. Set it only when Storage is reachable at an address the backend cannot infer. |
| `AUTH_COOKIE_DOMAIN`          | No                       | derived                 | `Domain` for the auth cookie in production. The web middleware reads this cookie on the **frontend's** domain, so it must be visible to both app and API. Derived from the last two labels of `FRONTEND_URL` when unset — set it explicitly if the API is on a different registrable domain, or the domain has a multi-part suffix (`app.example.co.uk` derives `.co.uk`, which browsers reject). `none` = host-only cookie. |
| `FRONTEND_URL`                | No                       | `http://localhost:3000` | Allowed CORS origins, **comma-separated**. The first is canonical: it is what the auth cookie domain is derived from, and the fallback for endpoints that write the CORS header by hand. In development, private/LAN origins are also accepted by shape (for the mobile app over Expo web) without being listed. |
| `PORT`                        | No                       | `3001`                  | Port the backend server listens on.                                                                                                                                                                                                                                   |
| `USE_REDIS`                   | No                       | `false`                 | Set to `true` to use Redis for caching, BullMQ queues, **and chat pub/sub fan-out**. When `false`, chat still works but delivers in-process only (single replica).                                                                                                    |
| `REDIS_URL`                   | Only if `USE_REDIS=true` | -                       | Redis connection URL (e.g., `redis://localhost:6379`).                                                                                                                                                                                                                |
| `CHAT_CHANNELS_ENABLED`       | No                       | `false`                 | Set to `true` to enable multi-participant chat channels. Direct messages are always on; see [Chat](./backend/chat.md).                                                                                                                                                |
| `CHAT_ENCRYPTION_KEY`         | **Prod**                 | -                       | Base64 of 32 random bytes (`openssl rand -base64 32`). Encrypts message content at rest (AES-256-GCM). **Required in production** — the app refuses to boot without it. Unset in dev = messages stored unencrypted (with a warning).                                  |
| `CHAT_ENCRYPTION_KEYS`        | No                       | -                       | Rotation ring: `1:<b64>,2:<b64>`. Overrides `CHAT_ENCRYPTION_KEY`. New rows use the highest version; old rows decrypt by their stored version.                                                                                                                        |
| `CHAT_ENCRYPTION_KEY_VERSION` | No                       | highest                 | Which key version to encrypt new messages with.                                                                                                                                                                                                                       |
| `STUDENT_CLAIM_CODE_PEPPER`   | **Prod**                 | -                       | Secret used to key the HMAC that hashes student claim codes (`openssl rand -base64 32`). **Required in production** - the app refuses to boot without it. Unset in dev = a well-known pepper is used (with a warning). Changing it invalidates every outstanding code.                                                  |
| `DEDICATED_DEPLOYMENT`        | No                       | `false`                 | Set to `true` for single-school dedicated instances. Blocks creation of a second school. See [Dedicated Deployment](./dedicated-deployment.md).                                                                                                                       |

### Example `backend/.env`

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...
SUPABASE_PUSHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...
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
| `SUPABASE_URL`                                      | `src/supabase/supabase.service.ts` | Creating both service and user Supabase clients              |
| `SUPABASE_SERVICE_ROLE_KEY`                         | `src/supabase/supabase.service.ts` | Service client - bypasses RLS for admin operations           |
| `SUPABASE_PUSHABLE_KEY`                             | `src/supabase/supabase.service.ts` | User client - respects RLS using the user's JWT              |
| `FRONTEND_URL`                                      | `src/createApp.ts`                 | CORS `origin` configuration                                  |
| `PORT`                                              | `src/main.ts`                      | Fastify listen port (local dev only; not used in serverless) |
| `USE_REDIS`                                         | `src/cache/cache.service.ts`       | Selects Redis store when `true`                              |
| `REDIS_URL`                                         | `src/cache/cache.service.ts`       | Redis connection URL for `ioredis`                           |

---

## Frontend

**File**: `frontend/.env.local`

| Variable                           | Required | Default                 | Description                                                                                                                                                                         |
| ---------------------------------- | -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`              | No       | `http://localhost:3001` | Backend API base URL (without `/api` - that's appended automatically)                                                                                                               |
| `NEXT_PUBLIC_DEDICATED_DEPLOYMENT` | No       | `false`                 | Set to `true` for single-school dedicated instances. Hides school selector on onboarding and school switcher in the sidebar. Must match the backend `DEDICATED_DEPLOYMENT` setting. |

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
| `AUTH_COOKIE_DOMAIN`  | Auth is httpOnly cookies, stored by the platform's native cookie store. If the cookie's `Domain` does not cover the API's own host, the client **rejects it and every request after login is unauthenticated**, with no error pointing at it. |
| `NODE_ENV`            | `production` marks the cookie `Secure`, so the API must be served over HTTPS or the cookie is never stored.                                                                                                                                    |
| `SUPABASE_JWT_SECRET` | Signs the short-lived token used for direct file uploads. Must belong to the same project as `SUPABASE_URL` or Storage rejects every upload.                                                                                                   |
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

The `ci.yml` workflow uses placeholder values for the frontend build (since the actual Supabase keys aren't needed at build time):

```yaml
env:
  NEXT_PUBLIC_SUPABASE_URL: "https://your-project.supabase.co"
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "supabase-anon-key"
```

These are dummy values to prevent the build from failing. The frontend doesn't currently read these variables at runtime - it only uses `NEXT_PUBLIC_API_URL`.

---

## Quick Setup

### 1. Get Supabase Keys

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **Settings → API**
4. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** (under "Project API keys") → `SUPABASE_SERVICE_ROLE_KEY` - use the **JWT** (starts `eyJ`), not an `sb_secret_…` key
   - **anon public key** → `SUPABASE_PUSHABLE_KEY`
   - **JWT Secret** (further down the same page) → `SUPABASE_JWT_SECRET`

### 2. Create Backend `.env`

```bash
cd backend
cp .env.example .env   # if an example exists, or create manually
# Fill in the three Supabase values
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
openssl rand -base64 32   # CHAT_ENCRYPTION_KEY
openssl rand -base64 32   # STUDENT_CLAIM_CODE_PEPPER
# SUPABASE_JWT_SECRET comes from the Supabase dashboard (step 1)
```

`infrastructure/env.example` is the template for a deployed stack and lists all of them.

### 6. (Optional) Configure GitHub Secrets

For CI/CD features:

```
Repository → Settings → Secrets and variables → Actions → New repository secret
```

Add `CODECOV_TOKEN` and `DISCORD_WEBHOOK_URL` if using those workflows.

## Supabase Edge Functions

The current data-processing Edge Functions do not require application secrets.
They use the public Supabase URL and anon key with the caller's JWT; row-level
security remains active. See [Supabase Edge Functions](./edge-functions.md) for
the deployment and authentication model.

---

## Security Notes

- **Never commit `.env` files** - they are in `.gitignore`
- `SUPABASE_SERVICE_ROLE_KEY` has **full database access** - treat it like a database admin password
- `SUPABASE_PUSHABLE_KEY` is the anon key - safe to expose in user-context clients since RLS policies protect the data
- Frontend variables prefixed with `NEXT_PUBLIC_` are embedded in the JavaScript bundle and visible to users
