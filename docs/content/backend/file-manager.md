---
sidebar_label: File Manager
---

# File Manager Module

**Location**: `backend/src/file-manager/`

The file manager gives each user a personal file space: generated report files land there automatically, and users can upload their own files. Any file can be shared - view-only or view+download - with a specific user, everyone holding a school role, or every teacher assigned to a class/group. Every uploaded file is virus-scanned synchronously before it is stored (see [Virus scanning](#virus-scanning)).

## Files

| File | Purpose |
|------|---------|
| `file-manager.module.ts` | Module definition; wires the controller and the four services |
| `file-manager.controller.ts` | `/files` REST surface (list, upload, view/download, rename, delete, shares, notifications) |
| `file-manager.service.ts` | Orchestration: listing, upload, rename/delete, content delivery, ownership checks |
| `file-access.service.ts` | Access resolution - owner / role / group / user shares, view vs. download |
| `file-share.service.ts` | Share CRUD (create/list/update/revoke) for a known-owned file |
| `folder.service.ts` | The owner's folder tree — browse, create, rename, delete (recursive), move, and find-or-create system paths |
| `file-notification.service.ts` | Read side of in-app "shared with you" notifications |
| `file-content.ts` | Allowed content types + magic-byte verification (used on upload) |
| `dto/` | Request validation (list filter + pagination, rename, share, update-share) |

Virus scanning is centralized at the storage boundary, not in this module:

| File | Purpose |
|------|---------|
| `scan/clamav.scanner.ts` | Streams bytes to a ClamAV daemon (INSTREAM) and interprets the verdict; provided globally by `ScanModule` |
| `supabase/supabase.service.ts` | `uploadFile` / `scanOrThrow` scan **every** backend upload before it is stored |

A small async pipeline remains in the queue module for non-upload work:

| File | Purpose |
|------|---------|
| `queue/handlers/file-ingest.handler.ts` | Records an already-stored object (e.g. a report PDF) as a `ready` file |
| `queue/handlers/file-share-notify.handler.ts` | Resolves a share's recipients and writes their notifications |

## Endpoints

All routes are under `/files`, guarded by `AuthGuard` + `PermissionGuard`.

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| `GET` | `/files` | `file:read` | Flat list (`filter=all\|own\|shared`; optional `page`/`pageSize`) — backs the All / Shared tabs |
| `POST` | `/files` | `file:create` | Upload a file (`multipart/form-data`, optional `?name=`, optional `?folderId=`) |
| `GET` | `/files/folders/contents` | `file:read` | Browse a folder: `{ folder, breadcrumb, folders, files }` (`?folderId=`, omit for root) |
| `GET` | `/files/folders` | `file:read` | Flat list of the caller's folders (move-target picker) |
| `POST` | `/files/folders` | `file:create` | Create a folder (`{ name, parentId? }`) |
| `PATCH` | `/files/folders/:folderId` | `file:update` | Rename a folder (not system folders) |
| `DELETE` | `/files/folders/:folderId` | `file:delete` | Delete a folder **and everything inside it** (recursive soft-delete) |
| `PATCH` | `/files/:id/move` | `file:update` | Move a file into a folder (`{ folderId: string \| null }`) |
| `GET` | `/files/notifications` | `file:read` | Recent share notifications for the caller |
| `GET` | `/files/notifications/unread-count` | `file:read` | Unread notification count (drives the sidebar badge) |
| `POST` | `/files/notifications/mark-read` | `file:read` | Mark all notifications read |
| `GET` | `/files/:id` | `file:read` | File metadata (+ `shareable` flag for owners) |
| `GET` | `/files/:id/content` | `file:read` | Inline bytes for the viewer (requires view access) |
| `GET` | `/files/:id/download` | `file:read` | Download bytes (requires download access) |
| `PATCH` | `/files/:id` | `file:update` | Rename (owner only) |
| `DELETE` | `/files/:id` | `file:delete` | Soft-delete (owner only) |
| `GET`/`POST` | `/files/:id/shares` | `file:update` | List / create shares (owner only) |
| `PATCH`/`DELETE` | `/files/:id/shares/:shareId` | `file:update` | Toggle download / revoke a share (owner only) |

> The `folders/*` and `notifications/*` routes are declared **before** `/:id` so the literal paths are not captured by the `:id` param route.

## Folders

Migration `20260712140000_file_manager_folders.sql` adds `file_manager.folder` (nested via `parent_id`) and a nullable `file.folder_id`.

Folders are an **owner-private organization layer** — a folder is never shared, and `folder_id` is the owner's placement of a file, irrelevant to recipients. Every `FolderService` method is scoped to `owner_id = userId` (plus RLS as defense-in-depth). Folder names are unique within a parent per owner, enforced by two partial unique indexes (one for nested folders, one for roots, since a `NULL` parent would otherwise never collide).

- **Browsing** — the **My files** tab calls `GET /files/folders/contents`, which returns the current folder's subfolders, the files directly inside it (`folder_id = current`, or `IS NULL` at the root), and a breadcrumb trail. The **All** and **Shared with me** tabs stay flat (`GET /files`) and ignore folders.
- **Delete is recursive** — deleting a folder soft-deletes the folder, all descendant folders, and every file within them. The subtree is walked in JS (trees are shallow) so contained files are soft-deleted the same way a direct file delete is, rather than being hard-deleted by the FK cascade.
- **System folders** (`is_system = true`) are auto-created for server reports (below). They can't be renamed, but the owner may still delete them.

### Server reports are filed by date

When a report is generated, `ReportService.enqueueFileManagerIngest` passes `folderPath: ['Reports', '<YYYY-MM-DD>']` on the ingest job. `FileIngestHandler` find-or-creates that per-owner system-folder path (idempotent via the unique indexes) and sets the new file's `folder_id` to the leaf — so each user's generated reports land under **Reports / \<generation date\>** in their file manager. The folder resolution is inlined in the handler (rather than reusing `FolderService`) so the queue module stays independent of the file-manager module.

## Listing

`GET /files` returns a bare array by default. Passing `page` switches it to a
paginated envelope (`{ data, meta }`) - mirroring the `student` list
convention - so existing array consumers are unaffected.

Access for a listing is resolved **without an N+1**: the caller's principals
(role ids + group ids) are resolved once, then the download flag for every
non-owned row on the page is resolved in a single batched query
(`FileAccessService.downloadFlagsFor`). The `all` filter is expressed as one
SQL query (`owner_id = me OR (id IN sharedIds AND status = 'ready')`) so it can
paginate at the database rather than merging two result sets in memory.

## Access model

`FileAccessService.accessFor` resolves what a user may do with one file:

- **Owner** → view + download, any status.
- **Recipient** → only once the file is `ready`; download only if their
  best-matching share has `can_download` (OR-ed across all matching shares -
  most permissive wins).
- **Otherwise** → no access.

A share targets a **user**, a **role** (everyone whose school membership holds
that custom role), or a **group** (every teacher assigned to that class/group).

## Upload validation

On `POST /files` the service checks size (≤10MB), rejects empty files, and
**verifies the content type against its magic bytes** (`file-content.ts`) - the
client-declared MIME type is never trusted alone, so a `.html` renamed to
`.pdf` is rejected up front. The bytes are then virus-scanned inside
`uploadFile` (below); a clean file is stored and recorded directly as `ready`.
The `file_status` enum still carries `pending`/`scanning`/`infected`/`failed`
for historical rows, but a synchronous upload now only ever produces `ready`
(an infected or unreadable file is rejected before any row is written).

## Virus scanning

Scanning is **centralized at the storage boundary**, so it is not specific to
the file manager - every backend-mediated upload is covered:

- `SupabaseService.uploadFile` scans each buffer before storing it (avatars,
  file-manager uploads).
- `SupabaseService.scanOrThrow` is called directly by the report writers and
  the resumable-avatar completion step, which upload by other means.
- The resumable/TUS avatar path can't be scanned inline (bytes go client →
  Supabase), so `completeResumableUpload` downloads the finished object, scans
  it, and **deletes + rejects** it if infected.

`ClamavScanner` streams the file to a ClamAV daemon over TCP (the INSTREAM
command) and interprets the verdict:

- `CLAMAV_HOST` **set** → a clean verdict lets the upload proceed; a `FOUND`
  verdict throws a `400` (file rejected, never stored). If clamd is unreachable
  or replies `ERROR`, the scan **fails closed** (the error propagates and the
  upload fails rather than storing unscanned bytes).
- `CLAMAV_HOST` **unset** → scanning is **disabled** and every file passes
  through, with a startup warning. Intended for local/dev only; configure a
  scanner before production.

See [Environment Variables](../environment-variables.md) for `CLAMAV_*`.

## Notifications

When a file is shared, the share-notify handler resolves the recipients and
writes one row per recipient into `file_manager.notification` (idempotent on
`(user_id, share_id)`, so a retry or a re-share does not duplicate or resurrect
a read notification). The owner is never notified about their own share.

The frontend polls `unread-count` on navigation to render a badge on the
**Files** sidebar item, and marks everything read when the Files page opens.

## Storage & schema

- Uploaded files live in the private **`file-manager`** bucket at
  `<schoolId>/<userId>/<fileId>-<slug>`; ingested report files reference the
  **`report-books`** bucket. Both buckets are declared in
  `supabase/config.toml` and must exist per environment.
- Tables (`file_manager` schema): `file`, `file_share`, `notification`. RLS
  keeps every row inside its school and restricts writes to the owner/admin;
  the API itself enforces fine-grained access via the service role, so RLS is
  defence-in-depth.

## Known limitations

- Soft-delete (`deleted_at`) hides a file but does not remove the stored object
  or its share rows; there is no storage GC job yet.
- Regenerating a report ingests a new file each time, so repeated generation
  can accumulate entries in a user's Files.
