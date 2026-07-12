---
sidebar_label: 2026-07-12 · File manager folders
sidebar_position: 3
---

# 2026-07-12 - File manager folders

The file manager gained **folders**. Users can organize their files into a nested folder tree under **My files**, and server-generated reports are now filed automatically under a per-owner **Reports / \<date\>** path instead of piling up in a flat list. **One new migration** (`file_manager.folder` + a `file.folder_id` column; no changes to existing columns' meaning).

## What you can do

- **Create, rename, and delete folders** in the **My files** tab, and **move files** between them (a "Move to…" action with a folder picker).
- **Browse** with breadcrumbs; upload straight into the folder you're viewing.
- **Reports auto-file by date** — every generated report lands under `Reports/YYYY-MM-DD` in the owner's file manager.

The **All** and **Shared with me** tabs are unchanged — they stay flat lists, since folders are the owner's private organization and don't apply to files shared with you.

## Data model

New migration `supabase/migrations/20260712140000_file_manager_folders.sql`:

- `file_manager.folder` — `parent_id` (self-FK) for nesting, `owner_id`, `is_system`, soft-delete. Folder names are unique within a parent per owner, enforced by **two partial unique indexes** (nested vs. root, because a `NULL` parent never collides on its own).
- `file_manager.file.folder_id` — nullable placement in the owner's tree (`NULL` = root), `ON DELETE SET NULL`.
- RLS: owner-scoped read/write, school-scoped (defense-in-depth; the API uses the service role). Run `bun db:types` to regenerate types.

## Backend

A new `FolderService` ([folder.service.ts](../../../../backend/src/file-manager/folder.service.ts)) owns browse / create / rename / delete / move and a `findOrCreateSystemPath` helper. New routes on the file-manager controller — `GET /files/folders/contents` (browse), `GET /files/folders` (picker), `POST /files/folders`, `PATCH|DELETE /files/folders/:id`, and `PATCH /files/:id/move` — all declared before `/:id` so the literal paths win. `uploadManual` takes an optional target `folderId`, and every listed file now carries its `folderId`.

**Recursive delete**: deleting a folder soft-deletes the folder, all descendant folders, and every file inside them — walked in JS so files are soft-deleted the same way a direct delete is, rather than hard-deleted by the FK cascade.

**Reports by date**: `IngestJobData` gained an optional `folderPath`. `ReportService` passes `['Reports', '<generation date>']`; `FileIngestHandler` find-or-creates that per-owner system-folder path (idempotent via the unique indexes) and files the report into the leaf. The resolver is inlined in the handler so the queue module stays decoupled from the file-manager module.

## Frontend

The **My files** tab is now a `FolderBrowser` ([app/dashboard/files/_components/](../../../../frontend/app/dashboard/files/_components/FolderBrowser.tsx)): breadcrumb navigation, a subfolder grid (each with rename/delete), a folder-aware upload button, and the file table with a new **Move to…** action backed by a `MoveFileDialog` folder picker. System folders (e.g. `Reports`) show a lock and can't be renamed. `FilesTable` and `UploadButton` gained optional `onMove` / `folderId` props and are otherwise unchanged, so the flat All / Shared tabs behave exactly as before.

## Tests

Added `folder.service.test.ts` — name sanitization, duplicate/empty rejection, the system-folder rename guard, and `findOrCreateSystemPath` (create-each-segment and reuse-existing). Existing `FileManagerService` tests were updated for the new `FolderService` dependency. Backend suite: 243 → 249 tests, all passing.

## Known limitations

- Folders don't move (a file moves between folders, but a folder can't be re-parented yet).
- Folders aren't shared — sharing stays at the file level, and a recipient sees shared files as a flat list.
