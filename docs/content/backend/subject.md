---
sidebar_label: Subject
---

# Subject Module

**Location**: `backend/src/subject/`

The subject module manages the catalog of subjects offered by a school (e.g., Mathematics, Language Arts, Science). Subjects are referenced throughout the system - in teacher assignments, student subject profiles, assessments, and grade calculations.

## Files

| File | Purpose |
|------|---------|
| `subject.module.ts` | Module definition |
| `subject.controller.ts` | API endpoints |
| `subject.service.ts` | Business logic |
| `dto/create-subject.dto.ts` | Validation for creation |
| `dto/update-subject.dto.ts` | Validation for updates |
| `dto/reorder-subjects.dto.ts` | Validation for batch reordering |

## Data Model

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `name` | string | Subject name (e.g., "Mathematics") |
| `code` | string? | Short code (e.g., "MATH") |
| `school_id` | UUID | The school this subject belongs to |
| `is_graded` | boolean | Whether grades are recorded for this subject (default: true) |
| `sort_order` | number? | Display ordering |

## Graded vs Non-Graded Subjects

When `is_graded` is `false`, the subject won't appear in grade calculations. This is useful for subjects where only remarks are recorded (e.g., Physical Education, Art).

## API Endpoints

All endpoints require `AuthGuard`. Subjects are automatically scoped to the user's school.

### `GET /api/subjects`

Returns all subjects for the user's school, ordered by `sort_order` then `name`.

---

### `GET /api/subjects/:id`

Returns a single subject by ID.

---

### `POST /api/subjects`

Creates a new subject.

**Body:**
```json
{
  "name": "Mathematics",
  "code": "MATH",
  "isGraded": true,
  "sortOrder": 1
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | |
| `code` | No | |
| `isGraded` | No | Defaults to true |
| `sortOrder` | No | |

**Error Handling:**
- Duplicate name or code within the same school → `409 Conflict`

---

### `PATCH /api/subjects/:id`

Updates a subject. All fields optional.

---

### `PATCH /api/subjects/reorder`

Batch-updates the `sort_order` for multiple subjects at once. Used by the drag-to-sort UI.

**Body:**
```json
{
  "items": [
    { "id": "uuid-1", "sortOrder": 0 },
    { "id": "uuid-2", "sortOrder": 1 },
    { "id": "uuid-3", "sortOrder": 2 }
  ]
}
```

Clears the subject cache after updating.

---

### `DELETE /api/subjects/:id`

Deletes a subject. Fails with `409 Conflict` if the subject has existing assessments or student assignments (foreign key constraint).
