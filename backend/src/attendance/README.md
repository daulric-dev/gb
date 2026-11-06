# Attendance (`src/attendance`)

This module handles course attendance with student self check-in. A member of the course staff opens a short **attendance session** for a published course. Students check themselves in from the student portal (web or mobile) in one of two ways:

- typing the 4-digit code shown in the room, or
- scanning a rotating QR code on the teacher's screen.

A session can also have a geofence, in which case the student's location must be close enough to the classroom. **The geofence is advisory**: see [Location is advisory](#location-is-advisory). When the session closes, every active student who has not checked in is recorded as `absent` (`method: 'auto'`). Staff can override any record at any time, see each student's attendance rate, and export a CSV. Live updates are sent over Server-Sent Events, backed by the Redis pub/sub bus, and students also get a push notification when a session opens.

Closing a session ("finalising") is idempotent and can happen in three ways:

1. a member of staff closes it early;
2. the background sweep, which runs every 30 seconds in each process (except when `NODE_ENV=test`), finds a session past its window;
3. any read of an expired session notices it first.

Only the call that actually sets `closed_at` sends the "closed" events.

## What it provides

### HTTP routes

**`AttendanceController`** (`/api/courses/:courseId/attendance`) is guarded by `AuthGuard` and `FeatureGuard` (the `attendance` feature; [`src/features`](../features/README.md)). `PortalAttendanceController` (including `/portal/me/stream`) needs it too, and the public `POST /attendance/scan-claim` checks it for the session's course's school. Pushes go through `PushService`, which skips schools with `push_notifications` off. Access is the caller's role in the course, checked with `CourseAccessService.require()`. All ids must be UUIDs.

| Method | Path | Who may call | What it does |
|--------|------|--------------|--------------|
| GET | `/api/courses/:courseId/attendance/sessions` | Course staff (`admin`, `teacher`, `ta`) | Lists the course's sessions, newest first, with counts. Expired sessions are finalised first. |
| POST | `/api/courses/:courseId/attendance/sessions` | Course staff | Opens a session (`OpenAttendanceDto`). Gives 409 when the course is not published, or when a session is already open (a unique index allows one open session per course). A random 4-digit code is generated unless `requireCode: false`, and a per-session QR secret is always created. Active students get a push notification and an `attendance.opened` portal event. |
| GET | `/api/courses/:courseId/attendance/sessions/:sessionId` | Course staff | The session with its roster. While the session is open, the roster is every active student. Once closed, it is whoever has a record. |
| GET | `/api/courses/:courseId/attendance/sessions/:sessionId/qr` | Course staff | The current QR frame: `{ token, url, rotatesAt, windowMs }`. `url` is `<primary origin>/scan?s=<sessionId>&t=<token>`. Gives 409 when the session is closed. |
| PATCH | `/api/courses/:courseId/attendance/sessions/:sessionId/location` | Course staff (same as open / close) | Live teacher position (`UpdateSessionLocationDto`: `latitude`, `longitude`, optional `accuracy`). Moves an open session's point and sets `location_updated_at`; 200 with `{ location, locationUpdatedAt }` and an `attendance.location` staff event. A reading with `accuracy` over 100 m is ignored: 204, the point stays. 409 when the session is closed or has no location check. At most one update per session every 5 s (`SESSION_LOCATION_MIN_INTERVAL_MS`), enforced atomically by the update itself (it only matches a point older than that), else 429. Not audit-logged, like opening and closing. |
| POST | `/api/courses/:courseId/attendance/sessions/:sessionId/close` | Course staff | Closes the session early and marks the absentees. Closing an already-closed session just returns it. |
| DELETE | `/api/courses/:courseId/attendance/sessions/:sessionId` | Course `admin` or `teacher` (`MANAGE_ROLES`) | Deletes the session (204) and its attendance records, with an `attendance_session` entry in the [erasure log](../erasure/README.md) in the same transaction. If it was open, an `attendance.closed` portal event takes the students' banner down. |
| PATCH | `/api/courses/:courseId/attendance/sessions/:sessionId/records/:studentId` | Course staff | Sets one student's status and note (`SetAttendanceRecordDto`, `method: 'teacher'`), whether the session is open or closed. Sends an `attendance.record` event. |
| GET | `/api/courses/:courseId/attendance/sessions/:sessionId/stream` | Course staff | SSE stream of `attendance.record` events (one per check-in or change, and again for an earlier check-in when it gains `duplicate_coords`), `attendance.location` when the point moves, then `attendance.closed`. |
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
| POST | `/api/attendance/scan-claim` | Anyone. Throttled: `claim-code` 300/min (keyed by IP for anonymous callers), plus a loose backstop of `MAX_SCAN_CLAIMS_PER_IP` (60) claims per session and address per claim lifetime. | Swaps a live QR token (`ScanClaimDto`) for a single-use `claim` that lasts 5 minutes, so a student who scanned while signed out can sign in and then check in. Sets (or reuses) the `gb_scan_device` cookie and binds the claim to it. |

### Check-in rules (`AttendanceService.checkIn`)

1. The session must exist, the student must be an **active** student of a published course (`requireStudent` with `allowArchived: false`), and the session must still be open. If any of these fails, the student sees a 404 or a 409.
2. If the student already has a record, the answer is 409.
3. A `qrToken` or `qrClaim` takes the place of the code. The token must be from the current or the previous 15-second window, and the method is recorded as `qr`. A claim must be presented with the same `gb_scan_device` cookie it was minted for; from any other device (or with no cookie) the answer is 403 "This scan was started on another device...", and the claim is not used up.
4. Otherwise, if the session has a code, it must match. Each wrong code increments the cache counter `attendance:wrong-code:<sessionId>:<studentId>`. After 5 wrong codes the answer is 429. A missing code is a 400 and does not count as a wrong attempt.
5. If the session has a location, the student's `location` is required, and it is checked **before** the code or QR (so a location retry costs no code attempt). A `location.mocked: true` (the app sends Android's `LocationObject.mocked`) is refused with 403 "Turn off mock location to check in". The student must be within `radius_m + min(accuracy, 50 m)` of the session's **current** point (staff may have moved it, see the live position route), or the answer is 403. The record keeps the reported `latitude`, `longitude`, `accuracy_m`, the rounded `distance_m` and `location_flags` (below). Sessions without a location check keep no coordinates, even if the client sent some.

### Live teacher position

The session point is the teacher's device position at open (`location_updated_at` = `opened_at`). While the session is open, the session page (web, `navigator.geolocation.watchPosition`) and the live screen in the app (`Location.watchPositionAsync`, foreground only - no background location) send a newer point through `PATCH .../location` every 30 s, or sooner after moving more than 20 m, never closer than the 5 s throttle and never with a fix worse than 100 m. Check-ins always measure from the current point. Sharing is on by default only for the staff member who opened the session (`openedBy`), so two staff screens don't pull the point back and forth; anyone can switch it on or off, and when off the last point stays. `AttendanceSession.locationUpdatedAt` tells the screens when it last moved.

### Location is advisory

`geo.ts` checks coordinates the **client sends**: the browser's Geolocation API or the phone's location service, reported by the student's own device. Nothing signs or attests them, and they are trivially spoofed (a mock-location app on Android, a location override in browser developer tools, or simply posting made-up numbers to the check-in route). The geofence therefore only deters casual check-ins from outside the room and gives staff a distance to look at; it is **not** evidence of presence and no security decision should rest on it.

Two things make faking it more effort and more visible, without changing that:

- **Mock-location refusal (Android only).** Android tells the app when the position comes from a mock-location provider, and the app sends it as `mocked`; `true` is refused. Browsers and iOS cannot tell, and a modified client can simply leave the field out.
- **Suspicious-reading flags** (`location-flags.ts`), recorded in `attendance_record.location_flags` and shown to staff (roster entries carry `locationFlags` and `accuracyM`; no portal response, webhook or CSV includes them). They are never used to refuse a check-in, because real phones produce these too:
  - `exact_point`: under 1 m from the session point (coordinates copied from the teacher's device);
  - `duplicate_coords`: the same latitude and longitude to 6 decimals as another check-in in the session. Checked by a query just after the insert, so of two simultaneous check-ins at least the later one sees the other; the earlier record is flagged too and re-sent to staff;
  - `zero_accuracy`: accuracy reported as 0, or missing from the app (`X-GradeBook-Client: native`, which always reports it);
  - `low_precision`: both coordinates have 3 decimals or fewer (typed in by hand).

The proof of presence is the **QR token or the room code**: both are shown only on the teacher's screen in the room, the QR rotates every 15 seconds, the code allows five wrong tries, and a scan claim only redeems on the device that scanned (see the scan-device cookie below). Staff who need certainty should keep one of them on and compare the list against the room.
6. The status is `late` when the student checks in more than `late_after_minutes` after the session opened, and `present` otherwise. An `attendance.record` event is sent to staff.

### Services / exports

The module exports nothing. Its providers are:

- **`AttendanceService`**:
  - staff: `list`, `open`, `detail`, `qr`, `close`, `updateLocation`, `remove`, `setRecord`, `summary`, `exportCsv`, `assertSession`;
  - portal: `openForStudent`, `checkIn`, `courseForStudent`, `scanClaim`;
  - finalising: `finalize`, `finalizeExpired(courseId?)`, `sweep`.
  - It also exports the helper `tally(records)`: the rate is (present + late) / (records − excused) × 100, rounded to one decimal, or `null` when there is nothing to count. It also exports `MAX_WRONG_CODES` (5), `MAX_SESSION_FIX_ACCURACY_M` (100), `SESSION_LOCATION_MIN_INTERVAL_MS` (5000) and `MOCK_LOCATION_MESSAGE`.
- **`AttendanceRealtime`**: attendance's wrapper around `RedisPubSubService`.
  - `publishStaff` and `subscribeSession` use channel `attendance:session:<sessionId>`.
  - `publishPortal` and `subscribePortal` use channel `portal:user:<userProfileId>`.

### Other

- `sse.ts`: `openEventStream(req, reply, subscribe)` takes over (hijacks) the Fastify reply and writes SSE headers. It writes CORS headers by hand using `corsOriginFor` from `src/config/origins.ts`, sends `retry: 5000`, sends a heartbeat every 25 seconds, and unsubscribes when the client disconnects. Every check that can fail must run before you call it, because once the reply is hijacked it can no longer carry an error status.
- `qr.ts`:
  - `newQrSecret()` makes a random per-session secret.
  - `qrWindow(now)` gives the number of the current 15-second window, and `qrToken(secret, window)` gives that window's token: an HMAC of the window number truncated to 22 characters.
  - `verifyQrToken()` accepts the current window and the one before it.
  - `qrClaim()` and `verifyQrClaim()` create and check the 5-minute scan claim, formatted as `<expiry>.<nonce>.<device>.<mac>`, where `<device>` is `claimDeviceTag()`: an HMAC of the scan-device id under the session secret (never the id itself), covered by the MAC. `readQrClaim()` returns its nonce and device tag; `claimFromDevice()` compares the tag with the presented cookie. On check-in the nonce is recorded with `CacheService.setIfAbsent` and bound to the first student who redeems it; anyone else using the same claim is refused. The wrong-code counter uses the atomic `CacheService.incr`, reserving the attempt before comparing.
- `scan-device.ts`: the `gb_scan_device` cookie - a random 128-bit id, `HttpOnly`, `Secure` when auth cookies are (production), `SameSite=Lax`, host-only, `Path=/api`, one year. `POST /attendance/scan-claim` sets it (reusing a well-formed existing one) and the portal check-in reads it, never from the body. A whole class behind one school NAT each gets its own device id, which is why the per-address limit is only a backstop (60, was 3).
- `geo.ts`: `haversineMeters()` and `withinGeofence()`, with a maximum GPS accuracy allowance of 50 m. The coordinates are client-reported and spoofable; see [Location is advisory](#location-is-advisory).
- `location-flags.ts`: `LOCATION_FLAGS`, `readingFlags()` (the single-reading flags), `coordKey()` (6-decimal key for `duplicate_coords`), `decimals()` and `normaliseFlags()`.
- `attendance.types.ts`: the wire types (`AttendanceSession`, `AttendanceRosterEntry`, `PortalOpenAttendance` and the others) and `ATTENDANCE_STATUSES`. They mirror the attendance section of `frontend/lib/courses/types.ts`, so keep the two in step.

## Used by

- `src/app.module.ts` imports `AttendanceModule`. No other backend module imports it.
- Frontend (staff):
  - `app/dashboard/courses/[courseId]/attendance/page.tsx` (list, summary, export);
  - `.../attendance/_components/TakeAttendanceDialog.tsx` (open);
  - `.../attendance/[sessionId]/page.tsx` (detail, QR, close, records, stream);
  - `.../attendance/_components/live-location.tsx` (live position and the flag badge), with `lib/attendance-location.ts`.
- Frontend (student):
  - `app/portal/_components/attendance-store.ts` (`/portal/me/attendance/open` and the `/portal/me/stream` events);
  - `attendance-check-in.tsx` and `app/portal/attendance/scan/page.tsx` (check-in);
  - `app/portal/courses/[courseId]/attendance/page.tsx` (the student's course history);
  - `app/scan/page.tsx` (`/attendance/scan-claim`);
  - `frontend/lib/attendance.ts` and `lib/attendance-scan.ts` (helpers).
- Mobile:
  - `app/attendance/take/[courseId].tsx` (open, QR, live position, flags), with `src/features/attendance/use-live-teacher-location.ts` and `src/lib/attendance-location.ts`;
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
| `scan-device.ts` | The `gb_scan_device` cookie that binds a scan claim to one device. |
| `geo.ts` | Distance and geofence maths. |
| `location-flags.ts` | Suspicious-reading flags for check-in locations. |
| `attendance.types.ts` | Wire types and `ATTENDANCE_STATUSES`. |
| `dto/` | Request bodies. See [dto/README.md](./dto/README.md). |
| `attendance.service.test.ts` | Service tests. |
| `qr.test.ts` | QR token and claim tests. |
| `scan-device.test.ts` | The scan-claim route sets or reuses the device cookie and binds the claim to it. |
| `geo.test.ts` | Haversine and geofence tests. |

## Tests

```bash
cd backend && bun test src/attendance
```

- `attendance.service.test.ts` covers:
  - **open**: the 4-digit code and push notification, no-code sessions, the default 100 m radius, a second open giving a conflict, an expired session not blocking a new one, unpublished courses being refused;
  - **check-in**: a wrong code gives 409 and then 429, how long the wrong-code counter lives, a missing code, QR tokens (valid and forged), the late threshold, the geofence, a double check-in, a closed or expired session, a dropped student;
  - **live position** (`updateLocation`): moving the point and the staff event, staff-only access, closed and location-less sessions (409), the 100 m accuracy filter (204), the 5 s throttle (429), and check-ins measured against the moved point;
  - **location readings**: a mocked reading refused without using a code attempt, stored coordinates/accuracy/distance, each flag (including the earlier record flagged when a later duplicate arrives), flags never in student responses, no coordinates kept without a location check;
  - **finalising**: idempotence, events sent once, the sweep, finalise-on-read;
  - **setRecord**: overrides and a TA being able to mark but not delete;
  - the summary rate, the CSV formula defusing, `tally`, and the portal views.
- `qr.test.ts` covers token windows, forged tokens and claim binding (session, secret, device) and expiry.
- `scan-device.test.ts` covers the device cookie's attributes, reuse, and malformed values.
- `attendance.service.test.ts` also covers a claim forwarded to another device (403, claim not used up) and a whole class claiming from one address.
- `geo.test.ts` covers the distance maths, the antimeridian and the accuracy allowance.

## See also

- `src/realtime/` (the pub/sub bus)
- `src/student-portal/` (`StudentGuard`)
- `src/course/access/` (course roles)
- `src/notifications/` (push)
