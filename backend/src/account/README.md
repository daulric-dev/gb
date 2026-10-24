# Account (`src/account`)

This module is GradeBook's own authentication core. It holds the user accounts (`account.app_user`), the SSO identities linked to them (`account.identity`), the passwordless email sign-in codes (`account.email_code`) and the server-side sessions (`account.session`). It has no HTTP routes of its own. The routes live in [`src/auth`](../auth/README.md) (email code sign-in, sign-out) and `src/sso` (single sign-on), and both call into the services here. The module is `@Global()`, because every guarded route resolves the session cookie through `SessionService`.

## What it provides

### HTTP routes

None.

### Services / exports

`AccountModule` is `@Global()` and exports all three services.

- **`AccountService`**: finds or creates users.
  - `userForVerifiedEmail(email)` finds or creates the `app_user` for an address that was just proven by an email code. It sets `email_verified_at` if it was not set yet, refuses disabled accounts with a 403, and handles two first sign-ins racing on the unique email.
  - `userForIdentity(identity, emailTrusted)` resolves an SSO sign-in. It matches by `(provider, subject)` first and updates the identity's email, claims and `last_used_at`. When there is no match, it falls back to the email address, but only if `emailTrusted` is true. An address the provider does not vouch for can never take over an existing account. Once the user is found or created, it links a new `identity` row to it.
- **`EmailCodeService`**: 8-digit email sign-in codes.
  - `send(email)` allows at most 5 codes per address in a 15-minute window and answers 429 after that. It issues a code and mails it with `MailService` using the `templates/sign-in-code.ts` email.
  - `issue(email)` creates a code without sending it. Any unused code for the same address is retired in the same transaction. The dev-only `POST /api/auth/dev/code` route uses it.
  - `verify(email, code)` checks the newest unused code. A code is valid for 10 minutes and allows up to 5 wrong attempts. The hash comparison is constant-time, and the code is consumed with a conditional update so it can only be used once. Every failure is the same 401.
- **`SessionService`**: HttpOnly cookie sessions.
  - `create(reply, req, userId, method)` stores a session row (holding only a SHA-256 hash of the token, plus the user agent and IP), updates `app_user.last_sign_in_at` and sets the `gb_session` cookie. Sessions last 30 days.
  - `resolve(req, reply?)` returns `{ sessionId, userId, email }` or `null`. Lookups are cached for 60 seconds under `session:<hash>`. Revoked, expired or disabled sessions clear the cookie. The expiry slides: after a day of use the session is extended by another 30 days, and this is written at most once a day.
  - `revoke(req, reply)` signs out the current device. `revokeAll(userId)` signs a user out everywhere and drops their cached sessions.

### Other exported helpers

- `session.service.ts`:
  - `SESSION_COOKIE` (`'gb_session'`) and `SESSION_TTL_MS` (30 days).
  - `isIssuedSessionToken(token)` checks the HMAC tag on a cookie value without touching the database. The rate limiter uses it to give real sessions their own bucket.
- `email-code.service.ts`: `CODE_LENGTH` (8), `normalizeEmail()` (trim and lowercase) and `hashCode()` (an HMAC-SHA256 of `email:code` keyed with the auth secret).
- `secret.ts`: `authSecret()` returns `AUTH_SECRET`. It throws in production when the secret is missing or shorter than 32 characters. In development it falls back to a fixed insecure value and logs a warning once.
- `templates/sign-in-code.ts`: `signInCodeEmail(code)`. See [templates/README.md](./templates/README.md).

## Used by

- `src/app.module.ts` imports `AccountModule`.
- `src/auth/auth.service.ts`:
  - `EmailCodeService.send/issue/verify` for the email code routes;
  - `AccountService.userForVerifiedEmail()` after a code is verified;
  - `SessionService.create()` to start the session and `SessionService.revokeAll()` on account deletion;
  - `SESSION_TTL_MS` to report the session expiry.
- `src/auth/auth.guard.ts` calls `SessionService.resolve()` on every guarded request and `revoke()` for deactivated profiles. `src/auth/auth.controller.ts` calls `revoke()` on `POST /api/auth/logout`.
- `src/sso/sso.service.ts` calls `AccountService.userForIdentity()` and `SessionService.create()` (for the provider sign-in and the mobile handoff).
- `src/throttle/tracker.ts` (and its test) uses `SESSION_COOKIE` and `isIssuedSessionToken()` to key rate limits by session.
- `frontend/proxy.ts` checks for the `gb_session` cookie.

## Depends on

- `PrismaService` (global).
- `CacheService` (global) for session lookups.
- `MailService` (`src/mail`, global) to send codes.
- `authCookieDomain()` from `src/config/origins.ts`, which sets the cookie domain.

## Data

These tables are in the `account` Postgres schema, defined in [`prisma/schema/account.prisma`](../../prisma/schema/account.prisma):

- `account.app_user`: read and written (create, `email_verified_at`, `last_sign_in_at`).
- `account.identity`: read and written by `userForIdentity`.
- `account.email_code`: read and written by `EmailCodeService`.
- `account.session`: read and written by `SessionService`.

## Configuration

| Variable | Default | Used for |
|----------|---------|----------|
| `AUTH_SECRET` | Development: a fixed insecure value. Production: required, 32 or more characters. | Keys the hashes of sign-in codes and the session token tags. |
| `NODE_ENV` | | `production` makes the cookie `Secure` and makes `AUTH_SECRET` mandatory. |
| `AUTH_COOKIE_DOMAIN` | Read indirectly through `authCookieDomain()` in `src/config/origins.ts`. Production only: when unset, the domain is derived from the primary origin; `none` means no domain. | The cookie domain. |

## Files

| File | Purpose |
|------|---------|
| `account.module.ts` | Global module that provides and exports the three services. |
| `account.service.ts` | `AccountService`: users and linked SSO identities. |
| `email-code.service.ts` | `EmailCodeService` and the `normalizeEmail`, `hashCode` and `CODE_LENGTH` exports. |
| `session.service.ts` | `SessionService`, the cookie constants and `isIssuedSessionToken`. |
| `secret.ts` | `authSecret()`. |
| `templates/` | The sign-in code email. See [templates/README.md](./templates/README.md). |
| `account.test.ts` | Tests for `EmailCodeService` and `SessionService`. |

## Tests

```bash
cd backend && bun test src/account
```

`account.test.ts` covers:

- **Codes**: an 8-digit code is sent and the previous one retired; sending is refused after five codes in the window; a correct code works only once; a wrong code counts an attempt; expired codes and exhausted attempts are refused.
- **Sessions**: only a hash of the token is stored; `resolve` caches the user; revoked, expired and disabled sessions return null and clear the cookie; the expiry slides after an idle day; a request without a cookie does no lookup.

## See also

- [Auth module](../auth/README.md) (the HTTP routes that use these services)
- [docs/content/backend/auth.md](../../../docs/content/backend/auth.md)
- [Cache module](../cache/README.md)
- `src/sso/` (single sign-on)
