---
sidebar_label: Announcement
---

# Announcement Module

**Location**: `backend/src/announcement/`

A school-wide announcement board. Staff post notices that everyone in their school can read; the module also tracks per-user read receipts that power an unread badge and "read by" avatars on the frontend.

## Files

| File | Purpose |
|------|---------|
| `announcement.module.ts` | Module definition |
| `announcement.controller.ts` | API endpoints |
| `announcement.service.ts` | Business logic, read tracking, caching |
| `transformer.ts` | Versioned response shapes |
| `dto/create-announcement.dto.ts` | `title` (required), `body` (optional) |
| `dto/update-announcement.dto.ts` | Partial update |

## Data model (`public` schema)

| Table | Columns |
|-------|---------|
| `announcement` | `id`, `school_id`, `author_user_profile_id`, `title`, `body`, `created_at`, `updated_at` |
| `announcement_read` | `(announcement_id, user_profile_id)` PK, `read_at` |

RLS: everyone in the school reads announcements; members may insert; author-or-admin may update/delete. Read receipts are visible to the school and writable only for oneself. The backend uses the service client and enforces authorization in code (RLS is the secondary defense).

## Permissions

`announcement` is a resource in the [permission catalog](./auth.md) with `create / read / update / delete`. Defaults: admins all, teachers full control, members read-only. The catalog syncs to `public.permission_catalog` on boot, so the resource shows up in the role editor automatically.

## Endpoints

All under `AuthGuard + PermissionGuard`. `:id` mutations additionally require the caller to be the **author or a school admin** (enforced in the service, not by the permission alone).

| Method | Route | Permission | Notes |
|--------|-------|------------|-------|
| GET | `/announcements` | `announcement:read` | School feed, newest first, with `readers[]` merged in |
| GET | `/announcements/unread-count` | `announcement:read` | `{ count }` of others' posts not yet read |
| POST | `/announcements/mark-read` | `announcement:read` | Records a read receipt for every in-school announcement |
| GET | `/announcements/:id` | `announcement:read` | |
| POST | `/announcements` | `announcement:create` | Author = caller |
| PATCH | `/announcements/:id` | `announcement:update` | Author/admin only |
| DELETE | `/announcements/:id` | `announcement:delete` | Author/admin only |

## Read tracking

A read is recorded when a user opens the board (`mark-read` bulk-upserts a receipt per announcement) - a board-level "seen", not per-message. `getUnreadCount` returns announcements posted **by others** that the caller hasn't read. The author is never counted as unread on, nor shown as a reader of, their own post.

## Caching

Announcement **content** (title/body/author) is cached per school under `announcements:content:<schoolId>` (30-day TTL) and invalidated only on create/update/delete. **Read receipts** are fetched live on each list and merged into the cached content, so "read by" stays accurate without invalidating the content cache every time someone reads.
