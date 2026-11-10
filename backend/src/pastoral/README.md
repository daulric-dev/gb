# Pastoral notes (`src/pastoral`)

Behaviour and pastoral notes (ROADMAP item 14): private staff notes about a student, with categories, severity, follow-ups, attachments and a timeline. Behind the `pastoral_notes` feature (**off by default**; the organisation makes it available and each school can switch it off). User guide: [docs/content/guide/pastoral-notes.md](../../../docs/content/guide/pastoral-notes.md).

## Who sees what

Permissions (`src/permission`, resource `pastoral-note`):

| Key | Default | Allows |
| --- | --- | --- |
| `pastoral-note:read` | admins | See every non-safeguarding note in the school; the CSV export. |
| `pastoral-note:create` | admins, teachers | Write notes (and see your own). |
| `pastoral-note:update` | admins | Edit, resolve, reopen and delete any note you can see. |
| `pastoral-note:safeguarding` | admins | Needed **as well** to see, write, change or delete a note in a safeguarding category. |

- **Authors always see their own notes**, and may edit them while they hold `create` (a safeguarding note still needs `safeguarding`).
- A follow-up can only be assigned to school staff who could read the note (`read`, plus `safeguarding` for a safeguarding note).
- Attachments must be the author's own ready files in the school; they are served only through `GET /api/pastoral/notes/:noteId/files/:fileId` under the same rules.
- Categories and the retention period are managed with `school:update`.
- Everything is scoped to the caller's active school; another school's notes and students read as 404. Students, parents and anyone without a staff membership get 403.

**Never exposed elsewhere.** No other module reads the tables (the module exports nothing): not the student portal, the parent portal, report cards, webhooks, LTI, rostering or any export but this module's staff CSV. Audit entries for `pastoral_note`, `pastoral_category` and `pastoral_setting` carry ids and settings only (never note text) and never queue an `audit.changed` webhook (`PRIVATE_AUDIT_ENTITIES` in `src/audit-log`). Tests check these boundaries.

**Safeguarding reads are audited.** Every time a safeguarding note is returned - opened, in a timeline or list, in the follow-ups, in an export, or an attachment opened - an audit entry with action `read` (`entity` `pastoral_note`, the note id and student id) is written.

## HTTP routes

All under `/api/pastoral`, `AuthGuard` + `FeatureGuard` (`pastoral_notes`).

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/me` | The caller's abilities (`canRead`, `canCreate`, `canUpdate`, `canSafeguard`, `canManageSettings`). |
| GET | `/categories` (`archived=true`) | The school's categories (the six defaults are created on first use); safeguarding ones only with `safeguarding` or `school:update`. |
| POST / PATCH | `/categories`, `/categories/:id` | `school:update`: add (label, kind, restricted), rename, reorder, archive, restrict. Restricting a category moves its notes with it in the same transaction. |
| GET / PATCH | `/settings` | `retentionDays` (30-36500 or null); PATCH needs `school:update`. |
| GET | `/assignees` (`safeguarding=true`) | Staff a follow-up may go to. |
| GET | `/notes` (`studentId`, `categoryId`, `status`, `severity`, `assignedTo`, `from`, `to`) | Notes the caller may see, newest first (at most 500). |
| GET | `/follow-ups` | Open notes assigned to the caller, soonest follow-up first. |
| GET | `/export` (same filters) | Staff CSV (`read` required; safeguarding notes only with `safeguarding`; cells guarded against formula injection). |
| GET / POST | `/students/:studentId/notes` | A student's timeline; add a note (`categoryId`, `severity`, `occurredOn`, `body`, `followUpOn?`, `assignedTo?`, `fileIds?`). |
| GET / PATCH / DELETE | `/notes/:noteId` | One note; change it (including `status` open/resolved, `fileIds` replacing the attachments); delete it (204). |
| GET | `/notes/:noteId/files/:fileId` | Stream an attachment (`no-store`, `nosniff`, `sandbox`). |

## Retention and erasure

Notes are personal data:

- **Deleted with the student**: `pastoral_note.student_id` cascades (and the school cascades everything). Staff accounts that are deleted leave their notes, with the author cleared (`SET NULL`).
- **Retention**: with a school's `retention_days` set, the daily purge (`RetentionService.purgePastoralNotes`, [src/retention](../retention/README.md)) erases resolved notes that many days after they were resolved, in batches, with one erasure-log entry per school and batch (kind `pastoral_note`, reason `retention_purge`, actor `system`). Without a period notes are kept until the student is removed. Open notes are never purged.
- **Deleting a note** (`DELETE /notes/:id`) is an erasure: the row and an erasure-log entry (kind `pastoral_note`, reason `admin`, replay `delete student.pastoral_note`) commit together, plus an audit `delete` entry.
- Attachments stay in their owner's file manager (they are that person's files); only the link goes.

## Data

`prisma/schema/pastoral.prisma` (migration `20261128100000_pastoral_notes`): `student.pastoral_category`, `student.pastoral_note` (with `is_safeguarding` copied from the category so every filter is a column test), `student.pastoral_note_file`, `student.pastoral_setting`. The migration also inserts the four permission catalog rows and adds `pastoral_note` to the erasure-log kind CHECK.

## Files

| File | Purpose |
| --- | --- |
| `pastoral.module.ts` | Module (imports `FileManagerModule`, exports nothing). |
| `pastoral.controller.ts` | Routes. |
| `pastoral.service.ts` | Categories, settings, notes, follow-ups, export, attachments, audit of safeguarding reads, erasure on delete. |
| `pastoral-access.ts` | The caller and the visibility rules (`visibleNotes`, `canSeeNote`, `canChangeNote`, `canWriteIn`). |
| `pastoral.constants.ts` | Kinds, severities, statuses, default categories, limits. |
| `pastoral.dto.ts` | Request DTOs. |
| `pastoral.service.test.ts` | Permission matrix (incl. safeguarding), teacher/author rules, audited safeguarding reads (no text, no webhook), writes audited without text, edits and resolving, assignee rules, own-file attachments, attachment access, deletion as erasure, CSV rules and formula guarding, cross-school isolation, students and parents refused, categories, admin-only settings, the retention purge, and static checks that no portal, parent, report card, webhook, LTI or student-account code touches the notes. |

## Tests

```bash
cd backend && bun test src/pastoral
```
