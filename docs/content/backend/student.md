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

## Student accounts and RLS

A student logs in with the same email OTP as staff, then redeems a
school-issued claim code that links the login to a `student.student` row and
sets `user_profile.account_type = 'student'`. Students get **no**
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
