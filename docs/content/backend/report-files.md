---
sidebar_label: Report Files
---

# Report Files Module

**Location**: `backend/src/report-files/`

Server-side generation of all report files - student report-card PDFs, year-end PDFs, the designed "report card", class-summary PDF/CSV/XLSX, exam reports, and a bulk zip of a whole class's report cards. The files are generated on demand and streamed to the client.

Generation used to live in the browser (jsPDF, `xlsx`, `@react-pdf/renderer`); it now runs here. The grade data being rendered comes from the [Calculation Module](./calculation.md), so no calculation logic is duplicated - only the rendering moved.

## Files

| File | Purpose |
|------|---------|
| `report-files.module.ts` | Module definition |
| `report-files.controller.ts` | Streaming endpoints |
| `report-files.service.ts` | Fetch data → generate → `{ buffer, filename, contentType }` |
| `generation/pdf.generator.ts` | jsPDF: student term report + class summary |
| `generation/year-pdf.generator.ts` | jsPDF: year-end report + year class summary |
| `generation/export.generator.ts` | CSV + XLSX (`write-excel-file`, async) class summary |
| `generation/year-export.generator.ts` | CSV + XLSX year class summary |
| `generation/student-report.generator.tsx` | react-pdf designed report card |
| `generation/exam-report.generator.tsx` | react-pdf exam report |
| `generation/class-summary.transform.ts` | `termResultsToClassSummary` + `ClassSummary` type |
| `generation/grading-rules.ts` | Grading-model display rules (ported from the frontend) |

## Endpoints

Under `AuthGuard + PermissionGuard + ClassTeacherGuard`. Every endpoint takes `studentGroupId` so the guard can resolve the class. File responses set `Content-Type` + `Content-Disposition`.

| Method | Route | Query | Permission |
|--------|-------|-------|------------|
| GET | `/reports/files/student-term.pdf` | `studentId, termId, studentGroupId` | `reporting:read` |
| GET | `/reports/files/student-year.pdf` | `studentId, academicYearId, studentGroupId` | `reporting:read` |
| GET | `/reports/files/student-report-card.pdf` | `studentId, termId, studentGroupId` | `reporting:read` |
| GET | `/reports/files/class-summary` | `studentGroupId, termId, reportType, format=pdf\|csv\|xlsx` | `reporting:read` |
| GET | `/reports/files/exam-report.pdf` | `studentGroupId, termId, reportType` | `reporting:read` |
| GET | `/reports/files/class-zip` | `studentGroupId, termId, reportType` | `reporting:read` |
| POST | `/reports/files/class-summary/persist` | `{ studentGroupId, termId, reportType }` | `reporting:create` |

`persist` generates the three class-summary formats and stores them via the [Reporting Module](./reporting.md)'s `uploadClassSummaryFile`, replacing the old client "generate & upload all" flow.

## Bulk zip streaming

`class-zip` is built for large classes. It plans the entries (auth + the cached calculation fetch) **before** writing any response, then calls `reply.hijack()` and pipes an `archiver` stream straight to the socket. PDFs are generated **one at a time** - the next entry is appended only after the previous is flushed - so at most one PDF buffer is live and memory stays flat regardless of class size. Because hijacking bypasses the framework CORS layer, the handler sets `Access-Control-Allow-Origin`/`-Credentials` and `Access-Control-Expose-Headers: Content-Disposition` manually.

## Notes

- The `.tsx` generators require `"jsx": "react"` in the backend `tsconfig.json` and the `react` + `@react-pdf/renderer` dependencies; they render with `renderToBuffer` (no browser/DOM).
- `archiver` is pinned to v7 (v8 is a typeless ESM-only rewrite).
- CORS exposes `Content-Disposition` globally ([createApp.ts](../../../backend/src/createApp.ts)) so the frontend can read the server-provided filename.
