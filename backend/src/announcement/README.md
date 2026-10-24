# Announcements (`src/announcement`)

This module manages two kinds of announcement that share one table, `public.announcement`:

- **School-wide announcements** (`course_id IS NULL`) are posted by staff to the whole school and gated by the `announcement` catalog permission. They come with read receipts (who has read each post) and an unread badge count.
- **Course announcements** (`course_id` set) are posted to one course's stream and gated by the caller's course role, not by a school-wide grant. A TA can post to their own course. Posting one sends a notice to the course's students.

## What it provides

### HTTP routes

**`AnnouncementController`** (`/api/announcements`) is guarded by `AuthGuard` and `PermissionGuard`. It works on school-wide announcements in the caller's school, and its responses go through the `announcement.*` versioned transformers.

| Method | Path | Permission | What it does |
|--------|------|------------|--------------|
| GET | `/api/announcements` | `announcement:read` | Lists the school-wide announcements, newest first. Each comes with its `author` and live `readers`; the author is never listed as a reader. The content is cached, and the readers are merged in fresh on every call. |
| GET | `/api/announcements/unread-count` | `announcement:read` | Returns `{ count }`: school-wide announcements posted by others that the caller has not read. |
| POST | `/api/announcements/mark-read` | `announcement:read` | Records a read receipt for every school-wide announcement, then returns `{ count: 0 }`. |
| GET | `/api/announcements/:id` | `announcement:read` | One school-wide announcement with its readers, or 404. |
| POST | `/api/announcements` | `announcement:create` | Creates a school-wide announcement (`CreateAnnouncementDto`). |
| PATCH | `/api/announcements/:id` | `announcement:update` | Edits one. Only its author or a school admin (`user_profile.role === 'admin'`) may do this; anyone else gets a 403. |
| DELETE | `/api/announcements/:id` | `announcement:delete` | Deletes one, with the same author-or-admin rule. A post that is already gone still counts as success. |

**`CourseAnnouncementController`** (`/api/courses/:courseId/announcements`) is guarded by `AuthGuard` only. Access is checked with `CourseAccessService.require()`. Both ids must be UUIDs (`ParseUUIDPipe`). Its responses are not versioned.

| Method | Path | Who may call | What it does |
|--------|------|--------------|--------------|
| GET | `/api/courses/:courseId/announcements` | Course staff (`admin`, `teacher`, `ta`) | The course's announcements, newest first, with their readers. |
| POST | `/api/courses/:courseId/announcements` | Course staff | Posts to the course. It also calls `CourseNotificationService.announcementPosted()` without waiting for it. |
| PATCH | `/api/courses/:courseId/announcements/:id` | Course staff; must be the author or a course `admin`/`teacher` | Edits a course announcement. |
| DELETE | `/api/courses/:courseId/announcements/:id` | Same rule as PATCH | Deletes a course announcement. |

### Services / exports

**`AnnouncementService`** is exported. Its methods:

- School-wide: `findAll`, `findOne`, `create`, `update`, `delete`, `getUnreadCount`, `markRead`.
- Course: `findForCourse`, `createForCourse`, `updateForCourse`, `deleteForCourse`.
- `findForStudent(courseId)` is the student view of a course's announcements. It leaves out the read receipts and the internal author id. The caller must already have checked that the student is enrolled.

### Other

- `transformer.ts`: the v1 transformers, which pass data through unchanged. They are registered in `src/versioning/transformer-registry.ts` as `announcement.list`, `detail`, `created`, `updated`, `deleted`, `unreadCount` and `markRead`. The file also defines the `Announcement`, `AnnouncementAuthor` and `UnreadCount` interfaces.
- Cache key `announcements:content:<schoolId>`, with a 30-day TTL. It holds only the school-wide content. Create, update and delete remove it. Course announcements are not cached.

## Used by

- `src/app.module.ts` imports `AnnouncementModule`.
- `src/student-portal/student-portal.module.ts` imports it. `student-portal.service.ts` calls `AnnouncementService.findForStudent()` for `GET /api/portal/me/courses/:courseId/announcements`.
- `src/versioning/transformer-registry.ts` registers the transformers.
- Frontend:
  - `app/dashboard/announcements/page.tsx` and `_components/AnnouncementForm.tsx` (the school-wide routes);
  - `lib/announcements.ts` (`unread-count`, `mark-read`);
  - `app/dashboard/courses/[courseId]/announcements/page.tsx` and `app/dashboard/courses/[courseId]/page.tsx` (the course routes).
- Mobile:
  - `app/announcements/index.tsx` and `src/features/announcements/AnnouncementForm.tsx` (both kinds);
  - `src/features/course/StaffSections.tsx` (the course list).
- Scripts: `backend/scripts/seed-demo.ts` and `smoke.ts` post course announcements.

## Depends on

- `PrismaService` and `CacheService` (both global).
- `CourseAccessService`, `STAFF_ROLES` and `MANAGE_ROLES` from `src/course/access` (global).
- `CourseNotificationService` from `src/course-notification` (global, injected as `@Optional()`).
- `AuthGuard`, `PermissionGuard` and `@RequirePermission`.
- `VersioningService`.
- `isoDate` and `isNotFound` from `src/common/db-values`.

## Data

All in [`prisma/schema/school.prisma`](../../prisma/schema/school.prisma):

- `public.announcement`: read and written.
- `public.announcement_read`: read (receipts, unread count) and written (`markRead`, with `createMany` and `skipDuplicates`).
- `public.user_profile`: read for the caller's school and role, and for author and reader details.

## Configuration

None.

## Files

| File | Purpose |
|------|---------|
| `announcement.module.ts` | Registers both controllers and the service, and exports the service. |
| `announcement.controller.ts` | School-wide routes (`/api/announcements`). |
| `course-announcement.controller.ts` | Course routes (`/api/courses/:courseId/announcements`). |
| `announcement.service.ts` | All the logic: school scoping, author and course-role checks, read receipts, caching. |
| `transformer.ts` | Versioned response transformers and types. |
| `dto/` | Request bodies. See [dto/README.md](./dto/README.md). |
| `announcement.service.test.ts` | Tests for the permission rules on course announcements. |

## Tests

```bash
cd backend && bun test src/announcement
```

`announcement.service.test.ts` covers the course-announcement rules:

- a course teacher can edit and delete a TA's post;
- a TA can edit their own post but not another TA's;
- a post from another course gives a 404;
- a user with no course role gets a 404.

## See also

- [docs/content/backend/announcement.md](../../../docs/content/backend/announcement.md)
- `src/course-notification/` (the notices sent when a course announcement is posted)
- `src/student-portal/` (the student view)
