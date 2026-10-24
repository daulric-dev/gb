---
sidebar_label: Term
---

# Term Module

**Location**: `backend/src/term/`

The term module manages terms (semesters, quarters) within an academic year. A term is a name and a date range; a course can optionally belong to one (`course.term_id`). Terms hold no grading settings - a course's grade comes from its own assignment groups (see [Grading](./grading.md)).

## Files

| File | Purpose |
|------|---------|
| `term.module.ts` | Module definition |
| `term.controller.ts` | API endpoints |
| `term.service.ts` | Business logic, school scoping and caching |
| `term.rows.ts` | Serialises a row for the API (dates as `YYYY-MM-DD`) |
| `transformer.ts` | Versioned response transformers |
| `dto/create-term.dto.ts` | Validation for creation |
| `dto/update-term.dto.ts` | Validation for updates |

## Data Model

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `academic_year_id` | UUID | Parent academic year |
| `name` | text | Free text, e.g. "Term 1", "Fall 2026" (unique within the year) |
| `start_date` | date | Term start |
| `end_date` | date | Term end |
| `sort_order` | number | Display order within the year |

## Sort Order

When `sortOrder` is not given on create, a term goes after the year's existing terms (highest `sort_order` + 1). The old fixed names keep their historic slots: `michaelmas` = 1, `hilary` = 2, `trinity` = 3.

## API Endpoints

All endpoints require `AuthGuard` and the matching `term:*` permission. Every lookup is scoped to the caller's school through the term's academic year; a term or year in another school is `404`.

### `GET /api/terms?yearId=<academic_year_id>`

Returns all terms for the academic year, ordered by `sort_order`. Cached per year.

---

### `GET /api/terms/:id`

Returns a single term.

---

### `POST /api/terms`

Creates a term.

**Body:**
```json
{
  "academicYearId": "uuid",
  "name": "Term 1",
  "startDate": "2025-09-01",
  "endDate": "2025-12-15",
  "sortOrder": 1
}
```

`name`, `startDate`, `endDate` and `academicYearId` are required; `sortOrder` (0-50) is optional.

**Errors:**
- Blank name, or start date not before end date → `400 Bad Request`
- Year not in the caller's school → `404 Not Found`
- Duplicate term name within the same year → `409 Conflict`

---

### `PATCH /api/terms/:id`

Updates a term. `name`, `startDate`, `endDate` and `sortOrder` are all optional. A duplicate name is `409`.

---

### `DELETE /api/terms/:id`

Deletes a term. Fails with `409 Conflict` while courses still reference it.
