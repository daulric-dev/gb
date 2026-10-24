# Course access (`src/course/access`)

The one place the backend decides what a caller may do inside a course. Every course-scoped service, in this module and elsewhere, starts by calling `CourseAccessService.require` (staff) or `requireStudent` (student portal) and then works only with the course row it returns. A course the caller has no part in is reported as `404 Course not found` rather than `403`, so ids from another course or school reveal nothing.

`CourseAccessModule` is `@Global()` and exports `CourseAccessService`, so grading, attendance, announcements, discussions and the student portal can check course access without importing `CourseModule` and its controllers. It is imported once, in `src/app.module.ts`.

## Files

| File | Defines |
|------|---------|
| `course-access.module.ts` | `CourseAccessModule` (global; provides and exports `CourseAccessService`). |
| `course-access.service.ts` | `CourseAccessService`, the `CourseRole` type, `MANAGE_ROLES`, `STAFF_ROLES`, `COURSE_SELECT` (Prisma select for a course row), `COURSE_COLUMNS` (the same columns as a string), the `CourseRow` interface and `toCourseRow()` (timestamps to ISO strings). |
| `course-access.service.test.ts` | Unit tests (see Tests). |

## Roles

| Role | Who | Constant membership |
|------|-----|---------------------|
| `admin` | Anyone whose effective permissions in the course's school include `course:update` (the school admin by default) | `MANAGE_ROLES`, `STAFF_ROLES` |
| `teacher` | A `course.course_staff` row with role `teacher` | `MANAGE_ROLES`, `STAFF_ROLES` |
| `ta` | A `course.course_staff` row with role `ta`; reads everything and marks, but does not change settings, people or delete things | `STAFF_ROLES` |

A user who is no longer a member of the school gets no role even if their `course_staff` rows still exist.

## Methods

- `roleIn(userId, course)` - the caller's `CourseRole` in a course, or `null`. Uses `loadEffectivePermissions` (cached via `CacheService`) and `course_staff`.
- `require(userId, courseId, allowed = STAFF_ROLES)` - loads the course and returns `{ course, role }`; no role is `404`, a role not in `allowed` is `403 Only the course teacher can do that in this course`.
- `requireStudent(studentId, courseId, { allowArchived = true })` - for the portal: the course must be `published` (or `archived` when allowed, so past work stays readable), not a template, and the student's enrolment must exist and not be `dropped`; otherwise `404`.
- `courseIdOfActivity(activityId)` - the course of an activity, for routes keyed by activity id (`404 Activity not found` otherwise).

## Used by

- In this module: `course.service.ts`, `module.service.ts`, `page.service.ts`, `course-copy.service.ts`, `course-file.service.ts` (`COURSE_SELECT` and `toCourseRow` are also used by `course.service.ts` and `course-copy.service.ts`).
- `src/discussion/discussion.service.ts`, `src/announcement/announcement.service.ts`, `src/attendance/attendance.service.ts`, `src/student-portal/student-portal.service.ts`.
- `src/grading/`: `activity.service.ts`, `assignment-group.service.ts`, `rubric.service.ts`, `submission.service.ts`, `gradebook.service.ts`, `gradebook-import.service.ts`.

## Data

Reads `course.course`, `course.course_staff`, `course.course_student` (`prisma/schema/course.prisma`) and `grading.activity` (`prisma/schema/grading.prisma`); effective permissions come from the permission tables via `src/permission/permission.effective.ts`.

## Adding a check

Keep course access decisions here. For a new course-scoped feature, call `require(userId, courseId, MANAGE_ROLES)` for writes and `require(userId, courseId)` for reads, or `requireStudent` for portal routes, and use the returned `course` (never a course id from the request) for every later query. If a new role or rule is needed, add it to `CourseRole` / the role constants and to `roleIn`, and add tests in `course-access.service.test.ts` and the consuming services.

## Tests

```bash
cd backend && bun test src/course/access
```

`course-access.service.test.ts` builds the service with `createMockPrisma()` and the in-memory cache, with school membership arranged through `school_management.findFirst` (as `loadEffectivePermissions` reads it). It covers:

- `MANAGE_ROLES` / `STAFF_ROLES` membership and `toCourseRow` (ISO timestamps, missing `is_template` becomes `false`).
- `roleIn`: `admin` from `course:update` (school admin, or a custom role granting it), admin winning over a staff row, `teacher` / `ta` from `course_staff`, `null` without a staff row or with an unknown role value, `null` for someone removed from the school even with a staff row (also from a cached non-member result), and the compound-key and school-scoped lookups plus the permission cache entry.
- `require`: `404` for a missing course, for no role and for another school's course; `403` with the documented message when the role is not in `allowed`; a TA passes the default list; teacher and admin pass `MANAGE_ROLES`.
- `requireStudent`: active and `completed` enrolments pass; missing course, draft (without reading the enrolment), template, not enrolled and `dropped` are `404`; archived is readable by default and `404` with `allowArchived: false`. Note that passing `{}` (no `allowArchived`) also hides archived courses, because the default only applies when the options argument is omitted.
- `courseIdOfActivity`: returns the course id; `404 Activity not found` for a missing activity or one without a course.

Access rules are also exercised through `course.service.test.ts` ("course roles") and the other services' tests.

See the [course README](../README.md).
