# Course template library (`src/course/library`)

A shared library of course designs across courses and schools (ROADMAP item 13), behind the `course_copy` feature. Routes, rules and the import flow are documented in the [course README](../README.md#template-library); this file is the map of the folder.

## The decision on files

Importing a template **copies** the files the author linked into the importer's own storage; the importer never gains access to the author's files. Publishing copies them once into the library's storage (`course-library/<item>/<version>/`), so a version keeps working after the author changes or deletes a file, and each import copies them again into `file-manager/<school>/<importer>/`, owned by the importer and checked against the importing school's upload limit before anything is written. The same rule now applies to ordinary course copy and import (`CourseFileCopyService`).

## Files

| File | Purpose |
| --- | --- |
| `library.module.ts` | `CourseLibraryModule.forRoot()`: registers the BullMQ queue and processor with Redis. |
| `library.controller.ts` | `/api/library` routes. |
| `library.service.ts` | Browse, preview (`previewOf`), publish, republish (versions), update, unpublish. |
| `library-import.service.ts` | Import: `start` (checks, limit, row, enqueue), `run` (idempotent, resumable), `resumeStale`, status. |
| `library-import.processor.ts` | BullMQ worker (`course-library-import`). |
| `library-import.scheduler.ts` | Resume sweep (boot + every 5 minutes, advisory lock). |
| `library-access.ts` | The caller (active school, keys), visibility filter, who may manage an item, the organisation-sharing check. |
| `library.constants.ts` | Queue name, attempts, job ids, sweep timing. |
| `library.dto.ts` | Request DTOs. |
| `library.service.test.ts` | Publishing (files copied into library keys, author's key never stored, organisation permission, TA refused, selections, clean-up), versioning, unpublish, visibility and cross-school isolation, imports (new keys and owner, author's file never referenced, upload-limit failure before writes, new course, idempotency and races, stable file ids, failure clean-up, LTI items kept or skipped, excluded data, status only for the requester). |

## Data

`prisma/schema/library.prisma` (migration `20261127100000_template_library`): `course.library_item`, `course.library_item_version` (`content` = the snapshot, immutable), `course.library_import`. Library storage objects live under `course-library/`; deleting a school cascades its items and versions (their objects are left in storage).

## Tests

```bash
cd backend && bun test src/course
```
