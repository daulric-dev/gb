---
sidebar_label: Student
---

# Student Module

**Location**: `backend/src/student/`

The student module manages student records for a school. Students are the core entities who get enrolled in courses and graded on their work.

Staff never create student records. A user signs up, onboards as a student and redeems the school's join code (`POST /api/auth/join-school`), or signs in with a school's verified student email domain; either creates their record, linked to their login. This module lists, shows and edits those records.

## Files

| File | Purpose |
|------|---------|
| `student.module.ts` | Module definition |
| `student.controller.ts` | API endpoints |
| `student.service.ts` | Business logic |
| `dto/update-student.dto.ts` | Validation for updates |

## Data Model

Students are stored in the `student` schema (not `public`).

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `first_name` | string | Student's first name |
| `last_name` | string | Student's last name |
| `gender` | string | Student's gender |
| `date_of_birth` | date? | Optional date of birth |
| `school_id` | UUID | The school the student belongs to |
| `is_active` | boolean | Whether the student is currently active |
| `enrollment_date` | date? | Optional enrollment date |

## API Endpoints

All endpoints require `AuthGuard`. Students are automatically scoped to the user's school.

### `GET /api/students`

Returns all students for the user's school.

**Query Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `search` | No | Search by first or last name (case-insensitive partial match) |

**Response:** Array of student objects.

---

### `GET /api/students/:id`

Returns a single student by ID.

---

### `PATCH /api/students/:id`

Updates a student. All fields are optional, plus `isActive` can be toggled.

**Body:**
```json
{
  "firstName": "Jane",
  "isActive": false
}
```

## Student accounts

A student logs in with the same email OTP as staff, picks "Student" at
onboarding, and joins with the school's join code. There is exactly one way in.

- **Issue the code.** Staff open **Students -> School join code**. One live
  code per school; reissuing supersedes it, and it lapses on its expiry
  (14 days by default) or when revoked. Only a keyed hash is stored, so a lost
  code is reissued rather than recovered. Gated on `student:create`, because
  redeeming one creates a student.
- **Redeem it.** The student enters it on `/schools`, which shows them the code
  field alone. Redemption creates their `student.student` row, links it to
  their login and binds their profile to the school. There is no staff route
  for creating a student record.

Students get no `school_management` row and no catalog permissions, so
`PermissionGuard` denies every staff route; their access comes from
`StudentGuard` and `/portal/me/*`. Join requests are staff only.

### One write path

`StudentMembershipService` is the only thing that writes student membership,
and every write ends at its private `finalise()`. This is not tidiness: the
work used to be spread over three services with three RPCs, each responsible
for invalidating four cache keys by hand. Misses were silent and long-lived,
because `profile:<id>` and `students:<school>` hold for thirty days - a student
could be fully joined yet stranded on the join screen, or missing from the
roster, with nothing in the logs.

Anyone holding the code can join, which expiry and revocation are the controls
for.

## Student accounts and RLS

A student logs in with the same email OTP as staff, picks "Student" at
onboarding and redeems the school join code (see above), or is placed by a
verified student email domain. Either way the login ends up linked to a new
`student.student` row with `user_profile.account_type = 'student'`; staff
cannot create student records,
and the old per-student claim codes, join-request linking and duplicate merging
are gone. Students get **no**
`school_management` row and **no** catalog permissions, so `PermissionGuard`
denies them every staff route; their access comes from `StudentGuard` and the
self-scoped `/portal/me/*` endpoints.

Because the API reaches Postgres through the service client, RLS never runs in
normal operation - it is the layer that has to hold if a user ever talks to
PostgREST directly with their own JWT. The original policies keyed off
`school_id = get_user_school_id()`, which a claimed student satisfies, so
before `20260917140000_student_rls.sql` a student session could read the whole
roster, edit and delete classmates, and set its own `role` to `admin`.

Policies now distinguish staff from students via `public.is_staff()`, and two
triggers guard columns that RLS cannot gate per-column:

- `guard_user_profile_privileges` - `role`, `account_type`, `school_id` and
  `is_active` may only change under the service role.
- `guard_student_account_link` - `student.user_profile_id` may only change
  under the service role, so a student cannot re-point their record.

The API connects as a privileged role, so these policies are a backstop for
direct database clients only; they are being dropped with the move off the
hosted database (see `platform-migration.md`). The API's own guards are what
enforce access, and its tests cover them.
