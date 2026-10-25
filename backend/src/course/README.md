# Courses (`src/course`)

The course module is the core of the learning side of GradeBook. A course belongs to a school (optionally to an academic year and term, with an optional grade scale), has a status (`draft`, `published`, `archived`), a staff list (teachers and TAs), an enrolled student roster, and content: **modules** that hold ordered **module items**, and Markdown **pages**. A module item either carries its own content (an external link or a section header) or points at something else in the course (a page, an activity, a file or a discussion topic). The module also handles student join codes, course **templates**, **copying** a course's design into a new course or **importing** it into an existing one (with due-date shifting), and serving **files** the course offers to its staff.

Access inside a course is decided by the caller's course role, worked out by `CourseAccessService` in the [`access/`](access/README.md) sub-folder, not by school-wide permissions. Only listing templates, creating a course and copying into a new course are gated by the `course:create` permission.

## Course roles in one paragraph

`admin` is anyone holding `course:update` in the course's school (the school admin by default) and may do everything in every course. `teacher` and `ta` come from `course.course_staff`. `MANAGE_ROLES` (admin, teacher) change structure, settings, content and roster; `STAFF_ROLES` (admin, teacher, ta) read everything. Someone with no role gets `404 Course not found` (ids from another course or school reveal nothing); a role that is not enough (a TA trying to edit) gets `403`.

## What it provides

### HTTP routes

All routes use `AuthGuard`. `CourseController` and `CourseCopyController` also use `PermissionGuard`, but only the routes marked with a permission below carry `@RequirePermission`.

**Courses** (`CourseController`, `course.controller.ts`)

| Method | Path | Who | What it does |
|--------|------|-----|--------------|
| GET | `/api/courses?status&termId&academicYearId` | Signed-in staff | The caller's courses in their school, sorted by name, each with `role` and active `studentCount`. Holders of `course:update` see every course as `admin`; others see the courses they teach or assist. |
| POST | `/api/courses` | `course:create` | Create a course; the creator becomes its teacher in the same transaction. Year, term and grade scale must belong to the school, and a term must be in the chosen year (a term alone implies its year). |
| GET | `/api/courses/:courseId` | Staff role | One course with `role` and `studentCount`. |
| PATCH | `/api/courses/:courseId` | Manage role | Update name, code, description, status, year, term, grade scale, `isTemplate`. Turning a course into a template is refused while it has non-dropped students and clears its join code. |
| DELETE | `/api/courses/:courseId` | Manage role | Delete (`204`). A course that is not archived and has any submissions must be archived first (`409`). The delete and a `course` entry in the [erasure log](../erasure/README.md) commit together (students' work and attendance cascade with the course). |
| POST | `/api/courses/:courseId/join-code` | Manage role | Issue a new 6-character join code (alphabet without 0/O/1/I/L; retried on a clash, unique across schools). Refused for templates. |
| DELETE | `/api/courses/:courseId/join-code` | Manage role | Turn the join code off (`204`). |

**People** (`CourseController`)

| Method | Path | Who | What it does |
|--------|------|-----|--------------|
| GET | `/api/courses/:courseId/people` | Staff role | `{ staff, students }`: staff with role, name, email, avatar (teachers first); students with status, `enrolledAt`, name and `hasAccount`, sorted by last name. |
| POST | `/api/courses/:courseId/staff` | Manage role | Add or re-role a staff member (`204`). They must have a `school_management` row in the course's school and not be a student account. |
| PATCH | `/api/courses/:courseId/staff/:userProfileId` | Manage role | Change role to `teacher` or `ta` (`204`). Demoting the last teacher is a `409`. |
| DELETE | `/api/courses/:courseId/staff/:userProfileId` | Manage role | Remove from the course (`204`). Removing the last teacher is a `409`. |
| POST | `/api/courses/:courseId/students` | Manage role | Enrol students from the school roster as `active` (duplicates removed, dropped enrolments revived). Returns `{ enrolled }`. Refused for templates; any id not in the school is a `404`. |
| DELETE | `/api/courses/:courseId/students/:studentId` | Manage role | Remove a student (`204`). A student with submissions in the course is set to `dropped` so their marks survive; otherwise the enrolment is deleted. |

**Modules and items** (`ModuleController`, `module.controller.ts`). The static `reorder` routes are declared before the `:moduleId` / `:itemId` routes.

| Method | Path | Who | What it does |
|--------|------|-----|--------------|
| GET | `/api/courses/:courseId/modules` | Staff role | Every module and item, drafts included, ordered by position. Each item has a resolved `title` (its own override, else its target's title or file name, else "Untitled") and, for activities, `activity: { kind, points, dueAt, status }`. |
| POST | `/api/courses/:courseId/modules` | Manage role | Create a module at the end. |
| PATCH | `/api/courses/:courseId/modules/reorder` | Manage role | `moduleIds` must list every module of the course exactly once, in the new order; anything else is a `400` asking the user to refresh. |
| PATCH | `/api/courses/:courseId/modules/:moduleId` | Manage role | Rename or publish/unpublish. |
| DELETE | `/api/courses/:courseId/modules/:moduleId` | Manage role | Delete the module and its items (`204`); linked pages and activities stay. |
| POST | `/api/courses/:courseId/modules/:moduleId/items` | Manage role | Add an item at the end of the module. Only the pointer matching `itemType` is stored, and it is checked: a page, activity or discussion topic must be in this course; a file must be the caller's own, in the course's school and not deleted; a link needs a URL and title; a header needs a title. |
| PATCH | `/api/courses/:courseId/modules/:moduleId/items/reorder` | Manage role | `itemIds` must list every item in the module exactly once. |
| PATCH | `/api/courses/:courseId/modules/:moduleId/items/:itemId` | Manage role | Change title override (null clears it; links and headers must keep one), indent (0-3), published flag, or move to another module of the course (appended last). |
| DELETE | `/api/courses/:courseId/modules/:moduleId/items/:itemId` | Manage role | Remove the item only (`204`). |

**Pages** (`PageController`, `page.controller.ts`)

| Method | Path | Who | What it does |
|--------|------|-----|--------------|
| GET | `/api/courses/:courseId/pages` | Staff role | Page summaries (no bodies), sorted by title. |
| POST | `/api/courses/:courseId/pages` | Manage role | Create a page (default: empty body, unpublished). |
| GET | `/api/courses/:courseId/pages/:pageId` | Staff role | The full page with Markdown body. |
| PATCH | `/api/courses/:courseId/pages/:pageId` | Manage role | Update title, body, published flag. |
| DELETE | `/api/courses/:courseId/pages/:pageId` | Manage role | Delete (`204`); module items that link it are removed by the foreign-key cascade. |

**Copy, import and templates** (`CourseCopyController`, `course-copy.controller.ts`)

| Method | Path | Who | What it does |
|--------|------|-----|--------------|
| GET | `/api/courses/templates` | `course:create` | The school's template courses with `moduleCount`, `activityCount`, `pageCount`. |
| POST | `/api/courses/:courseId/copy` | `course:create`, and a manage role on the source or the source is a template in the caller's school | Copy the source's design into a new **draft** course the caller teaches. Returns the course plus `copied` counts. |
| POST | `/api/courses/:courseId/import` | Manage role on the target, and the same source rule | Append another course's content (`sourceCourseId`) to this course. Returns `{ copied }`. A course cannot import from itself. |

What a copy carries, all inside one transaction (60 s timeout) with new ids: assignment groups, rubrics (criteria and ratings), activities with quiz questions and options (always as **drafts**, due dates shifted or cleared), pages, modules, module items, staff-written discussion topics (unpublished, no replies), and the discussion setting (copy only). It leaves behind students, submissions, marks, attendance, announcements, replies and student-started topics. Every internal pointer is repointed at the copy, and UUIDs of copied rows inside page bodies, activity instructions and topic bodies are rewritten (`relinkIds`) so links stay inside the copy. File items keep pointing at the same file. On import, assignment groups with the same name (case-insensitive) are merged and modules and groups are placed after the target's own. Dates: at most one of `shiftDays`, the gap between `sourceStartDate` and `targetStartDate` (whole days, so times of day are kept), or `clearDueDates`; none keeps dates unchanged.

**Course files** (`CourseFileController`, `course-file.controller.ts`)

| Method | Path | Who | What it does |
|--------|------|-----|--------------|
| GET | `/api/courses/:courseId/files/:fileId` | Staff role | Stream a file the course offers: linked by one of its module items (drafts included), shared with the course (`file_share` with `principal_type = 'course'`), or owned by the caller. Anything else is `404`. Sent inline with `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`. This lets a TA open a colleague's file that the file manager itself would not let them open. |

All `:courseId`, `:moduleId`, `:itemId`, `:pageId`, `:fileId`, `:userProfileId` and `:studentId` params go through `ParseUUIDPipe`.

### Services / exports

`CourseModule` exports `CourseService`, `ModuleService` and `PageService` (the student portal uses them).

- `CourseService` - `list`, `get`, `create`, `update`, `remove`, `regenerateJoinCode`, `disableJoinCode`, `joinByCode(studentId, schoolId, code)` (a student self-enrols: published, non-template course in their school; code upper-cased; a dropped student is reactivated), `people`, `addStaff`, `updateStaff`, `removeStaff`, `enrollStudents`, `removeStudent`, plus `validateLinks(schoolId, links)` and `toCourse(row)` which `CourseCopyService` reuses.
- `ModuleService` - `list` (staff), `listForStudent(courseId)` (published modules and items only, hiding items whose page is unpublished, activity is a draft, file is deleted or topic is unpublished; the caller must already have checked enrolment), `create`, `update`, `remove`, `reorder`, `createItem`, `updateItem`, `removeItem`, `reorderItems`.
- `PageService` - `list`, `get`, `getPublished(courseId, pageId)` (for students; an unpublished page is `404`), `create`, `update`, `remove`.
- `CourseCopyService` (not exported) - `listTemplates`, `copy`, `importInto`, `copyContent(tx, sourceId, targetId, userId, shift)`, `shiftOf(dates)`. Also exports the pure helpers `shiftDate` and `relinkIds`, and the `CopyDates` / `CopyCounts` types.
- `CourseFileService` (not exported) - `read(userId, courseId, fileId)`.

### Other

- Course access lives in the global `CourseAccessModule`; see [access/README.md](access/README.md).
- `dto/content.dto.ts` exports `MODULE_ITEM_TYPES` / `ModuleItemType` (`page`, `activity`, `file`, `link`, `header`, `discussion`); `dto/course.dto.ts` exports `COURSE_STATUSES` / `CourseStatus` and `JoinCourseDto` (used by the student portal). See [dto/README.md](dto/README.md).

## Used by

Backend:

- `src/app.module.ts` imports `CourseAccessModule` and `CourseModule`.
- `src/student-portal/student-portal.module.ts` imports `CourseModule`; `student-portal.service.ts` calls `CourseService.joinByCode`, `ModuleService.listForStudent` and `PageService.getPublished`; `student-portal.controller.ts` uses `JoinCourseDto`.
- `CourseAccessService` is used by grading (`activity`, `assignment-group`, `rubric`, `submission`, `gradebook`, `gradebook-import` services), `attendance/attendance.service.ts`, `announcement/announcement.service.ts`, `discussion/discussion.service.ts` and `student-portal/student-portal.service.ts`.

Web (`frontend/`):

- Course list, create, copy and import: `app/dashboard/courses/page.tsx`, `_components/CreateCourseDialog.tsx` (also lists `/courses/templates`), `_components/CopyCourseDialog.tsx`, `_components/ImportContentDialog.tsx` (lists courses and templates, then imports); settings in `app/dashboard/courses/[courseId]/settings/page.tsx`; course shell in `app/dashboard/courses/[courseId]/layout.tsx` and `page.tsx`.
- People: `app/dashboard/courses/[courseId]/people/page.tsx` with `_components/AddStaffDialog.tsx`, `AddStudentsDialog.tsx`, `JoinCodeCard.tsx`.
- Modules: `app/dashboard/courses/[courseId]/modules/page.tsx` and `_components/AddItemDialog.tsx`, `ModuleItemRow.tsx`.
- Pages: `app/dashboard/courses/[courseId]/pages/page.tsx` and `pages/[pageId]/page.tsx`.
- Files: `lib/files/content.ts` opens `/courses/:courseId/files/:fileId`. `app/dashboard/files/_components/ShareDialog.tsx` lists courses (`GET /courses`) to share with.
- Types: `lib/courses/types.ts`.

Mobile (`mobile/`):

- `app/teaching/index.tsx`, `app/teaching/[courseId]/index.tsx`, `src/features/dashboard/TeacherDashboard.tsx` (course lists and detail; the dashboard calls `GET /courses`), `src/features/course/StaffSections.tsx` (modules, people), `src/lib/course.ts`, `app/teaching/[courseId]/page/[pageId].tsx` and `src/features/course/PageScreen.tsx` (pages), `src/features/course/useOpenModuleItem.ts` (course files), `src/features/files/ShareSheet.tsx`.

Scripts: `backend/scripts/seed-demo.ts` builds demo courses, staff, students, join codes, modules, items and pages through these routes; `backend/scripts/smoke.ts` exercises courses, people, join codes, modules and items, templates, copy, import and course files.

## Depends on

- `PrismaService`, `CacheService` (global).
- `CourseAccessService` (global, `access/`).
- `loadEffectivePermissions` from `src/permission/permission.effective.ts` (course listing and template copy rules); `PermissionGuard` / `@RequirePermission` from `src/permission/`.
- `FileManagerModule` (imported) for `FileManagerService.readContentForAuthorisedCaller`.
- `userSchoolId`, `isoDate`, `isUniqueViolation` from `src/common/`.

## Data

`prisma/schema/course.prisma` (Postgres schema `course`): `course.course`, `course.course_staff`, `course.course_student`, `course.module`, `course.module_item`, `course.page` - read/write.

Also:

- `prisma/schema/grading.prisma`: `grading.activity`, `grading.submission` (read for checks), and on copy/import `grading.assignment_group`, `grading.rubric`, `grading.rubric_criterion`, `grading.rubric_rating`, `grading.quiz_question`, `grading.quiz_option` (read/write); `grading.grade_scale` (read, validation).
- `prisma/schema/discussion.prisma`: `course.discussion_topic` (read; written by copy/import), `course.discussion_setting` (copied).
- `prisma/schema/files.prisma`: `file_manager.file`, `file_manager.file_share` (read).
- `prisma/schema/school.prisma`: `public.academic_year`, `public.term`, `public.school_management`, `public.user_profile` (read).
- `prisma/schema/student.prisma`: `student.student` (read).

## Configuration

None.

## Files

| File | Purpose |
|------|---------|
| `course.module.ts` | Module; imports `FileManagerModule`, registers five controllers and services, exports `CourseService`, `ModuleService`, `PageService`. |
| `course.controller.ts` | Courses, join codes and people. |
| `course.service.ts` | Course CRUD, link validation, join codes, self-enrolment, staff and roster. |
| `module.controller.ts` | Modules and module items. |
| `module.service.ts` | Module/item reads (staff and student views), writes, target checks, reordering. |
| `page.controller.ts` | Pages. |
| `page.service.ts` | Page CRUD and the student `getPublished`. |
| `course-copy.controller.ts` | Templates, copy, import. |
| `course-copy.service.ts` | Template listing, source checks, date shifting, the transactional content copy, `shiftDate`, `relinkIds`. |
| `course-file.controller.ts` | Streams a course file to staff. |
| `course-file.service.ts` | Decides which files a course's staff may open. |
| `access/` | `CourseAccessModule` and `CourseAccessService`. See [access/README.md](access/README.md). |
| `dto/` | Request DTOs. See [dto/README.md](dto/README.md). |
| `course.service.test.ts` | Create, list, roles, join codes, people, staff, enrolment, delete, templates. |
| `module.service.test.ts` | Staff and student listings, module writes and reorder, item target checks, moves. |
| `page.service.test.ts` | Page list, scoping, role checks, create defaults, empty updates, `getPublished`. |
| `course-copy.service.test.ts` | Copy and import behaviour, date handling, permissions, helpers. |
| `course-file.service.test.ts` | Which files course staff may open. |

## Tests

```bash
cd backend && bun test src/course
```

The tests use mocked Prisma, cache and access services. They cover: the creator becoming teacher (and a failed teacher insert failing the whole create); listing for teachers versus admins; 404 for no role, 403 for a TA changing settings, and loss of access when removed from the school; join code format, clash retry and joining by code; the people shape; staff rules (last teacher, student accounts); enrolment scoping, de-duplication and drop-versus-delete; delete requiring archive; template rules; module and item listings for staff and students (unpublished pages, draft activities, deleted files, unpublished topics hidden); positions and reorder validation; item target validation per type; page scoping and defaults; copy producing a draft course without class data, repointing references and shifting or clearing dates, permission rules for TAs, strangers and templates; import merging groups and appending modules; and course file access.

## See also

- [Course copy and templates](../../../docs/content/backend/course-copy.md)
- [File manager](../../../docs/content/backend/file-manager.md)
- [discussion README](../discussion/README.md), [course-notification README](../course-notification/README.md), [calendar README](../calendar/README.md), [dashboard README](../dashboard/README.md)
