# Reporting Pages

The reporting section provides three pages for viewing, managing, and exporting student grades. All reporting pages are **class-teacher only** — the buttons to access them are hidden from subject teachers, and the pages themselves verify class teacher status before rendering.

Grade data displayed on these pages comes from **live calculation endpoints** (`/calculations/`), not from the persisted reporting schema. The reporting schema is used only for metadata (remarks, letter grades, status) and file storage.

## Frontend Library Files

| File | Purpose |
|------|---------|
| `lib/reports.ts` | API functions and types for the reporting schema (report CRUD, PDF management, file uploads) |
| `lib/reports.types.ts` | Shared type definitions |
| `lib/year-report.ts` | API functions for calculation endpoints, types for term/year results, and `termResultsToClassSummary` converter |
| `lib/report-pdf.ts` | PDF generation for individual student reports and term-based class summaries |
| `lib/report-year-pdf.ts` | PDF generation for year-based student reports and year-based class summaries |
| `lib/report-export.ts` | CSV and XLSX export for term-based class summaries |
| `lib/report-year-export.ts` | CSV and XLSX export for year-based class summaries |

---

## Reports List Page

**Route**: `/dashboard/classes/[classId]/reports`  
**File**: `app/dashboard/classes/[classId]/reports/page.tsx`

Displays all students in a class with their live calculated grades and the status of any persisted reports.

### Filters

| Selector | Source | Notes |
|----------|--------|-------|
| **Report Type** | Static | Shown only for `year_based` grading model. Options: "Term" or "Year-end" |
| **Term** | `GET /api/v1/terms?yearId=<id>` | Hidden when Report Type is "Year-end" (year-based model). Sorted by `sort_order` |

### Data Flow

1. **Live grades** are fetched from `/calculations/class-term` (term reports) or `/calculations/class-year` (year-end reports)
2. **Persisted reports** are fetched from `/reports?studentGroupId=&termId=` in parallel
3. The two are merged into a `MergedStudent` list — live averages with report status overlaid

### Student Table

| Column | Description |
|--------|-------------|
| Student | Full name |
| Overall Average | Live calculated average (from calculation endpoint) |
| Report Status | Badge: Draft / Published / Sent to ministry / "Not generated" |
| Actions | "Open" link to report detail (if report exists) |

### Generate Reports Button

- Label is **"Generate Reports"** if no persisted reports exist, **"Regenerate Reports"** if some exist
- Calls `POST /api/v1/reports/generate` to persist current live calculations to the `report_book` table
- This is optional — grades display immediately without generating

---

## Report Detail Page

**Route**: `/dashboard/classes/[classId]/reports/[reportId]`  
**File**: `app/dashboard/classes/[classId]/reports/[reportId]/page.tsx`

Displays a single student's report with live grades, editable teacher fields, and PDF management.

### Data Sources

| Data | Source | Purpose |
|------|--------|---------|
| Live term grades | `GET /api/v1/calculations/student-term` | CW, Exam, Term composite for each subject |
| Live year grades | `GET /api/v1/calculations/student-year` | Year-end: per-term composites, year grade |
| Persisted report | `GET /api/v1/reports/:id` | Status, remarks, conduct, attendance, letter grades, PDF history |

### Page Header

- Student name
- Status badge (Draft / Published / Sent to ministry)
- Term name
- Class ranking (from live data)
- Lock indicator when sent to ministry

### Actions (class teacher only, not locked)

| Action | Description |
|--------|-------------|
| Regenerate grades | Re-fetches live data and updates persisted entries |
| Publish | Sets status to `published` |
| Send to ministry | Locks the report permanently |

### Class Teacher Card

Editable fields (disabled when locked):

| Field | Description |
|-------|-------------|
| Class Teacher remark | Free text |
| Conduct | e.g., "Excellent", "Good" |
| Attendance % | 0–100 |

### Subject Results Table

Displays differently based on report type:

#### Term Report

| Column | Source | Description |
|--------|--------|-------------|
| Subject | Live | Subject name |
| Coursework | Live | Coursework average |
| Exam | Live | Exam average |
| Term | Live | Term composite |
| Letter | Persisted | Editable letter grade (e.g., "A") |
| Remark | Persisted | Editable teacher remark |

#### Year-End Report (year_based model)

| Column | Source | Description |
|--------|--------|-------------|
| Subject | Live | Subject name |
| M, H, T (term initials) | Live | Per-term composite grades |
| End of Yr Exam | Live | Last term's exam average |
| Year Grade | Live | Computed year grade |
| Letter | Persisted | Editable letter grade |
| Remark | Persisted | Editable teacher remark |

### PDF Section

| Action | Description |
|--------|-------------|
| Download PDF | Generates PDF client-side from live data and downloads |
| Generate & upload to storage | Generates PDF, downloads it, and uploads to Supabase Storage |
| PDF history | Lists all previously uploaded PDFs with download links |
| Register PDF manually | Advanced: manually record a storage path and file size |

---

## Class Report Page

**Route**: `/dashboard/classes/[classId]/class-report`  
**File**: `app/dashboard/classes/[classId]/class-report/page.tsx`

Class-level summary with statistics, rankings, and export capabilities.

### Filters

| Selector | Position | Notes |
|----------|----------|-------|
| **Report Type** | Left | Shown only for `year_based` model. Options: "Term" or "Year-end" |
| **Term** | Right | Hidden when "Year-end" is selected (year-based model) |

### Data Flow

- **Term reports**: `GET /api/v1/calculations/class-term` → converted to `ClassSummary` via `termResultsToClassSummary()`
- **Year-end reports**: `GET /api/v1/calculations/class-year` + `GET /api/v1/calculations/class-term` in parallel
- Stored files are fetched from `/reports/class-summary/files`

### Statistics Cards

| Card | Description |
|------|-------------|
| Class Average | Mean of all student overall averages |
| Highest / Lowest | Best and worst overall averages |
| Students | Total count with pass/fail breakdown (threshold: 50) |
| Weights | Coursework and exam weight percentages |

### Subject Averages Table (term-based only)

| Column | Description |
|--------|-------------|
| Subject | Subject name |
| Average | Class average for this subject |
| Highest | Highest individual mark |
| Lowest | Lowest individual mark |

### Student Rankings Table

#### Term View

| Column | Description |
|--------|-------------|
| # | Position |
| Student | Full name |
| Overall Average | Term composite average |

#### Year-End View

| Column | Description |
|--------|-------------|
| # | Position |
| Student | Full name |
| Year Average | Year-end overall average |

### Export Section

Three download formats, all generated **client-side** from live calculation data:

| Format | Term-based | Year-based |
|--------|-----------|------------|
| **PDF** | `buildClassSummaryPdfBlob` — CW/EX/Final per subject, with subject separator lines | `buildYearClassSummaryPdfBlob` — term initials + End of Yr Exam + Year per subject |
| **CSV** | `buildClassSummaryCsv` — same column structure as PDF | `buildYearClassSummaryCsv` — matches year PDF layout |
| **XLSX** | `buildClassSummaryXlsx` — two sheets (Summary + Students) with merged subject headers | `buildYearClassSummaryXlsx` — matches year PDF layout |

All exports include:
- Class name and term name in the header
- Weight information (CW% / EX%)
- Aggregate statistics (class average, pass/fail)

The **Generate & save all to storage** button creates all three formats, downloads them, and uploads to Supabase Storage.

### Dynamic Page Width (PDF)

Both term-based and year-based class summary PDFs dynamically calculate page width based on the number of subjects. If the table exceeds standard A4 landscape width (297mm), the page extends horizontally to fit all columns.

---

## PDF Generation Details

### Individual Student PDF (`buildReportPdfBlob`)

Takes a `StudentTermResult` (live data) and optional `ReportDetail` (persisted metadata). Includes:

- Student name, term, report type, status
- Overall average and class position
- Conduct, attendance, class teacher remark (from persisted data)
- Subject table: CW, Exam, Term, Letter Grade, Remark

### Year-End Student PDF (`buildYearReportPdfBlob`)

Takes a `StudentYearReport`. Includes:

- Student name, class name
- Subject table with term initials as column headers (e.g., M, H, T)
- End of Yr Exam column (last term's exam average)
- Year Grade column
- OVERALL summary row
- Legend mapping initials to full term names

### Class Summary PDF (`buildClassSummaryPdfBlob`)

Takes a `ClassSummary`. Includes:

- Header with class name, term, weights, student count, averages
- Subject averages table
- Student grades table with two-row header: subject names (merged) + CW/EX/Final sub-columns
- Vertical separator lines between subject groups

### Year-End Class Summary PDF (`buildYearClassSummaryPdfBlob`)

Takes `StudentYearReport[]`. Includes:

- Header with class name, academic year, weights
- Student table with term initials + E (End of Yr Exam) + Year per subject
- Smaller text (5pt) and condensed layout to fit more columns
- Legend for term initials

## API Calls Summary

| Action | Endpoint |
|--------|----------|
| Live term grades (student) | `GET /api/v1/calculations/student-term` |
| Live year grades (student) | `GET /api/v1/calculations/student-year` |
| Live term grades (class) | `GET /api/v1/calculations/class-term` |
| Live year grades (class) | `GET /api/v1/calculations/class-year` |
| List persisted reports | `GET /api/v1/reports?studentGroupId=&termId=` |
| Get report detail | `GET /api/v1/reports/:id` |
| Generate reports | `POST /api/v1/reports/generate` |
| Update report | `PATCH /api/v1/reports/:id` |
| Regenerate report | `PATCH /api/v1/reports/:id/regenerate` |
| Publish report | `PATCH /api/v1/reports/:id/publish` |
| Send to ministry | `PATCH /api/v1/reports/:id/send-to-ministry` |
| Update entry (letter/remark) | `PATCH /api/v1/report-entries/:entryId` |
| Upload student PDF | `POST /api/v1/reports/:id/pdf/upload` |
| Download student PDF | `GET /api/v1/reports/:id/pdf/:pdfId/download` |
| PDF history | `GET /api/v1/reports/:id/pdfs` |
| Upload class summary file | `POST /api/v1/reports/class-summary/upload` |
| Download class summary file | `GET /api/v1/reports/class-summary/download` |
| List class summary files | `GET /api/v1/reports/class-summary/files` |
| Academic year info | `GET /api/v1/academic-years/:id` |
| Terms | `GET /api/v1/terms?yearId=` |
