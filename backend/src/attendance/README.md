# Attendance (`src/attendance`)

This module handles course attendance with student self check-in. A member of the course staff opens a short **attendance session** for a published course. Students check themselves in from the student portal (web or mobile) in one of two ways:

- typing the 4-digit code shown in the room, or
- scanning a rotating QR code on the teacher's screen.

A session can also have a geofence, in which case the student's location must be close enough to the classroom. When the session closes, every active student who has not checked in is recorded as `absent` (`method: 'auto'`). Staff can override any record at any time, see each student's attendance rate, and export a CSV. Live updates are sent over Server-Sent Events, backed by the Redis pub/sub bus, and students also get a push notification when a session opens.

Closing a session ("finalising") is idempotent and can happen in three ways:

1. a member of staff closes it early;
2. the background sweep, which runs every 30 seconds in each process (except when `NODE_ENV=test`), finds a session past its window;
3. any read of an expired session notices it first.

Only the call that actually sets `closed_at` sends the "closed" events.

## What it provides

### HTTP routes

**`AttendanceController`** (`/api/courses/:courseId/attendance`) is guarded by `AuthGuard`. Access is the caller's role in the course, checked with `CourseAccessService.require()`. All ids must be UUIDs.

| Method | Path | Who may call | What it does |
|--------|------|--------------|--------------|
| GET | `/api/courses/:courseId/attendance/sessions` | Course staff (`admin`, `teacher`, `ta`) | Lists the course's sessions, newest first, with counts. Expired sessions are finalised first. |
| POST | `/api/courses/:courseId/attendance/sessions` | Course staff | Opens a session (`OpenAttendanceDto`). Gives 409 when the course is not published, or when a session is already open (a unique index allows one open session per course). A random 4-digit code is generated unless `requireCode: false`, and a per-session QR secret is always created. Active students get a push notification and an `attendance.opened` portal event. |
| GET | `/api/courses/:courseId/attendance/sessions/:sessionId` | Course staff | The session with its roster. While the session is open, the roster is every active student. Once closed, it is whoever has a record. |
| GET | `/api/courses/:courseId/attendance/sessions/:sessionId/qr` | Course staff | The current QR frame: `{ token, url, rotatesAt, windowMs }`. `url` is `<primary origin>/scan?s=<sessionId>&t=<token>`. Gives 409 when the session is closed. |
| POST | `/api/courses/:courseId/attendance/sessions/:sessionId/close` | Course staff | Closes the session early and marks the absentees. Closing an already-closed session just returns it. |
| DELETE | `/api/courses/:courseId/attendance/sessions/:sessionId` | Course `admin` or `teacher` (`MANAGE_ROLES`) | Deletes the session (204). If it was open, an `attendance.closed` portal event takes the students' banner down. |
| PATCH | `/api/courses/:courseId/attendance/sessions/:sessionId/records/:studentId` | Course staff | Sets one student's status and note (`SetAttendanceRecordDto`, `method: 'teacher'`), whether the session is open or closed. Sends an `attendance.record` event. |
| GET | `/api/courses/:courseId/attendance/sessions/:sessionId/stream` | Course staff | SSE stream of `attendance.record` events (one per check-in or change), then `attendance.closed`. |
| GET | `/api/courses/:courseId/attendance/summary` | Course staff | `{ sessionCount, students[] }`: each active student's present, late, absent and excused counts and `rate`. |
| GET | `/api/courses/:courseId/attendance/export` | Course staff | A CSV download (`<course code>-attendance.csv`) with one column per session, followed by totals and the rate. Cells go through `csvCell`, which neutralises values that look like spreadsheet formulas. |

**`PortalAttendanceController`** (`/api/portal/me`) is guarded by `AuthGuard` and `StudentGuard`. The student is always the one `StudentGuard` resolved, never an id from the client, and the check-in code is never sent to students.

| Method | Path | Who may call | What it does |
|--------|------|--------------|--------------|
| GET | `/api/portal/me/attendance/open` | A student | The open sessions in the student's active enrolments in published courses, each with `myStatus`. |
| POST | `/api/portal/me/attendance/:sessionId/check-in` | A student. Throttled: `claim-code` 30 per 15 min. | Checks in (`CheckInDto`). See the check-in rules below. |
| GET | `/api/portal/me/courses/:courseId/attendance` | A student enrolled in the course | `{ summary, records[] }` for this student. It includes only the sessions they have a record in, plus any open one. |
| GET | `/api/portal/me/stream` | A student | SSE stream of `attendance.opened` and `attendance.closed` events for the caller's courses. |

**`ScanClaimController`** (`/api/attendance`) is **public**.

| Method | Path | Who may call | What it does |
|--------|------|--------------|--------------|
| POST | `/api/attendance/scan-claim` | Anyone. Throttled: `claim-code` 300/min (keyed by IP for anonymous callers). | Swaps a live QR token (`ScanClaimDto`) for a `claim` that lasts 10 minutes, so a student who scanned while signed out can sign in and then check in. |

### Check-in rules (`AttendanceService.checkIn`)

1. The session must exist, the student must be an **active** student of a published course (`requireStudent` with `allowArchived: false`), and the session must still be open. If any of these fails, the student sees a 404 or a 409.
2. If the student already has a record, the answer is 409.
3. A `qrToken` or `qrClaim` takes the place of the code. The token must be from the current or the previous 15-second window, and the method is recorded as `qr`.
4. Otherwise, if the session has a code, it must match. Each wrong code increments the cache counter `attendance:wrong-code:<sessionId>:<studentId>`. After 5 wrong codes the answer is 429. A missing code is a 400 and does not count as a wrong attempt.
5. If the session has a location, the student's `location` is required. The student must be within `radius_m + min(accuracy, 50 m)` of it, or the answer is 403. The distance is stored on the record.
6. The status is `late` when the student checks in more than `late_after_minutes` after the session opened, and `present` otherwise. An `attendance.record` event is sent to staff.

### Services / exports

The module exports nothing. Its providers are:

- **`AttendanceService`**:
  - staff: `list`, `open`, `detail`, `qr`, `close`, `remove`, `setRecord`, `summary`, `exportCsv`, `assertSession`;
  - portal: `openForStudent`, `checkIn`, `courseForStudent`, `scanClaim`;
  - finalising: `finalize`, `finalizeExpired(courseId?)`, `sweep`.
  - It also exports the helper `tally(records)`: the rate is (present + late) / (records − excused) × 100, rounded to one decimal, or `null` when there is nothing to count. It also exports `MAX_WRONG_CODES` (5).
- **`AttendanceRealtime`**: attendance's wrapper around `RedisPubSubService`.
  - `publishStaff` and `subscribeSession` use channel `attendance:session:<sessionId>`.
  - `publishPortal` and `subscribePortal` use channel `portal:user:<userProfileId>`.

### Other

- `sse.ts`: `openEventStream(req, reply, subscribe)` takes over (hijacks) the Fastify reply and writes SSE headers. It writes CORS headers by hand using `corsOriginFor` from `src/config/origins.ts`, sends `retry: 5000`, sends a heartbeat every 25 seconds, and unsubscribes when the client disconnects. Every check that can fail must run before you call it, because once the reply is hijacked it can no longer carry an error status.
- `qr.ts`:
  - `newQrSecret()` makes a random per-session secret.
  - `qrWindow(now)` gives the number of the current 15-second window, and `qrToken(secret, window)` gives that window's token: an HMAC of the window number truncated to 22 characters.
  - `verifyQrToken()` accepts the current window and the one before it.
  - `qrClaim()` and `verifyQrClaim()` create and check the 10-minute scan claim, formatted as `<expiry>.<mac>`.
- `geo.ts`: `haversineMeters()` and `withinGeofence()`, with a maximum GPS accuracy allowance of 50 m.
- `attendance.types.ts`: the wire types (`AttendanceSession`, `AttendanceRosterEntry`, `PortalOpenAttendance` and the others) and `ATTENDANCE_STATUSES`. They mirror the attendance section of `frontend/lib/courses/types.ts`, so keep the two in step.

## Used by

- `src/app.module.ts` imports `AttendanceModule`. No other backend module imports it.
- Frontend (staff):
  - `app/dashboard/courses/[courseId]/attendance/page.tsx` (list, summary, export);
  - `.../attendance/_components/TakeAttendanceDialog.tsx` (open);
  - `.../attendance/[sessionId]/page.tsx` (detail, QR, close, records, stream).
- Frontend (student):
  - `app/portal/_components/attendance-store.ts` (`/portal/me/attendance/open` and the `/portal/me/stream` events);
  - `attendance-check-in.tsx` and `app/portal/attendance/scan/page.tsx` (check-in);
  - `app/portal/courses/[courseId]/attendance/page.tsx` (the student's course history);
  - `app/scan/page.tsx` (`/attendance/scan-claim`);
  - `frontend/lib/attendance.ts` and `lib/attendance-scan.ts` (helpers).
- Mobile:
  - `app/attendance/take/[courseId].tsx` (open and QR);
  - `app/attendance/[sessionId].tsx` and `app/attendance/scan.tsx` (check-in);
  - `src/features/attendance/OpenAttendanceCards.tsx` (open sessions);
  - `src/features/course/StudentSections.tsx` (the student's course history);
  - `src/providers/NotificationRouter.tsx` (handles the `attendance.opened` push).
- `backend/scripts/smoke.ts` runs a whole session: open, QR, check in, close, summary.

## Depends on

- `PrismaService` and `CacheService` (both global). The cache holds the wrong-code counters.
- `CourseAccessService` (global, from `src/course/access`): `require()` with `STAFF_ROLES` or `MANAGE_ROLES`, and `requireStudent()`.
- `NotificationsModule`: `PushService.sendToUsers()` (push channel `attendance`).
- `StudentPortalModule`: `StudentGuard`.
- `RedisPubSubService` (from `src/realtime`, global).
- `csvCell` from `src/grading/gradebook.service.ts`.
- `primaryOrigin` and `corsOriginFor` from `src/config/origins.ts`.
- `isoDate` and `isUniqueViolation` from `src/common/db-values`.

## Data

- `course.attendance_session` and `course.course_attendance_record`: read and written. `qr_secret` is only ever selected on its own, never sent out.
- `course.course_student`: read (active enrolments).
- `course.course`: read (published status and name).
- `student.student`: read (names, `user_profile_id`).

Schemas: [`prisma/schema/course.prisma`](../../prisma/schema/course.prisma) and [`prisma/schema/student.prisma`](../../prisma/schema/student.prisma).

## Configuration

| Variable | Effect |
|----------|--------|
| `NODE_ENV` | `test` turns off the 30-second background sweep. |

The app origin used in QR URLs and the allowed CORS origins come from `src/config/origins.ts`.

## Files

| File | Purpose |
|------|---------|
| `attendance.module.ts` | Imports `NotificationsModule` and `StudentPortalModule`, and registers the three controllers and two providers. |
| `attendance.controller.ts` | Staff routes under `/api/courses/:courseId/attendance`. |
| `portal-attendance.controller.ts` | Student routes under `/api/portal/me`. |
| `scan-claim.controller.ts` | The public `POST /api/attendance/scan-claim`. |
| `attendance.service.ts` | All the attendance logic, the finalising and the sweep. |
| `attendance.realtime.ts` | Pub/sub channels and event types. |
| `sse.ts` | `openEventStream` (the SSE response helper). |
| `qr.ts` | Rotating QR tokens and scan claims. |
| `geo.ts` | Distance and geofence maths. |
| `attendance.types.ts` | Wire types and `ATTENDANCE_STATUSES`. |
| `dto/` | Request bodies. See [dto/README.md](./dto/README.md). |
| `attendance.service.test.ts` | Service tests. |
| `qr.test.ts` | QR token and claim tests. |
| `geo.test.ts` | Haversine and geofence tests. |

## Tests

```bash
cd backend && bun test src/attendance
```

- `attendance.service.test.ts` covers:
  - **open**: the 4-digit code and push notification, no-code sessions, the default 100 m radius, a second open giving a conflict, an expired session not blocking a new one, unpublished courses being refused;
  - **check-in**: a wrong code gives 409 and then 429, how long the wrong-code counter lives, a missing code, QR tokens (valid and forged), the late threshold, the geofence, a double check-in, a closed or expired session, a dropped student;
  - **finalising**: idempotence, events sent once, the sweep, finalise-on-read;
  - **setRecord**: overrides and a TA being able to mark but not delete;
  - the summary rate, the CSV formula defusing, `tally`, and the portal views.
- `qr.test.ts` covers token windows, forged tokens and claim binding and expiry.
- `geo.test.ts` covers the distance maths, the antimeridian and the accuracy allowance.

## See also

- `src/realtime/` (the pub/sub bus)
- `src/student-portal/` (`StudentGuard`)
- `src/course/access/` (course roles)
- `src/notifications/` (push)
