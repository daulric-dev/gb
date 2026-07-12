---
sidebar_label: 2026-07-11 · File manager hardening
sidebar_position: 1
---

# 2026-07-11 - File manager hardening

The file manager moved from "structurally complete" to production-ready: real virus scanning, real share notifications, content-type verification on upload, and a fix for an N+1 in the listing. **Two new migrations** (storage-bucket notifications table; no changes to existing tables).

## Virus scanning is now real

`FileScanHandler` previously passed every upload through a no-op `scanForViruses` stub while still driving the `pending → scanning → ready/infected` lifecycle. It now delegates to a new `ClamavScanner` ([scan/clamav.scanner.ts](../../../../backend/src/scan/clamav.scanner.ts)) that streams the bytes to a ClamAV daemon over TCP (the INSTREAM command) and interprets the verdict:

- **`CLAMAV_HOST` set** - a clean verdict marks the file `ready`; a `FOUND` verdict marks it `infected` with the signature; an unreachable daemon or `ERROR` reply **fails closed** (the job errors and retries rather than marking untested bytes `ready`).
- **`CLAMAV_HOST` unset** - scanning is disabled and files pass through, with a startup warning. Local/dev only; see [Environment Variables](../../environment-variables.md) for `CLAMAV_HOST` / `CLAMAV_PORT` / `CLAMAV_TIMEOUT_MS`.

Writing the scanner surfaced a latent bug the tests caught: on an `ERROR` reply the parse threw *inside* the socket's `end` callback, which would have escaped as an uncaught exception instead of rejecting the scan promise. Fixed to route the throw to `reject`.

## Content-type verification on upload

Uploads previously trusted the client-declared MIME type; only the async scan checked it against an allowlist. A new shared `file-content.ts` ([backend/src/file-manager/file-content.ts](../../../../backend/src/file-manager/file-content.ts)) verifies the declared type against the file's **magic bytes** (PDF, PNG, JPEG, WebP, and the ZIP signature for xlsx/docx; text/csv have no signature and are accepted on declaration). `uploadManual` now rejects unsupported or mislabelled files up front, and the scan handler reuses the same check as defence in depth.

## Share notifications are real (in-app)

`FileShareNotifyHandler` previously only logged. There is now a `file_manager.notification` table and the handler writes one row per resolved recipient, idempotent on `(user_id, share_id)` so a retry or re-share never duplicates or resurrects a read notification. New endpoints under `/files/notifications` (list, `unread-count`, `mark-read`) back a **Files** sidebar unread badge that mirrors the announcements pattern; opening the Files page marks them read.

## Listing: N+1 fixed, pagination added

`GET /files` resolved the caller's principals (three queries) **per shared file** to compute each download flag. It now resolves principals once and batches the download flags for a whole page into a single query (`FileAccessService.downloadFlagsFor`), and the `all` filter is expressed as one SQL query so it can paginate at the database. The endpoint still returns a bare array by default; passing `page` (with optional `pageSize`) returns a `{ data, meta }` envelope - backward-compatible, matching the `student` list convention, so the existing Files page is unaffected.

## Tests

Added coverage for the previously-untested access logic: `FileAccessService` (owner/role/group/user resolution, ready-gating, download OR-ing), the `list` N+1/pagination path and ownership guard, `file-content` verification, and the ClamAV scanner (disabled passthrough + a fake-clamd server exercising OK/FOUND/ERROR). Backend suite: 212 → 234 tests.

## Behavior notes

- The runtime `ensureBucket()` bucket-creation path was removed earlier; the `file-manager` and `report-books` buckets are declared in `supabase/config.toml` and **must exist in each environment** before uploads run. The stale migration comment was corrected.
- Not addressed this pass: soft-delete still leaves the stored object and share rows behind (no storage GC), and regenerating a report ingests a new file each time. Both are documented as known limitations in [File Manager](../../backend/file-manager.md).
