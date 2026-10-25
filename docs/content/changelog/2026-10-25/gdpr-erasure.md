---
sidebar_label: 2026-10-25 · GDPR erasure log and purge
sidebar_position: 2
---

# 2026-10-25 - GDPR: erasure log, replay after restore, soft-delete purge

Two gaps in [Backups & GDPR](../../backups.md) are closed. Restoring a backup
used to bring back everything erased since the backup with no way to know what
that was, and soft-deleted files, folders, chat messages and discussion replies
stayed in the database (and every backup) forever.

## Erasure log (`backend/src/erasure`)

- New table **`compliance.erasure_log`** (new `compliance` schema, migration
  `20261025120000_erasure_log`). Every erasure of personal data writes one row
  **in the same transaction** as the erasure: account deletion
  (`DELETE /api/auth/account`), file and folder delete, chat message delete,
  discussion topic and reply delete, course delete, attendance session delete,
  removing someone from a school (or leaving), merging a duplicate student
  record, and the retention purge.
- Rows hold **ids only**: kind, subject table and uuids, school, actor (user id
  or `system`), reason (`user_request`, `admin`, `retention_purge`, `merge`) and
  a `replay` plan of uuid-only delete/update steps validated against a fixed
  table/column list. No names, emails, bodies or file names; no email hash.
- Each entry is also copied, signed, to the app bucket under
  `ERASURE_LOG_S3_PREFIX` (default `erasure-log/`) right after commit, with
  retries every 15 minutes (transactional outbox), so the log survives the
  database restore it is needed for.
- **`bun run erasure:replay --since <backup time> [--dry-run]`** re-applies every
  logged erasure since then from the database and the storage copy (union,
  de-duplicated), oldest first, one transaction per entry; idempotent; exits
  non-zero on failure. Now step 5 of the restore runbook in
  `infrastructure/BACKUPS.md`.
- Entries are kept `ERASURE_LOG_RETENTION_DAYS` (default 400).

## Retention purge (`backend/src/retention`)

- A daily job in the API (03:00 UTC, one replica at a time via a Postgres
  advisory lock, like billing) hard-deletes rows soft-deleted more than
  `SOFT_DELETE_RETENTION_DAYS` (default 30; per-kind overrides) ago: files
  (storage object first, then the row; files attached to a submission are
  kept), folders, chat message tombstones, and discussion replies (answered
  placeholders keep their place but lose their author). Each purge is logged
  as `retention_purge`.
- Also clears sessions expired or revoked, and sign-in codes created, more than
  a day ago, and prunes the erasure log.
- Batched (500), time-boxed (10 minutes), never throws; `RETENTION_PURGE_ENABLED=false`
  turns it off. `bun run retention:purge [--dry-run]` runs it by hand.

## Behaviour changes

- `DELETE /api/auth/account` now deletes the profile and the account in one
  transaction (it used to be two steps), and afterwards deletes the user's
  stored files and avatar, which used to be left in the bucket.
- Removing a school member now detaches the user in the same transaction; a
  failure there is a 400 instead of being logged and ignored.
- Soft-deleted items are now gone for good after 30 days.
- `StorageService.listKeys(prefix)` added.

## Deploy

- `prisma migrate deploy` (the container does it on start).
- Optional env: `RETENTION_PURGE_*`, `SOFT_DELETE_RETENTION_DAYS*`,
  `ERASURE_LOG_S3_PREFIX`, `ERASURE_LOG_RETENTION_DAYS`
  ([environment variables](../../environment-variables.md)). Keep `AUTH_SECRET`
  stable: it keys the signatures on the storage copy.
- The first purge after deploying erases everything soft-deleted more than 30
  days ago. Run `bun run retention:purge --dry-run` first to see how much.
- The privacy policy needs the retention and erasure-record wording (being
  updated separately).
