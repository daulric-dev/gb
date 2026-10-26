---
sidebar_label: 2026-10-26 · Session security
sidebar_position: 1
---

# 2026-10-26 - Session security: lifetime cap, signed-in devices, token rotation, sign-in alerts

Sessions were opaque tokens with a 30-day sliding expiry that could be renewed
forever, cached for a minute (so a revoked session kept working for up to 60
seconds), with no way for a user to see or end their other sessions. This
change hardens them in four ways. Migration `20261026100000_session_hardening`.

## Absolute lifetime

- A session now ends **`SESSION_MAX_AGE_DAYS` (default 90) after sign-in**,
  however active it is. The sliding 30-day expiry is capped at it.
- New column `account.session.absolute_expires_at` (not null). Existing
  sessions get `created_at + 90 days`, so long-lived ones end at once if they
  are already older.
- Past it: 401 like any expired session - the web cookie is cleared and the
  app drops its stored token. Cached lookups carry the expiry, so the cache
  never extends a session.

## Signed-in devices

- **`GET /api/auth/sessions`** - the caller's live sessions:
  `{ id, current, method, device, ip, createdAt, lastSeenAt, expiresAt }`,
  current first. Never tokens or hashes.
- **`DELETE /api/auth/sessions/:id`** (someone else's is a 404; your current
  one = logout), **`POST /api/auth/sessions/revoke-others`**,
  **`POST /api/auth/sessions/revoke-all`**.
- **Admins**: `POST /api/schools/members/:membershipId/sessions/revoke`
  (`AdminGuard`; other school = 404, only the owner can sign the owner out) and,
  on the hosted platform, `POST /api/platform/users/:userId/sessions/revoke`.
  Logged at info level (not an erasure, so not in the erasure log).
- **Revocation is immediate**: every revocation deletes the `session:<hash>`
  cache entries of the current and previous token (and once more a second
  later, for a lookup that was in flight). `revoked_reason` records why
  (`logout`, `signed_out`, `signed_out_others`, `signed_out_all`, `admin`,
  `platform_admin`, `token_reuse`, `account_deleted`, `deactivated`).
- **Device labels** (`account.session.device`), parsed from the user agent
  ("Chrome on macOS", "Safari on iPhone"). The mobile app sends
  `X-GradeBook-Device` (model and OS from `expo-device`, percent-encoded), shown
  as "GradeBook app on iPhone 15 (iOS 19.0)".
- **Web**: a *Signed-in devices* card on the staff **Settings** page and on a
  new student **Settings** page (`/portal/settings`, in the portal's account
  menu), with *This device*, last active, IP, **Sign out** per device and
  **Sign out of all other devices**. The staff page has a **Sign out of all
  devices** button on each member card for admins.
- **App**: the same list on the staff and student Settings screens.

## Token rotation with reuse detection

- At the daily renewal the token is **replaced**. The row keeps the replaced
  hash in `previous_token_hash` (unique) with `rotated_at`; the switch is one
  conditional update on the current hash, so concurrent requests can't rotate
  twice. The new token is derived from the old one with `AUTH_SECRET`, so
  racing requests all hand out the same one.
- The new token goes out on that response, **whatever its status**: as the
  cookie for the web, as `X-Session-Token` (with `Cache-Control: no-store`) for
  a bearer token or `X-GradeBook-Client: native`. The app now stores
  `X-Session-Token` from every response (`api`, `apiUpload`, file downloads),
  not only successful ones. `X-Session-Token` is in CORS `exposedHeaders`,
  `X-GradeBook-Device` in `allowedHeaders`.
- **Grace**: the replaced token works for `SESSION_ROTATION_GRACE_SECONDS`
  (default 120) and gets the current token again.
- **Reuse**: the replaced token after the grace period means a copy. The whole
  session is revoked (`token_reuse`), the cookie cleared, a warning logged and
  the user emailed. Older tokens match nothing: plain 401.

## Security emails

- **"New sign-in to GradeBook"** when a session starts on a device (label +
  sign-in method) the user hasn't signed in on for 90 days; not on a new
  account's first sign-in. Device, time (UTC) and IP (no geolocation), and a
  button to Signed-in devices (`/dashboard/settings#devices`, students
  `/portal/settings#devices`).
- **"Suspicious activity: a GradeBook device was signed out"** on token reuse.
- Templates in `backend/src/account/templates/` (`layout.ts`,
  `new-sign-in.ts`, `token-reuse.ts`), HTML-escaped. Fire and forget: never
  delays or fails a request; skipped (logged) without SMTP;
  `SESSION_ALERTS_ENABLED=false` turns them off.
- Known devices live in the new **`account.known_device`** table
  (`user_id`, SHA-256 `fingerprint` of method + label, `first_seen_at`,
  `last_seen_at`; no IPs), refreshed at sign-in and each daily rotation, so
  signing out and back in on the same browser is not "new" even after the old
  session was purged. Sessions from before this change match on user agent.
  The retention job deletes rows unused for 90 days and now also purges
  sessions past their absolute lifetime.

## Deploy

1. `bun run db:deploy` (migration `20261026100000_session_hardening`; additive,
   fills `absolute_expires_at` for existing rows).
2. Optional: `SESSION_MAX_AGE_DAYS`, `SESSION_ROTATION_GRACE_SECONDS`,
   `SESSION_ALERTS_ENABLED` (see [Environment variables](../../environment-variables.md)).
3. Ship the mobile app update: older builds still work, but they store the
   rotated token only from successful responses and show as "GradeBook app on
   iOS/Android" without a model.

## Behavior changes

- Everyone signs in again at most every 90 days (sessions older than 90 days
  end at deploy).
- `req.user` now carries `sessionId`.
- `SessionService.revokeAll(userId, reason?)` returns the number revoked;
  `SessionService` takes a `SessionAlertService`; `SchoolService` takes a
  `SessionService`.
- Privacy policy: the device and security text now names the device label,
  times, Signed-in devices and the new sign-in emails.

## Tests

`backend/src/account/account.test.ts` (rotation, grace, reuse, concurrency,
lifetime cap, listing and revoking, cache invalidation, alert rules, device
labels), `school.service.test.ts` (admin revoke for your own school only),
`retention.service.test.ts`, `frontend/lib/sessions.test.ts`, and the smoke
script (`bun run smoke`): listing, revoke-others, revoking the current
session, the native token header, a simulated rotation (grace, then reuse ->
401 and revoked), admin sign-out, and both emails in Mailpit.
