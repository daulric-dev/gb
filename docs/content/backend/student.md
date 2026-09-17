---
sidebar_label: Student
---

# Student Module

**Location**: `backend/src/student/`

The student module manages student records for a school. Students are the core entities who get enrolled in classes, assigned to subjects, and graded on assessments.

## Files

| File | Purpose |
|------|---------|
| `student.module.ts` | Module definition |
| `student.controller.ts` | API endpoints |
| `student.service.ts` | Business logic |
| `dto/create-student.dto.ts` | Validation for creation |
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

### `POST /api/students`

Creates a new student. The school is determined from the authenticated user's profile.

**Body:**
```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "gender": "female",
  "dateOfBirth": "2015-03-15",
  "enrollementDate": "2025-09-01"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `firstName` | Yes | |
| `lastName` | Yes | |
| `gender` | Yes | |
| `dateOfBirth` | No | |
| `enrollementDate` | No | |

**Error Handling:**
- Duplicate name within the same school → `409 Conflict`

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
  their login and binds their profile to the school - nobody has to add them to
  the roster first.

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

### Duplicates

A code cannot know who someone is, so a student already on the roster gets a
second record. `student_duplicate_candidates` finds those pairs - a linked
record with no results alongside an unlinked one under the same name - and the
Students page offers a merge. `merge_student_records` moves the login onto the
record holding the history and drops the empty one, refusing if the record
being discarded has any grades, attendance, enrolments or reports.

Anyone holding the code can join, which expiry and revocation are the controls
for.

## Student accounts and RLS

A student logs in with the same email OTP as staff and picks "Student" at
onboarding, then joins a school one of two ways:

- **Join request.** They pick the school on `/schools` and
  request to join, exactly as staff do. An admin approves under
  **Staff -> Pending Members** and, in the same dialog, either links them to
  the student record the school already has or creates a new one.
- **School join code (the usual path).** Staff issue one code for the whole
  school (**Students -> School join code**). Any student who has it joins by
  entering it, and redemption creates their student record - nobody has to add
  them to the roster first. The code is reusable until it expires or is
  revoked, so anyone holding it can join, and a student already on the roster
  gets a second record rather than being matched to the first.
- **Per-student claim code.** Issued against one existing roster row
  (**Students -> Account -> Claim code**) and redeemed at `/claim`. Use it when
  the student already has a record and their history must stay attached.

Either way the login ends up linked to a `student.student` row with
`user_profile.account_type = 'student'`.

Approval matters because of reconciliation: grades and attendance are keyed to
`student.student.id`, so a self-joining student who is already on the roster
must be matched to that row or their history is stranded on a record nobody is
linked to. `approve_student_join_request` does the match, the profile update
and the request close in one transaction. Students get **no**
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

Verify with `bun run rls:check` (from `backend/`, against a local Supabase).
Unit tests mock Supabase, so policies never execute there.
