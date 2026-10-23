---
sidebar_label: Calendar and course notifications
---

# Calendar and Course Notifications

**Location**: `backend/src/calendar/`, `backend/src/course-notification/`

Two small read-mostly modules around course work: a due-date calendar for staff and students, and notices that tell students when new work or an announcement is posted.

## Files

| File | Purpose |
|------|---------|
| `calendar/calendar.module.ts` | Module; provides `StudentGuard` for the portal route |
| `calendar/calendar.controller.ts` | `CalendarController` (staff) and `PortalCalendarController` (student) |
| `calendar/calendar.service.ts` | Range checks, staff and student queries, `toIcs` |
| `calendar/dto/calendar-range.query.dto.ts` | `from`, `to` (ISO) |
| `course-notification/course-notification.module.ts` | Global module; imports `NotificationsModule` for `PushService` |
| `course-notification/course-notification.controller.ts` | `/portal/me/notifications` routes |
| `course-notification/course-notification.service.ts` | Writing notices and pushing; the recipient's list, count, mark read |

## Calendar

| Method | Route | Who | Returns |
|--------|-------|-----|---------|
| GET | `/calendar?from&to` | Any signed-in staff | `CalendarItem[]` across courses the caller is `course_staff` in (current school, not archived); drafts, published and closed |
| GET | `/calendar/ics?from&to` | Same | `text/calendar` download |
| GET | `/portal/me/calendar?from&to` | Student (`StudentGuard`) | `StudentCalendarItem[]` across published courses with an active or completed enrolment; published and closed work only |
| GET | `/portal/me/calendar/ics?from&to` | Same | `text/calendar` download |

`from` is inclusive and `to` exclusive. Without `from` the window starts at today (UTC midnight); without `to` it runs six weeks. A backwards window or one longer than 400 days is a 400. Undated work is left out.

```ts
interface CalendarItem {
  activityId: string; courseId: string; courseName: string; courseCode: string | null;
  title: string; kind: 'quiz' | 'assignment' | 'offline';
  status: 'draft' | 'published' | 'closed'; points: number; dueAt: string;
}
interface StudentCalendarItem extends CalendarItem {
  // Score only once graded, as on the to-do list.
  submission: { status: 'draft' | 'submitted' | 'graded'; score: number | null;
                excused: boolean; submittedAt: string | null } | null;
}
```

The .ics export has one zero-length event per item at its due time, with a stable `UID` (`activity-<id>@gradebook`), so importing again updates rather than duplicates. It is a download, not a subscription feed: calendar apps cannot send the session cookie or bearer token.

## Course notifications

### Data model (`course` schema)

`course.course_notification` - one row per recipient (migration `20261023120000_notifications_calendar`):

| Column | Notes |
|--------|-------|
| `user_profile_id` | Recipient account (cascade) |
| `course_id` | Cascade |
| `kind` | `activity_published` or `announcement` (check constraint) |
| `activity_id` / `announcement_id` | What it is about (cascade; deleting the work removes its notices) |
| `title`, `body` | Shown as-is in the bell and the app |
| `read_at`, `created_at` | |

Unique `(user_profile_id, activity_id)` and `(user_profile_id, announcement_id)`, so a student is told about a piece of work once. The older `file_manager.notification` table is specific to file shares (it carries `file_id`, `share_id`, `can_download`) and is not reused.

### When notices are sent

- `ActivityService.publish` - after the status update, including reopening closed work.
- `AnnouncementService.createForCourse` - after the insert.

Both call `CourseNotificationService` without awaiting it (`void this.notices?.…`), so the request never waits on the database writes or Expo. The service never throws; failures are logged. It is injected `@Optional()` so unit tests can construct those services without it.

Only a **published** course notifies. Recipients are its `active` enrolments whose student record is active and linked to an account. For work that was published before, students who already have a notice are skipped, and only newly written rows get a push.

### Push

Sent through `PushService.sendToUsers` on the Android channel `coursework` (the mobile app creates it at registration). The push title is `<course>: <title>`; `data` is

| `type` | Other fields | Mobile opens |
|--------|--------------|--------------|
| `course.activity_published` | `courseId`, `activityId` | `/work/<activityId>` |
| `course.announcement` | `courseId`, `announcementId` | `/grades/<courseId>` (the app's course screen) |

### Student routes

All under `AuthGuard` + `StudentGuard`, scoped to the signed-in account:

| Method | Route | Body / query | Returns |
|--------|-------|--------------|---------|
| GET | `/portal/me/notifications` | `limit` (1-100, default 30), `before` (ISO), `unread` (bool) | Newest first: `{ id, kind, courseId, courseName, activityId, announcementId, title, body, readAt, createdAt }[]` |
| GET | `/portal/me/notifications/unread-count` | | `{ count }` |
| POST | `/portal/me/notifications/read` | `{ ids: uuid[] }` (max 200) | 204; ids that are not the caller's are ignored |
| POST | `/portal/me/notifications/read-all` | | 204 |
