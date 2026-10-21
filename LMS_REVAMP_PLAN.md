# GradeBook → Course-based LMS: revamp plan

Status: in progress on branch `feat/lms-courses`.

## Goal

Turn GradeBook from a class/subject report-card system into a Canvas/Moodle-style
LMS. Teachers create **courses**. A course holds modules, pages, assignments and
quizzes, announcements, people and a gradebook. Students see their courses in the
portal and do their work there.

## Decisions (agreed 2026-10-20)

| Question | Decision |
|---|---|
| Existing data | **Migrate.** Every class × subject pair with real evidence becomes a course. Enrollments, activities, submissions and grades carry over. Old tables stay (read-only, no UI) until a later cleanup migration drops them. |
| Structure | **Keep schools (tenants), academic years and terms.** A course may attach to a year and optionally a term. The fixed `michaelmas/hilary/trinity` term enum becomes free text. |
| Report cards | **Remove.** Report books, ministry reporting, class reports and the term/year calculation models go. Replaced by a per-course gradebook with weighted assignment groups and the school grade scale. |
| Mobile | **Web first.** Mobile class/subject screens are removed so the app still builds; full course UI on mobile comes later. |

## What goes, what stays, what is new

**Removed (backend modules + frontend pages):** `class`, `subject`, `enrollment`,
`calculation`, `reporting`, `report-files`, `attendance` (rebuilt per course in
phase 4), `grading/assessment`, `grading/grade`, `grading/grading-group`,
dashboard classes/subjects/reports pages, portal reports/attendance pages.

**Kept as is:** schools, membership, staff, roles/permissions engine, students and
student accounts (join codes), academic years, terms, grade scales,
announcements (gain an optional course), chat, file manager, images, realtime,
queue, cache, versioning, throttling.

**Reused and re-keyed to courses:** `grading.activity` (assignments + quizzes),
quiz questions/options/answers, `grading.submission`, the `submit_quiz` RPC,
`grading.grading_group` weighting idea (becomes `course.assignment_group`).

**New:** `course` schema and module: courses, course staff, course students,
modules + module items, pages, assignment groups, gradebook, join codes.

## Data model (new `course` schema)

```
course.course
  id, school_id → school (cascade), academic_year_id → academic_year (set null),
  term_id → term (set null), name, code, description, status course_status
  (draft | published | archived), join_code (unique, nullable),
  grade_scale_id → grading.grade_scale (set null), created_by, created_at,
  updated_at, legacy_student_group_id, legacy_subject_id (no FK; migration trace)

course.course_staff      course_id, user_profile_id, role (teacher | ta)       unique(course, user)
course.course_student    course_id, student_id, status (active | dropped | completed), enrolled_at
                         unique(course, student)
course.assignment_group  course_id, name, weight numeric(5,2) null, position   unique(course, lower(name))
course.module            course_id, title, position, is_published, created_at
course.module_item       module_id, course_id, position, item_type (page | activity | file | link | header),
                         title, page_id, activity_id, file_id, url, indent, is_published
course.page              course_id, title, body (markdown), is_published, created_by, timestamps
```

Changes to existing tables:

- `grading.activity`: + `course_id` (not null after backfill), + `assignment_group_id`,
  + `omit_from_final_grade`. `kind` gains `offline` (graded, no online
  submission - used for migrated manual assessments and paper work).
  `student_group_id`, `subject_id`, `term_id` become nullable legacy columns.
- `grading.submission`: + `excused`, + `excused_reason`. The submission score is
  now the single source of truth for a mark (Canvas model). `grading.grade` and
  `grading.assessment` are no longer written.
- `grading.submit_quiz`: no longer writes to `grading.grade`.
- `public.announcement`: + `course_id` (nullable; null = school-wide).
- `file_manager.share_principal`: + `course` (share a file with a course).
- `public.term.name`: enum → text.

RLS: all `course.*` tables have RLS on and no policies (service role only), the
same as `grading.activity` today. The API enforces access.

## Migration of existing data

Files (in order, each its own transaction so new enum values are usable):

1. `20261020120000_lms_enums.sql` - enum additions.
2. `20261020120100_lms_courses.sql` - schema, columns, RPC rewrite, term text.
3. `20261020120200_lms_backfill.sql` - data migration, idempotent.

Backfill rules:

1. **Courses** = distinct (class, subject) pairs found in teacher subject
   assignments, activities, or legacy grades (via student enrollment). Name
   `"<Subject> - <Class>"`, code = subject code, year = class year, status
   `published`.
2. **Course staff:** subject teachers → `teacher`. The class teacher of the class
   → `ta` on every course of that class, unless already teacher.
3. **Course students:** students enrolled in the class. If a student has any
   subject profile rows that year, only the courses for those subjects;
   otherwise every course of the class.
4. **Assignment groups:** the class's own grading groups, else the term defaults
   of the year, deduplicated by name (first term wins the weight).
5. **Activities** get `course_id` from their (class, subject), the group by name,
   `omit_from_final_grade` from the assessment's exclusion.
6. **Legacy assessments with no activity but with grades** become `offline`
   activities, one per course the graded students sit in.
7. **Grades → submissions:** each grade upserts the (activity, student)
   submission: `score`, `status = graded`, `excused = grade.is_excluded`.

Not migrated: report books and their PDFs, class report files, class attendance.
They remain in their tables until the cleanup migration. **Export them before
phase 5.**

## Access model

School-level permissions (catalog) after the change:

| Resource | admin | teacher | member |
|---|---|---|---|
| course | all | create, read | read |
| student, term, academic-year, grade-scale, school | all | read | read |
| announcement, file, chat | all | all | as before |

Removed resources: class, subject, enrollment, assessment, grade, reporting,
calculation, attendance. The boot-time catalog sync leaves their rows in place
(it only logs orphans), and nothing checks them any more. The phase 5 cleanup
migration deletes them, which cascades any custom-role grants.

Inside a course, access comes from the **course role**, not the catalog:

| Course role | Who | Can |
|---|---|---|
| admin | school admin, or `course:update` holder | everything in every course of the school |
| teacher | course_staff role teacher | everything in the course |
| ta | course_staff role ta | read everything, grade, post announcements; no settings, people or deletes |
| student | course_student active, via portal | published content, own submissions, own grades |

`CourseAccessService.resolve(userId, courseId)` returns `{ course, role }` and
throws 404 when the user has no role (never 403, so ids don't leak).

## API contract (all under `/api`, cookie auth)

### Staff

```
GET    /courses?status=&termId=           my courses (admin: all in school) → Course[]
POST   /courses                           {name, code?, description?, academicYearId?, termId?} → Course (caller becomes teacher)
GET    /courses/:courseId                 → Course & { role }
PATCH  /courses/:courseId                 {name?, code?, description?, status?, academicYearId?, termId?, gradeScaleId?}
DELETE /courses/:courseId                 204 (teacher/admin; refused when submissions exist unless archived first)
POST   /courses/:courseId/join-code       → { joinCode } (regenerate)
DELETE /courses/:courseId/join-code       204 (disable)

GET    /courses/:courseId/people          → { staff: CourseStaff[], students: CourseStudent[] }
POST   /courses/:courseId/staff           {userProfileId, role}
PATCH  /courses/:courseId/staff/:userProfileId {role}
DELETE /courses/:courseId/staff/:userProfileId
POST   /courses/:courseId/students        {studentIds: string[]}
DELETE /courses/:courseId/students/:studentId

GET    /courses/:courseId/modules         → Module[] (with items)
POST   /courses/:courseId/modules         {title}
PATCH  /courses/:courseId/modules/:moduleId {title?, isPublished?}
DELETE /courses/:courseId/modules/:moduleId
PATCH  /courses/:courseId/modules/reorder {moduleIds: string[]}
POST   /courses/:courseId/modules/:moduleId/items {itemType, title?, pageId?, activityId?, fileId?, url?, indent?}
PATCH  /courses/:courseId/modules/:moduleId/items/:itemId {title?, indent?, isPublished?, moduleId?}
DELETE /courses/:courseId/modules/:moduleId/items/:itemId
PATCH  /courses/:courseId/modules/:moduleId/items/reorder {itemIds: string[]}

GET    /courses/:courseId/pages           → Page[] (no body)
POST   /courses/:courseId/pages           {title, body?, isPublished?}
GET    /courses/:courseId/pages/:pageId   → Page
PATCH  /courses/:courseId/pages/:pageId   {title?, body?, isPublished?}
DELETE /courses/:courseId/pages/:pageId

GET    /courses/:courseId/assignment-groups        → AssignmentGroup[]
POST   /courses/:courseId/assignment-groups        {name, weight?}
PATCH  /courses/:courseId/assignment-groups/:id    {name?, weight?}
DELETE /courses/:courseId/assignment-groups/:id    (activities fall back to ungrouped)
PATCH  /courses/:courseId/assignment-groups/reorder {groupIds}

GET    /courses/:courseId/activities      → Activity[]
POST   /courses/:courseId/activities      {kind, title, instructions?, points, dueAt?, assignmentGroupId?, allowFile?, allowText?, maxAttempts?}
GET    /activities/:activityId            (unchanged shape, classId/subjectId/termId → courseId)
PATCH  /activities/:activityId            (+ assignmentGroupId, omitFromFinalGrade)
POST   /activities/:activityId/publish | /close
DELETE /activities/:activityId
...questions, submissions, grading endpoints keep their current paths
PATCH  /activities/:activityId/submissions/:studentId/grade {score, feedback?}  (offline too: creates the submission)
PATCH  /activities/:activityId/submissions/:studentId/excuse {excused, reason?}

GET    /courses/:courseId/gradebook       → { activities, groups, students: [{ student, scores: {activityId: Cell}, groupScores, total, letter }] }
GET    /courses/:courseId/gradebook/export → text/csv

GET    /courses/:courseId/announcements   course announcements
POST   /courses/:courseId/announcements   {title, body}
```

### Student portal

```
GET  /portal/me                              profile + school (unchanged, minus classes)
GET  /portal/me/courses                      → CourseCard[] (published, active enrollment) with grade %
POST /portal/me/courses/join                 {joinCode} → CourseCard
GET  /portal/me/courses/:courseId            → Course & { teachers }
GET  /portal/me/courses/:courseId/modules    published modules + published items
GET  /portal/me/courses/:courseId/pages/:pageId
GET  /portal/me/courses/:courseId/activities published activities + my submission state
GET  /portal/me/courses/:courseId/grades     my scores by group + total + letter
GET  /portal/me/courses/:courseId/announcements
GET  /portal/me/activities                   to-do across courses (existing, + course name)
...existing /portal/me/activities/:id endpoints unchanged
```

## Grade calculation (course total)

- Activity counts when published, not `omit_from_final_grade`, and the student's
  submission is graded and not excused. Ungraded work is ignored (Canvas
  "current grade").
- Group % = Σ score / Σ points over counted activities in the group.
- If every group has a weight: total = Σ(weight × group%) / Σ(weights of groups
  with counted work) - renormalised, as today.
- If no group has a weight: total = Σ score / Σ points across everything.
- Ungrouped activities form an implicit "Ungrouped" group (weight 0 when other
  groups are weighted).
- Letter from the course grade scale, else the school default scale.

## Frontend (web)

Staff (`/dashboard`):

- Sidebar: Dashboard, **Courses**, Students, Staff, Academic Calendar, Files,
  Messages, Announcements; Admin: Grade Scales, Roles.
- `/dashboard/courses` - card grid of my courses, filter by status/term, create dialog.
- `/dashboard/courses/[courseId]` layout with course nav:
  Home · Modules · Assignments · Pages · Announcements · People · Grades · Settings.
- `/dashboard/courses/[courseId]/assignments/[activityId]` - existing activity
  editor and marking screen, re-pointed at the course.
- Pages use markdown (`react-markdown` + `remark-gfm`, no raw HTML) with an
  edit/preview toggle.

Student (`/portal`):

- Nav: Dashboard (course cards + to-do), Courses, Work (to-do list).
- `/portal/courses/[courseId]` with Home · Modules · Assignments · Grades ·
  Announcements. Work pages at `/portal/work/[activityId]` stay.

## Phases

1. **Database** - three migrations above; regenerate types. ✅ when `supabase db reset` passes and backfill counts reconcile.
2. **Backend** - course module (courses, people, join codes, modules, pages,
   assignment groups, gradebook), activities/submissions re-keyed, portal
   course endpoints, permissions catalog, old modules removed, dashboard
   rewritten without the edge function, file shares to courses.
3. **Web** - course list/shell/all tabs, portal courses, sidebar, old pages removed.
4. **Follow-ups** - course attendance, calendar view of due dates, discussions,
   rubrics, drop-lowest rules, gradebook CSV import, notifications for new
   work, course copy/templates, mobile course UI, docs site update.
5. **Cleanup migration** - after production verification and an export of
   report books: drop `student_group`, `subject`, staff assignment tables,
   enrollment and subject profile tables, `grading.assessment/grade/grading_group`,
   `reporting` schema, class attendance, legacy columns on activity, the
   `class_invite` message type, unused RLS helpers.

## Progress (2026-10-20)

- Phase 1: migrations written. **Not yet run** against any database.
- Phase 2: done. Backend typechecks, builds, 355 tests pass.
- Phase 3: done. Web typechecks and `next build` passes. Not yet tried against a live backend.
- Mobile: class/subject screens removed, student home lists courses, `tsc` passes.

Known gaps carried into phase 4:

- A file placed in a module is visible to students only if it is also shared with the course.
- Sharing a file with a course sends no notification (`file-share-notify` cannot read course tables).
- `announcement_unread_count` RPC counts course announcements; the backend counts in code until a migration adds `course_id IS NULL`.
- A course teacher cannot edit or delete a TA's course announcement (only the author or a school admin can).
- Term create/update still requires exam + coursework weights summing to 100 (left over from report cards).
- `docs/` still describes classes, subjects and the deleted edge functions.

## Risks

- **New `course` schema must be exposed to the API.** Local `supabase/config.toml`
  now lists it. On the hosted project, add `course` under
  Settings → API → Exposed schemas before deploying the backend, or every
  course call fails with `PGRST106`.

- **Migration on production data.** Run against a staging copy first and compare
  counts: activities with null `course_id` must be 0; graded submissions ≥ grades
  linked to activities.
- **Report cards disappear for users** the moment phase 3 ships. Announce it, and
  export report book PDFs beforehand.
- **Edge functions** `dashboard-summary`, `report-class-summary`,
  `attendance-summary`, `grade-analytics`, `large-report-export` read old
  tables. The dashboard stops calling its function; the others become unused
  and are deleted in phase 5.
- **Mobile** loses class screens until phase 4.
