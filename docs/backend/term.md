# Term Module

**Location**: `backend/src/term/`

The term module manages terms (semesters) within an academic year. Each term defines its own grading weight split between exams and coursework.

## Files

| File | Purpose |
|------|---------|
| `term.module.ts` | Module definition |
| `term.controller.ts` | API endpoints |
| `term.service.ts` | Business logic |
| `dto/create-term.dto.ts` | Validation for creation |
| `dto/update-term.dto.ts` | Validation for updates |

## Data Model

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `academic_year_id` | UUID | Parent academic year |
| `name` | enum | `michaelmas`, `hilary`, or `trinity` |
| `start_date` | date | Term start |
| `end_date` | date | Term end |
| `exam_weight` | number | Percentage weight for exams (0-100) |
| `coursework_weight` | number | Percentage weight for coursework (0-100) |
| `is_ministry_reporting` | boolean | Whether this is the term reported to the Ministry of Education |
| `sort_order` | number | Display order |

## Term Names and Default Sort Order

| Term | Typical Period | Default Sort |
|------|---------------|-------------|
| `michaelmas` | September – December | 1 |
| `hilary` | January – April | 2 |
| `trinity` | April – July | 3 |

## Weight Validation

The `exam_weight + coursework_weight` must always equal **100**. For example:
- Exam 60% + Coursework 40% = 100 (valid)
- Exam 80% + Coursework 30% = 110 (rejected)

## API Endpoints

All endpoints require `AuthGuard`.

### `GET /api/v1/terms?yearId=<academic_year_id>`

Returns all terms for the specified academic year, ordered by `sort_order`.

**Query Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `yearId` | Yes | The academic year ID to fetch terms for |

---

### `GET /api/v1/terms/:id`

Returns a single term by ID.

---

### `POST /api/v1/terms`

Creates a new term.

**Body:**
```json
{
  "academicYearId": "uuid",
  "name": "michaelmas",
  "startDate": "2025-09-01",
  "endDate": "2025-12-15",
  "examWeight": 60,
  "courseworkWeight": 40,
  "isMinistryReporting": false,
  "sortOrder": 1
}
```

**Error Handling:**
- Duplicate term name within the same year → `409 Conflict`
- Weight sum ≠ 100 → `400 Bad Request`

---

### `PATCH /api/v1/terms/:id`

Updates a term. All fields are optional. Weight validation still applies.

---

### `DELETE /api/v1/terms/:id`

Deletes a term. Fails with `409 Conflict` if the term has existing assessments or grades (foreign key constraint).
