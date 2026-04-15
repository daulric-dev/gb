# Reporting Module

**Location**: `backend/src/reporting/`

The reporting module handles the persistence layer for student reports -generating report books, managing report status workflows, and storing/serving exported files (PDFs, CSVs, Excel). It works alongside the [Calculation Module](./calculation.md), which provides the live grade data.

## Files

| File | Purpose |
|------|---------|
| `reporting.module.ts` | Module definition |
| `report.controller.ts` | API endpoints for reports and report entries |
| `report.service.ts` | Business logic for report generation, updates, and file management |
| `report.guard.ts` | Prevents modification of reports after ministry submission |
| `dto/generate-report.dto.ts` | DTO for batch report generation |
| `dto/update-report.dto.ts` | DTO for updating report metadata (remarks, conduct, attendance) |
| `dto/update-report-entry.dto.ts` | DTO for updating per-subject entries (letter grade, remark) |
| `dto/save-pdf.dto.ts` | DTO for recording a PDF file reference |

## Key Concepts

### Report Book

A `report_book` row represents a single student's report for a specific term. It stores:

- **Metadata**: student, term, class, report type, academic year
- **Aggregates**: overall average, class position, total students
- **Class teacher fields**: remark, conduct, attendance percentage
- **Status**: `draft` → `published` → `sent_to_ministry`

### Report Book Entries

Each report book has multiple `report_book_entry` rows -one per subject. Entries store the **persisted snapshot** of grades at generation time plus editable fields:

| Field | Source | Editable |
|-------|--------|----------|
| `coursework_average` | Calculated at generation time | No |
| `exam_average` | Calculated at generation time | No |
| `term_composite` | Calculated at generation time | No |
| `year_grade` | Calculated at generation time | No |
| `letter_grade` | Teacher input | Yes |
| `teacher_remark` | Teacher input | Yes |

### Live Grades vs Persisted Grades

The frontend displays **live calculated grades** from the `/calculations/` endpoints. The reporting schema is used for:

- Persisting metadata (remarks, letter grades, conduct, attendance)
- Managing report status workflow (draft → published → ministry)
- Storing and serving exported files (PDF, CSV, XLSX)
- Recording PDF generation history

### Report Status Workflow

```
draft → published → sent_to_ministry (locked)
```

Once a report is marked `sent_to_ministry`, the `ReportGuard` prevents any further modifications.

### Report Types

| Type | Description |
|------|-------------|
| `term` | Single-term report |
| `year_end` | Year-end report (year_based grading model only) |

### File Storage

Exported files (PDFs, CSVs, XLSX) are stored in the `report-books` Supabase Storage bucket. The module handles:

- **Individual report PDFs**: uploaded per-student via multipart upload
- **Class summary files**: PDF, CSV, and XLSX uploaded per-class-per-term

## API Endpoints

All endpoints require `AuthGuard`. Most also require `ClassTeacherGuard` (admin or class teacher).

### Report Generation

#### `POST /api/v1/reports/generate`

**Guards**: `AuthGuard`, `ClassTeacherGuard`

Generates (or regenerates) report book entries for all students in a class for a given term. Calls the calculation engine internally to compute grades.

**Body** (`GenerateReportDto`):

| Field | Required | Description |
|-------|----------|-------------|
| `studentGroupId` | Yes | Class UUID |
| `termId` | Yes | Term UUID |
| `reportType` | Yes | `term` or `year_end` |

### Report Queries

#### `GET /api/v1/reports`

**Guards**: `AuthGuard`, `ClassTeacherGuard`

Lists all report books for a class + term combination.

| Param | Required | Description |
|-------|----------|-------------|
| `studentGroupId` | Yes | Class UUID |
| `termId` | Yes | Term UUID |
| `reportType` | No | Filter by `term` or `year_end` |

#### `GET /api/v1/reports/:id`

**Guards**: `AuthGuard`, `ClassTeacherGuard`

Returns a single report book with all entries, student info, and PDF history.

#### `GET /api/v1/reports/student`

**Guards**: `AuthGuard`, `ClassTeacherGuard`

Finds a student's report by student ID, term, and report type.

| Param | Required | Description |
|-------|----------|-------------|
| `studentId` | Yes | Student UUID |
| `termId` | Yes | Term UUID |
| `reportType` | Yes | `term` or `year_end` |

### Report Updates

#### `PATCH /api/v1/reports/:id`

**Guards**: `AuthGuard`, `ClassTeacherGuard`, `ReportGuard`

Updates class teacher metadata on a report.

**Body** (`UpdateReportDto`):

| Field | Type | Description |
|-------|------|-------------|
| `classTeacherRemark` | string | Class teacher's remark |
| `conduct` | string | e.g., "Excellent" |
| `attendancePercentage` | number | 0–100 |

#### `PATCH /api/v1/reports/:id/regenerate`

**Guards**: `AuthGuard`, `ClassTeacherGuard`, `ReportGuard`

Re-runs grade calculations for a single report and updates all entries.

#### `PATCH /api/v1/reports/:id/publish`

**Guards**: `AuthGuard`, `ClassTeacherGuard`, `ReportGuard`

Sets status to `published`.

#### `PATCH /api/v1/reports/:id/send-to-ministry`

**Guards**: `AuthGuard`, `ClassTeacherGuard`

Sets status to `sent_to_ministry`. The report becomes **locked** -the `ReportGuard` blocks further edits.

### Report Entry Updates

#### `PATCH /api/v1/report-entries/:entryId`

**Guards**: `AuthGuard`, `ReportGuard`

Updates editable fields on a single subject entry.

**Body** (`UpdateReportEntryDto`):

| Field | Type | Description |
|-------|------|-------------|
| `letterGrade` | string | e.g., "A", "B+" |
| `teacherRemark` | string | Subject-specific comment |

### PDF Management

#### `POST /api/v1/reports/:id/pdf`

**Guards**: `AuthGuard`, `ClassTeacherGuard`, `ReportGuard`

Records a PDF file reference (path + size) without uploading.

#### `POST /api/v1/reports/:id/pdf/upload`

**Guards**: `AuthGuard`, `ClassTeacherGuard`, `ReportGuard`

Uploads a PDF blob to Supabase Storage and records the reference. Accepts multipart form data with the file and an optional `objectPath` field.

#### `GET /api/v1/reports/:id/pdfs`

Returns the PDF generation history for a report.

#### `GET /api/v1/reports/:id/pdf/latest`

Returns the most recent PDF record.

#### `GET /api/v1/reports/:id/pdf/:pdfId/download`

Downloads a PDF file from Supabase Storage. Returns the file as a binary response with appropriate headers.

### Class Summary Files

#### `POST /api/v1/reports/class-summary/upload`

**Guards**: `AuthGuard`, `ClassTeacherGuard`

Uploads a class summary file (PDF, CSV, or XLSX) to Supabase Storage.

Accepts multipart form data with fields: `studentGroupId`, `termId`, `reportType`, `fileType`.

#### `GET /api/v1/reports/class-summary/download`

Downloads a stored class summary file by type.

| Param | Required | Description |
|-------|----------|-------------|
| `studentGroupId` | Yes | Class UUID |
| `termId` | Yes | Term UUID |
| `reportType` | Yes | `term` or `year_end` |
| `fileType` | Yes | `pdf`, `csv`, or `xlsx` |

#### `GET /api/v1/reports/class-summary/files`

Lists all stored class summary files for a class + term + report type.

## Database Tables

### `reporting.report_book`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `student_id` | uuid | FK to student |
| `academic_year_id` | uuid | FK to academic year |
| `term_id` | uuid | FK to term |
| `student_group_id` | uuid | FK to class |
| `report_type` | text | `term` or `year_end` |
| `status` | text | `draft`, `published`, `sent_to_ministry` |
| `overall_average` | numeric | Computed at generation time |
| `position` | integer | Class ranking |
| `total_students` | integer | Class size at generation time |
| `class_teacher_remark` | text | Editable by class teacher |
| `conduct` | text | Editable by class teacher |
| `attendance_percentage` | numeric | Editable by class teacher |

### `reporting.report_book_entry`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `report_book_id` | uuid | FK to report_book |
| `subject_id` | uuid | FK to subject |
| `coursework_average` | numeric | Snapshot from calculation |
| `exam_average` | numeric | Snapshot from calculation |
| `term_composite` | numeric | Snapshot from calculation |
| `year_grade` | numeric | Snapshot from calculation |
| `letter_grade` | text | Teacher input |
| `teacher_remark` | text | Teacher input |
| `sort_order` | integer | Display ordering |

### `reporting.report_book_pdf`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `report_book_id` | uuid | FK to report_book |
| `file_path` | text | Supabase Storage object path |
| `file_size` | integer | File size in bytes |
| `generated_by` | uuid | FK to user_profile |
| `generated_at` | timestamptz | When the PDF was generated |

### `reporting.class_report_file`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `student_group_id` | uuid | FK to class |
| `term_id` | uuid | FK to term |
| `report_type` | text | `term` or `year_end` |
| `file_type` | text | `pdf`, `csv`, or `xlsx` |
| `file_path` | text | Supabase Storage object path |
| `file_size` | integer | File size in bytes |
| `generated_by` | uuid | FK to user_profile |
| `generated_at` | timestamptz | Upload timestamp |
