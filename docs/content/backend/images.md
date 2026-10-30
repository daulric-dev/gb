---
sidebar_label: Images
---

# Images Module

**Location**: `backend/src/images/`

The images module provides image upload and retrieval services for the application. Avatars are uploaded directly to object storage with a presigned S3 `PUT` (via `StorageService`); no route accepts the image bytes through the API. Its own `ImagesController` serves the public avatar route `GET /api/images/avatars/:file`; the upload endpoints live on `AuthController`, which uses the exported `ImagesService` for avatar management.

## Files

| File | Purpose |
|------|---------|
| `images.module.ts` | Module definition; provides and exports `ImagesService`, registers `ImagesController` |
| `images.controller.ts` | Public `GET /images/avatars/:file` route (no auth), streams avatars from storage |
| `images.service.ts` | Core image upload, download, and storage logic |
| `transformer.ts` | Response shaping for API versioning (`images.uploaded`, `images.resumable`) |
| `dto/create-resumable-upload.dto.ts` | Validation for resumable upload initialization |
| `dto/complete-upload.dto.ts` | Validation for resumable upload completion |

## Architecture

```
AuthController (auth/auth.controller.ts)
  │
  ├── GET  /auth/avatar          → ImagesService.getImageFromUserProfile()
  ├── POST /auth/avatar/resumable → ImagesService.createResumableUpload()
  └── POST /auth/avatar/complete  → ImagesService.completeResumableUpload()

ImagesController (images/images.controller.ts)
  │
  └── GET  /images/avatars/:file  → ImagesService.readAvatar()   (public)
```

The `ImagesModule` exports `ImagesService` and is imported by `AuthModule`. This keeps avatar endpoints grouped under `/auth` while the image logic remains in a dedicated, reusable module.

## Upload Methods

### Direct Upload (Presigned PUT)

This is the only way to set an avatar. The file uploads directly from the client to object storage - no data passes through the backend in a request. (The endpoint keeps its historical `resumable` name.) The web app (`uploadAvatar()` in `frontend/lib/files/upload.ts`) and the mobile app (`uploadAvatar()` in `mobile/src/lib/upload.ts`) both use it.

**Flow:**
1. Client calls `POST /auth/avatar/resumable` with file metadata
2. Backend validates size/type and creates a presigned `PUT` URL for the staging key `images/uploads/avatars/{userId}.{ext}` via `StorageService.uploadUrl` (valid 5 minutes, signed for the declared type and size; signed for `S3_PUBLIC_ENDPOINT` when set)
3. Returns `{ path, method, uploadUrl, headers, expiresAt }`
4. Client `PUT`s the bytes to `uploadUrl` with exactly the returned `Content-Type` header
5. Client calls `POST /auth/avatar/complete` with the returned `path`
6. Backend checks the path belongs to the caller, verifies the object exists, and re-checks its size, content type and **magic-byte signature** (deleting + rejecting it on failure, since the bytes never passed through the backend during upload), writes the checked bytes to `images/avatars/{userId}.{ext}`, deletes the staged object, then updates `user_profile.avatar_url` and the avatar and profile caches

## Validation

| Constraint | Value |
|-----------|-------|
| Max file size | 5 MB |
| Allowed types | `image/jpeg`, `image/png`, `image/webp` |
| Storage area | `images` (object key prefix) |
| Path | `avatars/{userId}.{ext}` |
| Presigned URL lifetime | 5 minutes |

## Cache-Busting

Since the storage path is deterministic (`avatars/{userId}.jpg`), re-uploading produces the same URL. A `?t={timestamp}` query parameter is appended to force browsers and CDNs to fetch the new image instead of serving the cached version.

The `extractStoragePath()` helper strips this query param when reading the object back, so the storage lookup isn't affected. It also accepts avatar URLs written by the previous hosted storage, so older `avatar_url` values keep working.

The stored URL points at `<API_URL>/api/images/avatars/<file>`, or at `<S3_PUBLIC_URL>/images/avatars/<file>` when a public storage/CDN host is configured. The public route only serves `avatars/<file>` names and responds with `Cache-Control: public, max-age=86400`.

## Caching Strategy

| Cache Key | TTL | Updated When |
|-----------|-----|-------------|
| `avatar:{userId}` | 1 hour | Set after each upload; checked before DB query on `GET /avatar` |
| `profile:{userId}` | 30 days | Patched in-place with new `avatar_url` via `CacheService.update()` |

On `GET /avatar`, the service checks `avatar:{userId}` first. On cache miss, it queries the database and populates the cache. On upload, both caches are updated atomically.

## Dependencies

| Service | Purpose |
|---------|---------|
| `StorageService` | S3 object storage: put, get, exists, delete, presigned upload URLs |
| `PrismaService` | Reads and updates `user_profile.avatar_url` |
| `CacheService` | Avatar URL and profile caching |
