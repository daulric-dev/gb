---
sidebar_label: Authentication
---

# Authentication Module

**Location**: `backend/src/auth/`

The authentication module handles user login via email OTP (one-time password), session management, profile retrieval, and first-time user onboarding. Sign-in codes and sessions are handled by the backend's own account module (`backend/src/account/`): codes are stored hashed with `AUTH_SECRET`, and a signed-in user holds an **opaque session token in the HTTP-only `gb_session` cookie**, whose hash is stored in the `account.session` table. The mobile app uses the same token as a **bearer token**: it signs in with `X-GradeBook-Client: native`, receives the token in the `X-Session-Token` response header, stores it in the device keychain and sends `Authorization: Bearer <token>` on every request.

## Files

| File | Purpose |
|------|---------|
| `auth.module.ts` | Module definition; exports `AuthGuard`, imports `ImagesModule` for avatar endpoints |
| `auth.controller.ts` | API endpoints for auth operations and avatar management |
| `auth.service.ts` | Business logic for OTP, profiles, onboarding |
| `auth.guard.ts` | Resolves the `gb_session` cookie (or the mobile app's bearer token) to a live session and rejects deactivated accounts |
| `transformer.ts` | Response shaping for API versioning (includes `avatar_url`) |
| `dto/send-otp.dto.ts` | Validation for OTP send request |
| `dto/verify-otp.dto.ts` | Validation for OTP verification |
| `dto/onboard.dto.ts` | Validation for onboarding data |
| `dto/update-profile.dto.ts` | Validation for profile updates |

## Authentication Flow

```
1. User enters email
   └── POST /auth/otp/send { email }
       └── EmailCodeService stores a hashed 8-digit code (valid 5 minutes)
           and MailService emails it (Mailpit in development)

2. User enters OTP code
   └── POST /auth/otp/verify { email, token }
       ├─ Returns user profile in response body
       └─ SessionService.create() stores the hashed session token in
          account.session and writes the gb_session HTTP-only cookie
          to the response

3. If user has no name/school (first login)
   └── PATCH /auth/onboard { firstName, lastName, schoolId }
       ├─ If user already has school_id (because they just created one): updates name
       ├─ If joining an existing school: creates a school_join_request and returns
       │  the profile with a `joinRequest` field - frontend redirects to /onboard/pending
       └─ If no schoolId provided: saves name, leaves school empty

4. Session renewal (30 days sliding, 90 days at most)
   └── Each authenticated request runs AuthGuard → SessionService.resolve()
       └── Looks up the token hash (cached for 60 s)
       └── If more than a day has passed since the session was last renewed,
           extends expires_at by 30 days (never past absolute_expires_at,
           SESSION_MAX_AGE_DAYS after sign-in) and ROTATES the token: the
           response carries a new cookie (web) or X-Session-Token (app)
       └── The replaced token still works for SESSION_ROTATION_GRACE_SECONDS;
           after that it is treated as copied and the whole session is revoked
       └── No refresh token and no client-side refresh - the frontend never
           sees a 401 while the session is live; after 90 days the user
           signs in again

5. User logs out
   └── POST /auth/logout
       └── SessionService.revoke() marks the session revoked, drops its
           cache entry and clears the cookie

6. Signed-in devices
   └── GET /auth/sessions lists the user's live sessions; DELETE /auth/sessions/:id,
       POST /auth/sessions/revoke-others and /revoke-all sign devices out at once
```

## Session Cookies

The session is a single HTTP-only cookie named `gb_session`. Its value is an opaque token - 256 random bits plus an HMAC tag keyed with `AUTH_SECRET` - and only its SHA-256 hash is stored, in `account.session`, so a database leak hands out no usable sessions. Sessions can be revoked individually (logout, Signed-in devices), all but the current one, or all at once (account deleted or disabled, an admin signing a member out). Every revocation records a `revoked_reason` and deletes the session's cache entries, so it takes effect on the next request.

Cookie attributes (set in `SessionService.setCookie`):

| Attribute | Value |
|-----------|-------|
| `httpOnly` | `true` (not accessible via JavaScript - prevents XSS exfiltration) |
| `secure` | `true` in production, `false` in development |
| `sameSite` | `lax` (works for same-origin and most cross-origin GETs; switch to `none` if frontend is on a different domain) |
| `path` | `/` |
| `domain` | Production only: derived from the app origin, or `AUTH_COOKIE_DOMAIN` (see `config/origins.ts`) |
| `expires` | 30 days from creation or last renewal, never past the absolute lifetime (90 days from sign-in) |

There is no separate frontend access-token storage. The frontend never reads or writes auth tokens - it only sends `credentials: "include"` on every request, and the browser handles the cookies automatically.

## SessionService

`SessionService` (`backend/src/account/session.service.ts`) owns the session lifecycle:

- `create(reply, req, userId, method)`: issues a token, stores its hash with the user agent, a device label ("Chrome on macOS", "GradeBook app on iPhone 15 (iOS 19.0)" from the app's `X-GradeBook-Device` header), the IP and `absolute_expires_at`, sets the cookie, and emails a **new sign-in alert** when the device label + sign-in method was not seen for the user in 90 days (never on a new account's first sign-in)
- `resolve(req, reply?)`: returns `{ sessionId, userId, email }` for a live session, or `null` (clearing the cookie) if it is missing, revoked, expired (sliding or absolute), or the user is disabled. Lookups are cached for 60 seconds; revocation deletes the cache entries, so it is immediate
- `list(userId, currentSessionId)`, `revokeOwn()`, `revokeOthers()`: Signed-in devices
- `revoke(req, reply)`: signs this device out
- `revokeAll(userId, reason)`: signs a user out everywhere

### Session lifetime and token rotation

| Setting | Default | Meaning |
|---------|---------|---------|
| Sliding expiry | 30 days | A session unused for 30 days ends. |
| `SESSION_MAX_AGE_DAYS` | 90 | A session ends this long after sign-in, however active. |
| Renewal | once a day | The first request more than a day after the last renewal extends the expiry and rotates the token. |
| `SESSION_ROTATION_GRACE_SECONDS` | 120 | The replaced token keeps working this long, for requests already in flight. |
| `SESSION_ALERTS_ENABLED` | true | New sign-in and suspicious-activity emails. |

At rotation the session row keeps the replaced token's hash in `previous_token_hash` (with `rotated_at`); the switch is one conditional update on the current hash, so concurrent requests cannot rotate twice. The new token is derived from the old one with `AUTH_SECRET`, so every request that rotates, or presents the old token during the grace period, gets the same new token. It is sent as the cookie (web) or the `X-Session-Token` header (bearer token or `X-GradeBook-Client: native`) on that response, whatever its status; the app stores the header from every response.

Presenting the replaced token **after** the grace period means it was copied: the whole session is revoked with `revoked_reason = 'token_reuse'`, the cookie is cleared, the request gets a 401 and the user is emailed ("Suspicious activity: a GradeBook device was signed out"). Tokens older than that match no session and are a plain 401. The emails link to Signed-in devices (`/dashboard/settings#devices`, or `/portal/settings#devices` for students); sending never blocks or fails a request, and is skipped (logged) when SMTP is not configured.

There is no database-level row security: services query Postgres through `PrismaService` and enforce access in the API.

## AuthGuard

The `AuthGuard` is a NestJS `CanActivate` guard that protects endpoints requiring authentication.

**How it works:**

1. Calls `SessionService.resolve(req, reply)` to turn the `gb_session` cookie into a live session (renewing it if due)
2. Checks `user_profile.is_active`; a deactivated account has its session revoked and gets a 401
3. If valid, attaches `{ id, email, sessionId }` to `request.user`
4. If invalid or missing, throws `UnauthorizedException` (the frontend then redirects to `/login`)

**Usage:** Applied to controllers/endpoints with `@UseGuards(AuthGuard)`.

## API Endpoints

### `POST /api/auth/otp/send`

Sends a one-time password to the user's email.

**Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:** `{ message: "OTP sent" }`

---

### `POST /api/auth/otp/verify`

Verifies the OTP and returns the user profile. Creates a session and writes the `gb_session` cookie on the response.

**Body:**
```json
{
  "email": "user@example.com",
  "token": "12345678"
}
```

**Response:**
```json
{
  "session": {
    "access_token": "",
    "expires_in": 2592000,
    "expires_at": 1234567890
  },
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "role": "teacher",
    "avatar_url": "...",
    "school": { "id": "uuid", "name": "School Name" },
    "is_onboarded": true
  }
}
```

The `session` object is kept for clients that read the response shape; `access_token` is always empty, since the token is never exposed to page scripts. The cookie set on the response is the source of truth.

---

### `GET /api/auth/me`

**Requires:** `AuthGuard`

Returns the current user's profile including their school.

---

### `PATCH /api/auth/onboard`

**Requires:** `AuthGuard`

Completes the user's profile after first login. The behavior depends on the user's existing state:

- **User already has `school_id`** (because they just created a school via `POST /schools`, which auto-assigns them as `admin`): only `first_name` / `last_name` are updated.
- **User selected an existing school** via `schoolId`: a `school_join_request` is created in `pending` status. The user's `school_id` is **not** set - they remain in a pending state until an admin approves. The response includes a `joinRequest` field.
- **No `schoolId` provided**: only the name is saved.

**Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "schoolId": "uuid"
}
```

**Response (joining existing school - pending approval):**
```json
{
  "id": "uuid",
  "first_name": "John",
  "last_name": "Doe",
  "school_id": null,
  "school": null,
  "joinRequest": {
    "id": "uuid",
    "school_id": "uuid",
    "status": "pending"
  }
}
```

When the response includes `joinRequest`, the frontend redirects to `/onboard/pending`, which polls `GET /auth/me` until the request is approved. See the [School module](./school.md) for full details on the join request flow.

---

### `POST /api/auth/logout`

**Requires:** `AuthGuard`

Signs out the user via `SessionService.revoke()`, which marks the session revoked in `account.session` and clears the `gb_session` cookie on the response.

---

### `GET /api/auth/sessions`

**Requires:** `AuthGuard`

The caller's live sessions, the current one first. No tokens or hashes.

```json
[
  {
    "id": "6f1c...",
    "current": true,
    "method": "email-code",
    "device": "Chrome on macOS",
    "ip": "203.0.113.7",
    "createdAt": "2026-10-20T09:12:00.000Z",
    "lastSeenAt": "2026-10-26T08:01:00.000Z",
    "expiresAt": "2026-11-25T08:01:00.000Z"
  }
]
```

### `DELETE /api/auth/sessions/:id`

**Requires:** `AuthGuard`

Signs out one of the caller's sessions: `{ revoked: 1, current }`. Another user's session (or one already ended) is a 404. Revoking the current session is a logout and clears the cookie.

### `POST /api/auth/sessions/revoke-others`

**Requires:** `AuthGuard`

Signs out every other session: `{ revoked }`.

### `POST /api/auth/sessions/revoke-all`

**Requires:** `AuthGuard`

Signs out every session, this one included, and clears the cookie: `{ revoked }`.

### Admin sign-out

- `POST /api/schools/members/:membershipId/sessions/revoke` (`AdminGuard`): a school admin signs a staff member of their school out of every device. Another school's membership is a 404; only the owner can sign the owner out. The staff page has a **Sign out of all devices** button for it.
- `POST /api/platform/users/:userId/sessions/revoke` (platform admins, `BILLING_ENABLED=true`): the same for any user.

Both log at info level; neither touches the erasure log.

## Avatar Endpoints

The auth controller also handles avatar management by delegating to `ImagesService` (from the `ImagesModule`). The avatar endpoints are grouped under `/api/auth/avatar`.

### `GET /api/auth/avatar`

**Requires:** `AuthGuard`

Returns the user's profile picture as a binary blob with the appropriate `Content-Type` header (`image/jpeg`, `image/png`, etc.). The response includes `Cache-Control: private, max-age=3600`.

If the user has no avatar, returns `400 Bad Request`.

---

### `POST /api/auth/avatar/resumable`

**Requires:** `AuthGuard`

Creates a direct upload, the only way to set a profile picture: the backend returns a presigned S3 `PUT` URL (valid 5 minutes) and the client uploads the bytes straight to object storage - no file data passes through the backend. At most 5MB, JPEG/PNG/WebP only.

**Body:**
```json
{
  "filename": "photo.png",
  "contentType": "image/png",
  "totalSize": 204800
}
```

**Response:**
```json
{
  "path": "uploads/avatars/user-id.png",
  "method": "PUT",
  "uploadUrl": "https://<s3-endpoint>/...",
  "headers": { "Content-Type": "image/png" },
  "expiresAt": "2026-10-21T12:15:00.000Z"
}
```

---

### `POST /api/auth/avatar/complete`

**Requires:** `AuthGuard`

Called after the direct upload finishes. Verifies the object exists in storage, re-checks its size, type and magic bytes (deleting it if rejected), copies the checked image to `images/avatars/<userId>.<ext>`, and saves its public URL (with a cache-busting timestamp) to `user_profile.avatar_url`. That URL is `<API_URL>/api/images/avatars/<file>` (served by the public `GET /api/images/avatars/:file` route), or `<S3_PUBLIC_URL>/images/avatars/<file>` when a public storage/CDN host is configured.

**Body:**
```json
{
  "path": "uploads/avatars/user-id.png"
}
```

**Response:**
```json
{
  "avatar_url": "https://api.example.com/api/images/avatars/user-id.jpg?t=1745512900000"
}
```

---

## Caching

Avatar uploads update two cache entries:
- `avatar:{userId}` - cached avatar URL (1 hour TTL), used to avoid DB lookups on `GET /avatar`
- `profile:{userId}` - the full profile cache is patched in-place with the new `avatar_url` via `CacheService.update()`, so subsequent `/auth/me` calls return the updated URL without a DB re-fetch

## Response Transformer

The `transformer.ts` file provides response shaping functions that format data according to the API version (read from the `X-API-Version` header, defaults to `1`). The `v1Profile` transformer includes `avatar_url` in the profile response, and `v1VerifyOtp` includes it in the login response.
