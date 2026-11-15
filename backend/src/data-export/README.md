# Data exports (`src/data-export`)

Copies of the personal data GradeBook holds about a person, for subject
access (GDPR Article 15) and data portability (Article 20). A request creates
a `compliance.data_export` row and a job; the job checks access again, runs
the collectors for the export's scope, writes a ZIP to object storage and
marks the row ready. Only the person who asked can download it, for
`DATA_EXPORT_TTL_HOURS`, after which the sweep deletes it. How schools use it
is in [docs/content/guide/data-requests.md](../../../docs/content/guide/data-requests.md).

## Routes

All under `/api/data-exports`, signed in (`AuthGuard`). "Step-up" means the
session must have confirmed an emailed code in the last ten minutes.

| Method | Path | Step-up | Throttle | Who and what |
| --- | --- | --- | --- | --- |
| GET | `/` (`?studentId=`) | - | - | The caller's own export requests, newest first (50), optionally about one student. |
| POST | `/me` | yes | 5/hour | Anyone signed in: their own account (`self`). |
| POST | `/students/:studentId` | yes | 5/hour | Staff with `student:export` in the student's school (`staff`). Not a member of that school: 404, so ids cannot be probed. |
| POST | `/children/:studentId` | yes | 5/hour | A parent account for a linked child the parent portal shows them (`parent`): active child and school, not excluded by the school's age limit, `parent_portal` feature on. Anything else: 404. |
| GET | `/:id` | - | - | One of the caller's exports. |
| POST | `/:id/download` | yes | 20/hour | A 5-minute signed URL for the ZIP (`gradebook-data-<kind>-<date>.zip`). Ready and not expired only. Sets `downloaded_at`; audited. |
| DELETE | `/:id` | - | - | Delete the caller's export early (ZIP and row); audited. |

A second request while one for the same subject is `pending` or `running`
returns the existing one (a unique index, `data_export_one_active_key`, also
stops two racing clicks). Only the requester can see, download or delete an
export; there is no admin route to other people's exports.

Where the web app offers it: account settings (staff, organisation admins),
the student portal settings, the parent portal (per child), and the staff
student page (`staff` scope).

## Scopes

`data-export.types.ts`, `data-export-access.ts`. Access is resolved at the
request and again when the job runs, so access removed in between fails the
export (`Access check failed`, not retried).

| Scope (`kind`) | Subject | Contents |
| --- | --- | --- |
| `self` (`self`) | The caller's account and every student record linked to it, in every school | Everything held about them, except records staff keep about a student (pastoral notes and `staff-records`). README.txt says how to ask the school for those. |
| `staff` (`student`) | One student record, in the student's school only, plus the student's own account if one is linked (`account_type` student) | Everything the school holds: the student record, the account's sign-in identities, sessions (with IP address and browser), devices, account security metadata, files, the chat messages the student sent (decrypted), discussions, notifications, AI requests, integrations, audit entries, and the staff-only collectors. Guardian contact details and accommodation reasons need `student:sensitive`. |
| `parent` (`child`) | One linked child, that school only | What the school's parent portal shows (`parent_settings`): categories the school hides from parents are left out and named in README.txt. No messages, files, sign-in history or staff records. |

### Pastoral notes in staff exports

`pastoralCollector` uses the app's visibility rule (`pastoral-access.ts`):
the exporter's own notes; with `pastoral-note:read`, every non-safeguarding
note; with `pastoral-note:safeguarding` as well, every note. A note marked
withheld (`sar_withheld`, set by `PATCH /api/pastoral/notes/:noteId/sar-withheld`
with a reason, audited) is left out. The row's manifest records
`withheldNotes` (count) and `pastoralComplete` (the exporter could see every
note), and the API returns both with the export, so a partial export is not
mistaken for a complete one. `pastoral-note:safeguarding` is never granted
implicitly, not even to school admins (`EXPLICIT_ONLY_KEYS`).

## Collectors and the registry

`registry.ts` lists the collectors in README order. Each has an `id` (the
JSON file name), a `description` (copied into README.txt), the `scopes` it
runs in, an optional `parentSetting`, and `covers`: every person column
(`schema.table.column`) whose rows it exports.

| File | Collector ids |
| --- | --- |
| `collectors/account.ts` | `profile`, `sign-in-identities`, `sessions`, `devices`, `account-security` |
| `collectors/memberships.ts` | `memberships` |
| `collectors/coursework.ts` | `coursework`, `mastery` |
| `collectors/attendance.ts` | `attendance` |
| `collectors/reports.ts` | `reports` |
| `collectors/files.ts` | `files` |
| `collectors/communication.ts` | `chat`, `discussions`, `notifications` |
| `collectors/activity.ts` | `ai-requests`, `integrations`, `audit-log` (at most 10 000 entries) |
| `collectors/staff-only.ts` | `pastoral-notes`, `staff-records` (staff scope only) |

`EXCLUDED` in `registry.ts` lists person columns deliberately left out, each
with its reason (mostly a staff member's id on a record about someone else,
and who last changed a school setting). `registry.test.ts` scans the Prisma
schema (`schema-scan.ts`) and fails when a column that points at a person is
neither covered nor excluded, so a new table cannot silently miss exports.
The `covers` lists are also the starting point for the data inventory
([docs/content/gdpr/data-inventory.md](../../../docs/content/gdpr/data-inventory.md)).

Never exported: session tokens, sign-in codes, push tokens, authenticator
secrets and recovery-code hashes, signing keys, other people's messages, and
files other people shared (listed by name only).

## The ZIP

- `README.txt` (`readme.ts`): what the export is, one entry per category with
  its record count, the format, what is not included and why, and how long the
  download lasts.
- `<collector id>.json`: UTF-8 JSON, ISO 8601 UTC dates.
- `files/`: copies of stored objects (uploads, coursework, report card PDFs,
  pastoral attachments in staff exports). A file larger than
  `DATA_EXPORT_MAX_FILE_MB`, past the `DATA_EXPORT_MAX_TOTAL_MB` total, missing
  or unreadable is listed in `files-not-included.json` instead.

The ZIP is built in memory (`archive.ts`) and written to the app bucket at
`data-exports/<id>.zip`. The row keeps ids, status, byte size and a manifest
of counts; never the exported data.

## Jobs, lifetime and the sweep

- **With Redis** (`USE_REDIS=true` and `REDIS_URL`): BullMQ queue
  `data-export`, 3 attempts with exponential backoff from 10 seconds.
- **Without Redis**: in the API process, one at a time, after the request has
  answered, 3 attempts.
- When ready, the requester is emailed (no names in the subject or body) with
  a link to the page to download it and the expiry time.
- `DataExportScheduler` runs `sweep()` at boot and every 10
  minutes, in every instance, under a `job_lease` (`gradebook:data-export-sweep`)
  so one instance works at a time. Off under `NODE_ENV=test` or with
  `DATA_EXPORT_SWEEP=false`. A sweep:
  - deletes the ZIPs of exports past `expires_at` and marks them `expired`;
  - deletes `expired` rows 30 days later and `failed` rows after 7 days;
  - deletes ZIPs under `data-exports/` older than the longest lifetime that no
    ready row points at (a crash between upload and row update);
  - resumes `pending` or `running` exports untouched for 15 minutes, or fails
    them after 3 attempts.

## Audit

Every request (`create`, with `kind`, `student_id`, `subject_user_id`),
download (`read`) and early deletion (`delete`) is written to `audit_log`
with `entity: 'data_export'`: against the student's school for staff and
parent exports, and against the requester's active school for self exports.

## Data

| Table | What |
| --- | --- |
| `compliance.data_export` | `requested_by`, `kind`, `subject_user_id` or `student_id`, `school_id`, `status` (`pending`, `running`, `ready`, `failed`, `expired`), `storage_key`, `byte_size`, `manifest`, `attempts`, timestamps, `expires_at`, `downloaded_at`. Migration `20261205100000_data_export`. |

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `DATA_EXPORT_TTL_HOURS` | `24` | Hours a ready export can be downloaded (clamped to 1-168). |
| `DATA_EXPORT_MAX_FILE_MB` | `100` | Largest stored file copied in. |
| `DATA_EXPORT_MAX_TOTAL_MB` | `500` | Most MB of stored files per export. |
| `DATA_EXPORT_SWEEP` | `true` | `false` stops the sweep in this instance. |
| `USE_REDIS`, `REDIS_URL` | - | Queue mode, as above. |
