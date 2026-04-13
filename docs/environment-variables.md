# Environment Variables

This document lists every environment variable used across the project - backend, frontend, and CI/CD workflows.

No `.env` files are committed to the repository. You must create them manually in each workspace.

---

## Backend

**File**: `backend/.env`

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SUPABASE_URL` | **Yes** | - | Your Supabase project URL (e.g., `https://abcdef.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | - | Supabase service role key. Has full database access, bypasses RLS. **Keep secret.** |
| `SUPABASE_PUSHABLE_KEY` | **Yes** | - | Supabase anon/public key. Used for user-context clients that respect RLS policies. |
| `FRONTEND_URL` | No | `http://localhost:3000` | Allowed CORS origin. Set to your frontend's production URL in deployment. |
| `PORT` | No | `3001` | Port the backend server listens on. |
| `USE_REDIS` | No | `false` | Set to `true` to use Redis for caching instead of in-memory. |
| `REDIS_URL` | Only if `USE_REDIS=true` | - | Redis connection URL (e.g., `redis://localhost:6379`). |

### Example `backend/.env`

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...
SUPABASE_PUSHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...
FRONTEND_URL=http://localhost:3000
PORT=3001
USE_REDIS=false
# REDIS_URL=redis://localhost:6379
```

### Where Each Variable Is Used

| Variable | File | Usage |
|----------|------|-------|
| `SUPABASE_URL` | `src/supabase/supabase.service.ts` | Creating both service and user Supabase clients |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/supabase/supabase.service.ts` | Service client - bypasses RLS for admin operations |
| `SUPABASE_PUSHABLE_KEY` | `src/supabase/supabase.service.ts` | User client - respects RLS using the user's JWT |
| `FRONTEND_URL` | `src/main.ts` | CORS `origin` configuration |
| `PORT` | `src/main.ts` | Fastify listen port |
| `USE_REDIS` | `src/cache/cache.service.ts` | Selects Redis store when `true` |
| `REDIS_URL` | `src/cache/cache.service.ts` | Redis connection URL for `ioredis` |

---

## Frontend

**File**: `frontend/.env.local`

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:3001` | Backend API base URL (without `/api/v1` - that's appended automatically) |

### Example `frontend/.env.local`

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### Where It Is Used

| Variable | File | Usage |
|----------|------|-------|
| `NEXT_PUBLIC_API_URL` | `lib/api.ts` | Constructs the API base URL as `${NEXT_PUBLIC_API_URL}/api/v1` |

> **Note**: The `NEXT_PUBLIC_` prefix makes this variable available in the browser bundle. Do **not** put secrets in `NEXT_PUBLIC_` variables.

---

## GitHub Actions Secrets

These secrets must be configured in the repository's **Settings → Secrets and variables → Actions**.

| Secret | Required For | Description |
|--------|-------------|-------------|
| `CODECOV_TOKEN` | `codecov.yml` | Upload token from [codecov.io](https://codecov.io) for test coverage reports |
| `DISCORD_WEBHOOK_URL` | `discord-merge-main.yml`, `success.yml` | Discord webhook URL for sending PR merge and workflow success notifications |

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
   - **service_role key** (under "Project API keys") → `SUPABASE_SERVICE_ROLE_KEY`
   - **anon public key** → `SUPABASE_PUSHABLE_KEY`

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

### 4. (Optional) Configure GitHub Secrets

For CI/CD features:

```
Repository → Settings → Secrets and variables → Actions → New repository secret
```

Add `CODECOV_TOKEN` and `DISCORD_WEBHOOK_URL` if using those workflows.

---

## Security Notes

- **Never commit `.env` files** - they are in `.gitignore`
- `SUPABASE_SERVICE_ROLE_KEY` has **full database access** - treat it like a database admin password
- `SUPABASE_PUSHABLE_KEY` is the anon key - safe to expose in user-context clients since RLS policies protect the data
- Frontend variables prefixed with `NEXT_PUBLIC_` are embedded in the JavaScript bundle and visible to users
