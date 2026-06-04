---
sidebar_label: 2026-06-04 · Server-side report files
sidebar_position: 3
---

# 2026-06-04 - Server-side report-file generation

All report files (student report-card PDFs, year-end PDFs, class-summary PDF/CSV/XLSX, exam-report PDFs) were generated **in the browser** with jsPDF, the `xlsx` library, and `@react-pdf/renderer`, then saved with a client-side blob download. This release moves all of that generation to the backend and streams the files to the client - including a new bulk "download all report cards as a zip" that streams compactly for large classes.

No migration required.

## Backend

New `ReportFilesModule` ([report-files.module.ts](../../../../backend/src/report-files/report-files.module.ts)). The existing frontend generators were ported to Node largely as-is - the jsPDF and CSV builders return a `Buffer` instead of a `Blob`, the XLSX builders use the maintained `write-excel-file` library (and are now async - see [Dependency maintenance](./dependency-maintenance.md)), and the two `@react-pdf/renderer` documents use `renderToBuffer`. The grade data they render already exists server-side via `CalculationService`, so no calculation logic was duplicated; only the rendering moved.

New endpoints (under `/reports/files/*`, guarded by `AuthGuard + PermissionGuard + ClassTeacherGuard`, `reporting:read`):

| Route | File |
|-------|------|
| `GET /reports/files/student-term.pdf` | per-student term report |
| `GET /reports/files/student-year.pdf` | per-student year-end report |
| `GET /reports/files/student-report-card.pdf` | designed report card (react-pdf) |
| `GET /reports/files/class-summary?format=pdf\|csv\|xlsx` | class summary (term + year) |
| `GET /reports/files/exam-report.pdf` | exam report (react-pdf) |
| `GET /reports/files/class-zip` | bulk zip of every student's report card |
| `POST /reports/files/class-summary/persist` | generate + store the 3 summary files (`reporting:create`) |

### Bulk zip streaming

`class-zip` ([report-files.controller.ts](../../../../backend/src/report-files/report-files.controller.ts)) plans the entries (auth + the cached calculation fetch) *before* hijacking the response, then pipes an `archiver` stream straight to the socket, generating **one PDF at a time** (the next entry is appended only after the previous is consumed). Memory stays flat regardless of class size. Because hijacking bypasses the framework CORS layer, the handler sets the cross-origin + `Content-Disposition` headers manually.

## Frontend

- New `downloadFromUrl` helper ([lib/reports/download.ts](../../../../frontend/lib/reports/download.ts)) - fetch the file, read the server-provided filename from `Content-Disposition`, save it. The student, class-report, and class-detail pages now call the endpoints instead of building blobs locally.
- A **"Download all (PDFs)"** button was added to the class Reports toolbar, hitting `class-zip`.
- The client generators (`pdf.ts`, `year-pdf.ts`, `export.ts`, `year-export.ts`, `exam-report-pdf.tsx`, `student-report-pdf.tsx`) and the deps `jspdf`, `jspdf-autotable`, `xlsx`, `@react-pdf/renderer`, `jszip` were removed from the frontend. The `grading-rules` and calculation types stay (still used to render on-screen views).

## Config

`createApp.ts` adds `exposedHeaders: ['Content-Disposition']` to CORS so the browser can read the server-provided download filename.

## Tests

New unit tests for every generator (PDF/zip magic-byte + content assertions), the class-summary transform, the zip streamer, and a `ReportFilesService` smoke test. Backend suite green, `nest build` clean (confirms the `.tsx`/react-pdf path compiles). Verified end-to-end: every endpoint returns a valid file, and `class-zip` produces one PDF per student.
