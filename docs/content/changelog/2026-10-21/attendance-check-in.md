---
sidebar_label: 2026-10-21 · Attendance with self check-in
sidebar_position: 2
---

# 2026-10-21 - Attendance with self check-in

Attendance is per course and students check themselves in, PointSolutions-style.

## Flow

1. A teacher or TA presses **Take attendance** in a published course and picks a window (2-60 min), whether a 4-digit room code is required, an optional "late after N minutes", and an optional location check (their device's position plus a radius).
2. Every enrolled student with an account gets a **push notification** on the app and a banner in the web portal.
3. The teacher's live screen shows the code large, a **rotating QR code**, a countdown, and the roster filling in live. "Present" goes fullscreen for a projector.
4. Students check in by scanning the QR (phone camera or the in-app scanner), typing the code, or tapping the notification. Status is present, or late past the threshold.
5. When the window closes, everyone who did not check in is marked **absent**. Teachers can override any record (present / late / absent / excused) at any time.

Courses get attendance history, per-student rates and CSV export; students see their own record.

## Anti-cheating

- The room code is never sent to students.
- The QR changes every **15 seconds** (an HMAC of a per-session secret and the time window); the current and previous window are accepted. A photo forwarded outside the room stops working almost at once.
- Five wrong codes lock a student out of that session.
- The optional location check refuses check-ins outside the radius ("too far from the classroom").
- One open session per course.

## Scanning while signed out

Scanning opens the public `/scan` page, which swaps the 15-second token for a **10-minute claim** bound to that session before sending the student through sign-in. Getting a claim still needs a live token, so it buys time to sign in without widening the window for passing the code on.

## Configuration

- Push: `eas init` (Expo project id), APNs/FCM credentials via EAS, and a native rebuild. Optional `EXPO_ACCESS_TOKEN`.
- QR links use the first `FRONTEND_URL`; it must be an address phones can open.
- Web location checks need `Permissions-Policy: geolocation=(self)` (set in `frontend/next.config.ts`).
- With more than one API instance, `USE_REDIS=true` so live updates reach every instance.

## Endpoints

Staff: `/api/courses/:courseId/attendance/sessions` (list, open), `.../:sessionId` (detail, close, delete), `.../records/:studentId` (override), `.../qr` (current QR frame), `.../stream` (live SSE), `/summary`, `/export`.
Students: `/api/portal/me/attendance/open`, `.../:sessionId/check-in` (`code`, `qrToken` or `qrClaim`, optional `location`), `/api/portal/me/courses/:courseId/attendance`, `/api/portal/me/stream`.
Public: `POST /api/attendance/scan-claim`. Devices: `POST/DELETE /api/notifications/devices`.

Migrations: `20261021120000_course_attendance.sql`, `20261021130000_attendance_qr.sql`.
