---
sidebar_label: 2026-09-21 · ClamAV removed
sidebar_position: 1
---

# 2026-09-21 - ClamAV removed

Virus scanning is gone. **Uploads are no longer scanned for malware.** This is a deliberate trade of a security control for the resources it cost; the reasoning and what remains are below.

> **Followed by** [Structural content checks](./structural-content-checks.md), which closed the specific gaps this removal left - macro-carrying documents, archives posing as documents, and PDFs with active content.

No migration. The `file_manager.file_status` enum keeps `scanning` and `infected` for historical rows; neither is produced any more.

## Why

A `clamd` instance holds its entire signature database resident - roughly 1.5-2GB - and the image ships amd64-only, so on an arm64 host it ran under emulation. The stack also blocked on its health check with a 300-second start period, because first boot downloads the signature database before clamd answers. For the size of deployment this runs on, that was the single largest line item in the resource budget.

## What was removed

- `backend/src/scan/` - `ClamavScanner`, its test, and `ScanModule`.
- `SupabaseService.scanOrThrow`, and the scan step inside `SupabaseService.uploadFile`.
- The call sites: the two report-PDF writers, the resumable-avatar completion step, and the file manager's `finaliseUpload`.
- The `clamav` service, its `depends_on`, its volume and the `CLAMAV_*` variables from both `infrastructure/docker-compose.yml` and `docker-compose.dev.yml`.
- `CLAMAV_HOST`, `CLAMAV_PORT` and `CLAMAV_TIMEOUT_MS` from the environment docs.

The avatar completion path also lost its download step, which existed only to feed the scanner - the object is now left where the client put it.

## What still protects an upload

Scanning was one layer of several, and the others are untouched:

- **Type allow-list.** Only PDF, PNG, JPEG, WebP, plain text, CSV, XLSX and DOCX are accepted. Executables and scripts are refused outright.
- **Magic-byte verification.** `verifyContent` checks the declared type against the leading bytes, so a renamed file does not pass on its extension. This is what catches the cheap attack - an `.exe` called `coursework.pdf`.
- **Size cap.** 10MB per file.
- **No execution path.** Files are stored as opaque objects and served back as downloads; nothing in the stack opens, renders or interprets them.
- **Scoped access.** A file is reachable by its owner, the people it is explicitly shared with, and - for a submission - the teacher who owns the class. `downloadBytes` additionally refuses anything not `ready`.

## The residual risk, stated plainly

As of this change, a file that is a **genuine** PDF, DOCX or XLSX and also carries a payload - a macro, or an exploit for the recipient's viewer - reached the recipient: nothing inspected file contents beyond the first few bytes.

> Most of this was addressed the same day by [structural content checks](./structural-content-checks.md): macros, archives posing as documents and PDFs carrying active content are now rejected. What remains is an exploit against the recipient's own viewer, in an otherwise well-formed file.

The exposure that matters most is student submissions: a student uploads, and a teacher downloads and opens it on their own machine.

## Putting it back

`SupabaseService.uploadFile` remains the single choke point for bytes entering storage, so reinstating scanning means one call there plus the two resumable completion paths (`ImagesService.completeResumableUpload` and `FileManagerService.finaliseUpload`), which upload by other means and have to check after the fact.

A hosted scanning API would avoid the memory cost that caused this removal, at the price of a per-file network round trip and a key to manage.
