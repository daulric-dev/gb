---
sidebar_label: 2026-06-04 · Dependency maintenance
sidebar_position: 1
---

# 2026-06-04 - Dependency maintenance

A maintenance pass over the dependency tree, prompted by an audit of which packages are still actively maintained. The headline change is dropping SheetJS (`xlsx`), which has been unmaintained on npm since 2022 and ships known security advisories. Two other packages were bumped, one was deliberately held back, and a React version pin that was silently holding the whole repo back was reconciled. No migrations are required.

## Replaced SheetJS (`xlsx`) with `write-excel-file`

The backend used `xlsx@0.18.5` to generate the class-summary and year-end XLSX exports. That is the last version SheetJS ever published to npm (March 2022); newer builds are distributed only from their own CDN, and `0.18.5` carries unpatched prototype-pollution (CVE-2023-30533) and ReDoS (CVE-2024-22363) advisories. The npm package is effectively abandoned.

Since the code only ever *writes* spreadsheets (it never parses them), it was swapped for [`write-excel-file`](https://www.npmjs.com/package/write-excel-file) — an actively maintained, write-only library whose feature set (multiple named sheets, column widths, horizontal cell merges) covers everything the generators need.

**Fix.** [export.generator.ts](../../../../backend/src/report-files/generation/export.generator.ts) and [year-export.generator.ts](../../../../backend/src/report-files/generation/year-export.generator.ts) now build sheet data for `writeXlsxFile(...)` instead of `XLSX.utils`:

- `worksheet['!cols'] = [{ wch }]` → the sheet's `columns: [{ width }]`.
- `worksheet['!merges'] = [{ s, e }]` → a `columnSpan` on the subject-header cell, with the covered cells left as `null` (the library's merge convention). The resulting merge range is byte-for-range identical to the old SheetJS output (e.g. `C1:E1`).
- `XLSX.write(wb, { type: 'buffer' })` → `await writeXlsxFile(sheets).toBuffer()`.

### Behavior change: XLSX builders are now async

`writeXlsxFile(...).toBuffer()` returns a `Promise<Buffer>`, so `buildClassSummaryXlsxBuffer` and `buildYearClassSummaryXlsxBuffer` now return `Promise<Buffer>` rather than `Buffer`. The single consumer, [report-files.service.ts](../../../../backend/src/report-files/report-files.service.ts), `await`s them inside the existing async `getClassSummaryFile`; the CSV and PDF branches are unchanged. No controller or route signatures changed, and the generated files are identical (validated as a valid zip container with the expected `Summary`/`Students` sheets and merge ranges).

The `xlsx` dependency was removed from the backend entirely.

## react-day-picker 9 → 10

Bumped [`react-day-picker`](../../../../frontend/package.json) from `^9.14.0` to `^10`. The only breaking change that touched our code was a renamed `classNames` key: the grid element moved from `table` to `month_grid` in [calendar.tsx](../../../../frontend/components/ui/calendar.tsx). None of v10's removed props (`fromMonth`, `toMonth`, `initialFocus`, etc.) were in use. Frontend typecheck is clean.

## React/react-dom version pin reconciled

The root [package.json](../../../../package.json) `overrides` block pinned `react`/`react-dom` to `19.2.5`, which was *older* than the versions the workspaces actually requested (frontend `19.2.6`, backend `^19.2.7`). The override therefore silently held the whole repo back to `19.2.5`. Everything is now unified on **`19.2.7`** (the latest, and what the backend already wanted): the root override, [frontend/package.json](../../../../frontend/package.json), and [docs/package.json](../../../../docs/package.json). The lockfile now resolves a single React version across all workspaces.

## archiver: evaluated v8, stayed on v7

`archiver` is one major behind (`8.0.0` is out), but v8 is a ground-up **ESM-only rewrite** with a new class-based API (`ZipArchive`/`TarArchive`) and **no TypeScript types** — DefinitelyTyped's `@types/archiver` still only covers v7. Adopting it today would mean losing type coverage and rewriting the streaming zip logic in [report-files.controller.ts](../../../../backend/src/report-files/report-files.controller.ts) against an unproven API, for no functional gain. It is the same maintainers' work and v7 carries no security advisories, so the dependency was deliberately kept at `^7`. Worth revisiting once `@types/archiver@8` ships and the rewrite stabilizes.

## Tests

Backend: 214 passing, typecheck clean. Frontend: typecheck clean (pre-existing `bun:test` type-resolution warnings in `*.test.ts` files are unrelated and untouched).
