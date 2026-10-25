---
sidebar_label: Backups & GDPR
---

# Backups, point-in-time recovery and GDPR

Every production deployment must back up its Postgres database. GradeBook ships
two complementary pieces:

| | Daily encrypted dump | Continuous backup (point-in-time recovery) |
| --- | --- | --- |
| What | `pg_dump` of the whole database, encrypted with [age](https://age-encryption.org) **before** it leaves the server | Every committed transaction, as archived WAL plus a daily base backup |
| Works with | Any Postgres (managed or self-hosted) | Self-hosted: the `db` image in `infrastructure/postgres/` (WAL-G). Managed: your provider's PITR feature |
| Schedule | Every day at 04:00 (`BACKUP_SCHEDULE`, time zone `BACKUP_TZ`, default UTC) | WAL shipped at least every 60 s (`WALG_ARCHIVE_TIMEOUT`); base backup 04:00 |
| Worst-case data loss (RPO) | 24 hours | About 1 minute (self-hosted) / about 5 minutes (typical managed) |
| Kept for | 30 days (`BACKUP_RETENTION_DAYS`) | 7 base backups ≈ 7 days (`WALG_RETAIN_FULL`) / provider setting |
| Code | `infrastructure/backup/`, compose service `backup` | `infrastructure/postgres/`, compose services `db` + `db-backup` |

The full operator guide, with the IAM policy, key handling, every variable and
the step-by-step runbook (daily check, restore, point-in-time restore, key
rotation), is
[`infrastructure/BACKUPS.md`](https://github.com/daulric-dev/gb/blob/main/infrastructure/BACKUPS.md).
This page summarises it. **None of this is legal advice**; confirm retention
periods and privacy-notice wording with your data protection officer.

---

## Set it up

1. **Create an age key pair offline** (not on the server):
   `docker run --rm gradebook-backup:local age-keygen` or `age-keygen -o key.txt`.
   The public key (`age1...`) goes in `BACKUP_AGE_RECIPIENTS`. The private key is
   stored by two named people (password manager + sealed copy) and **never
   placed on the server**. Listing two public keys (primary and break-glass)
   is recommended.
2. **Create a separate backup bucket** in the same jurisdiction as your database
   (an EU region for EU schools), block public access, turn on versioning and
   Object Lock, and add a lifecycle rule that expires old (noncurrent) versions
   after about 7 days. Give the server a key that can only write, read and
   delete under its own prefix.
3. **Configure** `infrastructure/.env` (`BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`,
   `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`,
   `BACKUP_AGE_RECIPIENTS`, optionally `BACKUP_HEALTHCHECK_URL`), then:

   ```bash
   cd infrastructure
   docker compose up -d --build backup
   docker compose exec backup backup-now     # first backup, now
   docker compose exec backup backup-list
   ```

   The `backup` service starts with the stack by default. If it is not
   configured it stops with the reason and keeps restarting, so a missing
   backup is visible. It refuses to upload anything unencrypted.
4. **Continuous backup:**
   - *Managed Postgres:* enable point-in-time recovery in the provider console
     (e.g. AWS RDS automated backups with 7-35 days retention, Google Cloud SQL
     PITR, Azure Flexible Server 7-35 days, DigitalOcean 7 days). Keep the
     `backup` service too: it is a copy outside the provider account.
   - *Self-hosted:* uncomment `db` and `db-backup` in
     `infrastructure/docker-compose.yml` and set `WALG_S3_PREFIX`,
     `WALG_S3_*` credentials and `WALG_LIBSODIUM_KEY` (`openssl rand -hex 32`,
     keep an offline copy). The image is a drop-in for the existing
     `postgres:18.6-alpine` volume.
5. **Alerting:** point `BACKUP_HEALTHCHECK_URL` / `WALG_HEALTHCHECK_URL` at
   healthchecks.io (or similar) with a one-day period, or alert on the
   containers' Docker health status.

Variables are listed in [Environment Variables](./environment-variables.md#database-backups).

---

## Restore

```bash
# Into a NEW, empty database, with the private key mounted for this one command:
docker compose run --rm -v /secure/key.txt:/run/secrets/age:ro backup \
  backup-restore --latest --identity /run/secrets/age \
  --target 'postgresql://gradebook:...@db-host:5432/gradebook_restored'
```

The tool checks the sha256, checks the key, refuses a non-empty target (unless
`--force`) and restores in one transaction. Point-in-time restore on the
self-hosted image:
`walg-restore --target-time 2026-10-25T13:59:00Z` on a new volume, then start the
database normally. After **any** restore:

1. sign everyone out (`DELETE FROM account.session;`), because sessions revoked
   after the backup would work again;
2. **re-apply erasures** made since the backup:
   `bun run erasure:replay --since <backup time> --dry-run`, then without
   `--dry-run` (see below);
3. take a new backup.

`backup-verify` restores the newest backup into a throwaway database, checks
`_prisma_migrations` and the tables, prints row counts and drops it. Run it
weekly on a separate verification host with its own key, and do a full restore
drill every quarter. Keep a record of each test.

---

## GDPR checklist

- **What:** the backups contain all personal data in the database (pupils,
  staff, marks, attendance, messages). They do **not** contain uploaded file
  contents (version the app bucket separately) or application secrets.
- **Encryption:** dumps are encrypted on the server with a public key, so even
  the server cannot read old backups; WAL-G uses a symmetric key that lives on the
  database server with an offline copy. Transport is TLS.
- **Where:** a separate bucket and credentials, same jurisdiction as the live
  data, provider under a DPA and listed as a sub-processor.
- **Access:** least-privilege keys, read-only keys for restore/verify, MFA for
  bucket administration, versioning + Object Lock against ransomware, access
  logging.
- **Retention:** with the defaults, erased data can remain in backups for up to
  30 days (dumps) + 7 days (old versions). State the maximum in your privacy
  notice, e.g. *"Backups are kept encrypted for up to 37 days; data you delete
  disappears from backups when they expire."* Soft-deleted items add up to
  `SOFT_DELETE_RETENTION_DAYS` before that clock starts.
- **Right to erasure after a restore:** erasures made since the backup must be
  re-applied, and GradeBook records them for that. Every erasure (account
  deletion, deleted files, folders, chat messages, discussion posts, courses,
  attendance sessions, school removals, student merges, retention purges) writes
  an entry to `compliance.erasure_log` in the same transaction - ids only, no
  names, emails or content - and copies it to the app bucket
  (`ERASURE_LOG_S3_PREFIX`, default `erasure-log/`), which a database restore
  does not roll back. After a restore, `bun run erasure:replay --since <backup
  time>` reads both, de-duplicates and re-applies everything since then; it is
  idempotent, so running it twice changes nothing. Entries are kept
  `ERASURE_LOG_RETENTION_DAYS` (400 by default, longer than any backup).
  Requests handled outside GradeBook still belong in the DPO's register.
- **Soft deletes:** deleted files, folders, chat messages and discussion replies
  (`deleted_at`) are purged for good after `SOFT_DELETE_RETENTION_DAYS`
  (default 30) by a daily job in the API (`RETENTION_PURGE_ENABLED`), so they
  stay at most 30 days in the database plus the backup retention. Expired
  sessions and used sign-in codes are cleared after a day. Run it by hand with
  `bun run retention:purge [--dry-run]`.
- **Breaches:** a leaked backup is a personal-data incident to assess and
  document; encryption with keys held elsewhere is a strong mitigating factor.
  Losing every key (or backup) is an availability breach. Rotate the age key
  yearly and when a holder leaves; destroy old keys only after the backups
  encrypted to them have expired.
- **Testing:** Art. 32 asks for regular testing of the ability to restore:
  weekly automated verification plus a quarterly timed drill.
