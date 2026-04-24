---
sidebar_label: Academic Year
---

# Academic Year Module

**Location**: `backend/src/academic-year/`

The academic year module manages the lifecycle of academic years for a school. Each academic year defines the time boundaries and grading model that governs how final grades are calculated.

## Files

| File | Purpose |
|------|---------|
| `academic-year.module.ts` | Module definition |
| `academic-year.controller.ts` | API endpoints |
| `academic-year.service.ts` | Business logic |
| `dto/create-academic-year.dto.ts` | Validation for creation |
| `dto/update-academic-year.dto.ts` | Validation for updates |

## Data Model

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `name` | string | Display name (e.g., "2025-2026") |
| `school_id` | UUID | The school this year belongs to |
| `start_date` | date | Year start |
| `end_date` | date | Year end (must be after start) |
| `is_active` | boolean | Whether this is the current active year |
| `grading_model` | enum | `term_based` or `year_based` |
| `year_exam_weight` | number? | Exam weight for year-end calculation (year_based only) |
| `year_coursework_weight` | number? | Coursework weight for year-end (year_based only) |

## Grading Models

### Term-Based (`term_based`)

The final grade for each subject is calculated **per term only**. There is no year-end aggregation. Each term stands on its own.

### Year-Based (`year_based`)

Term grades are aggregated into a **year-end grade** using the weights defined on the academic year. The `year_exam_weight` and `year_coursework_weight` must sum to **100**.

## API Endpoints

All endpoints require `AuthGuard`. Data is automatically scoped to the user's school.

### `POST /api/academic-years`

Creates a new academic year.

**Body:**
```json
{
  "name": "2025-2026",
  "startDate": "2025-09-01",
  "endDate": "2026-07-15",
  "gradingModel": "year_based",
  "yearExamWeight": 60,
  "yearCourseworkWeight": 40
}
```

**Validation:**
- `startDate` must be before `endDate`
- If `gradingModel` is `year_based`, then `yearExamWeight + yearCourseworkWeight` must equal 100

---

### `GET /api/academic-years`

Returns all academic years for the user's school, ordered by creation date.

---

### `GET /api/academic-years/active`

Returns the currently active academic year for the user's school.

---

### `GET /api/academic-years/:id`

Returns a single academic year by ID.

---

### `PATCH /api/academic-years/:id`

Updates an academic year. All fields are optional.

**Body:** Same fields as create, all optional. Weight validation still applies when grading model is `year_based`.

---

### `PATCH /api/academic-years/:id/activate`

Sets this academic year as active. **Deactivates all other years** for the same school first.

---

### `PATCH /api/academic-years/:id/deactivate`

Deactivates the academic year.
