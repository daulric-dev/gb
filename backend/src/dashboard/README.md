# Dashboard (`src/dashboard`)

The dashboard module computes the staff home screen in one call. Every staff member gets the active academic year and the courses they teach or assist (with student counts and how many submissions are waiting to be marked). Whoever can manage every course in the school (the `course:update` permission, held by the admin role by default) also gets school-wide counts of courses, students and staff, and a feed of recent course activity. Everything is computed from the course, grading and school tables on each request; it replaced an older `dashboard-summary` edge function that counted classes, which no longer exist. The module only reads.

## What it provides

### HTTP routes

| Method | Path | Guard / who may call | What it does |
|--------|------|----------------------|--------------|
| GET | `/api/dashboard/summary` | `AuthGuard`; student accounts get `403 Staff only`; a user without a school gets `400` | Returns `{ schoolId, isAdmin, activeYear, myCourses, awaitingMarking, school }`. |

Response fields:

- `activeYear` - the academic year covering today, otherwise the most recent one, as `{ id, name, startDate, endDate }`, or `null`.
- `myCourses` - `DashboardCourse[]`: courses where the caller is a `course_staff` row (role `teacher` or `ta`) in their school, archived courses left out, sorted by name, each with `studentCount` (active enrolments) and `awaitingMarking` (submissions with status `submitted`).
- `awaitingMarking` - the sum across `myCourses`.
- `isAdmin` - whether the caller's effective permissions include `course:update`.
- `school` - `SchoolOverview` for admins, else `null`: course totals by status, students total/active, staff total by `school_management.role` (`admin`, `teacher`, `member`) and `recentActivity` - the 10 latest of course created, activity published and course announcement events, newest first.

### Services / exports

Nothing is exported. `DashboardService.summary(userId)` is the only public method. The `DashboardCourse`, `RecentActivityEntry` and `SchoolOverview` interfaces describe the response.

## Used by

- `src/app.module.ts` imports `DashboardModule`.
- Web: `frontend/app/dashboard/page.tsx` loads `/dashboard/summary` (response type in `frontend/app/dashboard/_components/types.ts`).
- `backend/scripts/student-flow-check.ts` checks that a student account is denied (`403`).

## Depends on

- `PrismaService` (global) and `CacheService` (global, `src/cache/`), the latter passed to `loadEffectivePermissions` from `src/permission/permission.effective.ts` to resolve the caller's permission keys.
- `userSchoolId`, `dateOnly`, `isoDate` from `src/common/`.
- `AuthGuard` from `src/auth/`.

## Data

Read only:

- `public.user_profile`, `public.academic_year`, `public.school_management`, `public.announcement` (`prisma/schema/school.prisma`)
- `course.course`, `course.course_staff`, `course.course_student` (`prisma/schema/course.prisma`)
- `grading.activity`, `grading.submission` (`prisma/schema/grading.prisma`)
- `student.student` (`prisma/schema/student.prisma`)

## Configuration

None.

## Files

| File | Purpose |
|------|---------|
| `dashboard.module.ts` | Nest module with the controller and service. |
| `dashboard.controller.ts` | `GET /dashboard/summary`. |
| `dashboard.service.ts` | Builds the summary: active year, my courses, school overview, recent activity. |
| `dashboard.service.test.ts` | Unit tests (see Tests). |

## Tests

```bash
cd backend && bun test src/dashboard
```

`dashboard.service.test.ts` builds `DashboardService` with `createMockPrisma()` and the in-memory cache; effective permissions come from a mocked `school_management` row, and the clock is pinned with `setSystemTime`. It covers:

- Preconditions: a student account is `403 Staff only`; no school (or no profile) is `400`.
- Teacher view: `isAdmin` false, `school` null and no school-wide queries; no `course_staff` rows means the course table is never read; `myCourses` carries the staff role, active student counts and `submitted` submissions per course (submissions without a course ignored), sorted query by name and scoped to school, staff course ids and non-archived; `awaitingMarking` is the sum; a course query failure is `400 Failed to load dashboard summary`.
- Active year: `null` with no years, the year covering today (inclusive at both ends), otherwise the most recent by start date.
- Admin view: course totals by status, students total/active (`is_active: null` counts as active), staff by role, all scoped to the school; an archived course counts in the school but not in `myCourses`; a custom role granting `course:update` gets the admin view.
- Recent activity: course created, activity published and announcement entries merged newest first with course names resolved (unknown course gives `courseName: null`), undated announcements dropped, capped at 10; the activity query is skipped when the school has no courses; both feed queries take 10 newest first.

`backend/scripts/student-flow-check.ts` also covers the student denial against a running server.

## See also

- [Backend overview](../../../docs/content/backend/overview.md)
- [course README](../course/README.md)
