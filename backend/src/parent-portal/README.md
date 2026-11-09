# Parent portal (`src/parent-portal`)

Read-only views of a student for their parents and guardians, the staff routes that link parents to students, the school's "what parents see" setting, and opt-in parent notices. Behind the **`parent_portal`** feature (off by default; the organisation makes it available, each school turns it on) and, for notices, **`parent_notifications`** (off by default, requires `parent_portal`). See [`src/features`](../features/README.md). User guide: [docs/content/guide/parent-portal.md](../../../docs/content/guide/parent-portal.md).

## How a parent is represented

A parent is a `public.user_profile` with **`account_type = 'parent'`**, signing in with the same email-code (or SSO) flow as everyone else. A parent account has **no school** (`school_id` null, `role` null), **no `school_management` row, no catalog permission, no course role and no student record**. That is what keeps every existing guard correct without changes:

- `PermissionGuard` finds no school (or no membership) and answers 403; `AdminGuard` needs an admin membership; `StudentGuard` and `ChatAccessGuard` need a student account; `CourseAccessService` needs a course role.
- Flows that could turn the account into staff or a student refuse parents: onboarding (`AuthService.onboard`), joining by school code (`StudentMembershipService.joinByCode`), automatic joining by email domain (`EmailDomainService.matchFor`), staff join request approval (`SchoolService`), appointing a school admin and organisation/school-admin invites (`src/organisation`), and switching school (`ActiveSchoolService`). `GET /api/permissions/me` returns no permissions and the dashboard summary is refused.

The children are the account's rows in **`student.parent_student_link`**. `ParentGuard` checks every child-scoped request against it.

An account becomes a parent only by redeeming an invitation. It can be a brand-new account or one that has signed in but never joined a school; students, staff with a school, membership or pending join request, and organisation admins get 409 `ACCOUNT_NOT_ELIGIBLE` (one account is one kind of user). They can accept with a different email address.

## HTTP routes

### Parent (`ParentPortalController`, `@Controller('parent')`)

Guards: `AuthGuard`, `ParentGuard`, `FeatureGuard`; every route `@RequireFeature('parent_portal')` (a method's keys replace the class's, so overrides repeat it). `:studentId` is checked by `ParentGuard`: not a linked child (or malformed, inactive, or over the school's age limit) is a **404**.

| Method | Path | Extra feature | What it returns |
| --- | --- | --- | --- |
| GET | `/api/parent/children` | | Linked children whose school has the portal on and does not leave them out by age: `[{ id, firstName, lastName, relationship, relationshipLabel, school: { id, name, logoUrl }, visibility: { grades, work, attendance, announcements, reports, notifications } }]`. `reports` is `showReports` and the `report_cards` feature. |
| GET | `/api/parent/children/:studentId` | | Overview: `{ child, school, visibility, courses, upcomingCount, missingCount }` (counts null when work is hidden). |
| GET | `/api/parent/children/:studentId/courses` | | `[{ id, name, code, status, teachers: [{ firstName, lastName }], grade: { percent, letter } \| null }]`; `grade` is null when grades are hidden. |
| GET | `/api/parent/children/:studentId/courses/:courseId/grades` | | `{ grade: { percent, letter, groups }, activities: [{ id, title, kind, points, dueAt, groupName, dropped, status, score }] }`. 404 unless the child is enrolled (`GradebookService.studentGrades` → `requireStudent`). A score only once marked, never feedback. |
| GET | `/api/parent/children/:studentId/work` | | `{ upcoming, missing, done }` from `SubmissionService.listForStudent`, on the child's **effective** due date (extensions included, `src/grading/due-date.ts`): `[{ id, courseId, courseName, kind, title, points, dueAt, hasExtension, lateUntil, late, state, submittedAt, score }]`. `lateUntil` is when late work is still accepted from the child (null with an extension or no late window), so missing work can still be handed in until then; `late` marks a hand-in after the due date. |
| GET | `/api/parent/children/:studentId/attendance` | `attendance` | `{ summary, courses: [{ courseId, courseName, summary, records: [{ sessionId, title, openedAt, status, checkedInAt }] }] }`. The query selects only those columns: **no location, accuracy, distance, location flags or notes**. |
| GET | `/api/parent/children/:studentId/announcements` | `announcements` | Newest first, author by name only: the child's school's announcements with `audience = everyone` (`scope: 'school'`, `courseId`/`courseName` null, `schoolName`) and the child's course announcements (`scope: 'course'`). Shape `{ id, scope, courseId, courseName, schoolName, title, body, createdAt, author: { firstName, lastName } }`. Staff-only school notices never appear; no read receipts. 403 `PARENT_VIEW_HIDDEN` with `showAnnouncements` off (nothing is read). |
| GET / PUT | `/api/parent/notifications/preferences` | `parent_notifications` | `{ emailEnabled, pushEnabled, kinds }` (`ParentNotificationPrefsDto`). |

### Report cards (`ParentReportController`, `@Controller('parent/children/:studentId')`)

Guards: `AuthGuard`, `ParentGuard` (link, active child and school, age limit; anything else 404), `FeatureGuard` with `@RequireFeature('parent_portal', 'report_cards')` for the child's school. `ParentReportsService` checks the school's `showReports` first (403 `PARENT_VIEW_HIDDEN`, nothing read), then calls the report module's `StudentReportsService` with the guarded child id, so only **published** terms are listed or served, only the child's own documents, and every storage key is checked against the school prefix.

| Method | Path | What it returns |
| --- | --- | --- |
| GET | `/api/parent/children/:studentId/reports` | The child's reports in published terms, newest first: `[{ id, termId, termName, yearName, startDate, endDate, publishedAt, status }]` (`pending` while the PDF is being made). |
| GET | `/api/parent/children/:studentId/reports/:documentId/file` | The PDF (web download, mobile `downloadAndOpen`). 404 for another child's document, an unpublished term, or one not ready yet. |
| GET | `/api/parent/children/:studentId/reports/:documentId/link` | `{ url, expiresAt }`: a five-minute signed link (`/api/report-cards/files/:token`). |
| GET | `/api/parent/children/:studentId/transcript` | `{ student: { name }, terms, generatedAt }` over published terms only. |
| GET | `/api/parent/children/:studentId/transcript.pdf` | The same as a PDF. |

Hidden by the school's setting: **403 `{ code: 'PARENT_VIEW_HIDDEN' }`**.

### Becoming a parent (`ParentLinkController`, `@Controller('parent/link')`, `AuthGuard` only)

| Method | Path | Body | What it does |
| --- | --- | --- | --- |
| POST | `/api/parent/link/accept` | `{ token, firstName?, lastName? }` | Redeems an emailed invitation. The signed-in address must be the invited one (403 otherwise). |
| POST | `/api/parent/link/redeem` | `{ code, firstName?, lastName? }` | Redeems a one-time code. Wrong codes count per account (`parent-link:failed-code:<userId>`, 10 per hour, then 429). |

Both are throttled (`claim-code`, 10 per 15 minutes), need `parent_portal` on for the invitation's school (403 `FEATURE_DISABLED`), and a name when the account has none. An unknown, used, withdrawn or expired invitation is **410 `INVITE_INVALID`**. The invitation is claimed atomically (`updateMany ... where used_at is null`), so it works once. The account becomes `account_type = 'parent'` and the link is created (once per parent and child). Returns `{ studentId, child: { firstName, lastName }, school: { name } }`.

### Staff (`StudentParentsController`, `@Controller('students/:studentId/parents')`)

Guards: `AuthGuard`, `PermissionGuard`, `FeatureGuard` (`parent_portal`, active school). The student must be in the caller's active school (404 otherwise).

| Method | Path | Permission | What it does |
| --- | --- | --- | --- |
| GET | `/api/students/:studentId/parents` | `student:read` | `{ links: [{ id, parent: { id, firstName, lastName, email }, relationship, relationshipLabel, createdAt }], invites: [open invitations] }`. |
| POST | `/api/students/:studentId/parents/invites` | `student:update` | `{ email, relationship?, relationshipLabel? }`. Emails an invitation link (`/parent/accept?token=...`, 14 days). A new one withdraws an open one for the same address; 409 if that address is already linked; 503 (and the invitation withdrawn) if the email cannot be sent. The token is never returned. |
| POST | `/api/students/:studentId/parents/link-codes` | `student:update` | One-time code `XXXXX-XXXXX` (7 days), returned once. |
| DELETE | `/api/students/:studentId/parents/invites/:inviteId` | `student:update` | Withdraws an open invitation. |
| DELETE | `/api/students/:studentId/parents/:linkId` | `student:update` | Removes a link; the parent loses access at once (the guard reads the link on every request). |

Invitations, codes and link changes are written to the audit log.

### School setting (`ParentSettingsController`, `@Controller('schools/current/parent-settings')`)

`GET` / `PATCH` with `school:update` (not feature-gated, so a school can prepare before switching the portal on). Body `{ settings: { showGrades?, showWork?, showAttendance?, showAnnouncements?, showReports?, maxStudentAge? } }` (all booleans default `true`; `showReports` covers published report cards and the transcript); unknown keys and wrong types are a 400. Audit-logged.

## Services

- **`ParentGuard`** (`parent.guard.ts`): `account_type = 'parent'` and active, else 403. With `:studentId`, the link must exist, the student and school be active and the student not be over `maxStudentAge`; pins `req.parent = { userId, studentId, schoolId }`. Without one, `schoolId` is a linked child's school with the portal on (else any linked child's; null with none) so `FeatureGuard` can check it. Never cached, so removing a link takes effect immediately.
- **`ParentPortalService`**: the reads above, built field by field (`parent-portal.mapper.ts`), never spreading student-portal rows, so a field added there later does not reach parents.
- **`ParentReportsService`** (`parent-reports.service.ts`, `parent-report.controller.ts`): report cards and transcript through `ReportCardModule`'s `StudentReportsService`, behind `showReports`.
- **`ParentLinkService`**: invitations, codes, links and redeeming.
- **`ParentNotificationService`** + **`ParentNotificationScheduler`**: see below.
- `parent-settings.ts` (defaults, parse, merge, age limit), `parent-token.ts` (tokens, codes and their SHA-256 hashes), `parent-emails.ts` (invitation and notice emails in the account email frame).

## Notifications

Each parent opts in to **email** and **push** separately (both off by default) and picks the kinds: `missing_work`, `absence`, `new_grade`, `announcement`, `attendance_alert`. `ParentNotificationScheduler` runs a sweep every 15 minutes (one instance at a time, Postgres advisory lock, like the retention scheduler; off under `NODE_ENV=test` or with `PARENT_NOTIFICATIONS_SWEEP=false`). It looks back 24 hours for: newly marked submissions, `absent` attendance records, work whose effective due date passed without a hand-in, course announcements, and the child's school's announcements with `audience = everyone` (read once per school per sweep; title "New announcement from <school>"). Both announcement sources need `showAnnouncements` and the `announcements` feature and use the `announcement` kind. **Attendance alerts** (`attendance_alert`, from [`src/attendance-alerts`](../attendance-alerts/README.md)): a still-open `student.attendance_alert` opened in the lookback, one notice per alert id (so a parent hears again only after the child recovered and fell below again); it needs `showAttendance`, the `attendance` and `attendance_alerts` features and the school's `notify_parents` alert setting. Notices are de-duplicated per parent, kind and row inside a sweep, so siblings at one school or in one course produce one notice. A staff-only post widened to everyone is noticed only if it was created within the lookback. A notice is collected only when `parent_portal` **and** `parent_notifications` are effective for the child's school and the school shows that area to parents (no grade notices while grades are hidden, and so on). `student.parent_notification_sent` (primary key parent, kind, row) keeps each event to one notice; only rows inserted by this sweep are sent. Push also needs `push_notifications` for the child's school (and `PushService`'s own check); more than three emails in one sweep become one digest. The grading, attendance and announcement write paths are unchanged. There is no "report published" notice yet: `parent_notification_pref.kinds` has a CHECK listing the kinds (`20261119100000_attendance_alerts` added `attendance_alert`; existing parents' choices were kept, so it is opt-in for them), so another kind needs a migration; it would fit the sweep (published releases in the lookback, the child's document as the row, behind `showReports` and `report_cards`).

## Data

Migration `20261112100000_parent_portal`:

- `public.account_type` gains `parent`.
- `public.school.parent_settings` (`jsonb`, default `{}`, CHECK object).
- `student.parent_student_link`: rows with a null side or duplicates removed; `user_profile_id` and `student_id` NOT NULL and cascading; `relationship_label` (≤ 60), `created_by` (no FK), `created_at`; unique `(user_profile_id, student_id)`.
- `student.parent_invite`: `kind` `email` (with lower-cased `email`) or `code`; `token_hash` unique (SHA-256, never the token); `expires_at`, `used_at`, `used_by`, `revoked_at`, `created_by`; relationship fields; cascades with the student.
- `student.parent_notification_pref` (per parent; opt-in flags, `kinds`), `student.parent_notification_sent` (dedupe).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PARENT_NOTIFICATIONS_SWEEP` | `true` | `false` stops the notice sweep. |

Invitation links use the first allowed web origin (`src/config/origins.ts`).

## Tests

```bash
cd backend && bun test src/parent-portal
```

- `parent.guard.test.ts`: every parent route answers 403 `FEATURE_DISABLED` with `parent_portal` off at the organisation or the school, and passes when on; preferences also need `parent_notifications`; staff link routes need the feature; `ParentGuard` pins only linked children, 404s another family's child on every child route (IDOR), a malformed id and a child over the age limit, refuses staff and student accounts; `StudentGuard`, `PermissionGuard` and `AdminGuard` refuse a parent account.
- `parent-link.service.test.ts`: tokens stored only as hashes and emailed; another school's student 404; a failed email withdraws the invitation; codes hashed; single use (used, lost claim race), expiry and withdrawal are 410; wrong address 403; feature off 403; student and staff accounts 409; wrong-code counting and 429.
- `parent-report.test.ts`: every report route needs both `parent_portal` and `report_cards` (403 `FEATURE_DISABLED`), another family's child and a child over the age limit are 404, `showReports` defaults on and parses/merges, hidden is 403 `PARENT_VIEW_HIDDEN` with nothing read, reads go to the guarded child only, the transcript JSON has no logo, and with the real `StudentReportsService` an unpublished term lists nothing and its document is 404.
- `parent-portal.service.test.ts`: school announcements for everyone merged with course posts, only from the child's own school, no audience/readers/author id/avatar, nothing read while `showAnnouncements` is off; no teacher-only field (feedback, instructions, lockdown, location, accommodations, answers, attempts) in grades, work or attendance; attendance selects no location columns; hiding grades makes the grades route 403 and drops grades and scores elsewhere; hidden areas 403; children filtered by feature and age; settings parsing, merging and the age limit; work states on effective due dates.
- `parent-notification.service.test.ts`: attendance alert notices keyed by the alert and gated by the feature, opt-in, `showAttendance`, `notify_parents` and `parent_notifications`; school announcements only for the child's school and `audience = everyone`, gated by `showAnnouncements`, `announcements` and the opt-in, one notice for siblings; notices only with both features on (organisation and school), only for shown areas and chosen kinds, dedupe sends only fresh rows, email and push follow the parent's switches and `push_notifications`, preferences default off.
