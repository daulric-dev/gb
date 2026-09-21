---
sidebar_label: 2026-09-17 · Student accounts
sidebar_position: 1
---

# 2026-09-17 - Student accounts

Students can now hold an account of their own, sign in alongside staff, and see a portal scoped to themselves. Previously a student was only a row in `student.student` - a record staff wrote about, with no way to log in.

Six migrations, delivered in phases. Apply them in order: `20260917120000_student_accounts` → `20260917130000_student_claim_redeem` → `20260917140000_student_rls` → `20260917150000_student_join_requests` → `20260917160000_school_join_code` → `20260917170000_student_membership_revamp`.

## The data model

`public.user_profile` gained `account_type` (`staff` | `student`, default `staff`) and `student.student` gained `user_profile_id`, a nullable link to the login behind the record. The link is uniquely indexed where non-null, so one login can never be two students.

`account_type` is deliberately separate from `role`. A role says what someone may do inside a school; the account type says which application they belong to. Conflating them would have meant inventing a "student" role that every permission check then had to special-case.

## Joining a school

The flow changed twice during the work and settled on the simplest version: **a school-wide join code**, not a code per student.

`student.school_join_code` holds a hashed code per school (`SECURITY DEFINER` RPC `redeem_school_join_code`), which a student enters on `/schools`. Redeeming creates their `student.student` record and links it to their login in one transaction. Staff generate and revoke the code from the students roster.

An admin then reconciles duplicates: a student who joined by code and a record staff had already created for them are merged from the students page, keeping the older record and moving the account link onto it.

### Why it was revamped

The first implementations wrote student membership from three different services, through three RPCs, touching four cache keys. Cache invalidation was missed three times in a row - the visible symptom being students who had joined not appearing on the students page. `20260917170000_student_membership_revamp` collapses this to **one write path and one cache boundary**, so there is a single place that can forget to invalidate, rather than nine.

## Auth and routing

`POST /auth/otp/verify` now returns `account_type` alongside `is_onboarded`, and every entry point routes on it: the web app sends students to `/portal` and staff to `/dashboard`, and the mobile app does the same between its `(portal)` and `(tabs)` groups. The layouts re-check on mount, so a pasted URL cannot drop someone into the wrong application.

An approved applicant now moves into their app **without a reload** - the previous behaviour left them on a "pending" screen until they refreshed by hand.

## The portal API

`/portal/me/*` is a self-scoped API: `StudentGuard` resolves the caller's `studentId` and `schoolId` from their session, and **no endpoint accepts a student id from the request**. Endpoints cover the student's own profile, grades, attendance, report list and report detail. Only published reports are returned.

## Permissions

Students hold **no catalog permissions at all**. `PermissionService` reads `account_type` and short-circuits: a student's effective permission set is empty, so every `@RequirePermission` route is closed to them regardless of role. The portal is reachable only through `StudentGuard`.

This is why later features had to add explicit portal endpoints rather than reusing staff ones - a student cannot call `POST /files`, for instance, so assignment uploads needed their own route.

## RLS holes students inherited

`20260917140000_student_rls` and the phase-8 audit closed policies that were written when every authenticated user was staff.

The most serious was a **privilege escalation**: any authenticated user could `UPDATE user_profile SET role = 'admin'` on their own row, because the update policy checked only `id = auth.uid()`. The policy is now split, and a trigger (`guard_user_profile_privileges`) rejects changes to `role`, `account_type`, `school_id` and `is_active` from a signed-in user, while leaving the rest of the row editable.

A companion trigger guards `student.student.user_profile_id` so a student cannot re-point their record at somebody else's login.

## Throttling

Per-route throttles were sharing buckets. The throttler key was `${throttlerName}:${tracker}` with no route in it, so every endpoint using the same named throttler drained one shared allowance - hitting the limit on one route locked the others. `generateKey` is now route-scoped for non-default throttlers.
