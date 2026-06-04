---
sidebar_label: 2026-06-04 · Announcement board
sidebar_position: 2
---

# 2026-06-04 - Announcement board

A new school-wide announcement board: staff post notices that everyone in the school can read, with an unread badge and per-announcement read receipts (avatars of who has read each notice).

Requires two migrations. No behavior changes to existing features.

## Data model

Three additions in the `public` schema (see [20260603120000_announcement.sql](../../../../supabase/migrations/20260603120000_announcement.sql) and [20260603140000_announcement_read_receipts.sql](../../../../supabase/migrations/20260603140000_announcement_read_receipts.sql)):

- `announcement` - `id`, `school_id`, `author_user_profile_id`, `title`, `body`, timestamps. FK-cascaded to `school` and (set-null) `user_profile`. RLS: anyone in the school reads; members insert; author-or-admin update/delete.
- `announcement_read` - `(announcement_id, user_profile_id)` read receipts with `read_at`. RLS: school members see in-school receipts; a user records only their own.

An interim `announcement_read_state` (last-read timestamp) shipped first and was replaced by the per-announcement `announcement_read` table in the same release, so read receipts could show *who* read each notice. The drop is handled in the second migration.

## RBAC

A new `announcement` resource was added to the code-owned permission catalog ([permission.catalog.ts](../../../../backend/src/permission/permission.catalog.ts)) with the usual `create/read/update/delete` actions. Default grants: admins everything, teachers full control, members read-only. The catalog syncs to `public.permission_catalog` on boot, so the resource appears in the role permissions editor automatically.

## Backend

New `AnnouncementModule` ([announcement.module.ts](../../../../backend/src/announcement/announcement.module.ts)) wired into `app.module.ts` and the versioning registry.

| Method | Route | Permission |
|--------|-------|------------|
| GET | `/announcements` | `announcement:read` |
| GET | `/announcements/unread-count` | `announcement:read` |
| POST | `/announcements/mark-read` | `announcement:read` |
| GET | `/announcements/:id` | `announcement:read` |
| POST | `/announcements` | `announcement:create` |
| PATCH | `/announcements/:id` | `announcement:update` |
| DELETE | `/announcements/:id` | `announcement:delete` |

Notable service behavior ([announcement.service.ts](../../../../backend/src/announcement/announcement.service.ts)):

- **Author-or-admin edits.** `announcement:update`/`delete` alone isn't sufficient - the service additionally requires the caller to be the author or a school admin, so a teacher can't modify another staff member's notice.
- **Read tracking.** `markRead` bulk-upserts a receipt per in-school announcement; `getUnreadCount` returns the count of announcements posted *by others* the user hasn't read. The author is never counted as unread on, or shown as a reader of, their own post.
- **Caching.** Announcement *content* (title/body/author) is cached per school (`announcements:content:<schoolId>`, 30-day TTL) and invalidated only on create/update/delete. Read receipts are fetched live on each list and merged in, so "read by" stays accurate without invalidating the content cache on every read.

## Frontend

- New board at `/dashboard/announcements` ([page.tsx](../../../../frontend/app/dashboard/announcements/page.tsx)) - a card feed with a permission-gated "New Announcement" dialog, author + timestamp, and edit/delete shown only to the author/admin.
- **Unread badge.** A global signal ([lib/announcements.ts](../../../../frontend/lib/announcements.ts)) drives a count badge on the sidebar "Announcements" item; it refreshes on navigation and clears when the board is opened (which marks everything read).
- **Read receipts.** Each card shows a "Read by" row of overlapping avatars ([ReaderAvatars.tsx](../../../../frontend/app/dashboard/announcements/_components/ReaderAvatars.tsx)) with a name tooltip on hover and a "+N" overflow. A read is recorded when a user opens the board (board-level "seen", not per-message).

## Deploy

Run both announcement migrations, then restart the backend so the permission catalog re-syncs the `announcement` resource.

## Tests

Backend suite green; typecheck clean on both apps. Verified end-to-end against a local stack: create → list → update → delete, and the unread count going `0 → 2 → 0` across two users with reader avatars resolving correctly.
