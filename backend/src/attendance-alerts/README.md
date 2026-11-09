# Attendance reports and alerts (`src/attendance-alerts`)

Attendance percentages per student, course and school over a date range, with CSV exports, and **alerts** when a student falls below the school's thresholds: to their form tutor and the school's admins (in the app and by email), and, through the parent notice sweep, to parents who opted in. Behind the **`attendance_alerts`** feature (off by default; requires `attendance`). User guide: [docs/content/guide/attendance-reports.md](../../../docs/content/guide/attendance-reports.md).

## The percentage

The attendance module's `tally`: `(present + late) / (present + late + absent) × 100`, rounded to one decimal; **excused** records count neither way; `null` (shown as "-") when nothing counts. A student is measured only over sessions they have a record in, so joining a course late is not absence. Report ranges are local days in the school's time zone (`school.time_zone`, see [`src/timetable`](../timetable/README.md)); a session counts on the day it opened. The default range is the last 28 days including today; a range covers at most 400 days.

## Who sees what

- **School report** and **any student's report**: `report-card:read` in the active school (admins by default; it is the existing "view any student's report" power, reused rather than adding a permission). Without it the school report is 403.
- **A form tutor** sees their own tutees' student reports and alerts. Another student, or one in another school, is a 404.
- **Course report**: the course's staff (`CourseAccessService`, any staff role).
- **Settings**: `school:update`. **Form tutors**: `student:update`.

## Form tutors

`student.student.form_tutor_id` (no foreign key; the API checks the tutor is a member of the school when assigning and skips a tutor who has left when emailing). Set in bulk from the reports page.

## Alerts

Settings (`public.attendance_alert_setting`, one row per school; nothing is checked until a school sets a threshold):

| Setting | Default | Meaning |
| --- | --- | --- |
| `min_rate` | off | Alert when the rate over the window is below this percent. |
| `window_days` | 28 | The rate window. |
| `min_sessions` | 5 | Counted records needed in the window before the rate is judged (so one absence out of one is not 0%). |
| `consecutive_absences` | off | Alert after this many absences in a row (excused records skipped; present or late ends the run; looks back 60 days). |
| `notify_tutor`, `notify_admins` | on | Who is emailed. Admins are the school's `admin` members. |
| `email_staff` | on | Off: alerts only in the app. |
| `notify_parents` | on | Parents can be told (they must also opt in, and `parent_portal` + `parent_notifications` must be on). |

**The sweep** (`AttendanceAlertScheduler`, hourly, first run 5 minutes after start, Postgres advisory lock `gradebook:attendance-alerts`, so one instance at a time and no Redis; off under `NODE_ENV=test` or with `ATTENDANCE_ALERTS_SWEEP=false`) evaluates every active student with recent records in each school with a threshold and the feature on (`rates.ts` → `evaluate`).

**Dedupe.** `student.attendance_alert` has a partial unique index on `(student_id, kind) WHERE resolved_at IS NULL`: at most one **open** alert per student and condition. While the condition holds nothing new is opened (and nobody is told again). An open alert is **resolved** only on recovery: for the rate, enough counted records at or above the threshold, or none at all in the window; for absences in a row, a present or late record. Falling below again afterwards opens, and notifies, a new alert. Switching a check off resolves its open alerts. Inserts use `ON CONFLICT DO NOTHING`, so a racing instance cannot double an alert, and only rows actually inserted are emailed.

**In the app**, staff see open alerts on the attendance reports page (with a count for a badge) and can acknowledge them; acknowledging does not resolve.

**Parents.** The parent notice sweep (`src/parent-portal`, every 15 minutes) has a new kind, **`attendance_alert`**: an alert opened in its 24-hour lookback and still open becomes one notice per parent, keyed by the alert's id in `parent_notification_sent` (so each alert reaches a parent once, and a re-alert after recovery reaches them again). It needs `parent_portal` and `parent_notifications` (as every notice), `attendance` and `attendance_alerts` effective for the child's school, the school's `showAttendance` and `notify_parents`, and the parent's choice of the kind.

## HTTP routes

Guards: `AuthGuard`, `FeatureGuard` with `@RequireFeature('attendance', 'attendance_alerts')`, and `PermissionGuard` where a permission is listed. Dates are `?from&to` (`YYYY-MM-DD`).

| Method | Path | Who | What it returns |
| --- | --- | --- | --- |
| GET | `/api/attendance-reports/school` | `report-card:read` | `{ range, overall, sessions, courses: [{ courseId, name, code, students, …tally }], students: [{ studentId, firstName, lastName, formTutorId, openAlerts, …tally }] }`. |
| GET | `/api/attendance-reports/school/export` | `report-card:read` | CSV, one row per student. |
| GET | `/api/attendance-reports/students/:studentId` | `report-card:read` or the form tutor | `{ range, student, overall, courses, records: [{ courseId, courseName, status, openedAt }], alerts }`. |
| GET | `/api/attendance-reports/students/:studentId/export` | same | CSV: each record (local date, course, status), then per course and overall. |
| GET | `/api/courses/:courseId/attendance-report` | Course staff | `{ range, course, overall, sessions, students }`. |
| GET | `/api/courses/:courseId/attendance-report/export` | Course staff | CSV, one row per student. |
| GET | `/api/attendance-alerts?status=open\|resolved\|all` | Member (school-wide with `report-card:read`, else own tutees) | `{ canSeeSchool, alerts: [{ id, studentId, firstName, lastName, mine, kind, value, threshold, windowDays, description, openedAt, resolvedAt, acknowledgedAt }] }`. |
| GET | `/api/attendance-alerts/count` | same | `{ count }` of open, unacknowledged alerts. |
| POST | `/api/attendance-alerts/:alertId/acknowledge` | same | 204; another school's or another tutor's alert is 404. |
| GET / PUT | `/api/attendance-alerts/settings` | `school:update` | `AlertSettingsDto` `{ minRate, windowDays, minSessions, consecutiveAbsences, notifyTutor, notifyAdmins, notifyParents, emailStaff }`. |
| GET / PUT | `/api/attendance-alerts/form-tutors` | `student:update` | GET `{ students: [{ id, firstName, lastName, formTutorId }], staff }`; PUT `{ studentIds, tutorId \| null }` (400 if the tutor is not school staff, 404 if a student is not in the school). |

CSV cells go through `csvCell` (from the gradebook), which defuses values that look like spreadsheet formulas. Downloads are `Cache-Control: private, no-store`.

The student's own percentage (`GET /api/portal/me/attendance/summary`) lives in [`src/attendance`](../attendance/README.md) and needs only `attendance`; the parent's attendance tab already returns the percentage.

## Files

| File | Purpose |
| --- | --- |
| `attendance-alerts.module.ts` | Three controllers, two services, the scheduler. |
| `attendance-alerts.controller.ts` | `AttendanceReportController`, `CourseAttendanceReportController`, `AttendanceAlertController`. |
| `attendance-report.service.ts` | Ranges, access (`scope`), reports and CSV. |
| `attendance-alert.service.ts` | Settings, form tutors, alert list and acknowledge, the sweep, staff emails (`alertEmail`). |
| `attendance-alert.scheduler.ts` | Hourly sweep under an advisory lock. |
| `rates.ts` | `tally`, `trailingAbsences`, `evaluate`, `describeAlert` (pure). |
| `dto/attendance-alerts.dto.ts` | Bodies and queries. |

## Data

Migration `20261119100000_attendance_alerts`: `student.student.form_tutor_id` (+ index), `public.attendance_alert_setting`, `student.attendance_alert` (kind `low_rate` / `consecutive_absences`, `value`, `threshold`, `window_days`, `opened_at`, `resolved_at`, `acknowledged_at`, `acknowledged_by`; the partial unique open index), and the parent notice kind `attendance_alert` added to `parent_notification_pref.kinds`' CHECK and default (existing parents keep their choices; the new kind is opt-in for them). Models in [`prisma/schema/attendance-alert.prisma`](../../prisma/schema/attendance-alert.prisma).

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `ATTENDANCE_ALERTS_SWEEP` | `true` | `false` stops the alert sweep in this instance. |

## Tests

```bash
cd backend && bun test src/attendance-alerts
```

- `rates.test.ts`: the percentage (late counts, excused does not, nothing counted is null, rounding), absences in a row (excused skipped, order-independent), thresholds (minimum sessions, exactly at the threshold, empty window, switched-off checks), wording.
- `attendance-alert.service.test.ts`: one alert while the condition holds (**dedupe**), re-alert only after recovery, the window, absences in a row and their recovery, switching a check off, the feature gate, staff emails (tutor and admins once each, a tutor who left skipped, `notifyAdmins` and `emailStaff` off), form tutor validation.
- `attendance-report.service.test.ts`: school, course and student reports, local-day ranges in the school's zone (across a DST change), range validation, access (no school report without the permission, a tutor's own tutee only, another school 404, non-members 403, course access) and the CSV defusing formulas.
- `src/parent-portal/parent-notification.service.test.ts`: the `attendance_alert` notice and its **parent gating** (feature, opt-in, `showAttendance`, `notify_parents`, `parent_notifications`, `attendance`) and dedupe.
- `src/timetable/timetable.feature.test.ts` covers the feature gate on these routes.
