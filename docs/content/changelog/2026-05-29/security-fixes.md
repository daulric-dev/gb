---
sidebar_label: 2026-05-29 · Security fixes
sidebar_position: 1
---

# 2026-05-29 - Security fixes

A follow-up security audit surfaced a batch of authorization and input-validation issues, all fixed in this release. The fixes are backend-only; no migrations are required.

## Attendance IDOR

The attendance service issued service-client (RLS-bypassing) queries keyed off `recordId` alone, and the roster endpoint had no ownership check at all. `ClassTeacherGuard` authorized against the `:classId` in the URL, but the service never confirmed that the record being touched actually belonged to that class.

### Attendance update IDOR

`PATCH /classes/:classId/attendance/:recordId` updated by record id only. A teacher of class A could pass any `recordId` from class B (including another school) and overwrite it.

**Fix.** [attendance.service.ts](../../../../backend/src/attendance/attendance.service.ts) `update` now takes `classId` and adds `.eq('student_group_id', classId)` to the update. [attendance.controller.ts](../../../../backend/src/attendance/attendance.controller.ts) plumbs the `classId` param through.

### Attendance delete IDOR

`DELETE /classes/:classId/attendance/:recordId` had the same defect: the lookup and delete were both keyed on `recordId` only, so any teacher could delete any attendance record by iterating ids.

**Fix.** [attendance.service.ts](../../../../backend/src/attendance/attendance.service.ts) `delete` now takes `classId` and adds `.eq('student_group_id', classId)` to both the lookup and the delete. The controller plumbs `classId` through.

### Attendance roster missing authorization

`GET /classes/:classId/attendance?date=` was guarded only by the class-level `AuthGuard`, with no ownership check, unlike the sibling `studentRange` and `studentSummary` endpoints. Any authenticated user could read any class's roster (student names plus attendance) for any `classId`.

**Fix.** [attendance.controller.ts](../../../../backend/src/attendance/attendance.controller.ts) `roster` now calls `assertCanViewClass(req.user.id, classId)` before reading, matching the per-student report endpoints.

## Avatar object IDOR

`completeResumableUpload` trusted a client-supplied storage `path` and only checked `exists(path)`, so a user could point their profile avatar at any object in the `images` bucket (and have it served back via the service-role download).

**Fix.** [images.service.ts](../../../../backend/src/images/images.service.ts) now calls `assertOwnedPath(userId, path)`, which requires the path to equal the caller's canonical `avatars/<userId>.<ext>`. `extractStoragePath` additionally rejects any stored URL that is not a traversal-free `avatars/...` object.

## Avatar content-type spoofing

Direct avatar uploads trusted the client-declared `file.mimetype` and skipped validation entirely when it was absent, with no inspection of the actual bytes.

**Fix.** [images.service.ts](../../../../backend/src/images/images.service.ts) now rejects a missing or non-allowed mimetype and verifies the buffer's magic bytes against the declared format (JPEG, PNG, WebP) before storing.

## Deactivated users retained access

`is_active` was only enforced in `AdminGuard`. A deactivated user kept a valid session and continued to pass `AuthGuard` and `ClassTeacherGuard`, so deactivation did not revoke teacher access.

**Fix.** [auth.guard.ts](../../../../backend/src/auth/auth.guard.ts) now loads the profile's `is_active` and rejects the request when it is explicitly `false`, so all downstream guards inherit the check.

## Admin self-elevation via onboard / join request

The `onboard` and `createJoinRequest` flows had an "orphaned school takeover" rule that granted `admin` to the first user to onboard into any school that had no admin yet, based on a client-supplied `schoolId` with no invite or domain check. (The onboard path also inserted a malformed `admi-` role.)

**Fix.** Both flows now always create a join request that an existing admin must approve. Admin rights are only ever granted to the user who creates a school ([auth.service.ts](../../../../backend/src/auth/auth.service.ts), [school.service.ts](../../../../backend/src/school/school.service.ts)). A genuinely orphaned school is now handled administratively rather than by self-service claim.

## Per-student calculation and report IDOR

`/calculations/student-term`, `/calculations/student-year`, and report generation accepted a `studentId` and returned that student's data after authorizing only against `studentGroupId`, without confirming the student belonged to the class.

**Fix.** [calculation.service.ts](../../../../backend/src/calculation/calculation.service.ts) `calculateStudentTermResult` and `calculateStudentYearResult` now call `assertStudentInGroup`, which verifies enrollment in `studentGroupId` before returning anything. Report generation inherits this because it calls through the same methods.

## Spoofable rate-limit identity

`getClientIp` read the leftmost (fully client-controlled) `X-Forwarded-For` entry under `trustProxy: true`, so an attacker could rotate rate-limit buckets and bypass throttling.

**Fix.** [app.module.ts](../../../../backend/src/app.module.ts) now prefers the `X-Real-IP` header that nginx sets to the true peer, falling back to the rightmost `X-Forwarded-For` entry (the one our proxy appends) instead of the leftmost.

## Other

- Fixed a swallowed `BadRequestException` in `onboard` that was constructed but never thrown, silently masking a failed profile upsert ([auth.service.ts](../../../../backend/src/auth/auth.service.ts)).

## Tests

Full suite: 103 passing. Typecheck clean.

## Still open from the same audit

- No security headers are set (no `@fastify/helmet`), and avatars are served from a public bucket; consider `nosniff` / `Content-Disposition: attachment` on avatar responses ([createApp.ts](../../../../backend/src/createApp.ts)).
- The Fastify multipart `fileSize` limit (10 MB) is double the app's 5 MB avatar maximum, and the resumable flow trusts a client-declared `totalSize` ([createApp.ts](../../../../backend/src/createApp.ts), [images.service.ts](../../../../backend/src/images/images.service.ts)).
