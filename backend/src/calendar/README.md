# Calendar (`src/calendar`)

The calendar module turns activity due dates into a calendar. Staff get every dated activity (drafts included, so they can plan) across the courses they teach or assist in their current school; students get the published and closed work in the published courses they are enrolled in, together with their own submission state. Both audiences can also download the same items as an iCalendar (`.ics`) file to import into Google Calendar, Outlook or Apple Calendar. The module only reads data; it never writes.

## What it provides

### HTTP routes

| Method | Path | Guard / who may call | What it does |
|--------|------|----------------------|--------------|
| GET | `/api/calendar?from&to` | `AuthGuard` (any signed-in user) | `CalendarItem[]` for activities due in the window in courses where the caller is a `course_staff` row, limited to their current school and to `draft`/`published` courses. Activity statuses `draft`, `published` and `closed` are included. |
| GET | `/api/calendar/ics?from&to` | `AuthGuard` | The same items as a `text/calendar` download named `gradebook.ics` (`Cache-Control: private, no-store`). |
| GET | `/api/portal/me/calendar?from&to` | `AuthGuard` + `StudentGuard` | `StudentCalendarItem[]` for published/closed activities in published courses where the student has an `active` or `completed` enrolment, each with the student's `submission` (status, score once graded, excused, submittedAt) or `null`. |
| GET | `/api/portal/me/calendar/ics?from&to` | `AuthGuard` + `StudentGuard` | The student's items as `due-dates.ics`. |

`from` is inclusive and `to` exclusive (ISO 8601 dates or timestamps). Without `from` the window starts at today's UTC midnight; without `to` it runs 42 days (six weeks, enough for a month grid). A window where `to` is not after `from`, or one longer than 400 days, is a `400 Bad Request`. Activities without a due date are never shown.

### Services / exports

The module exports nothing; `CalendarService` is used only by its own controllers.

- `CalendarService.range(from?, to?)` - resolves and validates the window.
- `CalendarService.forStaff(userId, from?, to?)` - the staff calendar (empty if the user has no school or no staffed courses).
- `CalendarService.forStudent(studentId, from?, to?)` - the student calendar with submission state; scores are rounded with `roundScore` from `@/grading/round` and only shown once graded.
- `toIcs(items, name)` (exported function in `calendar.service.ts`) - builds an RFC 5545 calendar: one zero-length `VEVENT` per item at its due time, a stable `UID` of `activity-<id>@gradebook` so re-importing updates instead of duplicating, escaped text and lines folded at 75 octets.

### Other

- Two controllers live in one file: `CalendarController` (`/calendar`) and `PortalCalendarController` (`/portal/me/calendar`).
- `StudentGuard` (from `src/student-portal/student.guard.ts`) is listed in this module's `providers` so the portal routes can use it without importing the student-portal module.

## Used by

- `src/app.module.ts` imports `CalendarModule`. No other backend module depends on it.
- Web staff calendar: `frontend/app/dashboard/calendar/page.tsx` calls `GET /calendar` and links to `/calendar/ics`.
- Web student calendar: `frontend/app/portal/calendar/page.tsx` calls `GET /portal/me/calendar` and links to `/portal/me/calendar/ics`. Types live in `frontend/lib/courses/types.ts`.
- Mobile student calendar: `mobile/app/(portal)/calendar.tsx` calls `GET /portal/me/calendar` (helpers in `mobile/src/lib/calendar.ts`).
- `backend/scripts/smoke.ts` checks the staff and student calendars, the `.ics` download and that an oversized range returns 400.

## Depends on

- `PrismaService` (global `PrismaModule`).
- `userSchoolId` from `src/common/user-school.ts`, `isoDate` from `src/common/db-values.ts`.
- `roundScore` from `src/grading/round.ts`.
- `StudentGuard` / `StudentRequest` from `src/student-portal/student.guard.ts`, `AuthGuard` from `src/auth/auth.guard.ts`.

## Data

Read only:

- `course.course_staff`, `course.course`, `course.course_student` (`prisma/schema/course.prisma`)
- `grading.activity`, `grading.submission` (`prisma/schema/grading.prisma`)
- `public.user_profile` (via `userSchoolId`, `prisma/schema/school.prisma`)

## Configuration

None.

## Files

| File | Purpose |
|------|---------|
| `calendar.module.ts` | Nest module: both controllers, `CalendarService`, `StudentGuard`. |
| `calendar.controller.ts` | `CalendarController` (staff) and `PortalCalendarController` (student), plus the `sendIcs` reply helper. |
| `calendar.service.ts` | `CalendarService`, the `CalendarItem` / `StudentCalendarItem` types and the `toIcs` iCalendar builder. |
| `dto/calendar-range.query.dto.ts` | `CalendarRangeQueryDto` (`from`, `to`). See [dto/README.md](dto/README.md). |
| `calendar.service.test.ts` | Unit tests with a mocked Prisma client. |

## Tests

```bash
cd backend && bun test src/calendar
```

The tests cover the default six-week window and rejection of backwards or oversized windows, the staff query (school filter, drafts included, empty when the user has no school or courses), the student query (published work only, submission state, a bad range failing before any query) and `.ics` output (one escaped event per item).

## See also

- [Calendar and course notifications](../../../docs/content/backend/calendar-notifications.md)
- [course-notification README](../course-notification/README.md)
- [common README](../common/README.md)
