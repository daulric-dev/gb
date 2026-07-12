---
sidebar_label: 2026-07-12 · Scan all storage uploads
sidebar_position: 1
---

# 2026-07-12 - Virus-scan every storage upload

Virus scanning was previously wired only into file-manager uploads. It now runs at the storage boundary, so **every** file written to a bucket - avatars, file-manager uploads, and generated report files - is scanned. No migrations.

## Scanning centralized in `uploadFile`

`ClamavScanner` moved out of the queue module into a small global `ScanModule` ([scan/clamav.scanner.ts](../../../../backend/src/scan/clamav.scanner.ts)) so it has no module-cycle with `SupabaseService`. `SupabaseService` gained a `scanOrThrow` and now scans inside `uploadFile` ([supabase/supabase.service.ts](../../../../backend/src/supabase/supabase.service.ts)): every backend-buffered upload is scanned before it is stored. A `FOUND` verdict throws a `400` (file never stored); an unreachable/`ERROR` clamd **fails closed** (the upload errors rather than storing unscanned bytes). With `CLAMAV_HOST` unset, scanning is disabled and uploads pass through (dev only).

Coverage by path:

- **Avatars (standard)** and **file-manager uploads** go through `uploadFile` → scanned automatically.
- **Report files** (PDF/CSV/XLSX) upload by a different call, so `ReportService` now calls `scanOrThrow` before each `.upload()`.
- **Resumable/TUS avatars** upload client → Supabase directly, so the bytes never reach the backend at upload time. `completeResumableUpload` now downloads the finished object, scans it, and **deletes + rejects** it if infected.

## File-manager scanning is now synchronous

Because `uploadFile` scans up front, the file manager no longer needs its async scan step. The `file-scan` BullMQ queue, its handler, and processor were **removed**; `uploadManual` records a clean upload directly as `ready`. The `ingest` and `share-notify` queues are unchanged. The `file_status` enum keeps its `pending`/`scanning`/`infected`/`failed` values for historical rows, but a synchronous upload now only ever yields `ready` (infected/unreadable files are rejected before a row is written).

## Tests

Added a fake-clamd server test for the scanner (OK / FOUND / ERROR, plus disabled passthrough - which caught a real bug where an `ERROR` reply escaped the socket callback instead of rejecting), and an "infected resumable avatar is deleted and rejected" test. Backend suite: 234 → 236.

## Behavior notes

- Report generation now incurs one virus scan per generated file. With `CLAMAV_HOST` unset it's a no-op.
- Scanning is fail-closed: if a scanner is configured but unreachable, uploads (including avatars and report saves) will fail until clamd is healthy. See [docker-compose.dev.yml](../../../../docker-compose.dev.yml) for a local clamd, and [Environment Variables](../../environment-variables.md) for `CLAMAV_*`.
