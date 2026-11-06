# Account (`src/account`)

This module is GradeBook's own authentication core. It holds the user accounts (`account.app_user`), the SSO identities linked to them (`account.identity`), the passwordless email sign-in codes (`account.email_code`) and the server-side sessions (`account.session`). It has no HTTP routes of its own. The routes live in [`src/auth`](../auth/README.md) (email code sign-in, sign-out, Signed-in devices), `src/sso` (single sign-on), `src/school` (an admin signing a member out) and `src/organisation` (an organisation admin signing a user out), and they call into the services here. The module is `@Global()`, because every guarded route resolves the session cookie through `SessionService`.

## What it provides

### HTTP routes

None.

### Services / exports

`AccountModule` is `@Global()` and exports `AccountService`, `EmailCodeService` and `SessionService` (and provides `SessionAlertService`, which `SessionService` uses).

- **`AccountService`**: finds or creates users.
  - `userForVerifiedEmail(email)` finds or creates the `app_user` for an address that was just proven by an email code. A user with `email_verified_at` still null can only be a legacy row, created by an SSO sign-in before untrusted providers stopped creating users. Before the owner adopts it, one transaction marks it verified (only if still null, so a concurrent adoption does this once), revokes its sessions (`email_verified`, cache purged) and deletes its `identity` rows, so whoever made that SSO sign-in is locked out. Its profile and everything else are kept. It refuses disabled accounts with a 403, and handles two first sign-ins racing on the unique email. Then it runs the verified sign-in hooks with `{ id, email }`; a failing hook is logged and never fails the sign-in.
  - `onVerifiedSignIn(hook)` registers such a hook. `InviteService` ([`src/organisation`](../organisation/README.md#invites)) registers one at boot to apply the invites for that email, so this module does not depend on the organisation module. An SSO sign-in reaches the hooks only when it goes through `userForVerifiedEmail` (a trusted email, first linked); a sign-in by an already-linked identity does not.
  - `userForIdentity(identity, emailTrusted)` resolves an SSO sign-in. It matches by `(provider, subject)` first and updates the identity's email, claims and `last_used_at`. When there is no match, it falls back to the email address (through `userForVerifiedEmail`), but only if `emailTrusted` is true. Without it there is no new user: a 403 with "An account with this email already exists. Sign in with an email code to link it." when the address is taken, else "Your sign-in provider did not confirm this email address. Sign in with an email code instead." (both shown verbatim by `frontend/lib/sso.ts`). So an address the provider does not vouch for can never take over an account, nor create one ahead of its owner. Once the user is found or created, it links a new `identity` row to it.
- **`EmailCodeService`**: 8-digit email sign-in codes.
  Built so that someone who knows an address cannot lock its owner out: nothing they do from their own client address spends the owner's budget.
  - `send(email, ip)` allows 5 codes per (address, client) in 15 minutes (`MAX_SENDS_PER_CLIENT`) and 20 per address in an hour from anywhere (`MAX_SENDS_PER_EMAIL`, against email bombing; its 429 says codes were sent to the address, not that the caller asked too often). It issues a code and mails it with `MailService` using the `templates/sign-in-code.ts` email.
  - `issue(email, ip?)` creates a code without sending it. Earlier codes keep working. The client is stored only as a keyed hash (`hashClient`). The dev-only `POST /api/auth/dev/code` route uses it.
  - **Purpose.** Every code has a `purpose` (`account.email_code.purpose`): `sign_in` (the default) or `step_up` (`send/issue/verify(..., 'step_up')`, the "Confirm it's you" code before changing single sign-on settings; see [src/auth](../auth/README.md)). Sends are counted, live codes looked up and codes used up per purpose, and a non-sign-in purpose is bound into the hash too, so a sign-in code never confirms a step-up and a step-up code never signs in. Step-up codes are mailed with `templates/step-up-code.ts`.
  - `verify(email, code, ip)` tries the code against every live (unused, unexpired) code for the address and, on a match, consumes all of them. Each guess first takes an attempt at every live code, conditionally: per (code, client) in `account.email_code_attempt` (`MAX_ATTEMPTS_PER_CLIENT`, 5) and in total in `email_code.attempts` (`MAX_TOTAL_ATTEMPTS`, 25, which ends the code for everyone). With at most 20 codes an hour, that is at most 500 guesses an hour at 1 in 10^8 each. Codes are valid for 5 minutes, compared in constant time, and the matched code is consumed with a conditional update so it signs in once. Every failure is the same 401.
- **`SessionService`**: HttpOnly cookie sessions for the web, bearer tokens for the mobile app. `sessionTokenFrom(req)` reads the `gb_session` cookie, else an `Authorization: Bearer <token>` header (same token). When a sign-in request carries `X-GradeBook-Client: native` and no `Origin` header, `create()` also returns the new token in an `X-Session-Token` response header (with `Cache-Control: no-store`); the app keeps it in the device keychain (`mobile/src/lib/session-token.ts`), because native cookie storage drops `Secure` cookies over http and is unreliable across LAN addresses.
  - `create(reply, req, userId, method)` stores a session row (holding only a SHA-256 hash of the token, plus the user agent, a device label, the IP and `absolute_expires_at`), updates `app_user.last_sign_in_at` and sets the `gb_session` cookie. The device label comes from `device-label.ts` ("Chrome on macOS"; for the app, the `X-GradeBook-Device` header: "GradeBook app on iPhone 15 (iOS 19.0)"). When this device label + method was not seen for the user in 90 days (`account.known_device`, or for sessions from before device labels, the same user agent) and it is not the account's first sign-in, it fires a **"New sign-in to GradeBook"** email (fire and forget).
  - **Lifetime.** The expiry slides by 30 days (`SESSION_TTL_MS`) but is always capped at `absolute_expires_at`, `SESSION_MAX_AGE_DAYS` (default 90) after sign-in. Past either, the session is dead: 401, cookie cleared, and the app drops its token.
  - `resolve(req, reply?)` returns `{ sessionId, userId, email, elevatedUntil }` or `null`. Lookups are cached for 60 seconds under `session:<hash>`, with the expiry in the entry so a cached session never outlives it. Revoked, expired or disabled sessions clear the cookie.
  - **Rotation.** When a session is used more than a day after its last renewal, `resolve()` renews it and **replaces the token**: one conditional `updateMany` on the current hash moves it to `previous_token_hash`, stores the new hash and sets `rotated_at`, `last_seen_at` and the new (capped) expiry. The new token (`rotatedToken(old)`, derived from the old one with `AUTH_SECRET`) goes out as the cookie for a cookie session and as `X-Session-Token` (with `Cache-Control: no-store`) for a bearer-token session only, on whatever status the response ends with. Two requests renewing at once derive the same token, so only one update wins and both hand out the same token.
  - **Grace and reuse.** The replaced token keeps working for `SESSION_ROTATION_GRACE_SECONDS` (default 120) after `rotated_at`, and each such request gets the current token again. Presented later, it still recovers the session (current token handed over again) for up to `LOST_ROTATION_GRACE_MS` (24 h) when the client plainly never got the rotation: the request has the session's user agent and the new token was never presented (`rotation_confirmed_at` null; set on its first use, and the new token is not cached until then). Otherwise it must be a copy: the whole session is revoked (`revoked_reason = 'token_reuse'`), the cookie cleared, a warning logged and a **"Suspicious activity"** email sent. Tokens older than the previous one match no row: a plain 401.
  - `list(userId, currentSessionId)`: the user's live sessions for Signed-in devices (`SessionSummary`: id, current, method, device, ip, createdAt, lastSeenAt, expiresAt; never hashes).
  - `revokeOwn(userId, sessionId, currentSessionId)` (404 for anyone else's), `revokeOthers(userId, currentSessionId)`, `revoke(req, reply, reason?)` (this device) and `revokeAll(userId, reason?)` (everywhere; returns the count). Every revocation stores `revoked_reason` and deletes the `session:<hash>` cache entries of the current **and** previous token, then once more a second later (for a lookup that was mid-flight), so it takes effect on the next request.
  - `elevate(sessionId)` (step-up): sets the live session's `elevated_until` to now + `STEP_UP_WINDOW_MS` (10 minutes) and drops its cached lookups (current and previous token, then again a second later), so the next request sees it; 404 for a revoked or unknown session. `resolve` carries `elevatedUntil` (ms, or null) from the row or the cache; the window is compared when used, so a cached entry never extends it.
  - `clearCookie(reply)` for controllers that end the current session.
- **`SessionAlertService`**: the security emails. `newSignIn()` and `tokenReuse()` look up the address, pick the link (`<FRONTEND_URL>/portal/settings#devices` for students, `/dashboard/settings#devices` for staff) and send through `MailService`. Off with `SESSION_ALERTS_ENABLED=false`; skipped (logged) when SMTP is not configured; never throws.

### Other exported helpers

- `session.service.ts`:
  - `SESSION_COOKIE` (`'gb_session'`), `SESSION_TTL_MS` (30 days), `RENEW_AFTER_MS` (1 day), `STEP_UP_WINDOW_MS` (10 minutes), `RevokeReason`, `SessionSummary`.
  - `rotatedToken(token)` (the token a rotation replaces `token` with) and `deviceFingerprint(method, device)`.
  - `isIssuedSessionToken(token)` checks the HMAC tag on a cookie value without touching the database. The rate limiter uses it to give real sessions their own bucket.
- `email-code.service.ts`: `CODE_LENGTH` (8), `normalizeEmail()` (trim and lowercase), `CodePurpose`, `hashCode(email, code, purpose?)` (an HMAC-SHA256 of `email:code`, prefixed with the purpose for anything but sign-in, keyed with the auth secret), `hashClient()` (the same for a client address) and the caps `MAX_ATTEMPTS_PER_CLIENT`, `MAX_TOTAL_ATTEMPTS`, `MAX_SENDS_PER_CLIENT`, `MAX_SENDS_PER_EMAIL`.
- `secret.ts`: `authSecret()` returns `AUTH_SECRET`. It throws in production when the secret is missing or shorter than 32 characters. In development it falls back to a fixed insecure value and logs a warning once. `dataEncryptionKey()` returns the optional `DATA_ENCRYPTION_KEY` (null when unset; throws when set but shorter than 32 characters).
- `secret-box.ts`: `sealSecret(info, aad, plaintext)` / `openSecret(info, aad, stored)`, AES-256-GCM for secrets stored in the database (webhook secrets and header values, school SSO client secrets), with an HKDF-SHA256 key per `info`. The stored prefix says which root key: `v1:<iv>:<tag>:<ct>` is `AUTH_SECRET` (every value written before `DATA_ENCRYPTION_KEY`, and while it is unset); `v2:<kid>:<iv>:<tag>:<ct>` is `DATA_ENCRYPTION_KEY`, `kid` being a 12-hex fingerprint of it (`dataKeyId`). New values use `DATA_ENCRYPTION_KEY` when set. `openSecret` returns null on any failure, including a `v2` value under another key. `storedKeyId()` and `isSealedWithCurrentDataKey()` tell which key a value uses.
- `secret-rotation.ts`: `reencryptStoredSecrets(prisma, { dryRun })` rewrites every `v1` secret as `v2` (compare-and-set per row, idempotent) and `resignErasureLog(storage, { dryRun })` re-signs erasure-log copies that verify only under the `AUTH_SECRET` key. Run by `bun run secrets:reencrypt` ([scripts/reencrypt-secrets.ts](../../scripts/reencrypt-secrets.ts)) before rotating `AUTH_SECRET`; see `DATA_ENCRYPTION_KEY` in the environment variables doc.
- `templates/`: `signInCodeEmail(code)`, `stepUpCodeEmail(code)`, `newSignInEmail(...)`, `tokenReuseEmail(...)`. See [templates/README.md](./templates/README.md).
- `device-label.ts`: `deviceLabel(userAgent, deviceHeader?, native?)` and `DEVICE_HEADER`.
- `session.config.ts`: `sessionMaxAgeMs()`, `rotationGraceMs()`, `sessionAlertsEnabled()`, `KNOWN_DEVICE_WINDOW_MS` (90 days).

## Used by

- `src/app.module.ts` imports `AccountModule`.
- `src/auth/auth.service.ts`:
  - `EmailCodeService.send/issue/verify` for the email code routes;
  - `AccountService.userForVerifiedEmail()` after a code is verified;
  - `SessionService.create()` to start the session and `SessionService.revokeAll()` on account deletion;
  - `SESSION_TTL_MS` to report the session expiry.
- `src/auth/auth.guard.ts` calls `SessionService.resolve()` on every guarded request (and puts `sessionId` and `elevatedUntil` on `req.user`) and `revoke()` for deactivated profiles. `src/auth/auth.controller.ts` calls `revoke()` on `POST /api/auth/logout` and `list`, `revokeOwn`, `revokeOthers`, `revokeAll` for the `/api/auth/sessions` routes.
- `src/auth/step-up.service.ts` calls `EmailCodeService.send/verify/issue(..., 'step_up')` and `SessionService.elevate()`.
- `src/school/school.service.ts` (`revokeMemberSessions`) and `src/organisation/organisation.service.ts` (`revokeUserSessions`, reason `organisation_admin`) call `revokeAll()` for admins signing someone out.
- `src/retention/retention.service.ts` purges ended sessions and unused `known_device` rows (`KNOWN_DEVICE_WINDOW_MS`).
- `src/sso/sso.service.ts` calls `AccountService.userForIdentity()` and `SessionService.create()` (for the provider sign-in and the mobile handoff).
- `src/throttle/tracker.ts` (and its test) uses `SESSION_COOKIE` and `isIssuedSessionToken()` to key rate limits by session.
- `frontend/proxy.ts` checks for the `gb_session` cookie.

## Depends on

- `PrismaService` (global).
- `CacheService` (global) for session lookups.
- `MailService` (`src/mail`, global) to send codes and security alerts.
- `primaryOrigin()` from `src/config/origins.ts` for the links in the alerts.
- `authCookieDomain()` from `src/config/origins.ts`, which sets the cookie domain.

## Data

These tables are in the `account` Postgres schema, defined in [`prisma/schema/account.prisma`](../../prisma/schema/account.prisma):

- `account.app_user`: read and written (create, `email_verified_at`, `last_sign_in_at`).
- `account.identity`: read and written by `userForIdentity`.
- `account.email_code`: read and written by `EmailCodeService` (`ip_hash` and `account.email_code_attempt`, wrong guesses per code and client, added by `20261027130000_sign_in_codes`; `purpose`, CHECK `sign_in` / `step_up`, added by `20261103130000_sso_audit`).
- `account.session`: read and written by `SessionService` (columns added by `20261026100000_session_hardening`: `absolute_expires_at`, `previous_token_hash` (unique), `rotated_at`, `revoked_reason`, `device`; `elevated_until` by `20261103130000_sso_audit`).
- `account.known_device`: `(user_id, fingerprint)` with `first_seen_at` / `last_seen_at`, refreshed at sign-in and each rotation; no IPs or user agents.

## Configuration

| Variable | Default | Used for |
|----------|---------|----------|
| `AUTH_SECRET` | Development: a fixed insecure value. Production: required, 32 or more characters. | Keys the hashes of sign-in codes and the session token tags. |
| `NODE_ENV` | | `production` makes the cookie `Secure` and makes `AUTH_SECRET` mandatory. |
| `SESSION_MAX_AGE_DAYS` | `90` | Absolute session lifetime from sign-in, however active. |
| `SESSION_ROTATION_GRACE_SECONDS` | `120` | How long a replaced token still works after a rotation. |
| `SESSION_ALERTS_ENABLED` | `true` | `false` turns off the new sign-in and token reuse emails. |
| `AUTH_COOKIE_DOMAIN` | Read indirectly through `authCookieDomain()` in `src/config/origins.ts`. Production only: when unset, the domain is derived from the primary origin; `none` means no domain. | The cookie domain. |

## Files

| File | Purpose |
|------|---------|
| `account.module.ts` | Global module that provides and exports the three services. |
| `account.service.ts` | `AccountService`: users and linked SSO identities. |
| `email-code.service.ts` | `EmailCodeService` and the `normalizeEmail`, `hashCode` and `CODE_LENGTH` exports. |
| `session.service.ts` | `SessionService`, the cookie constants, `isIssuedSessionToken`, `rotatedToken`, `deviceFingerprint`. |
| `session-alert.service.ts` | `SessionAlertService`: the new sign-in and token reuse emails. |
| `session.config.ts` | The session settings read from the environment. |
| `device-label.ts` | `deviceLabel()`: friendly device names from the user agent or the app's device header. |
| `secret.ts` | `authSecret()`, `dataEncryptionKey()`. |
| `secret-box.ts` | Versioned AES-256-GCM for stored secrets (`v1` = `AUTH_SECRET`, `v2` = `DATA_ENCRYPTION_KEY`). |
| `secret-rotation.ts` | Re-encrypt stored secrets and re-sign erasure-log copies under `DATA_ENCRYPTION_KEY`. |
| `templates/` | The sign-in code, step-up code, new sign-in and token reuse emails. See [templates/README.md](./templates/README.md). |
| `account.test.ts` | Tests for `EmailCodeService`, `SessionService`, `SessionAlertService` and `deviceLabel`. |

## Tests

```bash
cd backend && bun test src/account
```

`account.test.ts` covers:

- **Codes**: an 8-digit code is sent and the previous one retired; sending is refused after five codes in the window; a correct code works only once; a wrong code counts an attempt; expired codes and exhausted attempts are refused.
- **Step-up codes**: mailed as a confirmation with a purpose-bound hash; a sign-in code cannot confirm a step-up and a step-up code cannot sign in; confirming uses up only step-up codes; the same per-client attempt limit; send caps counted per purpose.
- **Step-up sessions**: a new session is not elevated; `elevate` sets ten minutes on that session only, drops its cached lookup at once and the next lookups (database, then cache) carry it; a revoked session cannot be elevated.
- **Sessions** (against an in-memory session table): only a hash of the token is stored, with the device label and both expiries; `SESSION_MAX_AGE_DAYS` caps the first expiry; the app gets its token in a header; `resolve` caches the user, and a cached entry never outlives its expiry; revoked, expired, past-the-absolute-lifetime and disabled sessions return null and clear the cookie; sliding renewal is capped at the absolute lifetime.
- **Rotation**: the daily renewal issues a new token (cookie for the web, `X-Session-Token` for a bearer token); the replaced token works within the grace period and gets the new token again; after it, the whole session is revoked (`token_reuse`), the user is alerted and the new token dies too; an older token is a plain 401; two concurrent renewals rotate once and hand out the same token.
- **Signed-in devices**: listing (own live sessions, current first, no hashes); revoking your own session, someone else's is a 404; revoke-others; revocation drops the cache entries; logout.
- **Alerts**: none on a new account's first sign-in; one for a new device, none for a known one (even after its session was purged); a device unused for 90 days is new; daily use keeps it known; legacy sessions match on the user agent; `SESSION_ALERTS_ENABLED=false`; a failing check never fails sign-in. `SessionAlertService` escapes HTML, links students to the portal, skips without SMTP and swallows send failures.
- **`deviceLabel`**: browsers and systems, the app's device header (percent-encoded or plain, cleaned, bounded).

## See also

- [Auth module](../auth/README.md) (the HTTP routes that use these services)
- [docs/content/backend/auth.md](../../../docs/content/backend/auth.md)
- [Cache module](../cache/README.md)
- `src/sso/` (single sign-on)
