---
sidebar_label: Academic Year
---

# Academic Year Module

**Location**: `backend/src/academic-year/`

The academic year module manages a school's academic years. A year is a name and a date range, with at most one **active** year per school - that is how the app knows what "now" means. Years hold no grading settings: courses grade through their own assignment groups and grade scale (see [Grading](./grading.md)).

## Files

| File | Purpose |
|------|---------|
| `academic-year.module.ts` | Module definition |
| `academic-year.controller.ts` | API endpoints |
| `academic-year.service.ts` | Business logic, school scoping and caching |
| `academic-year.rows.ts` | Serialises a row for the API; `parseDateOnly` for request dates |
| `transformer.ts` | Versioned response transformers |
| `dto/create-academic-year.dto.ts` | Validation for creation |
| `dto/update-academic-year.dto.ts` | Validation for updates |

## Data Model

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `name` | string | Display name (e.g. "2025/2026") |
| `school_id` | UUID | The school this year belongs to |
| `start_date` | date | Year start (sent as `YYYY-MM-DD`) |
| `end_date` | date | Year end (must be after start) |
| `is_active` | boolean | Whether this is the school's current year |

## API Endpoints

All endpoints require `AuthGuard` and the matching `academic-year:*` permission. Data is scoped to the caller's school.

### `POST /api/academic-years`

Creates an academic year. New years start inactive.

**Body:**
```json
{
  "name": "2025/2026",
  "startDate": "2025-09-01",
  "endDate": "2026-07-15"
}
```

**Validation:** `startDate` must be before `endDate`.

---

### `GET /api/academic-years`

Returns all academic years for the caller's school, newest start date first.

---

### `GET /api/academic-years/active`

Returns the school's active academic year, or `null`.

---

### `GET /api/academic-years/:id`

Returns a single academic year.

---

### `PATCH /api/academic-years/:id`

Updates `name`, `startDate` and/or `endDate`. All fields are optional. There is no `isActive` field (sending one is a 400); use the activate and deactivate routes below.

---

### `PATCH /api/academic-years/:id/activate`

Sets this academic year as active, deactivating every other year in the school in the same transaction.

---

### `PATCH /api/academic-years/:id/deactivate`

Deactivates the academic year.
