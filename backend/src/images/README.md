# Images (`src/images`)

User avatars, course cover images and school logos: upload, validation, storage and serving. Avatars are stored in object storage under `images/avatars/<userId>.<ext>`, and the public URL is written to `user_profile.avatar_url`. Every client renders that URL as a plain image source with no credentials.

Uploads go directly to storage with a presigned PUT; the API never receives the bytes in a request. The client asks for a URL, PUTs the image (at most 5 MB), then calls "complete", and the API checks what arrived. Anything rejected is deleted.

Course covers (`course-banners/<courseId>-<32 hex>.<ext>`, 5 MB) and school logos (`school-logos/<schoolId>-<32 hex>.<ext>`, 2 MB) use the same flow through the shared steps below; their routes live in `src/course` and `src/school`, and only the stored key is kept (`course.banner_image_path`, `school.logo_path`). Each upload gets a new random name, so a URL can't be guessed and a cached copy is never stale; the previous object is deleted on replace or remove.

Only JPEG, PNG and WebP are accepted. The declared type is never trusted alone: the leading bytes must match the format, which stops SVG or HTML from being smuggled in.

## What it provides

### HTTP routes

This module's own controller serves one public route.

| Method | Path | Guard | What it does |
| --- | --- | --- | --- |
| GET | `/api/images/course-banners/:name`, `/api/images/school-logos/:name` | public | Stream a course cover or school logo. Only `<area>/<[A-Za-z0-9-]+>.(jpg\|png\|webp)` can be read. Same headers as avatars but `Cache-Control: public, max-age=604800, immutable`. 404 if missing. These are school content served without a session (like avatars): what protects them is the 128-bit random part of the name, which only members are shown. |
| GET | `/api/images/avatars/:name` | public | Stream an avatar object. Only `avatars/<[A-Za-z0-9._-]+>` can be read. Headers: `Cache-Control: public, max-age=86400`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`. 404 if missing. |

The signed-in avatar routes are declared in `src/auth/auth.controller.ts` and call `ImagesService`:

| Method | Path | Guard | Service call |
| --- | --- | --- | --- |
| GET | `/api/auth/avatar` | `AuthGuard` | `getImageFromUserProfile()`: the caller's own avatar bytes (`Cache-Control: private, max-age=3600`) |
| POST | `/api/auth/avatar/resumable` | `AuthGuard` | `createResumableUpload()`: body `CreateResumableUploadDto`; returns a presigned PUT ticket (`images.resumable`) |
| POST | `/api/auth/avatar/complete` | `AuthGuard` | `completeResumableUpload()`: body `CompleteUploadDto`; validates the object and sets the avatar; response through versioned transformer `images.uploaded` |

### Services / exports

`ImagesModule` exports `ImagesService`:

- `getImageFromUserProfile(userId)`: looks up `avatar_url` (cached under `avatar:<userId>` for 1 hour), works out the object path, and streams it. The path can come from the old hosted-storage public URL or from the current URL shapes. It must match `avatars/<file>` with no traversal.
- `readAvatar(path)`: reads `images/<path>` from storage, or returns null if the path is not a valid avatar path or nothing is there. Used by the public route.
- `createResumableUpload(userId, filename, contentType, totalSize)`: checks size and type, then returns `{ path, method: 'PUT', uploadUrl, headers, expiresAt }`. `path` is the staging key `uploads/avatars/<callerId>.<ext>`, which is never served. The URL is valid for 5 minutes and signs the Content-Type and the declared size (the PUT must be exactly `totalSize` bytes).
- `completeResumableUpload(userId, path, requestOrigin?)`: the path must be exactly `uploads/avatars/<callerId>.<ext>`, so nobody can claim another user's object. It then checks size, type and byte signature (reading at most 5 MB), deletes the object on rejection, writes the verified bytes to `avatars/<callerId>.<ext>`, deletes the staged object and updates the profile. A still-valid upload URL therefore cannot change an avatar after it was checked.

Shared upload steps (used by the avatar methods above, `CourseBannerService` and `SchoolLogoService`):

- `newImagePath(area, ownerId, contentType)`: a fresh `{ staging, served }` key pair for `course-banners` or `school-logos`, the extension taken from the (allowed) type.
- `servedPathFor(area, ownerId, path)`: checks `path` is a staging key issued for that owner and returns the served key, else 400.
- `createImageTicket(stagingPath, contentType, totalSize, maxBytes)`: size and type checks, then the presigned PUT ticket.
- `finalizeImage(stagingPath, servedPath, maxBytes)`: size, type and signature checks (reading at most `maxBytes`), writes the served object, deletes the staged one (or deletes it and throws 400 on rejection).
- `removeImage(path)`: best-effort delete of a served cover or logo.
- `readPublicImage(path)`: the public route's read, limited to the `IMAGE_AREAS`.

`public-url.ts` exports `publicImageUrl(path, requestOrigin?)` and `optionalImageUrl(path)`, which turn a stored key into the URL clients render (CDN when `S3_PUBLIC_URL` is set, else `<API_URL>/api/images/...`).

After a successful upload the stored URL gets a `?t=<timestamp>` cache-buster. The `avatar:<userId>` cache entry is refreshed, and `avatar_url` is patched into the cached `profile:<userId>`.

### Other

`transformer.ts` holds the v1 response transformers `v1Uploaded` and `v1Resumable`. `src/versioning/transformer-registry.ts` registers them as `images.uploaded` and `images.resumable`.

## Used by

- `src/course/course.module.ts` and `src/school/school.module.ts` import `ImagesModule` for course covers and school logos. `public-url.ts` is also used by `src/course/course.service.ts`, `src/student-portal`, `src/dashboard`, `src/student` and `src/auth/auth.service.ts` (the profile's `school.logo_url`).
- `src/auth/auth.module.ts` imports `ImagesModule`. `src/auth/auth.controller.ts` injects `ImagesService` and uses `CreateResumableUploadDto` and `CompleteUploadDto` for the avatar routes above.
- `src/versioning/transformer-registry.ts` imports `@/images/transformer`.
- `src/app.module.ts` imports `ImagesModule`, which registers the public route.
- Front end: `frontend/app/dashboard/settings/page.tsx` uploads through `uploadAvatar()` in `frontend/lib/files/upload.ts` (ticket, PUT, complete), and `frontend/app/portal/layout.tsx` renders `/api/auth/avatar`.
- Mobile: `mobile/app/(tabs)/settings.tsx` uploads through `uploadAvatar()` in `mobile/src/lib/upload.ts`.
- Every client that shows another user's picture uses the stored `avatar_url`, which points at `/api/images/avatars/...` or the CDN.

## Depends on

- `StorageService` and `objectKey()` from `src/storage` (global). Uses `get`, `put`, `exists`, `getBuffer`, `delete` and `uploadUrl`.
- `PrismaService` (global).
- `CacheService` from `src/cache`.

## Data

`public.user_profile.avatar_url` is read and written. Objects live in the storage "bucket" `images` under `avatars/`, `course-banners/` and `school-logos/` (staged under `uploads/`). See [`prisma/schema/school.prisma`](../../prisma/schema/school.prisma).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `S3_PUBLIC_URL` | unset | When set (a CDN or public bucket host), image URLs are `<S3_PUBLIC_URL>/images/<area>/<file>` |
| `API_URL` | the request's own origin (avatars only), else `http://localhost:3001` | Base for `<API_URL>/api/images/<area>/<file>` when there is no `S3_PUBLIC_URL`. Cover and logo URLs are built per response without a request, so set `API_URL` (or `S3_PUBLIC_URL`) in any deployment that shows them. |

The storage backend itself is configured by `src/storage`.

## Files

| File | Purpose |
| --- | --- |
| `images.module.ts` | Module: public controller plus `ImagesService` (exported) |
| `images.controller.ts` | `GET /api/images/avatars/:name` and `GET /api/images/:area/:name` (covers, logos) |
| `public-url.ts` | Stored key to client URL |
| `images.service.ts` | Avatar upload, the shared image upload steps, validation, URLs and reads |
| `transformer.ts` | v1 response transformers for the versioning layer |
| `images.service.test.ts` | Service tests |
| `dto/` | Request DTOs, see [`dto/README.md`](dto/README.md) |

## Tests

`cd backend && bun test src/images`. Covers:

- Path checks on complete: own path only; no other user, outside `avatars/`, traversal, smuggled query strings or empty paths.
- Content-type and signature checks on complete for PNG, JPEG and WebP, including a missing or disallowed type, mismatched and too-short objects, and an oversize object (deleted without being read); the ticket refuses oversize and non-image declarations.
- Hardening of the stored URL on read.
- The new avatar URL shape, the presigned PUT ticket, and completion rejecting a bad or missing object.

## See also

- [`docs/content/backend/images.md`](../../../docs/content/backend/images.md)
- [`docs/content/backend/auth.md`](../../../docs/content/backend/auth.md)
