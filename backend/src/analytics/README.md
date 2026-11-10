# Analytics (`src/analytics`)

Submission rates, grade distributions and students at risk per course and across the school. Behind the **`analytics`** feature (on by default; the organisation or a school can switch it off). User guide: [docs/content/guide/analytics.md](../../../docs/content/guide/analytics.md).

Nothing here changes a mark, a grade or anything a student or parent sees. Course grades are worked out by the gradebook's own `calculateCourseGrade` (`src/grading/gradebook.calc.ts`), so the analytics agree with the gradebook; `score` is the mark after any late penalty.

## Who sees what

| What | Who |
| --- | --- |
| A course's analytics (and its CSV exports) | The course's staff (teacher, TA, course admin) through `CourseAccessService`, **or** `analytics:read` in the course's school (any course). Anyone else, another school's course or a template is a 404. |
| School analytics: roll-ups per course and teacher, the school at-risk list, their CSV exports, "Refresh now" | `analytics:read` (admins by default). |
| At-risk rules: read | Any member of the school. |
| At-risk rules: change | `school:update`. |

**Students and parents never reach these routes**: they hold no course staff role and no school keys (students are not `school_management` members), so course routes are 404 and school routes 403.

**Privacy.** School roll-ups are counts and averages only. Per-student rows appear in two places: a course's own at-risk list (for its staff) and the school at-risk list, which needs `analytics:read`. Those rows hold the student's name, current grade, recent missing count, attendance and mastery figures and the reasons; no marks per activity, no feedback, no answers. The `analytics:read` key therefore shows staff the at-risk students of courses they do not teach: grant it to roles that should see that (heads of year, deputy heads).

## The numbers (`analytics.calc.ts`, pure)

**Submission state** of each enrolled (active or completed) student × published or closed activity (`classify`):

| State | When |
| --- | --- |
| `excused` | The student is excused. Left out of every rate. |
| `on_time` / `late` | Handed in (`submitted_at` on a non-draft submission, or a mark). Late when `late_seconds > 0`, which the grading module measures from the student's own due date (extension included). |
| `missing` | Not handed in and the student's due date (extension, else the activity's) has passed. |
| `pending` | Not handed in and not due yet, or no due date. Not counted. |

Offline work has nothing to hand in: only a mark counts as handed in, and it is never missing. A quiz attempt still running (a `draft`) is not handed in.

**Submission rate** = (on time + late) / (on time + late + missing), one decimal; `null` when nothing is due. **On-time rate** = on time over the same.

**Distributions** (`distribution`): marks as percent of the activity's points (graded, not excused, with a score; activities worth 0 points skipped), or students' current course grades. Mean, min, max, **median and quartiles by linear interpolation** (R type 7 / Excel `QUARTILE.INC`: [1, 2, 3, 4] → Q1 1.75, median 2.5, Q3 3.25), and ten 10-point bins (0-10 … 90-100; 100 in the last; values outside 0-100 clamped into the end bins).

**Group averages**: per assignment group (and Ungrouped when it has published work), the mean of the students' group percentages from `calculateCourseGrade` (drop rules applied), over students with marked work in the group.

**Weekly trend** (`weeklyTrend`): the mean mark percent per week, oldest first, only weeks with marks, the last 26 at most. A mark belongs to the week (Monday, in the school's time zone; UTC while none is set) of its activity's due date, else when it was handed in, else when it was marked.

**At risk** (`atRiskReasons`): a student is at risk when any rule applies. Rules are per school (`public.analytics_setting`; defaults without a row), and `null` switches a rule off:

| Rule | Default | Fires when |
| --- | --- | --- |
| `minGrade` | 60 | The current course grade is below it. No grade yet: never. |
| `missingCount` | 3 | At least this many pieces of work became missing (their due date passed) in the last `windowWeeks`. |
| `windowWeeks` | 4 | The window for missing work and attendance (1-26). |
| `minAttendance` | 90 | The student's attendance in this course over the window is below it. Only while `attendance` is on; nothing counted: never. Present and late attend, excused does not count (as in `src/attendance-alerts`). |
| `masteryBelowLevel` | 2 | The mean mastery score over the course's outcomes the student has evidence on is below this level. Only while `mastery` is on; no evidence: never. Uses the school's scale and calculation (`masteryByStudentOutcome`). |

Being exactly at a threshold is not at risk (except `missingCount`, which is "at least"). Each reason has a `rule` and a sentence (`"Current grade 52.3% is below 60%"`). Lists are sorted by number of reasons, then name.

**Roll-ups** (`rollUp`) add the counts of the course summaries, then divide, so a big course weighs as much as its students and work (never an average of averages): average grade = Σ grade sums / Σ graded students; submission rate from Σ on time, late, missing; attendance from Σ attended / Σ counted. A teacher's roll-up covers every course where they are a `teacher` on the staff list (TAs are not listed). "Students at risk" on the school totals counts distinct students; per course and teacher the count is student-course pairs.

## Performance

- **Course view: on request**, for one course, in a fixed number of queries whatever its size: groups, activities, roster, **one joined cell query** (`$queryRaw`: activity × enrolled student with the submission and extension), **one grouped attendance query** (`count(*) FILTER … GROUP BY student_id`), and the course's mastery evidence. No per-student or per-activity queries.
- **School views: cached rows only.** `analytics_course_summary`, `analytics_at_risk` and `analytics_refresh` are written by `AnalyticsService.refreshSchool`, which runs the same course computation for every published or archived, non-template course of the school, replaces each course's summary and at-risk rows in one transaction, removes rows of courses no longer summarised and stamps the refresh time. Running it twice gives the same rows (idempotent). The page shows "Updated … ago" from `analytics_refresh.refreshed_at`.
- **The sweep** (`AnalyticsScheduler`): hourly in every instance, first run 3 minutes after start, under the Postgres advisory lock `gradebook:analytics` (one instance at a time, no Redis). Skips schools with the feature off. Off under `NODE_ENV=test` or with `ANALYTICS_SWEEP=false`.
- **Refresh now** (`POST /api/analytics/school/refresh`): starts the active school's refresh in the background under the same lock (the request does not wait). Ignored while a refresh runs in this instance or within 2 minutes of the last one; the response says `{ started, lastUpdated }`.

Course pages apply changed rules at once; the school page after the next refresh (saving the rules on the web starts one).

## HTTP routes

Guards: `AuthGuard`, `FeatureGuard` with `@RequireFeature('analytics')`, and `PermissionGuard` where a permission is listed.

| Method | Path | Who | Returns |
| --- | --- | --- | --- |
| GET | `/api/courses/:courseId/analytics` | Course staff or `analytics:read` | `{ course, generatedAt, timeZone, rules, features: { attendance, mastery }, students, overview: { averageGrade, medianGrade, submission, attendanceRate, atRisk }, activities: [{ id, title, kind, points, dueAt, group, onTime, late, missing, excused, pending, handedIn, rate, onTimeRate, distribution }], gradeDistribution, groups: [{ groupId, name, weight, average, students }], trend: [{ week, average, count }], atRisk: [{ studentId, firstName, lastName, grade, missingRecent, attendanceRate, masteryScore, reasons: [{ rule, text }] }] }` |
| GET | `/api/courses/:courseId/analytics/export?table=` | same | CSV of one table: `activities` (default), `distribution`, `groups`, `trend`, `at-risk` |
| GET | `/api/analytics/school?termId&academicYearId` | `analytics:read` | `{ lastUpdated, filter, filters: { academicYears, terms }, totals: RollUp + atRiskStudents, courses: [RollUp + { courseId, name, code, status, termId, academicYearId, teachers, computedAt }], teachers: [RollUp + { teacherId, name }] }` |
| GET | `/api/analytics/school/at-risk?termId&academicYearId` | `analytics:read` | `{ lastUpdated, students: [{ studentId, firstName, lastName, courseId, courseName, courseCode, grade, missingRecent, attendanceRate, masteryScore, reasons }] }` |
| GET | `/api/analytics/school/export?table=&termId&academicYearId` | `analytics:read` | CSV: `courses` (default), `teachers`, `at-risk` |
| POST | `/api/analytics/school/refresh` | `analytics:read` | 202 `{ started, lastUpdated }` |
| GET | `/api/analytics/settings` | Member | `{ rules: { minGrade, missingCount, windowWeeks, minAttendance, masteryBelowLevel }, features: { attendance, mastery } }` |
| PUT | `/api/analytics/settings` | `school:update` | Any subset of the rules (`AnalyticsSettingsDto`; `null` switches a rule off); returns the settings |

`RollUp` is `{ courses, enrolments, averageGrade, submissionRate, onTime, late, missing, attendanceRate, atRisk }`. Filters: courses are matched on `course.term_id` / `course.academic_year_id` (schools have no grade level or subject on a course, so there is no such filter). The attendance figures always cover the last `windowWeeks` weeks, whatever the filter.

**CSV**: every cell goes through `csvCell` (from the gradebook), which defuses values a spreadsheet would run as a formula (`= + - @`, tab, CR; plain numbers like `-3.5` are left alone). Downloads are `Cache-Control: private, no-store`.

## Files

| File | Purpose |
| --- | --- |
| `analytics.module.ts` | Two controllers, the service and the scheduler. |
| `analytics.controller.ts` | `AnalyticsController` (`/api/analytics`), `CourseAnalyticsController` (`/api/courses/:courseId/analytics`). |
| `analytics.service.ts` | Access (`authorizeCourse`, `memberSchool`), rules, the course computation (`computeCourse`), school views from the cached rows, `refreshSchool` / `sweep`, CSV tables. |
| `analytics.scheduler.ts` | Hourly sweep and "refresh now" under the advisory lock. |
| `analytics.calc.ts` | Pure maths: `classify`, `submissionRates`, `quantile`, `distribution`, `weekOf`, `weeklyTrend`, `atRiskReasons`, `rollUp`, `toCsv`. |
| `dto/analytics.dto.ts` | Filters, export tables, settings body. |

## Data

[`prisma/schema/analytics.prisma`](../../prisma/schema/analytics.prisma), migration `20261129100000_analytics` (hand-written): `public.analytics_setting`, `public.analytics_course_summary`, `public.analytics_at_risk`, `public.analytics_refresh`, all cascading with school / course / student. The summaries are derived data: deleting them only means the next refresh rebuilds them. The migration also inserts the `analytics:read` catalog row. No role gets it automatically: admins hold it in code, and any other role only when a school grants it on the Roles page.

## Depends on

- `CourseAccessService` / `STAFF_ROLES` (`src/course/access`), `loadEffectivePermissions` (`src/permission`), `FeatureService` (`src/features`).
- `calculateCourseGrade` (`src/grading/gradebook.calc.ts`), `csvCell` (`src/grading/gradebook.service.ts`).
- `scaleFromRow` (`src/mastery/mastery.calc.ts`), `masteryByStudentOutcome` (`src/mastery/mastery.service.ts`).
- `localParts`, `isoWeekday`, `addDays`, `safeTimeZone` (`src/common/time-zone.ts`).

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `ANALYTICS_SWEEP` | `true` | `false` stops the hourly summary refresh in this instance ("Refresh now" still works). |

## Tests

```bash
cd backend && bun test src/analytics
```

- `analytics.calc.test.ts`: submission states (on time, late, missing, pending, excused, drafts, extensions, offline work), rates and rounding, quantiles and quartiles, histogram edges, local weeks and the trend, every at-risk rule with its text, thresholds at the line, rules switched off and features off, exact roll-ups, CSV formula defusing.
- `analytics.service.test.ts`: the course computation end to end (rates per activity, distributions, grades by the gradebook's rules, group averages, trend, attendance, at-risk order), configured rules and the missing-work window, attendance off (no query, no reason), mastery on and off, a fixed number of queries, **access** (course staff, `analytics:read` for any course in the school, 404 without either, for another school's course, templates and students), route metadata (permission and feature on each route), **cross-school isolation** of the school views (every query scoped to the caller's school), the school at-risk list, **sweep idempotency** (two refreshes write identical rows; rows of removed courses deleted; nothing while the feature is off), the advisory lock, the refresh cooldown, CSV defusing, settings and the migration.
- `src/features/feature.catalog.test.ts` and `src/permission/permission.catalog.test.ts` cover the flag and the key.

## Front end

- `frontend/app/dashboard/courses/[courseId]/analytics/page.tsx`: the course Analytics tab.
- `frontend/app/dashboard/analytics/page.tsx` (+ `_components/settings-card.tsx`): the school page (sidebar, `analytics:read` and the flag).
- `frontend/components/analytics/analytics-ui.tsx` (chart cards with a Chart / Table switch and a written summary), `frontend/lib/analytics.ts` (types, summaries).
- No mobile screens.
