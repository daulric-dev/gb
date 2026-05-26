---
sidebar_label: 2026-05-24 · High-severity fixes
sidebar_position: 4
---

# 2026-05-24 - High-severity fixes

Follow-up batch to [the morning's critical fixes](./security-fixes.md). All Highs from the same audit, fixed in one pass. One new migration (`20260524180200_one_admin_per_school.sql`); the rest is backend + nginx code.

## `PATCH /auth/profile` accepted arbitrary `schoolId`

`UpdateProfileDto.schoolId` was just `@IsString()` and `auth.service.updateProfile` wrote `school_id = dto.schoolId` straight to `user_profile` with no membership check. A user could attach themselves to any school by id, inheriting that school's RLS scope.

**Fix.** Removed `schoolId` entirely from [update-profile.dto.ts](../../../../backend/src/auth/dto/update-profile.dto.ts) and the corresponding handling in [auth.service.ts](../../../../backend/src/auth/auth.service.ts) `updateProfile`. School changes must go through `school.createJoinRequest`, which checks membership.

## ClassTeacherGuard / verifyClassTeacher admin bypass

Both the [`ClassTeacherGuard`](../../../../backend/src/class/class-teacher.guard.ts) and the [`CalculationController.verifyClassTeacher`](../../../../backend/src/calculation/calculation.controller.ts) helper short-circuited on `user_profile.role === 'admin'` without checking which school owned the class. A platform admin in school A could perform class-teacher actions against a class in school B by guessing class ids.

**Fix.** The admin bypass now resolves the class's school via `student_group → academic_year → school_id` and only returns true when it matches the caller's `user_profile.school_id`. Cross-school admin attempts log a warning and 403.

## `/calculations/student-term` and `/student-year` had no auth check

Both endpoints accepted `studentId` directly with only the `AuthGuard` (any authenticated user). Their sibling endpoints `class-term`, `class-year`, `class-summary` already called `verifyClassTeacher`; these two were just missed.

**Fix.** Both now call `verifyClassTeacher(req.user.id, studentGroupId)` before computing the result. Combined with the bypass fix above, this restricts access to the class teacher of `studentGroupId` (or an admin of that class's school).

## First-admin race in onboarding and join-request

The "first joiner takes ownership of an orphan school" bootstrap rule in both [`auth.service.onboard`](../../../../backend/src/auth/auth.service.ts) and [`school.service.createJoinRequest`](../../../../backend/src/school/school.service.ts) was a non-transactional check-then-insert. Two concurrent requests could both observe "no admin yet" and both succeed - leaving the school with two admins.

**Fix.**

- New migration [20260524180200_one_admin_per_school.sql](https://github.com) adds a partial unique index:
  ```sql
  CREATE UNIQUE INDEX school_management_one_admin_per_school
    ON public.school_management (school_id)
    WHERE role = 'admin';
  ```
  The second concurrent insert now fails with PostgreSQL error code `23505`.
- Both service methods reordered to **claim school_management before elevating `user_profile.role`**, so a lost race leaves no half-state behind.
- A `23505` from the admin insert is now treated as "race lost" and the request falls through to the normal join-request path. Any other error still bubbles up as 4xx.

## Avatar upload path injection

`POST /auth/avatar` and `POST /auth/avatar/resumable` took a client-controlled `pathname` (query param / DTO field) that became the directory prefix in the avatars bucket. Combined with the filename-supplied extension, a client could store files at arbitrary paths within the bucket.

**Fix.** Dropped `pathname` from both endpoints entirely. [images.service.ts](../../../../backend/src/images/images.service.ts) now always writes to `avatars/${userId}.${ext}`. File extensions are passed through `safeExtension()` - lowercase, alphanumerics only, max 8 chars; anything else falls back to `jpg`. The `CreateResumableUploadDto.pathname` field is removed.

## nginx hardening

[infrastructure/nginx/default.conf](../../../../infrastructure/nginx/default.conf):

- `X-Real-IP` now uses `$remote_addr` (the actual TCP peer) instead of `$host` (the attacker-controlled Host header). Downstream rate-limiting and audit logging now key off a real IP.
- `server_tokens off` - no more leaking the nginx version in `Server:` headers or default error pages.
- `client_max_body_size 16m` - matches the 5MB avatar/PDF cap with headroom, instead of the implicit 1MB default that silently 413'd valid requests.
- `X-Forwarded-Proto` is now set from the upstream `X-Forwarded-Proto` header when present (e.g. from Cloudflare), falling back to `$scheme` otherwise.
- Always-on response headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(), microphone=(), camera=()`.
- Added a fully-formed (but commented-out) `:443` server block as a template for when a certificate is provisioned for the deploy hostname. **No TLS termination changes were made** - keep the existing TLS terminator (Cloudflare / ALB / whatever's in front) doing its job until a real cert is in place here. When you uncomment the 443 block, also uncomment the `return 301 https://$host$request_uri;` line in the `:80` block to redirect plaintext traffic.

## Deploy order

1. Apply the new migration to Supabase.
2. Deploy the backend.
3. Reload nginx (or rebuild the container image - `nginx -t && nginx -s reload`).

## CSRF (verified, not vulnerable)

The audit flagged CSRF as "needs verification" because [frontend/lib/api.ts:41](../../../../frontend/lib/api.ts) uses `credentials: "include"` against the NestJS backend without sending an explicit anti-CSRF token. After re-reading the backend cookie config:

[supabase.service.ts:36-38](../../../../backend/src/supabase/supabase.service.ts) sets the session cookie with `sameSite: 'lax'`, `httpOnly: true`, and `secure: true` in production. `SameSite=Lax` means browsers will not send the cookie on cross-site `POST` / `DELETE` requests originating from third-party pages - which is the exact scenario CSRF exploits. The route also requires a `cookie` header that an attacker page can't forge.

No code change needed. If the cookie ever loses `SameSite=Lax`, add a CSRF token before flipping it.

## Tests

- `auth.service.test.ts` updated to drop the now-removed `schoolId` field from the `updateProfile` test case.
- Full suite: 101 passing.

## Still open from the same audit

These are Medium / Low and not in this batch:

- `SECURITY DEFINER` helpers lacking `SET search_path` - already addressed in the [critical-fixes migration](./security-fixes.md#cross-school-admin-rls-bypass).
- OTP / account-deletion rate limit too coarse - needs a per-email `@Throttle()` decorator on the relevant routes.
- `enrollment.enroll` doesn't verify the student belongs to the class's school.
- `student.service` `.or()` filter interpolates `search` without escaping `,()%` - DoS / weird-query surface only; cross-school exfil is already blocked by the AND'd school filter.
- `BulkGradeDto` has no `@ArrayMaxSize` and `score` has no `@Max` - unbounded payloads.
- `worker.ts` Cloudflare entrypoint doesn't register `@fastify/cookie` - Supabase cookie writes silently fail there if this entrypoint is ever used.
- `docker-compose.yml` mounts the nginx config from a wrong relative path → container would boot with stock default config exposing the welcome page.
- OTP verify auto-submits on paste.
- Onboard/pending page double-decodes `searchParams.get('school')`.
