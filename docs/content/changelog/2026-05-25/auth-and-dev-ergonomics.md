---
sidebar_label: 2026-05-25 · Auth + dev ergonomics
sidebar_position: 3
---

# 2026-05-25 - Auth provider refactor and dev-mode fixes

Incidental fixes that landed while building [attendance tracking](./attendance-tracking.md) and [custom grade scales](./custom-grade-scales.md). Grouped here so the feature changelogs stay focused.

## `useProfile` rebuilt as a Context provider

Each component that called `useProfile()` previously fired its own `/auth/me` request. On a dashboard page that meant the layout, the sidebar, the page itself, and the `AdminDashboard` widget all hit the endpoint independently - 4-6 requests per page load.

- New `AuthProvider` lives at `frontend/providers/AuthProvider.tsx`. It owns a single profile signal and a single in-flight Promise.
- `useProfile()` and `useAuth()` (the latter also exposes `refresh()`) are thin wrappers that read from the context - no fetch of their own.
- Mounted once in `app/layout.tsx`, so the whole app shares one fetch.
- The provider always uses `skipAuthRedirect: true` internally - a missing/invalid session doesn't cause a hard navigation just because the provider mounted. Routes that need auth (`app/dashboard/layout.tsx`) handle their own redirect to `/login`.

After login or logout, call `useAuth().refresh()` to force the provider to re-fetch.

## `SupabaseService.getUser` made non-throwing

`@supabase/auth-js` can *throw* (not just return `{ error }`) when an in-progress refresh attempt fails - e.g. when the refresh token cookie points to a session that was wiped on the server. The original `getUser` only checked `{ error }`, so the throw escaped `AuthGuard`'s `instanceof UnauthorizedException` check and logged as an "Unexpected error" while the request was already on its way to a 401.

`backend/src/supabase/supabase.service.ts` now wraps the `auth.getUser()` call in a try/catch and returns `null` on any throw. The guard reliably returns 401 instead of crashing, and the spammy stack traces stop.

## `bun run start:dev` actually runs on Bun

`nest start --watch` spawns a Node child, which crashed on `import { RedisClient } from 'bun'` in `CacheService`. The dev scripts now invoke Bun directly:

```json
"start":     "bun src/main.ts",
"start:dev": "bun --watch src/main.ts",
"start:prod": "bun --bun dist/src/main"
```

`build` still uses `nest build` (production output), so `start:prod` runs the compiled bundle. The Nest CLI's compile-time Swagger plugin is skipped in dev - Swagger docs are slightly less detailed there, but the app runs.

## Dev-only throttle relief

The throttler in `AppModule` was tuned for production (100 req/min/IP default, 5 OTP per hour). In local dev that's too tight: the `frontend/proxy.ts` middleware re-validates session cookies against `/auth/me` whenever the cookie is stale or invalid - which is the normal state right after a `supabase db reset` - and a couple of reloads burned through the quota.

`backend/src/app.module.ts` now gates the limits behind `NODE_ENV`:

- Default bucket: 1000 req/min/IP in dev, 100 in production.
- Auth-strict bucket (OTP/account-delete): 100/hour in dev, 5 in production.

Production limits are unchanged. The underlying cause - the middleware re-hitting `/auth/me` on every navigation with a non-fresh cookie - is unaddressed; caching the validation result server-side is a future task.
