# Erasure log (`src/erasure`)

The GDPR erasure log: a record of every erasure of personal data, written in the **same transaction** as the erasure, so that erasures can be re-applied after a database backup is restored (`bun run erasure:replay`). It stores **ids only** - never names, emails, message bodies, file names or any other erased content.

Why it exists: restoring a backup brings back everything deleted since the backup was taken. Data-protection rules accept erased data lingering in backups for a limited, stated time only if erasures are re-applied whenever a backup is restored ([infrastructure/BACKUPS.md](../../../infrastructure/BACKUPS.md#retention-and-the-right-to-erasure)). This module is how.

## What it provides

- **HTTP routes** - none. The log is append-only: nothing updates or deletes entries except the exporter (stamps `exported_at`) and the retention job (prunes entries past `ERASURE_LOG_RETENTION_DAYS`). There is deliberately no admin UI or read route.
- **Services / exports** - the module is `@Global()`:
  - `ErasureLogService.record(tx, { kind, subjectTable, subjectIds, schoolId, actor, reason, replay })` - insert one entry with the transaction client the erasure runs in. Throws on anything that is not a uuid, an unknown kind/reason/table, or an invalid replay plan, which rolls the erasure back with it.
  - `ErasureLogService.exportPending()` - copy committed, not-yet-exported entries to object storage (see below). Also `removeObjects(keys, prefixes)` (best-effort storage clean-up after an erasure commits) and `prune(now, dryRun)`.
  - `ErasureReplayService` - read entries from the database, the storage copy or a JSON Lines file, merge them, and re-apply them (`replay()`, `applyEntry()`); `retryStorage(kind, since)` re-runs the storage steps of recent entries.
- **Other** - `erasure-plan.ts`: the replay plan format, the table/column registry, `validatePlan()`, `compileStep()` and the `plan` builders call sites use.

## The table

`compliance.erasure_log` (migration `20261025120000_erasure_log`, model in [`prisma/schema/compliance.prisma`](../../prisma/schema/compliance.prisma)):

| Column | What |
| --- | --- |
| `id`, `occurred_at` | uuid, commit-time timestamp |
| `kind` | `account`, `student`, `school_membership`, `file`, `folder`, `chat_message`, `discussion_topic`, `discussion_reply`, `course`, `attendance_session` (CHECK) |
| `subject_table`, `subject_ids` | e.g. `file_manager.file` and the uuids erased (non-empty) |
| `school_id` | the school it happened in, or null |
| `actor` | the user who asked (uuid) or `system` (CHECK) |
| `reason` | `user_request`, `admin`, `retention_purge`, `merge` (CHECK; nothing writes `merge` any more, it stays so older entries still replay) |
| `replay` | the plan below (`jsonb` object) |
| `exported_at` | when the storage copy was written; null = still to do |

**Why a `compliance` schema, not `public`:** it is not application data and has its own lifecycle (kept 400 days, no foreign keys so it outlives the rows it describes); a separate schema keeps it out of the app's models, lets an operator grant, dump or inspect it on its own (`pg_dump -n compliance`), and gives future records of processing an obvious home.

**No email hash.** Nothing in GradeBook re-imports people by email (accounts are created only when the person signs in again, which is their choice; roster imports are by staff), so there is nothing a hash would block, and replay works on uuids alone. Storing even a keyed hash of an erased address would keep a linkable identifier for no purpose, so the log has none.

The uuids themselves are pseudonymous personal data: after a restore they point at the person again. Keeping them is what makes re-applying the erasure possible (Art. 17, accountability under Art. 5(2)), they are kept for a fixed period, and the privacy notice says so.

## Replay plans

`replay` is `{ "v": 1, "steps": [...] }`, steps run in order:

| Step | Effect |
| --- | --- |
| `{ "op": "delete", "table", "where", "objects"? }` | `DELETE FROM <table> WHERE <col> = ANY(uuids) AND ...`. With `objects: true` (file rows only) the rows' storage objects are deleted first. |
| `{ "op": "update", "table", "where", "set" }` | Blank columns: `null`, `''`, `{}` (jsonb), a uuid, or `"$occurred_at"` = `COALESCE(col, occurred_at)`. Only rows that would change are touched, so a re-run updates 0 rows. |
| `{ "op": "delete_storage_prefix", "prefixes" }` | Delete every object under `file-manager/<school uuid>/<user uuid>/` or `images/avatars/<user uuid>.` - the only prefixes allowed. |

`where` maps a column to a uuid list (`= ANY`) or `null` (`IS NULL`); at least one list is required, so a step can never match a whole table. Tables and columns must be in `REGISTRY` in `erasure-plan.ts`; identifiers in the SQL come from there, values are always bound parameters. Plans read back from storage are untrusted and validated again.

What each path writes:

| Path | Kind / reason | Replay |
| --- | --- | --- |
| `DELETE /api/auth/account` (`AuthService.deleteAccount`) | `account` / `user_request` | delete storage prefixes of the user's files and avatar, file rows (with objects), `user_profile`, `app_user` (cascades sessions, identities, memberships, messages, ...) |
| Merge duplicate student (removed by `20261027140000_drop_student_merge`; older entries only) | `student` / `merge` | clear the join-time record's login, move it to the roster record (only if that one has none), delete the join-time record |
| Remove a member / leave a school (`SchoolService`) | `school_membership` / `admin`, `user_request` | delete the `school_management` row(s), detach the profile from that school |
| Delete a file (`FileManagerService.softDelete`) | `file` / `user_request` | set `deleted_at` |
| Delete a folder (`FolderService.remove`) | `folder` / `user_request` | set `deleted_at` on the subtree's folders and their files |
| Delete a chat message (`ChatService.deleteMessage`) | `chat_message` / `user_request` | clear `body`, set `deleted_at` |
| Delete a discussion topic / reply (`DiscussionService`) | `discussion_topic`, `discussion_reply` / author: `user_request`, moderator: `admin` | delete (replies cascade with a topic); a reply with answers is blanked instead |
| Delete a course (`CourseService.remove`) | `course` / `admin` | delete (cascades enrolments, work, marks, attendance, discussions) |
| Delete an attendance session (`AttendanceService.remove`) | `attendance_session` / `admin` | delete (cascades its attendance records) |
| Retention purge ([`src/retention`](../retention/README.md)) | `file`, `folder`, `chat_message`, `discussion_reply` / `retention_purge`, actor `system` | delete (files with objects); answered discussion placeholders lose `author_user_profile_id` |

Not logged, on purpose: deleting content that is not personal data (modules, pages, activities - refused when they have work - rubrics, grade scales, terms, announcements, roles, email domains, join codes); roster changes inside a course (`course_student` / `course_staff` removal - access changes, not erasures; a student with work is only marked `dropped`); push-token removal; expired sessions and sign-in codes (a restore signs everyone out anyway, BACKUPS.md step 4); quiz-answer replacement during an attempt. Billing invoices are financial records and are not erased.

## The storage copy (surviving a restore)

A restore rolls `compliance.erasure_log` back too, so the entries made since the backup would be lost exactly when they are needed. Each entry is therefore also written to the app bucket as one small JSON object:

```
<ERASURE_LOG_S3_PREFIX>/YYYY/MM/DD/<occurred_at compact>-<id>.json     e.g. erasure-log/2026/10/25/20261025T101500.123Z-<uuid>.json
```

This is a **transactional outbox**: `record()` only inserts the row (inside the caller's transaction); about two seconds later the service exports rows with `exported_at IS NULL` and stamps them, and the retention scheduler retries that every 15 minutes in every instance. A crash, a storage outage or a rolled-back transaction can therefore never lose an entry or export one that did not commit - at worst the copy is late. BullMQ was not used: an outbox in the same database needs no Redis, cannot drop a job when Redis is flushed, and re-exporting is idempotent because the key is fixed by the entry. Copies are signed (HMAC-SHA256 with a key derived from `AUTH_SECRET`); replay refuses an unsigned or altered copy unless `--allow-unsigned`. The copy holds the same ids-only content as the row. A database lost at the instant between commit and export (seconds) loses those entries; that window is documented in BACKUPS.md.

## Replay CLI

```bash
cd backend
bun run erasure:replay --since 2026-10-24T04:00:00Z --dry-run
bun run erasure:replay --since 2026-10-24T04:00:00Z [--source both|db|storage] [--from-file log.jsonl] [--allow-unsigned] [--json]
```

[`scripts/erasure-replay.ts`](../../scripts/erasure-replay.ts) reads entries with `occurred_at >= since` from the database and the storage copy (and a JSON Lines file if given), takes the union de-duplicated by id, and applies them oldest first (ties by id). Per entry: storage objects first (the keys are read from the rows that are about to go, so a storage failure leaves rows and entry for the next run), then one transaction with the SQL steps and, if the entry is missing from the restored log, the entry itself. It prints one line per entry (`APPLIED` / `nochange` / `FAILED`) and a summary, and exits 1 if any entry failed, 2 on bad arguments. `--dry-run` counts rows and objects without changing anything.

## Used by

`AuthService`, `StudentMembershipService`, `SchoolService`, `FileManagerService`, `FolderService`, `ChatService`, `DiscussionService`, `CourseService`, `AttendanceService` (all call `record(tx, ...)`), `RetentionService` and `RetentionScheduler` ([src/retention](../retention/README.md)), and the CLIs `scripts/erasure-replay.ts` and `scripts/retention-purge.ts`.

## Depends on

`PrismaService` and `StorageService` (global); `authSecret()` from [src/account](../account/README.md) for the signing key.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `ERASURE_LOG_S3_PREFIX` | `erasure-log` | Prefix in `S3_BUCKET` for the storage copy. `off` / `false` / `none` disables it (then replay can only use what the restored database still has). |
| `ERASURE_LOG_RETENTION_DAYS` | `400` | Entries (rows and copies) older than this are pruned by the retention job. Keep it longer than any backup you could restore. |
| `AUTH_SECRET` | - | Derives the signing key for the copies. Changing it makes older copies fail verification (`--allow-unsigned` reads them anyway). |

## Files

| File | Purpose |
| --- | --- |
| `erasure.module.ts` | Global module providing `ErasureLogService` and `ErasureReplayService`. |
| `erasure-log.service.ts` | `record()`, the outbox export, signing, `removeObjects()`, `prune()`. |
| `erasure-replay.service.ts` | Reading entries (database, storage, file), `mergeEntries()`, `replay()`, `retryStorage()`. |
| `erasure-plan.ts` | Kinds, reasons, plan format, table registry, validation and SQL compilation. |
| `erasure.config.ts` | Environment helpers (`erasureLogPrefix()`, `erasureLogRetentionDays()`, the signing key, `envInt()`). |
| `*.test.ts` | Plan validation and SQL, the service (in-transaction write, no personal data, export/retry, signatures, pruning), replay (idempotency, ordering, union/dedupe, storage-first, dry run, tampering) and `erasure-paths.test.ts` (every erasure path writes its entry on the transaction client and fails with it). |

## Tests

```bash
cd backend && bun test src/erasure
```

`bun run smoke` also deletes a file and a chat message through the API, checks the entries, purges both with `retention:purge --retention-days 0 --only ...`, simulates a restore (rows and log entries put back) and checks that `erasure:replay` removes them again from the storage copy and that a second run changes nothing.

## See also

- [infrastructure/BACKUPS.md](../../../infrastructure/BACKUPS.md) - restore runbook.
- [src/retention/README.md](../retention/README.md) - the soft-delete purge.
- [docs/content/backups.md](../../../docs/content/backups.md), [docs/content/environment-variables.md](../../../docs/content/environment-variables.md)
