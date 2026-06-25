---
sidebar_label: School
---

# School Module

**Location**: `backend/src/school/`

The school module manages schools, school membership, and join requests. Schools are the top-level organizational unit - every user belongs to a school via a `school_management` row, and all data (students, subjects, classes) is scoped to a school.

## Files

| File | Purpose |
|------|---------|
| `school.module.ts` | Module definition |
| `school.controller.ts` | API endpoints |
| `school.service.ts` | Business logic |
| `dto/create-school.dto.ts` | Validation for school creation |
| `dto/create-join-request.dto.ts` | Validation for submitting a join request |
| `dto/approve-join-request.dto.ts` | Validation for approving a join request |

Related guard:

| File | Purpose |
|------|---------|
| `backend/src/auth/admin.guard.ts` | `AdminGuard` - restricts endpoints to users whose `user_profile.role` is `admin` and `is_active = true` |

## Membership Model

Three tables work together to track who belongs to which school and in what role:

### `school`

The school record itself.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `name` | string | School name |
| `code` | string? | Optional school code |
| `school_type` | enum | `primary` or `secondary` |
| `address` | string? | Optional physical address |
| `email` | string | Contact email |
| `phone` | string | Contact phone |
| `is_active` | boolean | Whether the school is active |

### `school_management`

The **canonical** record of who belongs to which school and in what role. A user can have at most one row per school (enforced by `UNIQUE(user_id, school_id)`).

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK → `user_profile.id` (cascade delete) |
| `school_id` | UUID | FK → `school.id` (cascade delete) |
| `role` | enum | One of `admin`, `member`, `teacher` |
| `created_at` | timestamptz | When the membership was created |
| `updated_at` | timestamptz | Last role change |

### `school_join_request`

Pending/historic requests from a user to join a school.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK → `user_profile.id` |
| `school_id` | UUID | FK → `school.id` |
| `status` | enum | `pending`, `approved`, or `rejected` |
| `message` | string? | Optional message from the requester |
| `requested_at` | timestamptz | When the request was submitted |
| `reviewed_at` | timestamptz? | When an admin reviewed it |
| `reviewed_by` | UUID? | FK → `user_profile.id` of the reviewing admin |

A partial unique index prevents duplicate **pending** requests for the same `(user_id, school_id)`. The service additionally rejects new requests if the user has any pending request (across all schools).

### Denormalized cache on `user_profile`

For backwards compatibility and query simplicity, two fields on `user_profile` mirror the user's *active* membership:

| Field | Mirrors |
|-------|---------|
| `user_profile.school_id` | The user's currently active school |
| `user_profile.role` | The role from the matching `school_management` row |

These are kept in sync on every write that affects membership (school creation and join request approval). All existing services that read `user_profile.role` (e.g. `AdminGuard`, `ClassTeacherGuard`, `enrollment`, `calculation`, `class`) continue to work unchanged. **`school_management` is the source of truth**; the `user_profile` fields are a cache.

## Roles

`public.role` enum values:

| Role | Meaning |
|------|---------|
| `admin` | Full administrative control of the school. Can approve/reject join requests, manage all data. School creators are automatically `admin`. |
| `teacher` | Staff member assigned to classes. Has access scoped to the classes/subjects they're assigned to (see `ClassTeacherGuard`). |
| `member` | Generic school participant - for users who belong to the school but aren't teaching staff or admins. |

## Flows

### Creating a school (auto-admin)

When a user creates a school, they become its admin immediately - no approval needed.

```
User → POST /schools { name, schoolType, ... }
  ├─ INSERT school
  ├─ INSERT school_management { user_id, school_id, role: 'admin' }
  └─ UPDATE user_profile { school_id, role: 'admin' }   (cache mirror)
```

### Joining an existing school (request → approval)

```
User → PATCH /auth/onboard { firstName, lastName, schoolId }
  └─ INSERT school_join_request { status: 'pending' }
  └─ Response includes a `joinRequest` field; frontend redirects to /onboard/pending

[user is in pending state - no school_id set on user_profile]

Admin → GET /schools/join-requests          # sees the pending request
Admin → PATCH /schools/join-requests/:id/approve { role }
  ├─ UPSERT school_management { user_id, school_id, role }
  ├─ UPDATE user_profile { school_id, role, is_active: true }
  └─ UPDATE school_join_request { status: 'approved', reviewed_at, reviewed_by }
```

The frontend pending page polls `GET /auth/me` every 10 seconds; once `school_id` is populated, the user is auto-redirected to the dashboard.

### Rejection

```
Admin → PATCH /schools/join-requests/:id/reject
  └─ UPDATE school_join_request { status: 'rejected', reviewed_at, reviewed_by }
```

The user can submit a new request afterwards (no pending request blocks them anymore).

### Switching schools

The "Change School" dialog in the sidebar and the school selector on the settings page both go through the same join-request flow - they `POST /schools/:schoolId/join-requests` rather than directly mutating `user_profile.school_id`. The user's active school does not change until an admin of the target school approves.

## API Endpoints

All endpoints require `AuthGuard`. Endpoints under `/schools/join-requests` additionally require `AdminGuard`.

### `GET /api/schools`

Returns all active schools ordered by name. Used during onboarding and in the school switcher.

**Response:** Array of `{ id, name, school_type }` (the underlying table also carries a legacy `parish` column for previously-created schools).

---

### `POST /api/schools`

Creates a new school **and** assigns the requesting user as its admin (inserts `school_management` row, mirrors role/school to `user_profile`). On dedicated deployments, blocked once any school exists.

**Body:**
```json
{
  "name": "Grenada Academy",
  "code": "GA",
  "schoolType": "secondary",
  "address": "123 Main St",
  "email": "info@school.com",
  "phone": "+1473-555-0100"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | |
| `code` | No | |
| `schoolType` | Yes | `primary` or `secondary` |
| `address` | No | |
| `email` | No | |
| `phone` | No | |

**Response:** The created school object.

---

### `POST /api/schools/:schoolId/join-requests`

Submits a request to join a school. Fails with `400` if the user already has any pending join request, or `404` if the school doesn't exist or is inactive.

**Body:**
```json
{ "message": "I'm a new teacher starting next term." }
```

| Field | Required | Notes |
|-------|----------|-------|
| `message` | No | Optional note shown to the reviewing admin (max 500 chars) |

**Response:** The created `school_join_request` row, with the school joined in.

---

### `GET /api/schools/members`

Lists every `school_management` row for the caller's active school, ordered by `role` then `created_at`, with the member's `user` joined in.

Each member also carries a `roles` array of the **custom** (non-system) roles assigned on top of their base enum role, resolved through the `school_management_role → school_role` join:

```json
[
  {
    "id": "…",
    "role": "teacher",
    "created_at": "2026-06-25T…",
    "user": { "id": "…", "first_name": "Test", "last_name": "Hmm", "avatar_url": null },
    "roles": [{ "id": "…", "name": "Student Registrar" }]
  }
]
```

System roles are filtered out of `roles` - the base role is already conveyed by `role`. The staff page renders these as badges on each member card.

---

### `GET /api/schools/join-requests`

**Requires:** `AdminGuard`

Lists pending join requests for the admin's school, oldest first. Each item embeds the requesting user (`first_name`, `last_name`, `email`) and the school (`id`, `name`).

**Response:**
```json
[
  {
    "id": "uuid",
    "status": "pending",
    "message": "...",
    "requested_at": "2026-05-03T12:00:00Z",
    "user": { "id": "uuid", "first_name": "Jane", "last_name": "Doe", "email": "jane@example.com" },
    "school": { "id": "uuid", "name": "Grenada Academy" }
  }
]
```

---

### `PATCH /api/schools/join-requests/:requestId/approve`

**Requires:** `AdminGuard`

Approves a pending request. Fails with `403` if the request belongs to a different school, or `400` if it's already been reviewed.

**Body:**
```json
{ "role": "member" }
```

| Field | Required | Notes |
|-------|----------|-------|
| `role` | Yes | `admin`, `member`, or `teacher` |

**Effects:**

1. Upserts `school_management { user_id, school_id, role }` (idempotent).
2. Updates `user_profile { school_id, role, is_active: true }` for the requester.
3. Marks the request `approved` and records `reviewed_by` / `reviewed_at`.
4. Clears the requester's profile cache.

**Response:** The updated `school_join_request` row.

---

### `PATCH /api/schools/join-requests/:requestId/reject`

**Requires:** `AdminGuard`

Rejects a pending request. Same scope checks as approve. The user's profile is not modified - they may submit a new request afterwards.

**Response:** The updated `school_join_request` row.

## Caching

`SchoolService` uses the shared `CacheService`:

| Key | TTL | Invalidation |
|-----|-----|--------------|
| `schools:all` | 30 days | Updated on `POST /schools` |
| `profile:{userId}` | (managed by AuthService) | Cleared on school create and on join-request approval |

## Frontend Pages

| Path | Audience | Purpose |
|------|----------|---------|
| `/onboard` | New users | Pick or create a school. Selecting an existing school submits a join request. |
| `/onboard/pending` | Users with a pending request | Polls `/auth/me` every 10s and auto-redirects to `/dashboard` once approved. |
| `/dashboard/staff` (Pending Members tab) | Admins only | Lists pending join requests with approve (with role picker) / reject actions. |
| Sidebar → "Change School" | Any user | Submits a join request to switch schools. Does not change the active school until approved. |
| `/dashboard/settings` | Any user | School selector goes through the join-request flow; name updates apply immediately. |
