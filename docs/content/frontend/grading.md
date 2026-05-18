---
sidebar_label: Grading
---

# Grading Page

**Route**: `/dashboard/classes/[classId]/grading`  
**File**: `app/dashboard/classes/[classId]/grading/page.tsx`

The grading page is where teachers enter and manage student grades. It provides a spreadsheet-like interface for recording scores per assessment.

## Page Layout

### Selectors

Two dropdowns at the top:

| Selector | Source | Notes |
|----------|--------|-------|
| **Term** | `GET /api/terms?yearId=<id>` | Terms for the class's academic year |
| **Subject** | `GET /api/classes/:id/my-subjects` | Filtered by teacher role - class teachers see all, subject teachers see only their assigned subjects |

When both are selected, assessments for that term + subject combination are loaded.

### Assessment Cards

Displays assessments as horizontal selectable cards:

| Element | Description |
|---------|-------------|
| Title | Assessment name (e.g., "Mid-term Exam") |
| Type badge | `Exam` or `Coursework` |
| Max score | e.g., "/100" |

**Assessment Actions** (top-right icons):
- **Exclude/Include** toggle - excludes the assessment from grade calculations
- **Edit** - opens edit dialog
- **Delete** - confirmation dialog with cascade warning

### Create Assessment

A dialog form with:

| Field | Required | Description |
|-------|----------|-------------|
| Title | Yes | Assessment name |
| Type | Yes | `Exam` or `Coursework` (default: `Coursework`) |
| Assessment Date | No | Date of the assessment |
| Max Score | Yes | Maximum possible score (default: 100) |
| Weight | No | Weight within its type category |
| Sort Order | No | Display ordering |

The default assessment type is **Coursework** (changed 2026-05-17). This aligns with the most common use case across all grading models, since coursework assessments are created more frequently than exams.

## Grade Entry Table

When an assessment is selected, a table appears showing all students assigned to the selected subject:

| Column | Description |
|--------|-------------|
| Student | Full name |
| Score | Editable number input, capped to max score |
| Remarks | Optional text input |
| Exclude | Toggle button per student grade |

### Score Clamping

Scores are clamped client-side:
- Negative values → `0`
- Values above max score → `max_score`

No error toast is shown - the value is silently adjusted.

### Bulk Save

The **Save All Grades** button collects all entered scores and sends them as a single `POST /api/grades/bulk` request. This uses upsert behavior, so:
- New grades are created
- Existing grades are updated
- Empty score fields are skipped

### Grade Exclusion

Each student's grade has an **exclude toggle** (eye icon). When excluded:
- The grade is marked with `is_excluded = true`
- It is skipped in all grade calculations
- An optional exclusion reason can be provided

### Student Filtering

The table only shows students who are **assigned to the selected subject** (`student_subject_profile` exists). This is achieved by passing `?subjectId=<id>` to the enrolled students endpoint.

When the subject selector changes, the student list refreshes automatically.

## API Calls

| Action | Endpoint |
|--------|----------|
| Class info | `GET /api/classes` |
| My subjects | `GET /api/classes/:id/my-subjects` |
| Terms | `GET /api/terms?yearId=<id>` |
| List assessments | `GET /api/assessments?termId=&subjectId=` |
| Create assessment | `POST /api/assessments` |
| Update assessment | `PATCH /api/assessments/:id` |
| Exclude assessment | `PATCH /api/assessments/:id/exclude` |
| Delete assessment | `DELETE /api/assessments/:id` |
| List grades | `GET /api/grades?assessmentId=<id>` |
| Save grades (bulk) | `POST /api/grades/bulk` |
| Exclude grade | `PATCH /api/grades/:id/exclude` |
| Enrolled students | `GET /api/classes/:id/students?subjectId=<id>` |
