# School Module

**Location**: `backend/src/school/`

The school module manages school records. Schools are the top-level organizational unit - every user belongs to a school, and all data (students, subjects, classes) is scoped to a school.

## Files

| File | Purpose |
|------|---------|
| `school.module.ts` | Module definition |
| `school.controller.ts` | API endpoints |
| `school.service.ts` | Business logic |
| `dto/create-school.dto.ts` | Validation for school creation |

## Data Model

A school record contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `name` | string | School name |
| `code` | string? | Optional school code |
| `school_type` | enum | `primary` or `secondary` |
| `parish` | string | Parish/district location |
| `address` | string? | Optional physical address |
| `email` | string | Contact email |
| `phone` | string | Contact phone |
| `is_active` | boolean | Whether the school is active |

## API Endpoints

All endpoints require `AuthGuard`.

### `GET /api/schools`

Returns all active schools ordered by name. Used during onboarding to let users select their school.

**Response:** Array of school objects.

---

### `POST /api/schools`

Creates a new school.

**Body:**
```json
{
  "name": "Grenada Academy",
  "code": "GA",
  "schoolType": "secondary",
  "parish": "St. George",
  "address": "123 Main St",
  "email": "info@school.com",
  "phone": "+1473-555-0100"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | |
| `code` | No | |
| `schoolType` | Yes | Must be `primary` or `secondary` |
| `parish` | Yes | |
| `address` | No | |
| `email` | Yes | Must be valid email |
| `phone` | Yes | |

**Response:** The created school object.
