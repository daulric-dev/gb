---
sidebar_label: 2026-09-20 · Resumable uploads
sidebar_position: 3
---

# 2026-09-20 - File uploads moved to TUS

Uploads now go **straight from the browser (or app) to Supabase Storage over TUS**, resuming where they stopped if the connection drops, instead of streaming through the API as one multipart request.

No migration. The `file_manager.file_status` enum already had `pending | scanning | ready | failed | infected`, which is what makes the new flow possible.

## The flow

1. `POST /files/upload-ticket` reserves a `file` row as **`pending`**, decides the object path, and returns a short-lived token.
2. The client uploads the bytes to Storage over TUS.
3. `POST /files/upload-ticket/:fileId/complete` downloads what landed, checks the size, verifies the leading bytes against the declared type, virus-scans it, and only then flips the row to `ready`.

Rejected uploads are deleted from Storage and the row is marked `failed` or `infected` **with the reason**, rather than vanishing silently.

## The credential problem

The apps hold no Supabase session - auth is httpOnly cookies against this backend - so the browser cannot talk to Storage on its own. Two options were tested against a live stack:

- **Signed upload tokens are refused** by the resumable endpoint (403). They work only for the standard upload route.
- **A short-lived session JWT works.** The backend mints one (30 minutes, `role: authenticated`, carrying the caller's own id), and the existing storage RLS policy confines writes to that user's school prefix. Verified: **201** for the caller's own school, **403** for another school's path.

### The trade-off, stated plainly

For its lifetime that token could write anywhere under the user's own school prefix in the `file-manager` bucket. It cannot read, cannot touch another school, and is issued only after the usual permission guard. It is nonetheless more than the browser could do before, and it is the price of uploading directly.

`SUPABASE_JWT_SECRET` must be set, and **must match the Supabase project** - a hosted deployment needs its own value or Storage rejects every upload.

## What the new model broke, and how it is closed

A file row now exists **before** its bytes are checked. `downloadBytes` - the single choke point for bytes leaving the file manager - refuses anything not `ready`, so a pending or infected file is unreadable through every path at once rather than each call site needing its own check.

## Student submissions

Students hold no catalog permissions, so they cannot call `POST /files`. The portal has its own ticket endpoints (`/portal/me/activities/:id/upload-ticket` and `.../complete`) which check the activity is theirs and accepts files before issuing anything, then attach the released file to their draft.

A teacher is neither the file's owner nor a share recipient, so `getViewContent` would deny them. `GET /activities/submissions/:submissionId/file` authorises by **class ownership** instead and streams the bytes.

## A bug found while wiring it

`submitAssignment` wrote `file_id: input.fileId ?? null`, so **handing in text would have silently detached a file uploaded moments earlier**. It now falls back to the draft's existing `file_id`, and a file alone is enough to hand in.

## Mobile

The app uses the same three steps. A picked document arrives as a `file://` URI rather than a `File`, so it is read into a Blob first - which means the upload runs the identical code path the browser takes rather than a React-Native-specific one. The 10MB server cap keeps holding it in memory affordable.

## Not moved

Avatars still use the multipart path. They go to the `images` bucket, which has **no storage RLS policy**, so a direct upload would mean opening a public bucket - and avatars are small and cropped client-side, so resumability buys nothing. The multipart endpoints also remain in place for the file manager and portal as a fallback.
