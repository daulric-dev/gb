# Rostering (`src/rostering`)

SIS / rostering sync: import or sync students, staff, classes and enrolments from **CSV uploads** (a OneRoster 1.2 CSV bundle, or GradeBook's own templates) or a **OneRoster 1.2 REST endpoint** (OAuth2 client credentials). Every sync is a **dry run** first (a stored change set the admin reviews), then an **apply** in the background. Nothing is ever deleted. Behind the organisation-level feature `rostering` (default off). Admin guide: [docs/content/guide/rostering.md](../../../docs/content/guide/rostering.md).

## What it provides

### HTTP routes

All under `/api/organisation/rostering`, `AuthGuard` + `OrganisationAdminGuard` + `RosteringFeatureGuard` (`FeatureService.assertEnabled(null, 'rostering')`: the organisation's own setting, so a school's switch never matters; 403 `FEATURE_DISABLED` while off).

| Method | Path | Step-up | What it does |
| --- | --- | --- | --- |
| GET | `/templates/:kind` | | `students`, `staff`, `classes` or `enrolments` template CSV (header + example row). |
| GET | `/sources` | | Sources with their last run. Never the secret (`hasSecret`, `secretUnreadable`). |
| POST | `/sources` | yes | `{ name, kind: 'csv' \| 'oneroster_api', baseUrl?, tokenUrl?, clientId?, clientSecret?, schedule?: 'off' \| 'daily', autoApply?, settings? }`. `daily` only for API sources. |
| GET | `/sources/:id` | | One source. |
| PATCH | `/sources/:id` | only for `baseUrl` / `tokenUrl` / `clientId` / `clientSecret` | Name, schedule, auto-apply, `settings` (`orgMap`, `matchBy`, `notifyStudents`, `sendStaffInvites`, `scope`); a non-empty `clientSecret` replaces it. Mapped school ids must exist. |
| DELETE | `/sources/:id` | yes | 204. Links and runs cascade; GradeBook records it created stay. |
| POST | `/sources/:id/test` | | Test the saved source. |
| POST | `/sources/:id/uploads` | | `{ filename, contentType, size ≤ 50 MB }` → `{ key, method, uploadUrl, headers }`: a presigned PUT to `rostering/uploads/<sourceId>/…` (CSV sources). |
| POST | `/sources/:id/runs` | | Start a dry run: `{ uploads?: key[] }` (CSV: 1-10 of this source's keys; API: none). 409 while another run of the source is active. |
| GET | `/sources/:id/runs` | | The last 50 runs. |
| GET | `/sources/:id/runs/:runId` | | One run: status, summary, progress, error. |
| QUERY | `/sources/:id/runs/:runId/changes` | | `{ entity?, action?, status?, search?, limit? (≤500), offset? }` → `{ total, data }`. |
| POST | `/sources/:id/runs/:runId/apply` | | `{ includeDisables? }`. Only a `planned` run, and only the source's newest (409 otherwise). |
| POST | `/sources/:id/runs/:runId/cancel` | | Discard a planned run. |
| GET | `/sources/:id/runs/:runId/errors.csv` | | Error rows and failed changes (formula-safe cells). |

### Services

- `RosterSourceService`: CRUD, secret encryption, test connection, upload tickets, `clientFor(source)`.
- `RosterRunService`: `startDryRun`, `plan` (job), `apply`, `applyRun` (job and resume path), `resumeStale`, reads, `errorsCsv`.
- `RosterStateService`: loads what the planner compares against.
- `RosterApplyService`: applies one change.
- `RosterClaimService`: links rostered students to accounts (verified sign-in hook) and the opt-in student email.
- `RosteringScheduler`: resume + daily syncs.

## Design

**Normalise** (`roster-csv.ts`, `oneroster-client.ts` → `RosterSnapshot`, `roster-types.ts`): orgs, sessions, users (kind `student` or `staff`), classes, enrolments, row errors (file, line, message) and `present` (which parts the source carried). `tobedeleted` rows and disabled users count as absent; parents and guardians are skipped. CSV parsing reuses the gradebook import's RFC 4180 `parseCsv` (with a 40 M-character limit here); ZIPs are read by `zip.ts` (stored/deflate, ≤ 64 entries, 40 MB per entry, 120 MB total; no new dependency).

**Plan** (`roster-plan.ts`, pure): orgs → schools through `settings.orgMap` (an unmapped org: one error row, its records wait; `null` = ignore). Per school, a class's first session → academic year (+ term); years and terms keyed `<sourcedId>@<schoolId>`, matched by link then name. Classes → courses (draft). Students: link, else student number, else email (account email or another link's roster email), each switchable; ambiguity, a taken number or a school move is an error row. Staff: link, else account by email (member → link only; not a member → teacher membership; no account → `school_staff` invite; a student/parent account → error). Enrolments → `course_student`; teacher/aide enrolments → `course_staff` (`teacher` / `ta`), waiting (counted, not a change) while the teacher has no account. A matched record always gets an `update` (perhaps with an empty diff) so the apply records its link; a re-run is then quiet. Links not in the source, for parts it carried, become `disable` changes. Output is sorted: parents first, disables last (children first), errors at the end.

**Store**: `roster_change` rows (`seq`, entity, action, sourced id, target id, label, `diff` `{ field: { from, to } }`, `data`, errors, status). Uploads are deleted after planning.

**Apply** (`RosterApplyService`): one transaction per change, which also upserts its `roster_link` and marks the change `applied` (a re-delivered change already applied is skipped). Writes the diff's `to` values. Idempotent: years/terms/enrolments/course roles found by natural key, a create whose link points at a live record updates it. Staff invites go through `InviteService.invite('school_staff', …, { sendEmail })` outside the transaction, reusing an open invite. Disables never delete: student `is_active=false`, course `archived` (previous status kept in the link to restore), enrolment `dropped`, `course_staff` row removed (not the last teacher), pending staff invite revoked (memberships are left to admins). Each change is audit-logged (`roster_<entity>`, the diff) under the applying admin (or the source's creator for scheduled runs), plus `roster_run` start/finish and `roster_source` CRUD.

**Jobs**: `roster-sync` BullMQ queue (`plan` / `apply`) with Redis; otherwise in-process after the request answers (`inflight`). The run loop applies pending changes in batches of 100, updates `progress_*` and `heartbeat_at`, skips unconfirmed disables, stops if the feature is turned off. `RosteringScheduler` (every 5 min, advisory lock): fails dry runs stuck `planning` > 30 min, re-enqueues applies whose heartbeat is > 10 min old (they continue from the pending changes), and starts the dry run of each `daily` API source (`trigger: scheduled`; auto-applies creates/updates only, `includeDisables: false`, when `auto_apply`).

**Accounts**: rostered students have no login. `RosterClaimService` registers an `AccountService.onVerifiedSignIn` hook: a verified email equal to a student link's roster email links the (unlinked, active) student to that account if it is in no school (not a parent, no staff memberships) and makes the profile that school's student. The same runs after creating a student whose email already has an account. Students are emailed only when the source's `notifyStudents` is on. Staff get `school_staff` invites (src/organisation): accepted on first verified sign-in as a `teacher` membership, never admin.

## Security

- Organisation admins only; feature-gated; endpoint/credential changes and deletes need step-up.
- Client secret: AES-256-GCM via `src/account/secret-box.ts` (info `gradebook:roster-secret:v1`, AAD `roster-source:<id>`); never returned, logged or audited (`client_secret_changed: true` only).
- Outbound: `safeWebhookFetch` from `src/integrations` (DNS resolved per request, private/loopback/reserved addresses refused unless `WEBHOOK_ALLOW_PRIVATE=true`, IP pinned, no redirects); https required (http only with that switch); no credentials in URLs; 30 s timeout, 20 MB per response, 2000 pages per collection, ≥ 100 ms between requests, 429/5xx retried up to 5 times (Retry-After honoured, capped at 60 s); SSRF refusals are not retried.
- Uploads: presigned, size-signed, under the source's prefix (checked on dry run), deleted after planning; ZIP limits above.

## Data

[`prisma/schema/rostering.prisma`](../../prisma/schema/rostering.prisma), migration `20261120100000_rostering`: `roster_source`, `roster_link` (unique `(source_id, entity, sourced_id)`), `roster_run`, `roster_change`; `student.student.student_number` (unique per school when set); `organisation_invite` kind `school_staff` (CHECKs updated, one open per school and email).

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `ROSTERING_SCHEDULER` | `true` | `false` stops the resume + daily sync sweep in this instance. |
| `USE_REDIS`, `REDIS_URL` | | BullMQ mode. |
| `WEBHOOK_ALLOW_PRIVATE` | `false` | Also allows private-network (and http) OneRoster endpoints. |

## Tests

```bash
cd backend && bun test src/rostering
```

`roster-csv.test.ts` (OneRoster 1.2 and 1.1 bundles, malformed rows with lines, missing columns, duplicates, quoting/BOM; templates incl. malformed rows and partial uploads; ZIP reading and size caps), `roster-plan.test.ts` (first sync order, **re-run = no changes** after an in-memory apply, teacher linked after sign-in, field diffs, **match by email fallback**, student number and switching matching off, staff memberships, **disables proposed and only applied when confirmed**, partial uploads, unmapped/ignored orgs, year/term by name), `oneroster-client.test.ts` (OAuth2 + pagination, backoff and Retry-After, token refresh, **SSRF guard** on private addresses, URL rules, JSON shapes), `rostering.service.test.ts` (**flag off ⇒ 403**, guards and step-up, **credentials encrypted at rest**, SSRF on test connection, org mapping, upload tickets, **disables need confirmation**, per-row failures, **apply resumability**, newest-run rule, feature off mid-apply, errors CSV, apply idempotency, invites, never-delete disables, last teacher, student claim). Invite acceptance for `school_staff`: `src/organisation/invite.service.test.ts`. Fixtures: `src/test/roster-fixtures.ts`.
