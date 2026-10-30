# File manager (`src/file-manager`)

"My files" for school staff. Each user can upload documents into a private folder tree, rename, move and soft-delete them, and share a file with other people in the school. A share can name:

- a **user**,
- a **custom role** (everyone holding a `school_role`), or
- a **course** (its staff and its actively enrolled students).

A share is either view-only or view-and-download. Recipients only ever see a file once its status is `ready`. When several shares match the same user, download rights are OR-ed: the most permissive share wins.

Uploads are limited to the school's upload limit and, outside submissions, to PDF, PNG, JPEG, WebP, plain text, CSV, DOCX and XLSX. The declared type is not trusted. `file-content.ts` checks the leading bytes, then the structure:

- **Office files**: macro-enabled documents are rejected, the archive must contain `[Content_Types].xml`, and a DOCX must have `word/document.xml` (an XLSX `xl/workbook.xml`).
- **PDFs**: rejected if they contain `/Launch`, `/JavaScript`, `/JS` or `/EmbeddedFile`.

Every upload is a **presigned direct upload** (up to the school's limit); no route accepts file bytes through the API: a `pending` row is reserved (at most 20 unexpired tickets per user, else `429`), the client PUTs the bytes to a staging key under `file-manager/uploads/`, and "complete" checks them, moves them to the served key, points the row at it and deletes the staged object before marking the file `ready`. A rejected upload is deleted and the row marked `failed`. The retention job removes `pending` and `failed` rows (and their objects) after an hour.
  - Types whose check reads the bytes (`inspectsBytes()`: PDF, images, DOCX, XLSX, DOC) are read back, checked, and the checked buffer written to the served key. The read is capped at the HEAD size and draws from the process-wide `ByteBudget` (`UPLOAD_VERIFY_MEMORY_MB`, default 256 MB). If no room frees up within 10 seconds, "complete" answers `503` and leaves the row `pending`; calling it again works.
  - Every other type (plain text, CSV, and the arbitrary types submissions accept) is judged on its declared type alone, so the object is never read: after the HEAD size checks it is copied inside the store (`StorageService.copy`). The upload URL signs the length, so a re-PUT cannot change the size, and swapping bytes nobody inspects changes nothing.

**Upload limit per school.** `UploadLimitService` (`upload-limit.service.ts`) resolves it as `min(school.max_upload_mb ?? UPLOAD_DEFAULT_MB, UPLOAD_MAX_MB)`, caching the school's column for 60 seconds under `upload-limit:<schoolId>` (dropped when the limit is changed). The school is the uploader's active school, or for a hand-in the course's school. The limit is applied once, to the declared size, when the ticket is issued, and returned as the ticket's `maxBytes`; completing checks the stored bytes equal the declared size (the URL signs it too) and, as a backstop, the platform ceiling, so lowering a school's limit does not fail tickets already issued. The routes that read and set it are in [`src/school`](../school/README.md).

Other modules reuse the service to store student hand-ins and to read file bytes for callers they have already authorised.

## What it provides

### HTTP routes

Every route is behind `AuthGuard` and `PermissionGuard`, with the `file:*` key shown. Ownership is checked again in the service: rename, move, delete and shares are for the owner only (403 otherwise), and folders are always private to their owner. Literal paths (`folders`, `notifications`, `upload-ticket`) are declared before `:id`.

| Method | Path | Permission | What it does |
| --- | --- | --- | --- |
| GET | `/api/files?filter=own\|shared\|all&page=&pageSize=` | `file:read` | Files the caller owns and/or that are shared with them, newest first. Returns a bare array without `page`, and a `{ data, meta }` envelope with it (`pageSize` at most 100). |
| POST | `/api/files/upload-ticket` | `file:create` | Reserve a `pending` row and return a presigned PUT (`CreateUploadTicketDto`). The URL is valid for 5 minutes and signs the declared size and type. |
| POST | `/api/files/upload-ticket/:fileId/complete` | `file:create` | Check the uploaded object (exists, size, declared size, signature, structure), then mark it `ready`. `503` while the verify budget is full; the row stays `pending`, retry. |
| GET | `/api/files/folders/contents?folderId=` | `file:read` | One folder of the caller's tree: subfolders, files, breadcrumb. Omit `folderId` for the root. |
| GET | `/api/files/folders` | `file:read` | Every live folder the caller owns (for a move picker) |
| POST | `/api/files/folders` | `file:create` | Create a folder (`CreateFolderDto`). A duplicate name under the same parent is a 400. |
| PATCH | `/api/files/folders/:folderId` | `file:update` | Rename a folder (`RenameFolderDto`). System folders cannot be renamed. |
| PATCH | `/api/files/folders/:folderId/move` | `file:update` | Re-parent a folder (`MoveFolderDto`). It cannot go into itself or one of its own subfolders. |
| DELETE | `/api/files/folders/:folderId` | `file:delete` | Soft-delete the folder, its whole subtree and the files in it, in one transaction, with a `folder` erasure-log entry ([src/erasure](../erasure/README.md)) |
| GET | `/api/files/notifications` | `file:read` | The caller's 50 most recent "file shared with you" notifications |
| GET | `/api/files/notifications/unread-count` | `file:read` | `{ count }` of unread notifications |
| POST | `/api/files/notifications/mark-read` | `file:read` | Mark all of them read |
| GET | `/api/files/:id` | `file:read` | Metadata, with `canDownload`, plus `shareable` (true for the owner) |
| GET | `/api/files/:id/content` | `file:read` | Inline bytes for the viewer. Needs view access. |
| GET | `/api/files/:id/download` | `file:read` | Attachment bytes. Needs download access (403 otherwise). |
| PATCH | `/api/files/:id` | `file:update` | Rename (`RenameFileDto`), owner only |
| PATCH | `/api/files/:id/move` | `file:update` | Move into one of the caller's folders, or to the root with `null` (`MoveFileDto`) |
| DELETE | `/api/files/:id` | `file:delete` | Soft delete (`deleted_at`), owner only, with a `file` erasure-log entry in the same transaction. Rows and stored objects are erased for good after `SOFT_DELETE_RETENTION_DAYS` ([src/retention](../retention/README.md)) |
| GET | `/api/files/:id/shares` | `file:update` | List shares, owner only |
| POST | `/api/files/:id/shares` | `file:update` | Add or update shares (`ShareFileDto`), owner only. Re-sharing with the same principal updates the row. Each share queues a notification job, and each direct user share gets a chat message. |
| PATCH | `/api/files/:id/shares/:shareId` | `file:update` | Toggle `canDownload` (`UpdateShareDto`) |
| DELETE | `/api/files/:id/shares/:shareId` | `file:update` | Revoke a share |

Both content routes send `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`, so user content on the API origin can never run as a page.

### Services / exports

`FileManagerModule` exports `FileManagerService` and `FolderService`. The module also provides `FileAccessService`, `FileShareService` and `FileNotificationService`, which are not exported.

**`FileManagerService`**

- Listing and reading: `list()`, `getMetadata()`, `browseFolder()`.
- Uploads: `createUploadTicket(userId, { name, sizeBytes, contentType, folderId? })`, `finaliseUpload(userId, fileId)`.
- Changes: `move()`, `rename()`, `softDelete()`.
- Content: `getViewContent()`, `getDownloadContent()`.
- Shares: `listShares()`, `share()`, `updateShare()`, `revokeShare()`.
- `readContentForAuthorisedCaller(fileId)` streams any `ready`, not deleted file (`{ body, size, contentType, filename }`) with no access check. View, download, course-file and hand-in routes all stream from storage, so serving a file never holds it in memory. The caller must already have authorised the read; it exists for teachers reading hand-ins and for course files.
- Object keys are `file-manager/<schoolId>/<userId>/<fileId>-<slug>`.

**`FolderService`**

- `listChildren()`, `listAll()`, `getOwned()`, `breadcrumb()` (at most 64 levels).
- `create()`, `rename()`, `move()`, `remove()`.

**`FileAccessService`** (internal)

- `principalsFor(userId, schoolId)` returns the user id, custom role ids, and course ids. Staff courses count only while the user is still a school member; student courses count while the enrolment is `active`.
- `accessFor()`, `sharedFileIdsFor()`, `sharedFileIds()`.
- `downloadFlagsFor()` resolves download rights for a whole page in one query, so listing has no N+1.

**`FileShareService`** (internal)

- `list()`, `share()`, `updateDownload()`, `revoke()`.
- A course share must name a course in the file's own school (404 otherwise).

**`FileNotificationService`** (internal): `list()`, `unreadCount()`, `markAllRead()`.

### Other

- **`file-content.ts`**: `ALLOWED_CONTENT_TYPES`, `matchesSignature()`, `inspectStructure()`, `verifyContent()`, `verifySubmissionContent()` and `inspectsBytes()`. These are pure functions; `FileManagerService` uses `verifyContent()` on upload-ticket completion.
- **`dto/list-files.filter.ts`**: the `FileListFilter` enum (`own`, `shared`, `all`), kept free of decorators so the service and its tests can import it.

## Used by

- `src/grading/grading.module.ts` imports `FileManagerModule`. `src/grading/submission.service.ts` uses `createSubmissionUploadTicket()` and `finaliseSubmissionUpload()` for student hand-ins (the student's own login owns the file), and `readContentForAuthorisedCaller()` for staff reading a submission.
- `src/course/course.module.ts` imports it. `src/course/course-file.service.ts` calls `readContentForAuthorisedCaller()` once it has checked that the file is linked to the course, shared, or owned.
- `src/student-portal/student-portal.module.ts` imports it. `student-portal.service.ts` calls `readContentForAuthorisedCaller()` for course files, and `portal-activity.controller.ts` reuses `CreateUploadTicketDto`.
- `src/app.module.ts` imports `FileManagerModule`.
- Front end:
  - `frontend/app/dashboard/files/` (`page.tsx`, `FolderBrowser.tsx`, `FolderDialogs.tsx`, `RenameDialog.tsx`, `ShareDialog.tsx`, `UploadButton.tsx`).
  - `frontend/lib/files/content.ts` (content and download).
  - `frontend/lib/file-notifications.ts` (unread count, mark read).
  - `frontend/app/dashboard/courses/[courseId]/modules/_components/AddItemDialog.tsx` (picks a file with `/files?filter=all`).
- Mobile: `mobile/app/files/index.tsx`, `mobile/src/features/files/FileDetailsSheet.tsx`, `mobile/src/features/files/ShareSheet.tsx`, and `mobile/app/chat/[conversationId].tsx` (opens a shared file's content).

## Depends on

- `StorageService`, `ByteBudget` and `objectKey()` (`src/storage`, global).
- `PrismaService`.
- `FileQueueService.enqueueShareNotify()` (`src/queue`, global). `queue/handlers/file-share-notify.handler.ts` then writes the notification rows.
- `ChatSystemService.notifyFileShares()` (`src/chat`, global): a "file shared with you" message in the DM.
- `PermissionGuard` and `@RequirePermission` (`src/permission`).
- `userSchoolId()` (`src/common/user-school.ts`).
- `num()`, `isNotFound()` and `isUniqueViolation()` (`src/common/db-values.ts`).

## Data

Tables in the `file_manager` schema (see [`prisma/schema/files.prisma`](../../prisma/schema/files.prisma)):

| Table | Use |
| --- | --- |
| `file` | Status `pending`, `ready` or `failed`; `scan_detail` explains a failure; `deleted_at` marks a soft delete |
| `folder` | Owner's tree; `is_system` folders cannot be renamed (no code creates them today); names are unique per parent |
| `file_share` | `principal_type` (`user`, `role` or `course`), `principal_id`, `can_download`; unique per file and principal |
| `notification` | Read and marked read here; written by the queue handler |

It also reads `public.school_management`, `public.school_management_role`, `course.course`, `course.course_staff`, `course.course_student` and `student.student` to resolve principals. Objects are stored under the storage bucket `file-manager`.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `UPLOAD_MAX_MB` | `1024` | Ceiling for every school's upload limit, whole MB 1-1024 (1 GB). PDFs, images and Office files are also capped at `UPLOAD_VERIFY_MEMORY_MB`, since they are read whole to be checked. |
| `UPLOAD_DEFAULT_MB` | `100` | Limit for schools without their own; clamped to `UPLOAD_MAX_MB`. |

Both are read by `upload-limit.config.ts`; a malformed value stops a production boot and is warned about (default used) in development.

The storage backend, and `UPLOAD_VERIFY_MEMORY_MB` (memory for checking completed uploads), are configured in `src/storage`.

## Files

| File | Purpose |
| --- | --- |
| `file-manager.module.ts` | Module wiring; exports `FileManagerService`, `FolderService` and `UploadLimitService` |
| `file-manager.controller.ts` | All `/api/files` routes |
| `file-manager.service.ts` | Listing, presigned uploads, rename, move, delete, content, share orchestration |
| `folder.service.ts` | Owner-private folder tree |
| `upload-limit.config.ts` | `UPLOAD_MAX_MB` / `UPLOAD_DEFAULT_MB` parsing and `effectiveUploadMb()` |
| `upload-limit.service.ts` | A school's effective upload limit (cached), and setting it |
| `file-access.service.ts` | Principal resolution and view/download access |
| `file-share.service.ts` | Share rows and notification jobs |
| `file-notification.service.ts` | The caller's file notifications |
| `file-content.ts` | Allowed types, byte signatures, Office and PDF structure checks |
| `file-manager.service.test.ts` | Listing, ownership, direct uploads |
| `folder.service.test.ts` | Create, rename (system folders refused), move |
| `file-access.service.test.ts` | `accessFor()` and `downloadFlagsFor()` |
| `file-content.test.ts` | Signatures and structure checks |
| `upload-limit.test.ts` | Env validation, limit resolution, caching, the update DTO and ceiling |
| `dto/` | Request DTOs, see [`dto/README.md`](dto/README.md) |

## Tests

`cd backend && bun test src/file-manager`. Covers:

- **Listing**: bare array versus paginated envelope, an empty shared list, batched download flags.
- **Ownership**: 403 for someone else's file, and a malformed id is a 404.
- **Direct uploads**: the ticket is a presigned PUT; disallowed types and sizes are refused; completion succeeds or fails cleanly; mismatched objects are deleted.
- **Upload limit**: tickets above the school's limit are refused with it in the message, `maxBytes` is the school's limit, a 100 MB school takes 100 MB, hand-ins use the course's school; env validation (fail closed in production), null to default, clamp to the ceiling, cache dropped on update, DTO and ceiling checks.
- **Upload memory**: unchecked types are copied without being read; checked types hold and release the verify budget (also on failure); a full budget is a 503 that leaves the row pending and a retry completes.
- **Folders**: names are cleaned; duplicates, renaming a system folder and cycles are rejected.
- **Access**: owner, view-only and download shares, files that are not ready yet, OR-ed download flags.
- **Content checks**: every signature, Office and PDF structure rules.

## See also

- [`docs/content/backend/file-manager.md`](../../../docs/content/backend/file-manager.md)
- [`../permission/README.md`](../permission/README.md): the `file:*` keys
- [`../grading/README.md`](../grading/README.md): student hand-ins stored as files
