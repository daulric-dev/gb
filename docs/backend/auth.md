# Authentication Module

**Location**: `backend/src/auth/`

The authentication module handles user login via email OTP (one-time password), session management, profile retrieval, and first-time user onboarding. It uses Supabase Auth under the hood.

## Files

| File | Purpose |
|------|---------|
| `auth.module.ts` | Module definition; exports `AuthGuard`, imports `ImagesModule` for avatar endpoints |
| `auth.controller.ts` | API endpoints for auth operations and avatar management |
| `auth.service.ts` | Business logic for OTP, sessions, profiles |
| `auth.guard.ts` | JWT validation guard |
| `transformer.ts` | Response shaping for API versioning (includes `avatar_url`) |
| `dto/send-otp.dto.ts` | Validation for OTP send request |
| `dto/verify-otp.dto.ts` | Validation for OTP verification |
| `dto/refresh-token.dto.ts` | Validation for token refresh |
| `dto/onboard.dto.ts` | Validation for onboarding data |
| `dto/update-profile.dto.ts` | Validation for profile updates |

## Authentication Flow

```
1. User enters email
   └── POST /auth/otp/send { email }
       └── Supabase sends a 6 or 8-digit OTP to the email

2. User enters OTP code
   └── POST /auth/otp/verify { email, token }
       └── Returns access_token, refresh_token, user profile
       └── If no profile exists, one is created automatically

3. If user has no name/school (first login)
   └── PATCH /auth/onboard { firstName, lastName, schoolId }
       └── Completes the user profile

4. Token expired
   └── POST /auth/refresh { refresh_token }
       └── Returns new access_token + refresh_token

5. User logs out
   └── POST /auth/logout
       └── Invalidates the session server-side
```

## AuthGuard

The `AuthGuard` is a NestJS `CanActivate` guard that protects endpoints requiring authentication.

**How it works:**

1. Extracts the `Authorization: Bearer <token>` header
2. Calls `supabase.auth.getUser(token)` to validate the JWT
3. If valid, attaches `{ id, email, access_token }` to `request.user`
4. If invalid or missing, throws `UnauthorizedException`

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

Verifies the OTP and returns session tokens plus the user profile.

**Body:**
```json
{
  "email": "user@example.com",
  "token": "123456"
}
```

**Response:**
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "role": "teacher",
    "school": { "id": "uuid", "name": "School Name", ... }
  }
}
```

If the user doesn't have a `user_profile` record yet, one is created automatically during verification.

---

### `GET /api/auth/me`

**Requires:** `AuthGuard`

Returns the current user's profile including their school.

---

### `POST /api/auth/refresh`

Refreshes an expired access token using the refresh token.

**Body:**
```json
{
  "refresh_token": "..."
}
```

---

### `PATCH /api/auth/onboard`

**Requires:** `AuthGuard`

Completes the user's profile after first login.

**Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "schoolId": "uuid"
}
```

---

### `POST /api/auth/logout`

**Requires:** `AuthGuard`

Signs out the user server-side using Supabase admin API.

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
