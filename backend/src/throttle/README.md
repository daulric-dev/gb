# Throttle (`src/throttle`)

How rate-limit buckets are keyed. The limits themselves are configured in `src/app.module.ts` with `@nestjs/throttler`; this folder holds the functions that decide **who** a request counts against.

Two rules drive it:

- **Client IP comes only from Fastify's `req.ip`.** `X-Forwarded-For` and `X-Real-IP` are never read directly, because clients can set them. Fastify resolves `req.ip` through `trustProxy`, which `src/createApp.ts` sets to trust `TRUST_PROXY_HOPS` hops (default 1, the bundled nginx).
- **A signed-in session gets its own bucket**, keyed on the `gb_session` cookie - but only if the cookie looks like a token this server issued (`isIssuedSessionToken()`, a tag check with no database lookup). The throttler runs before `AuthGuard`, so without that check a client could rotate made-up cookies to get a fresh bucket per request. The bucket key is a truncated SHA-256 fingerprint, never the token.

## What it provides

- **HTTP routes** - none.
- **Exports** (`tracker.ts`, plain functions, not a Nest module):
  - `getClientIp(req)` - `req.ip`, or undefined.
  - `getSessionTracker(req)` - `s:<fingerprint>` for an issued session cookie, else undefined.
  - `fingerprint(value)` - first 22 characters of the base64url SHA-256.
  - `ThrottlerReq` - the request shape the trackers read (`body.email`, `headers`, `cookies`, `ip`).

## Used by

`src/app.module.ts` is the only importer. It registers four named throttlers (limits are per window; development limits are 100 000 so local work is never throttled):

| Throttler | Window | Production limit | Tracker |
| --- | --- | --- | --- |
| `default` | 60 s | 1 200 | session (`getSessionTracker`), else `ip:<getClientIp>` |
| `auth-strict` | 1 h | 10 000 | the request body's `email` (lower-cased), else IP |
| `auth-ip` | 1 h | 10 000 | `ip:<getClientIp>` |
| `claim-code` | 15 min | 10 000 | session, else IP |

Every throttler applies to every route through the global `ThrottlerGuard`; individual routes lower the limits with `@Throttle({ '<name>': { limit, ttl } })`. Storage keys are `default:<tracker>` for the default throttler and `<name>:<Controller>.<handler>:<tracker>` for the others, so a per-route override only counts calls to that route. Current overrides:

- `src/auth/auth.controller.ts` - `auth-strict` on `otp/send` (5/h) and `otp/verify` (10 per 15 min), `claim-code` on `join-school`, `default` on account deletion (3/h).
- `src/sso/sso.controller.ts` - `auth-ip` on `discover`, `saml/acs`, `:provider/start`, `handoff`.
- `claim-code` on guessable codes: `src/student-portal/student-portal.controller.ts` (course join), `src/email-domain/email-domain.controller.ts`, `src/attendance/portal-attendance.controller.ts`, `src/attendance/scan-claim.controller.ts`.
- `src/billing/billing-webhook.controller.ts` uses `@SkipThrottle()` (provider webhooks).

## Depends on

- `SESSION_COOKIE` and `isIssuedSessionToken()` from `src/account/session.service.ts`.
- `node:crypto`.

## Data

None. Throttler counters live in `@nestjs/throttler`'s default in-memory storage, so each API instance counts separately.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `TRUST_PROXY_HOPS` | `1` | Read by `src/createApp.ts`: how many proxies Fastify trusts when computing `req.ip`. Set it to the real number of proxies in front of the API, or every client shares one bucket (too few) or clients can spoof their IP (too many). |
| `NODE_ENV` | - | Read by `src/app.module.ts`: `production` selects the production limits. |

## Files

| File | Purpose |
| --- | --- |
| `tracker.ts` | The tracker functions above. |
| `tracker.test.ts` | Tests: uses `req.ip`, ignores client-sent proxy headers, undefined when nothing identifies the client, keys issued session cookies by session, made-up or tampered cookies get no bucket, never leaks the token, ignores bearer headers and other cookies. |

## Tests

```bash
cd backend && bun test src/throttle
```

## See also

- [src/account/README.md](../account/README.md) (session tokens), [src/README.md](../README.md) (request flow)
- [docs/content/environment-variables.md](../../../docs/content/environment-variables.md)
