# Announcements (`src/announcement`)

This module manages two kinds of announcement that share one table, `public.announcement`:

- **School-wide announcements** (`course_id IS NULL`) are posted by staff to the whole school and gated by the `announcement` catalog permission. They come with read receipts (who has read each post, staff only) and an unread badge count. Each has an `audience`: `staff` (default; the staff notice board) or `everyone` (also the school's students and parents). See [Audiences](#audiences).
- **Course announcements** (`course_id` set) are posted to one course's stream and gated by the caller's course role, not by a school-wide grant. A TA can post to their own course. Posting one sends a notice to the course's students.

## What it provides

### HTTP routes

**`AnnouncementController`** (`/api/announcements`) is guarded by `AuthGuard`, `FeatureGuard` (the `announcements` feature, 403 `FEATURE_DISABLED` while off; [`src/features`](../features/README.md)) and `PermissionGuard`. It works on school-wide announcements in the caller's school, and its responses go through the `announcement.*` versioned transformers.

| Method | Path | Permission | What it does |
|--------|------|------------|--------------|
| GET | `/api/announcements` | `announcement:read` | Lists the school-wide announcements, newest first. Each comes with its `author` and live `readers`; the author is never listed as a reader. The content is cached, and the readers are merged in fresh on every call. |
| GET | `/api/announcements/unread-count` | `announcement:read` | Returns `{ count }`: school-wide announcements posted by others that the caller has not read. |
| POST | `/api/announcements/mark-read` | `announcement:read` | Records a read receipt for every school-wide announcement, then returns `{ count: 0 }`. |
| GET | `/api/announcements/:id` | `announcement:read` | One school-wide announcement with its readers, or 404. |
| POST | `/api/announcements` | `announcement:create` | Creates a school-wide announcement (`CreateSchoolAnnouncementDto`: `title`, `body`, optional `audience` `staff` \| `everyone`, default `staff`). An `everyone` post pushes to the school's students. |
| PATCH | `/api/announcements/:id` | `announcement:update` | Edits one (`UpdateSchoolAnnouncementDto`, `audience` included; the change is audited). Only its author or a school admin (`user_profile.role === 'admin'`) may do this; anyone else gets a 403. Widening `staff` → `everyone` pushes to students. |
| DELETE | `/api/announcements/:id` | `announcement:delete` | Deletes one, with the same author-or-admin rule. A post that is already gone still counts as success. |

**`CourseAnnouncementController`** (`/api/courses/:courseId/announcements`) is guarded by `AuthGuard` and `FeatureGuard` (`announcements`, resolved through the course's school). The portal's `GET /api/portal/me/courses/:courseId/announcements` needs `announcements` too. Access is checked with `CourseAccessService.require()`. Both ids must be UUIDs (`ParseUUIDPipe`). Its responses are not versioned.

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
- `findEveryoneForSchool(schoolId)` is the student/parent view of a school's announcements: `course_id IS NULL AND audience = 'everyone'` only, no read receipts, no author id, no audience. The caller resolves the school from the student (StudentGuard) or the parent's linked child (ParentGuard), never from the request.

### Other

- `transformer.ts`: the v1 transformers, which pass data through unchanged. They are registered in `src/versioning/transformer-registry.ts` as `announcement.list`, `detail`, `created`, `updated`, `deleted`, `unreadCount` and `markRead`. The file also defines the `Announcement`, `AnnouncementAuthor` and `UnreadCount` interfaces.
- Cache key `announcements:content:v2:<schoolId>` (v2: rows carry `audience`), with a 30-day TTL. It holds only the school-wide content. Create, update and delete remove it. Course announcements are not cached.

## Used by

- `src/app.module.ts` imports `AnnouncementModule`.
- `src/student-portal/student-portal.module.ts` imports it. `student-portal.service.ts` calls `AnnouncementService.findForStudent()` for `GET /api/portal/me/courses/:courseId/announcements` and `findEveryoneForSchool()` for `GET /api/portal/me/announcements`.
- `src/parent-portal` calls `findForStudent()` and `findEveryoneForSchool()` for `GET /api/parent/children/:studentId/announcements`; its notice sweep reads `everyone` posts directly.
- `src/versioning/transformer-registry.ts` registers the transformers.
- Frontend:
  - `app/dashboard/announcements/page.tsx` and `_components/AnnouncementForm.tsx` (the school-wide routes);
  - `lib/announcements.ts` (`unread-count`, `mark-read`);
  - `app/dashboard/courses/[courseId]/announcements/page.tsx` and `app/dashboard/courses/[courseId]/page.tsx` (the course routes).
- Mobile:
  - `app/announcements/index.tsx` and `src/features/announcements/AnnouncementForm.tsx` (both kinds);
  - `src/features/course/StaffSections.tsx` (the course list).
- Scripts: `backend/scripts/seed-demo.ts` and `smoke.ts` post course announcements.

## Audiences

| `audience` | Staff board | Students | Parents | Notifications |
|---|---|---|---|---|
| `staff` (default; all rows from before `20261114100000_announcement_audience`) | yes | never | never | staff unread badge only |
| `everyone` | yes | `GET /api/portal/me/announcements`, own school only | `GET /api/parent/children/:studentId/announcements`, the child's school only, with `parent_portal`, `announcements` and `showAnnouncements` | students: push via `CourseNotificationService.schoolAnnouncementPosted` (`push_notifications`); parents: the parent-notice sweep's `announcement` kind (`parent_notifications` + opt-in) |

- Course posts keep the column default and are not affected; the course routes reject an `audience` field (400).
- Read receipts and the unread count stay staff-only: students and parents never call `mark-read` and no receipt rows are written for them.
- There are no drafts or scheduled posts; a row is visible to its audience from creation. Narrowing back to `staff` hides it from students and parents at once (pushes already sent stay sent).
- To add an audience later (e.g. `students`, `parents`): `ALTER TYPE public.announcement_audience ADD VALUE`, extend `ANNOUNCEMENT_AUDIENCES` in `dto/school-announcement.dto.ts`, and change the `audience` filters in `findEveryoneForSchool` and the parent sweep.

## Depends on

- `PrismaService` and `CacheService` (both global).
- `CourseAccessService`, `STAFF_ROLES` and `MANAGE_ROLES` from `src/course/access` (global).
- `CourseNotificationService` from `src/course-notification` (global, injected as `@Optional()`).
- `AuthGuard`, `PermissionGuard` and `@RequirePermission`.
- `VersioningService`.
- `isoDate` and `isNotFound` from `src/common/db-values`.

## Data

All in [`prisma/schema/school.prisma`](../../prisma/schema/school.prisma):

- `public.announcement`: read and written. `audience` (`public.announcement_audience`, `staff` | `everyone`, default `staff`) from migration `20261114100000_announcement_audience`, with the partial index `idx_announcement_school_audience_created` on `(school_id, audience, created_at desc) WHERE course_id IS NULL`.
- `public.announcement_read`: read (receipts, unread count) and written (`markRead`, with `createMany` and `skipDuplicates`).
- `public.user_profile`: read for the caller's school and role, and for author and reader details.

## Configuration

None.

## Files

| File | Purpose |
|------|---------|
| `announcement.module.ts` | Registers both controllers and the service, and exports the service. |
| `announcement.controller.ts` | School-wide routes (`/api/announcements`). |
| `dto/school-announcement.dto.ts` | `CreateSchoolAnnouncementDto` / `UpdateSchoolAnnouncementDto` (`audience`) and `ANNOUNCEMENT_AUDIENCES`. |
| `course-announcement.controller.ts` | Course routes (`/api/courses/:courseId/announcements`). |
| `announcement.service.ts` | All the logic: school scoping, author and course-role checks, read receipts, caching. |
| `transformer.ts` | Versioned response transformers and types. |
| `dto/` | Request bodies. See [dto/README.md](./dto/README.md). |
| `announcement.service.test.ts` | Tests for the course-announcement permission rules, auditing and audiences. |

## Tests

```bash
cd backend && bun test src/announcement
```

`announcement.service.test.ts` covers the course-announcement rules:

- a course teacher can edit and delete a TA's post;
- a TA can edit their own post but not another TA's;
- a post from another course gives a 404;
- a user with no course role gets a 404;
- the migration defaults existing rows to `staff`;
- `findEveryoneForSchool` returns only that school's `everyone` posts (staff-only, course and other-school rows never), without receipts or audience;
- create defaults to `staff` and notifies nobody; an `everyone` post notifies once; widening is audited and notifies, title edits and narrowing do not;
- the DTOs accept only `staff` / `everyone`, and course posts take no audience.

## See also

- [docs/content/backend/announcement.md](../../../docs/content/backend/announcement.md)
- `src/course-notification/` (the notices sent when a course announcement is posted)
- `src/student-portal/` (the student view)
