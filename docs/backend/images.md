# Images Module

**Location**: `backend/src/images/`

The images module provides image upload and retrieval services for the application. It handles both standard (backend-mediated) and resumable (TUS protocol) uploads to Supabase Storage. The module has no controller of its own - its `ImagesService` is imported by `AuthModule` and used by the `AuthController` for avatar management.

## Files

| File | Purpose |
|------|---------|
| `images.module.ts` | Module definition; provides and exports `ImagesService` |
| `images.service.ts` | Core image upload, download, and storage logic |
| `transformer.ts` | Response shaping for API versioning (`images.uploaded`, `images.resumable`) |
| `dto/create-resumable-upload.dto.ts` | Validation for resumable upload initialization |
| `dto/complete-upload.dto.ts` | Validation for resumable upload completion |

## Architecture

```
AuthController (auth/auth.controller.ts)
  │
  ├── GET  /auth/avatar          → ImagesService.getImageFromUserProfile()
  ├── POST /auth/avatar          → ImagesService.setImageToUserProfile()
  ├── POST /auth/avatar/resumable → ImagesService.createResumableUpload()
  └── POST /auth/avatar/complete  → ImagesService.completeResumableUpload()
```

The `ImagesModule` exports `ImagesService` and is imported by `AuthModule`. This keeps avatar endpoints grouped under `/auth` while the image logic remains in a dedicated, reusable module.

## Upload Methods

### Standard Upload (Small Files)

For files under 5MB. The entire file passes through the backend.

1. Client sends `multipart/form-data` to `POST /auth/avatar`
2. Backend reads the file buffer, validates size and MIME type
3. Uploads to Supabase Storage (`images` bucket) with `upsert: true`
4. Generates a cache-busted public URL (`?t={timestamp}`)
5. Updates `user_profile.avatar_url` in the database
6. Updates the avatar and profile caches

### Resumable Upload (TUS Protocol)

For larger files or unreliable connections. The file uploads directly from the client to Supabase - no data passes through the backend.

**Flow:**
1. Client calls `POST /auth/avatar/resumable` with file metadata
2. Backend validates size/type, creates a signed upload URL via Supabase
3. Returns TUS endpoint, token, headers, and metadata
4. Client uses `tus-js-client` or Uppy to upload directly to Supabase
5. Client calls `POST /auth/avatar/complete` with the storage path
6. Backend verifies the file exists and updates the profile

## Validation

| Constraint | Value |
|-----------|-------|
| Max file size | 5 MB |
| Allowed types | `image/jpeg`, `image/png`, `image/webp` |
| Storage bucket | `images` |
| Default path | `avatars/{userId}.{ext}` |
| TUS chunk size | 6 MB (Supabase requirement) |

## Cache-Busting

Since the storage path is deterministic (`avatars/{userId}.jpg`), re-uploading produces the same URL. A `?t={timestamp}` query parameter is appended to force browsers and CDNs to fetch the new image instead of serving the cached version.

The `extractStoragePath()` helper strips this query param when downloading so the Supabase Storage lookup isn't affected.

## Caching Strategy

| Cache Key | TTL | Updated When |
|-----------|-----|-------------|
| `avatar:{userId}` | 1 hour | Set after each upload; checked before DB query on `GET /avatar` |
| `profile:{userId}` | 30 days | Patched in-place with new `avatar_url` via `CacheService.update()` |

On `GET /avatar`, the service checks `avatar:{userId}` first. On cache miss, it queries the database and populates the cache. On upload, both caches are updated atomically.

## Custom Storage Paths

Both upload methods accept an optional `pathname` parameter to override the default `avatars/` directory:

```
POST /auth/avatar?pathname=profiles
→ stores at: profiles/{userId}.jpg

POST /auth/avatar/resumable
{ "pathname": "documents" }
→ stores at: documents/{userId}.png
```

## Dependencies

| Service | Purpose |
|---------|---------|
| `SupabaseService` | Supabase client for storage and database operations |
| `CacheService` | Avatar URL and profile caching |
| `ConfigService` | Reads `SUPABASE_URL` to construct the TUS endpoint |
