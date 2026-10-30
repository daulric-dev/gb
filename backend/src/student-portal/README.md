# Student portal (`src/student-portal`)

The student's own view of the system, under `/api/portal/me`: their record and school, their courses (cards with teachers and running grade), course modules, pages, files and announcements, joining a course by code, their to-do of activities, their grades, and handing in work.

The security model is **`StudentGuard`**. It resolves the caller's linked `student.student` record from their session and pins `{ studentId, schoolId }` to `req.student`. No route here accepts a student id from the client; handlers only ever use `req.student.studentId`. Students hold no catalog permissions and no course staff roles, so every staff route turns them away, and this API is the only one they can use. Course-level routes additionally go through `CourseAccessService.requireStudent()`, which answers 404 for a course the student is not actively enrolled in or that is still a draft.

## What it provides

### HTTP routes

Both controllers are `@Controller('portal/me')` with `@UseGuards(AuthGuard, StudentGuard)`. `:courseId` and `:pageId` / `:fileId` are checked with `ParseUUIDPipe`.

`StudentPortalController` (`student-portal.controller.ts`):

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/portal/me` | The student's record (`firstName`, `lastName`, `dateOfBirth`, `gender`, `enrollmentDate`) and school. |
| GET | `/api/portal/me/courses` | Course cards for every non-dropped enrolment in a published or archived, non-template course, sorted by name: teachers and the student's grade summary (a grade that fails to compute is left out, not an error). Never includes the course join code. |
| POST | `/api/portal/me/courses/join` | Body `JoinCourseDto` (`joinCode`). Enrols via `CourseService.joinByCode()` and returns the new card. Throttled by `claim-code` (10 per 15 min). |
| GET | `/api/portal/me/courses/:courseId` | One course card. |
| GET | `/api/portal/me/courses/:courseId/modules` | Published modules and items (`ModuleService.listForStudent`). |
| GET | `/api/portal/me/courses/:courseId/pages/:pageId` | A published page (`PageService.getPublished`); drafts are 404. |
| GET | `/api/portal/me/courses/:courseId/files/:fileId` | Streams a file the course offers - linked from a published item in a published module, or shared with the course. Otherwise 404. Sent with `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`. |
| GET | `/api/portal/me/courses/:courseId/announcements` | Course announcements (`AnnouncementService.findForStudent`). |

`PortalActivityController` (`portal-activity.controller.ts`), backed by `src/grading`:

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/portal/me/activities` | Published work across all the student's courses (`SubmissionService.listForStudent`). |
| GET | `/api/portal/me/courses/:courseId/activities` | One course's published and closed work with the student's state. |
| GET | `/api/portal/me/courses/:courseId/grades` | Scores by group, total and letter (`GradebookService.studentGrades`). |
| GET | `/api/portal/me/activities/:activityId` | One activity with the student's submission. |
| POST | `/api/portal/me/activities/:activityId/upload-ticket` | Body `CreateUploadTicketDto`. Starts a direct (presigned PUT) upload for an assignment. |
| POST | `/api/portal/me/activities/:activityId/upload-ticket/:fileId/complete` | Checks the uploaded bytes and attaches the file to the draft. |
| POST | `/api/portal/me/activities/:activityId/submit` | Body `SubmitAssignmentDto`. Hand in an assignment. |
| POST | `/api/portal/me/activities/:activityId/quiz` | Body `SubmitQuizDto`. Submit quiz answers; scored on submit up to the attempt limit. |

Other `/api/portal/me/...` routes live in the modules that own them: attendance (`src/attendance/portal-attendance.controller.ts`), discussions (`src/discussion/portal-discussion.controller.ts`), calendar (`/portal/me/calendar`, `src/calendar`) and notifications (`/portal/me/notifications`, `src/course-notification`). They all use `StudentGuard`.

### Services / exports

- `StudentGuard` (exported) - see below.
- `StudentPortalService` (not exported): `getMe`, `listCourses`, `getCourse`, `joinCourse`, `getModules`, `getPage`, `getCourseFile`, `getAnnouncements`.
- Types `StudentContext` (`{ studentId, schoolId }`) and `StudentRequest` (request with `user` and `student`), exported from `student.guard.ts`.

### `StudentGuard`

Runs after `AuthGuard`. It fails closed (403) when there is no `req.user`, when the profile's `account_type` is not `student`, when the profile is deactivated, when no student record is linked (the student has not joined a school yet), or when the student record is inactive. The resolved context is cached for one hour under `student-context:<userId>`; `src/student`, `src/student-account` and `src/email-domain` delete that key whenever they change what it would resolve to.

## Used by

- `src/app.module.ts` imports `StudentPortalModule`.
- `src/attendance/attendance.module.ts` and `src/discussion/discussion.module.ts` import the module for `StudentGuard`; `src/calendar/calendar.module.ts` and `src/course-notification/course-notification.module.ts` provide `StudentGuard` themselves (to avoid an import cycle).
- `src/permission/permission.service.ts` notes that students get their access from `StudentGuard`, not from permissions.
- Web: everything under `frontend/app/portal/` (home, courses and their modules, pages, announcements, grades, work, attendance, calendar), plus `frontend/lib/files/content.ts`, `frontend/lib/portal-notifications.ts` and the shared discussion components.
- Mobile: `mobile/app/(portal)/*`, `mobile/app/course/[courseId]/*`, `mobile/app/work/[activityId].tsx`, `mobile/app/grades/[courseId].tsx`, and `mobile/src/lib/{portal,course,grades,work,upload,calendar}.ts`.
- Scripts: `scripts/seed-demo.ts` (students hand in work), `scripts/smoke.ts` (portal checks), `scripts/student-flow-check.ts`.

## Depends on

- Imports `GradingModule` (`SubmissionService`, `GradebookService`), `CourseModule` (`CourseService`, `ModuleService`, `PageService`), `AnnouncementModule` (`AnnouncementService`), `FileManagerModule` (`FileManagerService.readContentForAuthorisedCaller`).
- `CourseAccessService` (global `CourseAccessModule`), `PrismaService`, `CacheService`.
- DTOs from other modules: `JoinCourseDto` (`src/course/dto/course.dto.ts`), `SubmitAssignmentDto` / `SubmitQuizDto` (`src/grading/dto/activity.dto.ts`), `CreateUploadTicketDto` (`src/file-manager/dto/upload-ticket.dto.ts`).

## Data

Read directly by this module (the services it calls read and write more):

- `public.user_profile`, `public.school` ([`school.prisma`](../../prisma/schema/school.prisma)).
- `student.student` ([`student.prisma`](../../prisma/schema/student.prisma)).
- `course.course`, `course.course_student`, `course.course_staff`, `course.module_item` ([`course.prisma`](../../prisma/schema/course.prisma)).
- `file_manager.file_share` ([`files.prisma`](../../prisma/schema/files.prisma)).

## Configuration

None.

## Files

| File | Purpose |
| --- | --- |
| `student-portal.module.ts` | Imports the feature modules; provides the service and guard; exports `StudentGuard`. |
| `student.guard.ts` | `StudentGuard`, `StudentContext`, `StudentRequest`. |
| `student-portal.controller.ts` | Record, courses, modules, pages, files, announcements, join. |
| `portal-activity.controller.ts` | Activities, grades, uploads, submissions. |
| `student-portal.service.ts` | Self-scoped reads and course cards. |
| `student.guard.test.ts` | Guard tests. |
| `student-portal.service.test.ts` | Service tests. |

## Tests

```bash
cd backend && bun test src/student-portal
```

Guard: fails closed without a user, pins the linked student, denies staff accounts, students without a linked record, deactivated accounts and inactive records, resolves from the account (never the request), serves the cached context. Service: `getMe` scoping and 404, course cards (teachers and grade, no join code, grade failure tolerated, no enrolments, drafts hidden, dropped students refused, join passes the guard-resolved ids, unpublished pages 404), and course files (module link served, course share served, anything else 404, dropped students refused).

## See also

- [docs/content/backend/student.md](../../../docs/content/backend/student.md), [docs/content/backend/grading.md](../../../docs/content/backend/grading.md)
- [src/course/README.md](../course/README.md), [src/grading/README.md](../grading/README.md), [src/student-account/README.md](../student-account/README.md)
