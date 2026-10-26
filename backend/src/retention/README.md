# Retention (`src/retention`)

The daily purge of personal data that has been deleted but not yet erased. Files, folders, chat messages and discussion replies are **soft-deleted** (`deleted_at` set) so the apps can hide them at once; without this job the rows - and every backup of them - would keep the "deleted" data forever. Once a row has been soft-deleted longer than `SOFT_DELETE_RETENTION_DAYS` (default 30), it is erased for good, and the erasure is written to the [erasure log](../erasure/README.md) with reason `retention_purge` in the same transaction.

## What it provides

- **HTTP routes** - none.
- **Services / exports**
  - `RetentionService.purge({ dryRun?, now?, retentionDays?, only? })` - one run; returns a `PurgeReport` with counts and errors. Never throws.
  - `RetentionScheduler` - the timer (not exported).
- **CLI** - `bun run retention:purge [--dry-run] [--retention-days N] [--only <id,...>]` ([`scripts/retention-purge.ts`](../../scripts/retention-purge.ts)) runs one purge now under the same advisory lock. `--only` limits it to those row ids and skips the global clean-ups (for tests). It ignores `RETENTION_PURGE_ENABLED`.

## What a run does

Each kind works in batches (`RETENTION_PURGE_BATCH_SIZE`, default 500), one transaction and one erasure-log entry per school per batch, and fails on its own (logged in `errors`) without stopping the others. The run stops when `RETENTION_PURGE_MAX_MINUTES` (default 10) is used up; the next run continues.

| Kind | Selected | Done |
| --- | --- | --- |
| Files (`file_manager.file`) | `deleted_at` older than the retention, and **not attached to a submission** (handed-in work is part of the school's record) | Storage objects deleted **first**, then the rows (cascading module items, shares, file notifications). If storage fails the rows stay and the next run retries; if the row delete fails after the objects went, the next run deletes the already-missing objects (a no-op) and then the rows. |
| Folders (`file_manager.folder`) | Expired, every child folder expired too, no live file inside | Rows deleted (child folders cascade; files' `folder_id` is set null). |
| Chat messages (`chat.message`) | Expired tombstones | Rows deleted. Nothing references a message, so conversations stay consistent; the "message deleted" placeholder simply disappears. |
| Discussion replies (`course.discussion_reply`) | Expired | Replies nobody answered are deleted (which can make an expired parent placeholder a leaf; the next batch takes it). A reply others answered stays as the "This post was deleted" placeholder so the thread holds together, but loses its author (`author_user_profile_id = null`; the body is already blank). |
| Sessions, sign-in codes, remembered devices (`account`) | Sessions expired (sliding or absolute lifetime) or revoked, codes created, more than a day ago; `account.known_device` rows unused for 90 days | Deleted. **Not** written to the erasure log: nobody asked for these to be erased, and a restore signs everyone out anyway. SSO state and handoff codes live in the cache with a TTL. |
| Erasure log | Entries older than `ERASURE_LOG_RETENTION_DAYS` (400) | Rows and their storage copies deleted. |
| Account storage | `account` erasures of the last 7 days | Their `delete_storage_prefix` steps re-run, finishing object deletions that failed when the account was deleted. |
| Export | Erasure-log rows not yet copied to storage | Exported (see the erasure README). |

A dry run counts what each kind would purge and changes nothing (no storage calls, no transactions).

## Scheduling

`RetentionScheduler` ticks every 15 minutes in every API instance (not in tests). Each tick retries the erasure-log export; the purge runs when it is due: once `RETENTION_PURGE_INTERVAL_HOURS` (24) have passed since this instance last ran it, and - for a whole-day interval - during `RETENTION_PURGE_HOUR_UTC` (3). Like [`BillingScheduler`](../billing/README.md), the purge holds a transaction-scoped Postgres advisory lock (`pg_try_advisory_xact_lock(hashtext('gradebook:retention:purge'))`), so only one instance purges at a time; an instance that finds the lock held skips the day. A second instance running later the same day finds nothing left. `RETENTION_PURGE_ENABLED=false` stops the purge (the export still runs).

## Used by

`AppModule` imports `RetentionModule`. The CLI builds `RetentionService` and `RetentionScheduler` by hand.

## Depends on

`PrismaService`, `StorageService`, `ErasureLogService` and `ErasureReplayService` ([src/erasure](../erasure/README.md)).

## Data

| Table | Read | Write |
| --- | --- | --- |
| `file_manager.file`, `file_manager.folder` | expired rows | delete |
| `chat.message` | expired rows | delete |
| `course.discussion_reply` | expired rows, child counts | delete, or clear author |
| `account.session`, `account.email_code`, `account.known_device` | old rows | delete |
| `compliance.erasure_log` | - | insert (purges), delete (pruning) |

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `RETENTION_PURGE_ENABLED` | `true` | `false` stops the scheduled purge. |
| `SOFT_DELETE_RETENTION_DAYS` | `30` | Days a soft-deleted row is kept. |
| `SOFT_DELETE_RETENTION_DAYS_FILES`, `_FOLDERS`, `_CHAT_MESSAGES`, `_DISCUSSION_REPLIES` | the above | Per-kind overrides. |
| `RETENTION_PURGE_HOUR_UTC` | `3` | Hour (UTC) of the daily run. |
| `RETENTION_PURGE_INTERVAL_HOURS` | `24` | Hours between runs per instance. |
| `RETENTION_PURGE_BATCH_SIZE` | `500` | Rows per batch. |
| `RETENTION_PURGE_MAX_MINUTES` | `10` | Time budget per run. |

## Files

| File | Purpose |
| --- | --- |
| `retention.module.ts` | Provides `RetentionService` and `RetentionScheduler`. |
| `retention.service.ts` | The purge. |
| `retention.scheduler.ts` | Timer, due check, advisory lock. |
| `retention.config.ts` | Environment helpers. |
| `retention.service.test.ts` | Selection by retention (and overrides), storage-before-rows, partial-failure retry, batching, discussion leaves vs placeholders, auth leftovers, log pruning, dry run, time budget. |
| `retention.scheduler.test.ts` | Due times, the lock, export on every tick, the off switch, never throwing. |

## Tests

```bash
cd backend && bun test src/retention
```

## See also

- [src/erasure/README.md](../erasure/README.md), [infrastructure/BACKUPS.md](../../../infrastructure/BACKUPS.md#retention-and-the-right-to-erasure)
