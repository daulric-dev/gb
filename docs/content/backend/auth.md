---
sidebar_label: Authentication
---

# Authentication Module

**Location**: `backend/src/auth/`

The authentication module handles user login via email OTP (one-time password), session management, profile retrieval, and first-time user onboarding. It uses Supabase Auth under the hood, with **`@supabase/ssr` cookie-based sessions** — the access token and refresh token live entirely in HTTP-only cookies, and rotation happens transparently on every authenticated request.

## Files

| File | Purpose |
|------|---------|
| `auth.module.ts` | Module definition; exports `AuthGuard`, imports `ImagesModule` for avatar endpoints |
| `auth.controller.ts` | API endpoints for auth operations and avatar management |
| `auth.service.ts` | Business logic for OTP, profiles, onboarding |
| `auth.guard.ts` | Validates the SSR cookie session and triggers refresh on expired access tokens |
| `transformer.ts` | Response shaping for API versioning (includes `avatar_url`) |
| `dto/send-otp.dto.ts` | Validation for OTP send request |
| `dto/verify-otp.dto.ts` | Validation for OTP verification |
| `dto/onboard.dto.ts` | Validation for onboarding data |
| `dto/update-profile.dto.ts` | Validation for profile updates |

## Authentication Flow

```
1. User enters email
   └── POST /auth/otp/send { email }
       └── Supabase sends an 8-digit OTP to the email

2. User enters OTP code
   └── POST /auth/otp/verify { email, token }
       ├─ Returns user profile in response body
       └─ Calls supabase.auth.setSession() via the SSR cookie client,
          which writes the chunked sb-<project>-auth-token.* HTTP-only
          cookies to the response

3. If user has no name/school (first login)
   └── PATCH /auth/onboard { firstName, lastName, schoolId }
       ├─ If user already has school_id (because they just created one): updates name
       ├─ If joining an existing school: creates a school_join_request and returns
       │  the profile with a `joinRequest` field — frontend redirects to /onboard/pending
       └─ If no schoolId provided: saves name, leaves school empty

4. Access token expires (default: 1 hour)
   └── Next authenticated request triggers AuthGuard
       └── supabase.auth.getUser() detects the expired access token
       └── Refreshes via the refresh token cookie
       └── setAll handler writes rotated cookies to the response
       └── Original request completes normally — frontend never sees a 401

5. User logs out
   └── POST /auth/logout
       └── supabase.auth.signOut() invalidates the session and clears cookies
```

## Session Cookies

The session is stored entirely in HTTP-only cookies managed by `@supabase/ssr`. The session payload (containing both access token and refresh token) is encoded and split across one or more chunks named `sb-<project-ref>-auth-token`, `sb-<project-ref>-auth-token.0`, `sb-<project-ref>-auth-token.1`, etc.

Cookie attributes (set in `setAll` inside `SupabaseService.createUserClient`):

| Attribute | Value |
|-----------|-------|
| `httpOnly` | `true` (not accessible via JavaScript — prevents XSS exfiltration) |
| `secure` | `true` in production, `false` in development |
| `sameSite` | `lax` (works for same-origin and most cross-origin GETs; switch to `none` if frontend is on a different domain) |
| `path` | `/` |

There is no separate frontend access-token storage. The frontend never reads or writes auth tokens — it only sends `credentials: "include"` on every request, and the browser handles the cookies automatically.

## SupabaseService

`SupabaseService.createUserClient(req, reply, schema)` builds an `@supabase/ssr` server client wired to the current Fastify request and reply:

- `getAll`: reads all cookies from `req.cookies`
- `setAll`: writes rotated session cookies via `reply.setCookie` with the secure flag set above

Any service method that needs to make a user-scoped (RLS-respecting) Supabase query takes `req` and `reply` parameters and calls `createUserClient(req, reply, schema)`. Calling `auth.getUser()` on this client triggers automatic refresh and cookie rotation when the access token has expired.

`SupabaseService.getServiceClient()` returns a singleton service-role client that bypasses RLS — used for trusted backend operations.

## AuthGuard

The `AuthGuard` is a NestJS `CanActivate` guard that protects endpoints requiring authentication.

**How it works:**

1. Builds an SSR client via `SupabaseService.createUserClient(req, reply, 'public')`
2. Calls `supabase.auth.getUser()` — this validates the session and silently refreshes the access token if expired (rotating cookies on the response in the process)
3. If valid, attaches `{ id, email }` to `request.user`
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

Verifies the OTP and returns the user profile. Writes the Supabase session cookies (`sb-*-auth-token*`) on the response.

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
    "access_token": "...",
    "expires_in": 3600,
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

The session payload is included in the response body for backwards compatibility, but the frontend doesn't need it — the cookies set on the response are the source of truth.

---

### `GET /api/auth/me`

**Requires:** `AuthGuard`

Returns the current user's profile including their school.

---

### `POST /api/auth/refresh`

A thin compatibility endpoint that returns the current session. Refresh actually happens implicitly inside `AuthGuard` on every authenticated request, so the frontend doesn't need to call this — it exists only to support deployed clients still polling it during the migration.

**Response:**
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3600,
  "expires_at": 1234567890
}
```

---

### `PATCH /api/auth/onboard`

**Requires:** `AuthGuard`

Completes the user's profile after first login. The behavior depends on the user's existing state:

- **User already has `school_id`** (because they just created a school via `POST /schools`, which auto-assigns them as `admin`): only `first_name` / `last_name` are updated.
- **User selected an existing school** via `schoolId`: a `school_join_request` is created in `pending` status. The user's `school_id` is **not** set — they remain in a pending state until an admin approves. The response includes a `joinRequest` field.
- **No `schoolId` provided**: only the name is saved.

**Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "schoolId": "uuid"
}
```

**Response (joining existing school — pending approval):**
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

Signs out the user via `supabase.auth.signOut()`, which invalidates the session server-side and clears the session cookies on the response.

## Avatar Endpoints

The auth controller also handles avatar management by delegating to `ImagesService` (from the `ImagesModule`). The avatar endpoints are grouped under `/api/auth/avatar`.

### `GET /api/auth/avatar`

**Requires:** `AuthGuard`

Returns the user's profile picture as a binary blob with the appropriate `Content-Type` header (`image/jpeg`, `image/png`, etc.). The response includes `Cache-Control: private, max-age=3600`.

If the user has no avatar, returns `400 Bad Request`.

---

### `POST /api/auth/avatar`

**Requires:** `AuthGuard`  
**Content-Type:** `multipart/form-data`

Uploads a profile picture. The file is validated (max 5MB, JPEG/PNG/WebP only), uploaded to Supabase Storage, and the public URL (with cache-busting timestamp) is saved to `user_profile.avatar_url`.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `pathname` | string (optional) | Custom storage path (default: `avatars/`) |

**Response:**
```json
{
  "avatar_url": "https://xxx.supabase.co/.../avatars/user-id.jpg?t=1745512900000"
}
```

---

### `POST /api/auth/avatar/resumable`

**Requires:** `AuthGuard`

Creates a TUS resumable upload session. The client uploads directly to Supabase Storage using the returned TUS endpoint and token - no file data passes through the backend.

**Body:**
```json
{
  "filename": "photo.png",
  "contentType": "image/png",
  "totalSize": 204800,
  "pathname": "avatars"
}
```

**Response:**
```json
{
  "path": "avatars/user-id.png",
  "token": "...",
  "signed_url": "...",
  "tus_endpoint": "https://xxx.supabase.co/storage/v1/upload/resumable",
  "tus_headers": { "authorization": "Bearer ...", "x-upsert": "true" },
  "tus_metadata": { "bucketName": "images", "objectName": "...", "contentType": "image/png" },
  "chunk_size": 6291456
}
```

---

### `POST /api/auth/avatar/complete`

**Requires:** `AuthGuard`

Called after a resumable upload finishes. Verifies the file exists in Supabase Storage and updates `user_profile.avatar_url`.

**Body:**
```json
{
  "path": "avatars/user-id.png"
}
```

---

## Caching

Avatar uploads update two cache entries:
- `avatar:{userId}` - cached avatar URL (1 hour TTL), used to avoid DB lookups on `GET /avatar`
- `profile:{userId}` - the full profile cache is patched in-place with the new `avatar_url` via `CacheService.update()`, so subsequent `/auth/me` calls return the updated URL without a DB re-fetch

## Response Transformer

The `transformer.ts` file provides response shaping functions that format data according to the API version (read from the `X-API-Version` header, defaults to `1`). The `v1Profile` transformer includes `avatar_url` in the profile response, and `v1VerifyOtp` includes it in the login response.
