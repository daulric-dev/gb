---
sidebar_label: Grading
---

# Grading Module

**Location**: `backend/src/grading/`

The grading module manages two core entities:
1. **Assessments** - exam or coursework items within a term and subject (e.g., "Mid-term Exam", "Take Home Project")
2. **Grades** - individual student scores for each assessment

This module uses **Supabase Row-Level Security (RLS)** to enforce that teachers can only create/modify assessments and grades for subjects they're assigned to.

## Files

| File | Purpose |
|------|---------|
| `grading.module.ts` | Module definition |
| `assessment.controller.ts` | Assessment API endpoints |
| `assessment.service.ts` | Assessment business logic |
| `grade.controller.ts` | Grade API endpoints |
| `grade.service.ts` | Grade business logic |
| `dto/create-assessment.dto.ts` | Assessment creation validation |
| `dto/update-assessment.dto.ts` | Assessment update validation |
| `dto/create-grade.dto.ts` | Single grade creation |
| `dto/update-grade.dto.ts` | Grade update |
| `dto/bulk-grade.dto.ts` | Bulk grade creation/update |
| `dto/exclude.dto.ts` | Grade/assessment exclusion toggle |

## Assessment Data Model

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `term_id` | UUID | The term this assessment belongs to |
| `subject_id` | UUID | The subject being assessed |
| `title` | string | Assessment name (e.g., "Mid-term Exam") |
| `assessment_type` | enum | `exam` or `coursework` |
| `assessment_date` | date? | Optional date of the assessment |
| `max_score` | number | Maximum possible score (default: 100) |
| `weight` | number? | Weight within its type category |
| `is_excluded` | boolean | If true, excluded from calculations |
| `exclusion_reason` | string? | Why the assessment was excluded |
| `sort_order` | number? | Display ordering |

## Grade Data Model

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `assessment_id` | UUID | The assessment this grade belongs to |
| `student_id` | UUID | The student being graded |
| `score` | number | The student's score |
| `letter_grade` | string? | Auto-calculated letter grade |
| `remarks` | string? | Optional teacher remarks |
| `is_excluded` | boolean | If true, excluded from calculations |
| `exclusion_reason` | string? | Why the grade was excluded |
| `created_by` | UUID | Teacher who created the grade |
| `updated_by` | UUID | Teacher who last updated the grade |

## Row-Level Security (RLS)

Unlike other modules that use the service role client, the grading module uses `createUserClient(token, 'grading')` for write operations. This means:

- Teachers can only create/modify assessments for subjects they're assigned to teach
- RLS policies on the `grading` schema enforce this at the database level
- If a teacher tries to grade a subject they don't teach, a `403 Forbidden` error is returned

Read operations that need to join student data use the service role client to bypass RLS.

## Exclusion System

Both assessments and individual grades can be **excluded** from calculations:

- **Excluded Assessment**: The entire assessment is skipped when computing term grades. Useful if an assessment is cancelled.
- **Excluded Grade**: An individual student's grade is skipped. Useful if a student was absent or excused.

The `ExcludeDto` is shared between assessment and grade exclusion.

### Two routes to a grade exclusion

An individual grade can be excluded through either of two endpoints, which differ in **who is allowed to do it**:

| | `PATCH /api/grades/:id/exclude` | `POST /api/activities/:activityId/students/:studentId/exclude` |
| --- | --- | --- |
| Identifies the grade by | its own id | the activity's assessment **and** the student |
| Client | user client, under RLS | service client |
| Allowed for | an admin in the school, or a teacher with a `teacher_subject_assignment` for that subject and year | anyone whose school owns the class the activity belongs to |
| Used by | nothing yet | the class activity's Submissions tab |

The second exists because the activity screens authorise by **class** throughout - marking a submission already does, through the service client. A class teacher who is not that subject's assigned teacher can set the mark and can exclude every mark on the activity at once, but would be refused by the RLS route for the same grade. That route remains the correct one for the gradebook at large, where subject assignment is the rule.

The activity route resolves the grade by assessment and student together, so a student id from another class cannot reach a grade the activity does not own, and it returns `409` if the activity is not published (there is no assessment yet) or `404` if the student has not been marked.

## Assessment Endpoints

All endpoints require `AuthGuard`.

### `GET /api/assessments?termId=<id>&subjectId=<id>`

Returns all assessments for a term and subject, ordered by `sort_order`.

---

### `GET /api/assessments/:id`

Returns a single assessment.

---

### `POST /api/assessments`

Creates a new assessment. **RLS enforced** - only the assigned teacher can create.

**Body:**
```json
{
  "termId": "uuid",
  "subjectId": "uuid",
  "title": "Mid-term Exam",
  "assessmentType": "exam",
  "maxScore": 100,
  "weight": 1,
  "sortOrder": 1
}
```

---

### `PATCH /api/assessments/:id`

Updates an assessment. **RLS enforced.**

---

### `PATCH /api/assessments/:id/exclude`

Toggles the exclusion status of an assessment.

**Body:**
```json
{
  "isExcluded": true,
  "exclusionReason": "Assessment cancelled due to weather"
}
```

---

### `DELETE /api/assessments/:id`

Deletes an assessment and all its grades. **RLS enforced.**

## Grade Endpoints

All endpoints require `AuthGuard`.

### `GET /api/grades?assessmentId=<id>`

Returns all grades for an assessment, enriched with student names, sorted by last name.

---

### `GET /api/grades/by-term?termId=<id>&subjectId=<id>`

Returns all assessments for a term + subject, with nested grades and student data. This powers the grading sheet view.

**Response structure:**
```json
[
  {
    "id": "assessment-uuid",
    "title": "Mid-term Exam",
    "max_score": 100,
    "assessment_type": "exam",
    "grades": [
      {
        "id": "grade-uuid",
        "student_id": "uuid",
        "score": 85,
        "remarks": "Good work",
        "is_excluded": false,
        "student": {
          "id": "uuid",
          "first_name": "Jane",
          "last_name": "Doe"
        }
      }
    ]
  }
]
```

---

### `POST /api/grades`

Creates a single grade. **RLS enforced.**

**Body:**
```json
{
  "assessmentId": "uuid",
  "studentId": "uuid",
  "score": 85,
  "remarks": "Good work"
}
```

**Error:** `409 Conflict` if a grade already exists for this student + assessment.

---

### `POST /api/grades/bulk`

Creates or updates multiple grades at once. Uses `upsert` on `(assessment_id, student_id)`, so existing grades are updated in place.

**Body:**
```json
{
  "assessmentId": "uuid",
  "grades": [
    { "studentId": "uuid1", "score": 85, "remarks": "Good" },
    { "studentId": "uuid2", "score": 72 }
  ]
}
```

---

### `PATCH /api/grades/:id`

Updates a grade's score or remarks. **RLS enforced.**

---

### `PATCH /api/grades/:id/exclude`

Toggles the exclusion status of a grade. Authorised by RLS - see [Two routes to a grade exclusion](#two-routes-to-a-grade-exclusion).

**Body:**
```json
{
  "isExcluded": true,
  "exclusionReason": "Student was absent"
}
```

---

### `POST /api/activities/:activityId/students/:studentId/exclude`

Leaves one student's mark for an activity out of the term, keeping the mark. Authorised by the class the activity belongs to - see [Two routes to a grade exclusion](#two-routes-to-a-grade-exclusion). Requires `grade:update`.

**Body:**
```json
{
  "excluded": true,
  "reason": "Absent, sat the makeup instead"
}
```

`reason` is optional, trimmed, and stored as null when blank. It is cleared whenever `excluded` is false, so a stale note cannot reappear the next time the mark is excluded.

**Response:**
```json
{
  "studentId": "...",
  "gradeId": "...",
  "isExcluded": true,
  "exclusionReason": "Absent, sat the makeup instead"
}
```

| Status | When |
| --- | --- |
| `409` | The activity is not published, so there is no assessment and nothing is being counted yet |
| `404` | The student has no mark for this activity, or the activity is outside the caller's school |

The exclusion appears on `GET /api/activities/:id/submissions`, whose rows carry `grade: { id, isExcluded, exclusionReason } | null`. A null `grade` means there is nothing to exclude yet - not that the mark counts.
