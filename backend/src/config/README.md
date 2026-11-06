# Config (`src/config`)

Shared configuration helpers. At the moment the folder holds one file, `origins.ts`, which is the single place the backend decides which browser origins may call the API, what to put in a hand-written CORS header, and which `Domain` to give the auth cookie. It is not a Nest module; callers import the functions directly.

`FRONTEND_URL` is a comma-separated list because the web app is not the only browser client: the mobile app running over Expo web comes from its own origin, and a developer's LAN address differs again. Native React Native sends no `Origin` header at all, so none of these checks apply to it. Several callers write `Access-Control-Allow-Origin` by hand and one derives the cookie domain from the origin, and a raw comma-separated list would be invalid for both, so everything goes through these helpers.

## What it provides

| Export | What it does |
|--------|--------------|
| `allowedOrigins()` | The configured origins from `FRONTEND_URL`, split on commas and trimmed; `['http://localhost:3000']` if unset or empty. |
| `primaryOrigin()` | The first configured origin, used where a single value is required (web links, cookie domain, redirect targets). |
| `corsOriginFor(requestOrigin)` | The value for `Access-Control-Allow-Origin` on one request: the request's own origin if it is allowed, otherwise the primary origin. |
| `isOriginAllowed(origin)` | True when there is no `Origin` header (same-origin, curl, native app), when the origin is configured, or, outside production, when it is a localhost / private-network (`10.x`, `192.168.x`, `172.16-31.x`) address. |
| `isDevelopmentOrigin(origin)` | Outside production, whether an origin is localhost or a private-network address. Used by `isOriginAllowed`, `corsOriginFor` and the CSRF check in `src/common/csrf.ts`. |
| `authCookieDomain()` | `undefined` outside production. In production: `AUTH_COOKIE_DOMAIN` if set (`none` means a host-only cookie), otherwise a parent domain derived from the last two labels of the primary origin (for example `.example.com`). |

## Used by

- `src/createApp.ts` - `enableCors` origin callback uses `isOriginAllowed`.
- `src/common/csrf.ts` - the CSRF origin check uses `allowedOrigins()` and `isDevelopmentOrigin()`.
- `src/attendance/sse.ts` and `src/chat/chat.controller.ts` - hand-written CORS headers on server-sent-event streams use `corsOriginFor`.
- `src/attendance/attendance.service.ts` - builds the QR scan link `${primaryOrigin()}/scan?...`.
- `src/storage/storage.service.ts` - bucket CORS rules use `allowedOrigins()` (plus `http://localhost:3000`).
- `src/sso/sso.service.ts` - post-login and error redirects to `primaryOrigin()`.
- `src/account/session.service.ts` - sets and clears the session cookie with `authCookieDomain()`.

## Depends on

Nothing but `process.env`.

## Data

None.

## Configuration

| Variable | Default | Effect |
|----------|---------|--------|
| `FRONTEND_URL` | `http://localhost:3000` | Comma-separated allowed origins; the first is canonical. |
| `AUTH_COOKIE_DOMAIN` | derived from the primary origin | Production cookie `Domain`; `none` for host-only. Needed when the API is on a different registrable domain from the app, or when the domain has a multi-part suffix such as `.co.uk`. |
| `NODE_ENV` | (unset) | Anything other than `production` enables LAN origins and disables the cookie domain. |
| `API_URL` | (unset) | The API's public origin. Required in production (checked by `startup.ts`). |

## Files

| File | Purpose |
|------|---------|
| `origins.ts` | Allowed origins, CORS header value, origin check and auth cookie domain. |
| `startup.ts` | `validateStartupConfig()`, run by `main.ts` before the app is built. Requires a PostgreSQL `DATABASE_URL`; in production an `AUTH_SECRET` of 32+ characters and an `API_URL` that is an absolute `https://` URL (`http://` only for `localhost`, `127.0.0.1`, `[::1]`); a Redis `REDIS_URL` when `USE_REDIS=true`; `WEBHOOK_ALLOW_PRIVATE` of `true`/`false`. `API_URL` is required because SSO redirect / SAML ACS URLs and avatar links are built from it, and production never falls back to the client-controlled `Host` header. |
| `startup.test.ts`, `host-header.test.ts` | Startup validation; and that `apiBase()` / `publicImageUrl()` use `API_URL` and ignore the `Host` header in production while still falling back to it in development. |
| `origins.test.ts` | Unit tests (see Tests). |

## Tests

```bash
cd backend && bun test src/config
```

`origins.test.ts` saves and restores `FRONTEND_URL`, `AUTH_COOKIE_DOMAIN` and `NODE_ENV` around each test and covers:

- `allowedOrigins` / `primaryOrigin`: default when unset, empty or only commas; splitting, trimming and dropping blanks; first entry is primary.
- `corsOriginFor`: echoes a configured origin, falls back to the primary for unknown, missing or non-exact (trailing slash, different case) origins; echoes a LAN origin only outside production.
- `isOriginAllowed`: no `Origin` header is always allowed; configured origins in any environment; a table of private-network origins accepted in development (`localhost`, `127.0.0.1`, `[::1]`, `10.x`, `192.168.x`, `172.16-31.x`) and look-alikes rejected (`172.15/172.32`, `localhost.evil.test`, paths, non-http schemes); LAN origins rejected in production unless listed; any `NODE_ENV` other than `production` counts as development.
- `authCookieDomain`: `undefined` outside production; trimmed override; `none` in any case means host-only; a blank override falls back to deriving; derivation from the last two labels (ports ignored); the documented `.co.uk` limitation; an unparseable origin gives `undefined`.
- A `test.todo` records that an IP-address primary origin (`http://10.0.0.5:3000`) derives the nonsense domain `.0.5` instead of a host-only cookie.

## See also

- [Environment variables](../../../docs/content/environment-variables.md)
- [Auth](../../../docs/content/backend/auth.md)
- [common README](../common/README.md)
