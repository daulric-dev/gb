---
sidebar_label: Announcement
---

# Announcement Module

**Location**: `backend/src/announcement/`

A school-wide announcement board. Staff post notices for an **audience**: `staff` (the staff board, the default) or `everyone` (staff, plus the school's students in the student portal and parents in the parent portal). The module also tracks per-user (staff) read receipts that power an unread badge and "read by" avatars on the frontend.

## Files

| File | Purpose |
|------|---------|
| `announcement.module.ts` | Module definition |
| `announcement.controller.ts` | API endpoints |
| `announcement.service.ts` | Business logic, read tracking, caching |
| `transformer.ts` | Versioned response shapes |
| `dto/create-announcement.dto.ts` | `title` (required), `body` (optional) |
| `dto/update-announcement.dto.ts` | Partial update |
| `dto/school-announcement.dto.ts` | School-wide create/update: adds `audience` (`staff` \| `everyone`, optional; create defaults to `staff`) |

## Data model (`public` schema)

| Table | Columns |
|-------|---------|
| `announcement` | `id`, `school_id`, `course_id` (null = school-wide), `author_user_profile_id`, `title`, `body`, `audience` (enum `public.announcement_audience`: `staff` \| `everyone`, not null, default `staff`), `created_at`, `updated_at` |
| `announcement_read` | `(announcement_id, user_profile_id)` PK, `read_at` |

All authorization is enforced in the service: everyone in the school reads school-wide announcements, and read receipts are written only for oneself.

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

The `/announcements/:id` routes only touch school-wide notices. Course announcements have their own routes, gated by course role instead of the catalog permission:

| Method | Route | Who |
|--------|-------|-----|
| GET | `/courses/:courseId/announcements` | Course staff (admin, teacher, TA) |
| POST | `/courses/:courseId/announcements` | Course staff |
| PATCH | `/courses/:courseId/announcements/:id` | The author, or the course's teachers and admins |
| DELETE | `/courses/:courseId/announcements/:id` | The author, or the course's teachers and admins |

So a teacher can correct or remove a TA's post; a TA can change only their own. Students read them at `/portal/me/courses/:courseId/announcements`. Course routes take no `audience` (a 400 if sent).

## Audiences

| Audience | Staff (`/announcements`) | Students (`GET /portal/me/announcements`) | Parents (`GET /parent/children/:studentId/announcements`) | Notifications |
|----------|-----|-----|-----|-----|
| `staff` (default; every row from before migration `20261114100000_announcement_audience`) | yes | never | never | none (staff see the unread badge) |
| `everyone` | yes | the student's own school only | each linked child's school only, while `parent_portal` + `announcements` are on and `showAnnouncements` is set | push to the school's active students (`CourseNotificationService.schoolAnnouncementPosted`, `push_notifications` respected; no in-app bell row); parents via the parent-notice sweep's `announcement` kind (`parent_notifications` + opt-in) |

The school is always resolved server-side (StudentGuard / ParentGuard), never from the request. Changing the audience on PATCH is audited (`changes.audience`); widening `staff` → `everyone` notifies students at that moment, and the parent sweep picks up posts created in its 24-hour lookback. There are no drafts or scheduled posts: a row is visible to its audience as soon as it is created. Students and parents get no read receipts (the receipt table and unread count are staff-only). More audiences (e.g. `students`, `parents`) can be added with `ALTER TYPE public.announcement_audience ADD VALUE` plus the DTO list and the portal filters.

## Read tracking

A read is recorded when a user opens the board (`mark-read` bulk-upserts a receipt per announcement) - a board-level "seen", not per-message. `getUnreadCount` returns announcements posted **by others** that the caller hasn't read. The author is never counted as unread on, nor shown as a reader of, their own post.

## Caching

Announcement **content** (title/body/audience/author) is cached per school under `announcements:content:v2:<schoolId>` (30-day TTL) and invalidated only on create/update/delete. **Read receipts** are fetched live on each list and merged into the cached content, so "read by" stays accurate without invalidating the content cache every time someone reads.
