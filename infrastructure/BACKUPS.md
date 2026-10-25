# Database backups, point-in-time recovery and GDPR

This page describes how the GradeBook Postgres database is backed up, how to
restore it, and what that means for data-protection (GDPR) obligations. It is
written for whoever operates a deployment. It is **not legal advice**: have your
data protection officer (DPO) or counsel confirm the retention periods,
privacy-policy wording and breach procedures for your schools.

| Piece | Where | What it does |
| --- | --- | --- |
| Daily logical backup | [`infrastructure/backup/`](./backup/) → compose service `backup` | `pg_dump` at 04:00, encrypted with [age](https://age-encryption.org) **before** upload, stored in an S3 bucket, kept 30 days. Works with any Postgres (managed or self-hosted). |
| Continuous backup (PITR), self-hosted | [`infrastructure/postgres/`](./postgres/) → compose services `db` + `db-backup` | Postgres 18.6 with [WAL-G](https://github.com/wal-g/wal-g): every WAL segment archived (encrypted) within ~60 s, a base backup at 04:00, 7 base backups kept. Restore to any second in that window. |
| Continuous backup (PITR), managed | Your database provider | Turn on the provider's point-in-time recovery (see [Managed Postgres](#managed-postgres)). The daily dump still runs as an independent, off-provider copy. |

Contents: [What is (and is not) backed up](#what-is-and-is-not-backed-up) ·
[RPO and RTO](#schedule-rpo-and-rto) · [Setup](#setup) ·
[Managed Postgres](#managed-postgres) · [Encryption and keys](#encryption-and-key-management) ·
[Storage location and access](#storage-location-and-access-control) ·
[Retention and erasure](#retention-and-the-right-to-erasure) ·
[Breaches](#incidents-and-breach-relevance) · [Restore testing](#restore-testing) ·
[Runbook](#runbook) · [Reference](#configuration-reference) · [Design notes](#design-notes)

---

## What is (and is not) backed up

**Backed up:** the whole `gradebook` database: every schema (`public`,
`account`, `course`, `grading`, `student`, `file_manager`, `chat`, `billing`,
`extensions`), all rows, functions, indexes, sequences and the
`_prisma_migrations` history. That covers every school, user, profile, course,
mark, submission, attendance record, file **metadata**, chat message
(stored encrypted by the API), notification and billing row.

**Not backed up by these tools - plan for them separately:**

| Not included | Why / what to do |
| --- | --- |
| File contents in the app bucket (`S3_BUCKET`: uploads, hand-ins, avatars) | The database stores only file metadata and keys. Turn on **versioning** (and replication if you want an off-provider copy) on the app bucket at your provider, with the same retention thinking as below. A restored database whose file rows point at deleted objects shows those files as missing. |
| Application secrets (`AUTH_SECRET`, `CHAT_ENCRYPTION_KEY`/`CHAT_ENCRYPTION_KEYS`, `STUDENT_CLAIM_CODE_PEPPER`, SSO and payment keys) | Keep them in your secret manager. **Chat messages in a backup can only be read with the chat key ring that was in use**: keep every old key version in `CHAT_ENCRYPTION_KEYS` for at least the backup retention period. |
| Postgres roles and server settings | `pg_dump` covers one database, not cluster-wide roles. The app uses a single owner role; a restore makes the connecting role the owner (`--no-owner`). |
| Redis | Caches, presence and pub/sub rebuild themselves; only queued, unsent share notifications could be lost. |

---

## Schedule, RPO and RTO

**RPO** (recovery point objective) is how much recent data you can lose. **RTO**
(recovery time objective) is how long the service is down while you restore.

| Setup | Schedule | RPO (worst case) | Typical RTO |
| --- | --- | --- | --- |
| Daily dump only | 04:00 in `BACKUP_TZ` (default UTC) | 24 h | Minutes to restore the dump plus app restart. Measured on the dev database (13 MB, 59 tables): download + verify + restore in about 1 s. Expect roughly a minute per few hundred MB of dump; measure yours with `backup-verify`. |
| Self-hosted + WAL-G | WAL shipped continuously, `archive_timeout=60s`; base backup 04:00 | About 1 minute (`WALG_ARCHIVE_TIMEOUT`) plus upload time | Base-backup download + WAL replay since that base backup. Measured on the test cluster: about 2 s. Grows with database size and the amount of WAL written since 04:00. |
| Managed Postgres + provider PITR | Provider-controlled | Usually about 5 minutes or less | Provider creates a new instance: typically 10-60 minutes, then repoint `DATABASE_URL`. |

**04:00 is in `BACKUP_TZ`** (compose maps it to the container's `TZ`). With the
default `UTC`, the backup runs at 04:00 UTC: 05:00/06:00 in Central Europe
depending on summer time. Set `BACKUP_TZ=Europe/Berlin` (for example) to pin it
to local 04:00. Cron expressions follow the standard 5-field syntax
(`BACKUP_SCHEDULE`, `WALG_BACKUP_SCHEDULE`).

**Lower RPO than ~1 minute.** `archive_timeout` only forces a segment switch;
anything committed since the last shipped segment is lost if the disk dies. For
near-zero data loss, stream WAL continuously instead: run
[`pg_receivewal`](https://www.postgresql.org/docs/18/app-pgreceivewal.html) on a
second machine (asynchronous: loses at most the last few in-flight
transactions), or make it, or a replica, synchronous
(`synchronous_standby_names`, `synchronous_commit=on`: zero committed data
lost, at the cost of commit latency and an availability dependency). Managed
providers offer this as "high availability / multi-AZ". This setup does not
include either.

---

## Setup

### 1. Create the encryption keys (offline)

On a trusted machine that is **not** the server (a laptop with disk encryption,
or the DPO's machine):

```bash
# Using the image avoids installing age locally:
docker run --rm -it -v "$PWD:/k" --user 0 gradebook-backup:local age-keygen -o /k/gradebook-backup-key.txt
#   Public key: age1...
age-keygen -y gradebook-backup-key.txt     # prints the public key again
```

- The **public key** (`age1...`) goes into `BACKUP_AGE_RECIPIENTS` on the
  server. It can only encrypt.
- The **private key** (`AGE-SECRET-KEY-1...`) never goes on the server. Store it
  in at least two places held by different people (e.g. the organisation's
  password manager + a sealed paper copy in a safe). Optionally protect the
  file with a passphrase: `age -p -o key.txt.age gradebook-backup-key.txt`.
- Recommended: create **two** key pairs held by different people (primary and
  break-glass) and list both public keys, comma-separated, in
  `BACKUP_AGE_RECIPIENTS`. Either private key can then decrypt.
- For WAL-G (self-hosted PITR) also create a symmetric key:
  `openssl rand -hex 32` → `WALG_LIBSODIUM_KEY`. This one must live on the
  database server (Postgres needs it to archive), so also keep an offline copy:
  without it no WAL or base backup can be restored.

### 2. Create the backup bucket

Use a bucket **separate from the app's file bucket**, ideally in a separate
provider account/project, in the **same legal jurisdiction as the database**
(see [data residency](#storage-location-and-access-control)). Recommended
settings:

- **Block all public access.**
- **Versioning on, plus Object Lock** (AWS S3, Backblaze B2, Wasabi, MinIO, and
  others support it) in *governance* or *compliance* mode with a default
  retention of a few days (e.g. 7). A stolen backup credential or ransomware on
  the server can then delete or overwrite objects only by adding delete markers;
  the locked versions survive.
- **A lifecycle rule** that permanently expires *noncurrent* versions after the
  same number of days (e.g. `NoncurrentVersionExpiration: 7 days`) and removes
  expired delete markers. Without it, "deleted" backups live on as old versions
  forever, which breaks your stated retention period (see
  [retention](#retention-and-the-right-to-erasure)).
- Server-side encryption at rest on (SSE-S3/SSE-KMS or the provider default);
  the age/libsodium client-side encryption is the real protection, SSE is
  defence in depth.
- Access logging (CloudTrail data events, bucket access logs or the provider's
  equivalent), so you can tell whether a backup was ever read.

Layout inside the bucket (defaults):

```text
gradebook-backups/
  postgres/daily/2026/10/gradebook-20261025T040002Z.dump.age          # daily dump (age)
  postgres/daily/2026/10/gradebook-20261025T040002Z.dump.age.sha256   # checksum of the encrypted file
  wal-g/basebackups_005/...                                            # WAL-G base backups (self-hosted)
  wal-g/wal_005/...                                                    # WAL-G archived WAL
```

#### Least-privilege credentials (AWS IAM example)

The server gets one key for the dump prefix and one for WAL-G. Neither may
change bucket settings, remove object versions or bypass Object Lock.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListOwnPrefix",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::gradebook-backups",
      "Condition": { "StringLike": { "s3:prefix": ["postgres/*", "postgres"] } }
    },
    {
      "Sid": "WriteReadPruneOwnPrefix",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::gradebook-backups/postgres/*"
    }
  ]
}
```

For WAL-G use the same policy with `wal-g` instead of `postgres`. For the
**restore/verify** machine create a separate read-only key (`s3:ListBucket` +
`s3:GetObject`). Do **not** grant `s3:DeleteObjectVersion`,
`s3:PutBucket*`, `s3:PutLifecycleConfiguration` or
`s3:BypassGovernanceRetention` to anything that runs on the server. Other
providers have equivalents (R2 API tokens scoped to a bucket, B2 application
keys restricted to a bucket and name prefix).

### 3. Configure and start the daily backup

In `infrastructure/.env` (full list in [`env.example`](./env.example)):

```env
BACKUP_S3_BUCKET=gradebook-backups
BACKUP_S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com   # empty for AWS default; R2/B2/MinIO URL otherwise
BACKUP_S3_REGION=eu-central-1
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
BACKUP_AGE_RECIPIENTS=age1...primary,age1...breakglass
BACKUP_HEALTHCHECK_URL=https://hc-ping.com/<uuid>         # optional but recommended
# BACKUP_DATABASE_URL=   # defaults to DATABASE_URL; a read-only role is better (below)
```

```bash
cd infrastructure
docker compose up -d --build backup
docker compose logs backup          # "startup check OK: database ... bucket ... writable"
docker compose exec backup backup-now
docker compose exec backup backup-list
```

The `backup` service starts by default with the rest of the stack. **If it is
not configured it exits with the reason** (e.g. `BACKUP_AGE_RECIPIENTS is not
set: refusing to make an unencrypted backup`) and keeps restarting, so a
missing backup is visible in `docker compose ps` instead of silently absent. On
start it also checks the database connection, that its `pg_dump` is at least the
server's major version, and that it can write and delete in the bucket.

A dedicated read-only database role is better than the app's owner role:

```sql
CREATE ROLE gradebook_backup LOGIN PASSWORD '...';
GRANT pg_read_all_data TO gradebook_backup;   -- PostgreSQL 14+
```

then `BACKUP_DATABASE_URL=postgresql://gradebook_backup:...@host:5432/gradebook?sslmode=require`.
Use `sslmode=require` (or `verify-full`) whenever the database is not on the
same host. Prisma-only URL parameters (`schema`, `connection_limit`, ...) are
removed automatically.

### 4. Self-hosted Postgres: turn on continuous archiving

In `infrastructure/docker-compose.yml`, uncomment `db`, `db-backup` and the
`db-data` volume (instructions are in the file), then set:

```env
POSTGRES_PASSWORD=...
WALG_S3_PREFIX=s3://gradebook-backups/wal-g
WALG_S3_ENDPOINT=                 # non-AWS providers only
WALG_S3_REGION=eu-central-1
WALG_S3_ACCESS_KEY_ID=...
WALG_S3_SECRET_ACCESS_KEY=...
WALG_LIBSODIUM_KEY=...            # openssl rand -hex 32, keep an offline copy
# WALG_S3_FORCE_PATH_STYLE=true   # MinIO/SeaweedFS; automatic when an endpoint is set
# WALG_ARCHIVE_TIMEOUT=60         # seconds
# WALG_RETAIN_FULL=7              # base backups kept = PITR window in days
# WALG_HEALTHCHECK_URL=https://hc-ping.com/<uuid>
```

```bash
docker compose up -d --build db db-backup backup
docker compose logs db-backup     # takes a first base backup if none exists
docker compose exec db-backup walg backup-list --detail
```

The `db` image refuses to start without `WALG_S3_PREFIX` and an encryption key
(set `WALG_ENABLED=false` to deliberately run without archiving). Postgres is
started with `wal_level=replica`, `archive_mode=on`,
`archive_command='wal-g wal-push %p'`, `archive_timeout=60s` and
`restore_command='wal-g wal-fetch %f %p'` (only used during recovery).

If archiving fails (bucket down, wrong key), Postgres keeps the WAL on disk and
retries; **the disk fills up** if it stays broken. The `db-backup` health check
turns unhealthy while `pg_stat_archiver` reports failures, and should be
alerted on.

**Existing self-hosted volumes:** the image is `postgres:18.6-alpine` plus
WAL-G, so it starts on a volume created by the old `db` service as-is (tested:
same musl libc and `en_US.utf8` collation, `amcheck` clean). Point-in-time
recovery covers changes from the first base backup onwards.

---

## Managed Postgres

With a managed database, continuous backup is the provider's job: **turn on
point-in-time recovery and set its retention** in the provider console.
Typical settings at the time of writing (check your plan; providers change
these):

| Provider | Point-in-time recovery | Retention to choose |
| --- | --- | --- |
| AWS RDS / Aurora PostgreSQL | Automated backups + PITR (transaction logs uploaded every ~5 min) | 1-35 days; 7-14 is a common choice. Enable deletion protection and copy snapshots to a second region/account if required. |
| Google Cloud SQL | Automated backups + PITR (write-ahead log retention) | Log retention 1-7 days (longer on Enterprise Plus); backups up to 365 days |
| Azure Database for PostgreSQL (Flexible Server) | Built in | 7-35 days (default 7); geo-redundant backup is an option at creation time |
| DigitalOcean Managed PostgreSQL | Built in (daily backups + PITR) | 7 days (fixed) |
| Aiven for PostgreSQL | Built in | 2-30 days depending on plan |
| Neon | Branch/restore from history | "History retention" setting, plan-dependent |
| EU-based providers (Scaleway, OVHcloud, IONOS...) | Usually automatic backups, sometimes PITR | Check the product page; choose an EU region |

Pick a provider region in the EU when your schools are in the EU, sign the
provider's data processing agreement (DPA), and list it as a sub-processor.

**Why still run the daily dump sidecar?** Provider PITR lives inside the same
provider account. It does not help if that account is compromised, suspended or
deleted, if a bad migration is only noticed after the PITR window, or if you need
to move providers. The dump is encrypted with a key the provider never sees and
stored in a separate bucket you control: point `BACKUP_DATABASE_URL` at the
managed database and run the `backup` service as described above.

---

## Encryption and key management

| Layer | Algorithm | Key lives | Who can decrypt |
| --- | --- | --- | --- |
| Daily dump | age (X25519 + ChaCha20-Poly1305), streamed: `pg_dump` output goes straight into `age`, plaintext never touches disk | Public key on the server; **private key offline** | Only holders of an age private key |
| WAL-G (WAL + base backups) | libsodium secretstream (XChaCha20-Poly1305) | Symmetric key on the DB server + offline copy | Anyone with the key (i.e. the server and the key holders) |
| In transit | TLS to the S3 endpoint (use `https://`) and to the database (`sslmode=require`) | - | - |
| Provider storage | SSE at rest (defence in depth) | Provider | Provider |

Why the dump uses a public key: someone who takes over the server can already
read the live database, but should **not** be able to read the previous 30
days of backups, which include data erased since. With age, the server can
write backups it cannot read. WAL-G cannot work that way (Postgres must fetch
and replay its own WAL), so its key necessarily sits on the database server.

**Who holds the age private key:** name them in your security documentation
(e.g. the DPO and the lead operator), never the server, never the repository,
never a chat or ticket. Each restore is done by one of them, with the key
mounted read-only for that one command.

**Rotation (age), at least yearly, and whenever a holder leaves:**

1. Generate a new key pair offline.
2. Set `BACKUP_AGE_RECIPIENTS=<new public key>` (or old and new during a
   hand-over) and `docker compose up -d backup`. New backups use the new key.
3. Keep the **old** private key until the last backup encrypted to it has
   expired (`BACKUP_RETENTION_DAYS`, plus the noncurrent-version window), then
   destroy every copy of it. Destroying the key is also what makes any copies
   of those old backups unreadable ("crypto-shredding").

**If an age private key may be compromised:** rotate immediately (above),
assume every backup encrypted to it is readable by the attacker, consider
deleting those backups early (keep at least one backup made with the new key
first), and treat it as a possible personal-data breach
([below](#incidents-and-breach-relevance)).

**Rotation (WAL-G libsodium key):** WAL-G cannot re-encrypt existing objects.
Set a new `WALG_LIBSODIUM_KEY` **and** a new `WALG_S3_PREFIX`
(e.g. `s3://gradebook-backups/wal-g-2027`), restart `db` and `db-backup` (a first
base backup is taken automatically), keep the old key until the old prefix's
7-day window has passed, then delete the old prefix and the old key.

---

## Storage location and access control

- **Data residency.** Backups contain the same personal data as the live
  database (pupils' names, marks, attendance, messages...), so they are subject
  to the same rules. Store them in the **same jurisdiction**: for schools in the
  EU/EEA use an EU region (e.g. AWS `eu-central-1`/`eu-west-1`, Cloudflare R2 with
  the EU jurisdiction, Backblaze B2 `eu-central-003`, Scaleway `fr-par`, OVHcloud
  `gra`/`sbg`). A transfer outside the EEA needs a legal basis (adequacy decision
  or SCCs plus a transfer impact assessment). Record the provider and region in
  your record of processing activities (Art. 30) and sub-processor list.
- **Separation.** Backups go to their own bucket (or provider account) with
  their own credentials, so a leaked app S3 key cannot read or delete backups,
  and a leaked backup key cannot touch app files.
- **Least privilege.** The server can only write/read/prune its own prefix (IAM
  example above); restore/verify machines get read-only keys; only named admins
  (with MFA) can change bucket policy, versioning, Object Lock or lifecycle.
- **Ransomware / mistakes.** Versioning + Object Lock as above. Consider a
  second copy at another provider (e.g. `rclone sync` from a separate machine
  that has read access to the primary and write access to the copy).
- **Audit.** Keep access logs for the backup bucket at least as long as your
  security logs.

---

## Retention and the right to erasure

| Data | Kept for (defaults) | Setting |
| --- | --- | --- |
| Daily dumps | 30 days (deleted after each successful backup) | `BACKUP_RETENTION_DAYS` |
| WAL-G base backups + WAL (self-hosted) | 7 newest base backups ≈ 7 days of PITR | `WALG_RETAIN_FULL` |
| Provider PITR (managed) | Provider setting (e.g. 7 days) | Provider console |
| Old object versions (if versioning) | + the noncurrent-version lifecycle period (e.g. 7 days) | Bucket lifecycle rule |

The dump retention job only deletes after a **new backup has uploaded
successfully**, so a broken backup never leaves you with nothing. It only
touches objects it named (`<name>-<timestamp>.dump[.age][.sha256]`).

**Choose and state the period.** With the defaults, personal data that is erased
from the live system remains in backups for **up to 30 days (dumps) + 7 days
(old versions)**. Write the maximum into your privacy notice and records of
processing, for example:

> Backups of the GradeBook database are kept encrypted for up to 37 days.
> Information that you delete, or that we delete at your request, is removed
> from the live system immediately and disappears from backups when they
> expire. Backups are only used to restore the service after a failure.

Data protection authorities generally accept that erased data may remain in
backups for a limited, stated period if the backups are protected and not used
for any other purpose (the data is "beyond use"), **provided erasures are
re-applied if a backup is ever restored**. Retention should be no longer than
needed for recovery: 30 days is a common choice for school systems; shorten it
if your DPO prefers.

**After any restore, re-apply erasures made since the backup was taken.**
GradeBook records every erasure and can replay them:

- **The erasure log.** Every path that erases personal data - deleting an
  account (`DELETE /api/auth/account`), a file or folder, a chat message, a
  discussion topic or reply, a course or an attendance session, removing
  someone from a school, merging a duplicate student record, and the
  retention purge below - writes one row to `compliance.erasure_log` **in the
  same transaction** as the erasure. A row holds ids only (what kind of
  record, which table and uuids, school, who asked, why, and a `replay` plan
  of uuid-only delete/update steps), never names, emails, message bodies or
  file names. Details: [`backend/src/erasure/README.md`](../backend/src/erasure/README.md).
- **It survives the restore.** Restoring the database also rolls this table
  back, so right after commit each entry is also written to the app bucket as
  one small signed JSON object under `ERASURE_LOG_S3_PREFIX` (default
  `erasure-log/YYYY/MM/DD/`). Rows whose copy failed are retried every 15
  minutes (`exported_at IS NULL`). The app bucket is not part of the database
  restore; keep it versioned so the copy is protected too.
- **Replay.** After the restore, before reopening the API:

  ```bash
  # in infrastructure/: the app image, with the app's .env (DATABASE_URL = the restored database)
  docker compose --profile release run --rm migrate bun run erasure:replay --since 2026-10-24T04:00:00Z --dry-run
  docker compose --profile release run --rm migrate bun run erasure:replay --since 2026-10-24T04:00:00Z
  # or from a checkout: cd backend && bun run erasure:replay --since ...
  ```

  It reads entries from the restored database **and** the storage copy (union,
  de-duplicated by id), applies them oldest first, one transaction each,
  deletes the storage objects of purged files, and writes entries missing
  from the restored log back into it. Every step is idempotent: a second run
  reports everything `nochange`. It exits non-zero if any entry failed - fix
  the cause and run it again. Use a `--since` a little **earlier** than the
  backup time when in doubt; replaying an erasure twice is harmless.
- **Soft deletes are purged.** Files, folders, chat messages and discussion
  replies are soft-deleted (`deleted_at`) and hard-deleted after
  `SOFT_DELETE_RETENTION_DAYS` (default 30) by a daily job in the API
  ([`backend/src/retention/README.md`](../backend/src/retention/README.md)),
  each purge logged as `retention_purge`. Expired sessions and used sign-in
  codes are cleared a day after they expire. So "deleted" personal data lives
  at most 30 days in the database and 30 + 37 days in backups.
- **The log's own retention.** Entries are kept `ERASURE_LOG_RETENTION_DAYS`
  (default 400), well past the longest backup you could restore; keep it
  longer than `BACKUP_RETENTION_DAYS` + version expiry + PITR window. The ids
  in it are pseudonymous personal data kept to meet the erasure obligation
  itself (Art. 17 and accountability, Art. 5(2)); mention it in the privacy
  notice.
- Requests handled **outside** GradeBook (for example a DPO deleting rows by
  hand) are not in the log; record those in the DPO's request register and
  re-apply them by hand after a restore.

---

## Incidents and breach relevance

- **Backups are part of "security of processing"** (GDPR Art. 32(1)(b)-(d)): the
  ability to restore availability in a timely manner, and regular testing of
  it. The restore tests below are your evidence.
- **Leak of the backup bucket or a backup file:** this is a personal data
  incident. Because the dumps and WAL are encrypted and the keys are held
  elsewhere, the data is unintelligible to the attacker, which is a mitigating
  factor (Art. 34(3)(a) can remove the duty to tell data subjects). You still
  have to assess it, document it (Art. 33(5)) and, where there is a risk,
  notify the supervisory authority within 72 hours. If the **age private key** or
  the **WAL-G key** was also exposed, treat the backups as readable.
- **Loss of all keys or all backups** is an availability breach if it then
  prevents recovery; holding keys in two places with two people prevents this.
- **Ransomware / account takeover:** Object Lock + versioning keeps the
  locked versions; restore from them (`backup-rclone` can copy a specific
  version) after rotating every credential.
- **After any security incident involving the database server**, rotate the
  database password, the S3 keys and `WALG_LIBSODIUM_KEY`; the age private key
  was never on the server.

---

## Restore testing

| When | What | How |
| --- | --- | --- |
| Every day (automatic) | Backup ran and uploaded | Healthchecks.io-style ping (`BACKUP_HEALTHCHECK_URL`, `WALG_HEALTHCHECK_URL`) or the containers' Docker health status |
| Weekly (automatic, recommended) | The newest dump actually restores | `backup-verify` on a **separate verification host** (below) |
| Quarterly | Full drill: restore the dump into a new database **and** a point-in-time restore (self-hosted) or a provider PITR restore into a new instance; time it (this is your real RTO); start an API against it and sign in | Runbook below |
| After changing Postgres major version, provider or keys | Same as quarterly | |

Write down every test: date, backup used, duration, row counts/result, who did
it. That record is what an auditor or supervisory authority will ask for.

**Verification host.** `backup-verify` needs to decrypt, so it needs an age
private key. Do not schedule it on the production server with the primary key.
Instead generate a third, **verification key pair**, add its public key to
`BACKUP_AGE_RECIPIENTS`, and run the backup image on a separate machine (or CI
runner with a throwaway Postgres 18) that holds only that key and a read-only
bucket key:

```bash
docker run --rm \
  -e BACKUP_S3_BUCKET=gradebook-backups -e BACKUP_S3_REGION=eu-central-1 \
  -e BACKUP_S3_ACCESS_KEY_ID=<read-only> -e BACKUP_S3_SECRET_ACCESS_KEY=<read-only> \
  -e BACKUP_VERIFY_DATABASE_URL=postgresql://postgres:...@scratch-db:5432/postgres \
  -e BACKUP_AGE_IDENTITY_FILE=/run/secrets/age \
  -v /secure/verify-key.txt:/run/secrets/age:ro \
  gradebook-backup:local backup-verify
```

It creates a throwaway database, restores the newest complete backup (sha256
checked), checks that `_prisma_migrations` exists with applied and no failed
migrations and that the tables are there, prints exact row counts per table,
and drops the database again (also on failure). The container can schedule it
itself with `BACKUP_VERIFY_SCHEDULE` (e.g. `0 6 * * 0`, Sundays) when started
with the default `backup-cron` command on that host; set
`BACKUP_VERIFY_HEALTHCHECK_URL` to be alerted on failures. (On the production
server the backup service refuses `BACKUP_VERIFY_SCHEDULE` unless an identity
file is mounted, and warns when it is.)

---

## Runbook

All commands are run from `infrastructure/` on the server unless noted.

### Daily check

Alerts should do this for you; by hand it takes a minute:

```bash
docker compose ps backup db-backup          # both "healthy"
docker compose exec backup backup-list | tail -4
docker compose logs --since 26h backup | grep -E 'backup OK|ERROR'
# self-hosted PITR:
docker compose exec db psql -U gradebook -Atc \
  "select archived_count, last_archived_time, failed_count, last_failed_time from pg_stat_archiver"
docker compose exec db-backup walg backup-list
```

A failed backup exits non-zero, logs `backup FAILED during '<stage>'`, pings
`/fail`, and leaves no partial object behind. Fix the cause and run
`docker compose exec backup backup-now`.

### Restore the daily dump (database lost or corrupted)

1. Stop writes: stop the API (or put it in maintenance) so nobody works on a
   database that is about to be replaced.
2. Create a **new, empty** database (new managed instance, or
   `CREATE DATABASE gradebook_restored;`). Keep the old one until you are done.
3. Restore, as a key holder, with the private key mounted for this one command:

   ```bash
   docker compose run --rm \
     -v /secure/gradebook-backup-key.txt:/run/secrets/age:ro \
     backup backup-restore --latest \
       --identity /run/secrets/age \
       --target 'postgresql://gradebook:...@db-host:5432/gradebook_restored?sslmode=require'
   ```

   `--key daily/2026/10/gradebook-20261024T040001Z.dump.age` picks a specific
   backup (`backup-list` shows them). The tool downloads it, checks the
   sha256, checks the key can decrypt, refuses a non-empty target (unless
   `--force`), and restores in a single transaction with `pg_restore
   --exit-on-error`. Objects end up owned by the `--target` user
   (`--keep-owner` keeps the original owners).
4. **Sign everyone out:** sessions revoked after the backup would be valid again.
   `DELETE FROM account.session; DELETE FROM account.email_code;`
5. **Re-apply erasures** recorded since the backup's timestamp:
   `bun run erasure:replay --since <backup time, UTC> --dry-run`, then without
   `--dry-run` (with `DATABASE_URL` pointing at the restored database and the
   app's `S3_*` and `AUTH_SECRET` set; see
   [Retention and erasure](#retention-and-the-right-to-erasure)).
6. Point `DATABASE_URL` at the restored database and start the API (it runs
   `prisma migrate deploy` on start, which applies any newer migrations).
7. Check: sign in, open a course, a gradebook, a file. Then take a fresh
   backup: `docker compose exec backup backup-now`.
8. Record the incident and the restore (time taken, data lost) and remove the
   private key from the machine.

**Single table or record:** restore into a scratch database as above, then copy
the rows you need across with `psql`/`COPY`, instead of replacing everything.

### Point-in-time restore (self-hosted, WAL-G)

Example: someone ran a destructive change at 13:59:30 UTC; restore to 13:59:00.

1. Find the target time in UTC (`YYYY-MM-DDTHH:MM:SSZ`). It must be after the
   oldest base backup (`walg backup-list --detail`) and at most about
   `WALG_ARCHIVE_TIMEOUT` before the failure if the server died.
2. Stop the API and the database: `docker compose stop db-backup db`.
   **Keep the old volume** (`db-data`) untouched until the restore is verified.
3. Create a new volume and prepare it:

   ```bash
   docker volume create gb_db-data-restore
   docker compose run --rm --no-deps -v gb_db-data-restore:/var/lib/postgresql \
     db walg-restore --target-time 2026-10-25T13:59:00Z
   ```

   This picks the newest base backup that finished before the target, fetches
   it, writes `recovery.signal` and sets `recovery_target_time`,
   `recovery_target_action='promote'`. Without `--target-time` it replays all
   archived WAL (latest possible state).
4. Point the `db` service's volume at `gb_db-data-restore` (edit the compose
   file's `volumes:` entry, e.g. declare `db-data-restore: { external: true, name: gb_db-data-restore }`
   and mount it instead of `db-data`), then `docker compose up -d db`.
   Watch `docker compose logs -f db` for
   `starting point-in-time recovery to ...`, `restored log file ... from archive`,
   `recovery stopping before commit of transaction ..., time ...` and
   `database system is ready to accept connections`.
5. Check the data (`psql`), then sign everyone out and re-apply erasures as in
   the dump restore (steps 4-5 above).
6. The restored server promotes to a new timeline and archives to the same
   `WALG_S3_PREFIX` (WAL-G keeps timelines apart). Take a new base backup
   straight away: `docker compose up -d db-backup` then
   `docker compose exec db-backup walg-basebackup`. Remove the
   `recovery_target_*` lines that `walg-restore` appended to
   `postgresql.auto.conf` (they are ignored after promotion but confusing).
7. Start the API. Delete the old volume only after a few days of normal
   operation.

### Point-in-time restore (managed)

Use the provider's "restore to point in time", which always creates a **new**
instance. Then follow steps 4-7 of the dump restore (sign everyone out,
re-apply erasures, repoint `DATABASE_URL`, check, take a backup), and update
`BACKUP_DATABASE_URL` if it is set.

### Key rotation

See [Encryption and key management](#encryption-and-key-management). Checklist:
new key pair offline → update `BACKUP_AGE_RECIPIENTS` → `docker compose up -d
backup` → `backup-now` → `backup-verify` with the new key → diary entry to
destroy the old private key after `BACKUP_RETENTION_DAYS` + version expiry.

### Local development

```bash
# Optional services; the default dev `db` is not touched.
docker compose -f docker-compose.dev.yml --profile backup run --rm \
  -e BACKUP_S3_NO_CHECK_BUCKET=false backup backup-rclone mkdir backup:gradebook-backups
docker compose -f docker-compose.dev.yml --profile backup run --rm --no-deps backup age-keygen  # prints a throwaway dev key pair
BACKUP_AGE_RECIPIENTS=age1... docker compose -f docker-compose.dev.yml --profile backup run --rm backup backup-now
BACKUP_AGE_RECIPIENTS=age1... docker compose -f docker-compose.dev.yml --profile backup run --rm \
  -v "$PWD/dev-key.txt:/run/secrets/age:ro" backup backup-verify --identity /run/secrets/age
# A separate WAL-G Postgres on 127.0.0.1:5433 with its base-backup sidecar:
WALG_LIBSODIUM_KEY=$(openssl rand -hex 32) docker compose -f docker-compose.dev.yml --profile walg up -d --build
```

---

## Configuration reference

### `backup` service (daily dump)

| Variable | Default | Meaning |
| --- | --- | --- |
| `BACKUP_DATABASE_URL` | `DATABASE_URL` | Database to dump. A `pg_read_all_data` role is enough. `_FILE` variant supported. |
| `BACKUP_S3_BUCKET` | - (required) | Backup bucket (not the app bucket). |
| `BACKUP_S3_PREFIX` | `postgres` | Folder inside the bucket. Objects go to `<prefix>/daily/YYYY/MM/`. |
| `BACKUP_S3_ENDPOINT` | AWS | Endpoint for R2, B2, MinIO, SeaweedFS... |
| `BACKUP_S3_REGION` | `us-east-1` | Bucket region (`auto` for R2). |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | - | Credentials (`_FILE` variants supported). Leave both empty to use an instance role / `AWS_*` environment. |
| `BACKUP_S3_FORCE_PATH_STYLE` | `true` with an endpoint, else `false` | Path-style addressing. |
| `BACKUP_S3_STORAGE_CLASS` | provider default | e.g. `STANDARD_IA`. |
| `BACKUP_S3_PROVIDER` | `Other` with an endpoint, else `AWS` | rclone S3 provider name (`Cloudflare`, `Minio`, ...). |
| `BACKUP_AGE_RECIPIENTS` | - (required) | Comma-separated age (`age1...`) or SSH public keys. A private key here is refused. `BACKUP_AGE_RECIPIENTS_FILE` for a file. |
| `BACKUP_ALLOW_UNENCRYPTED` | `false` | `true` allows unencrypted `.dump` files when no recipients are set. **Development only.** |
| `BACKUP_SCHEDULE` | `0 4 * * *` | Cron expression, in `TZ`. |
| `BACKUP_TZ` (compose) → `TZ` | `UTC` | Time zone of the schedules. |
| `BACKUP_RETENTION_DAYS` | `30` | Dumps older than this are deleted after each successful backup. |
| `BACKUP_HEALTHCHECK_URL` | - | Ping URL: `/start`, success, `/fail` (healthchecks.io style). Not logged. |
| `BACKUP_TMPFS_SIZE` (compose) | `2g` | Size of the `/work` tmpfs, which holds the encrypted dump during upload. |
| `BACKUP_NAME` | `gradebook` | File name prefix. |
| `BACKUP_STARTUP_CHECK` | `true` | Check DB and bucket access on start. |
| `BACKUP_RUN_ON_START` | `false` | Take a backup right after start. |
| `BACKUP_MAX_AGE_HOURS` | `26` | Health check turns unhealthy after this long without a successful backup. |
| `BACKUP_VERIFY_SCHEDULE` | - | Cron for `backup-verify` (verification host only). |
| `BACKUP_VERIFY_DATABASE_URL` | - | Role that may `CREATE DATABASE`, for `backup-verify`. |
| `BACKUP_VERIFY_HEALTHCHECK_URL` | - | Ping URL for verification runs. |
| `BACKUP_AGE_IDENTITY_FILE` | - | Private key file for `backup-restore`/`backup-verify` (only where those run). |
| `RESTORE_DATABASE_URL` | - | Default `--target` for `backup-restore`. |

Commands in the image: `backup-cron` (default), `backup-now`, `backup-restore`,
`backup-verify`, `backup-list`, `backup-rclone` (rclone with the bucket as
`backup:`), `backup-health`, `age`, `age-keygen`, `pg_dump`, `pg_restore`, `psql`.

### `db` / `db-backup` (WAL-G)

In `infrastructure/.env` (compose maps them to WAL-G's own names):

| Variable | Default | Meaning |
| --- | --- | --- |
| `WALG_S3_PREFIX` | - (required) | `s3://<bucket>/<path>` for WAL and base backups. |
| `WALG_S3_ENDPOINT` → `AWS_ENDPOINT` | AWS | Non-AWS endpoint. |
| `WALG_S3_REGION` → `AWS_REGION` | `us-east-1` | Bucket region. |
| `WALG_S3_ACCESS_KEY_ID`, `WALG_S3_SECRET_ACCESS_KEY` → `AWS_*` | - | Credentials. |
| `WALG_S3_FORCE_PATH_STYLE` → `AWS_S3_FORCE_PATH_STYLE` | `true` with an endpoint | Path-style addressing. |
| `WALG_LIBSODIUM_KEY` | - (required) | 64 hex chars (`openssl rand -hex 32`). Or `WALG_LIBSODIUM_KEY_PATH`. |
| `WALG_ALLOW_UNENCRYPTED` | `false` | Development only. |
| `WALG_ENABLED` | `true` | `false` runs plain Postgres without archiving (warns). |
| `WALG_ARCHIVE_TIMEOUT` | `60` | Seconds; forces a WAL segment switch, bounding data loss. |
| `WALG_BACKUP_SCHEDULE` | `0 4 * * *` | Base backup cron, in `TZ`. |
| `WALG_RETAIN_FULL` | `7` | Base backups kept (`wal-g delete retain FULL N --confirm`); older WAL is deleted with them. |
| `WALG_HEALTHCHECK_URL` | - | Ping URL for base backups. |
| `WALG_MAX_AGE_HOURS` | `26` | Health check threshold. |

Commands in the image: the default `postgres`, `walg-cron`, `walg-basebackup`,
`walg-restore`, `walg-health`, `walg` (wal-g with the checked settings, e.g.
`walg backup-list --detail`).

---

## Design notes

- **Pinned versions.** Postgres client/server 18.6 (`postgres:18.6-alpine`),
  supercronic v0.2.51, age v1.3.2, rclone v1.75.2, WAL-G v3.0.9 (built with Go
  1.26.10 on Alpine 3.24). Every download is checked against a SHA-256 in the
  Dockerfiles. Bump them deliberately, and the backup image's Postgres major
  together with the server's (`pg_dump` refuses a newer server; the startup
  check says so).
- **Why WAL-G is built from source on Alpine.** WAL-G only publishes glibc
  (Ubuntu) binaries. Switching the self-hosted database to a Debian image would
  change the C library, and with it the sort order of the `en_US.utf8`
  collation that existing Alpine databases use, which silently corrupts text
  indexes. A static musl build keeps the image a drop-in replacement.
- **Why a base-backup sidecar.** `wal-g backup-push` needs the data directory
  and a connection. Running it from a second container with the volume mounted
  read-only keeps the database container a single process (the official
  entrypoint, signals and health check unchanged) while the scheduler has its
  own logs, restarts and health check.
- **Why rclone.** One static binary with checksummed releases, configured purely
  from environment variables (no credentials on command lines or in files),
  works with every S3-compatible provider, and verifies uploads.
- **Why the plaintext never touches disk.** `pg_dump` streams into `age`; only
  ciphertext is written to `/work` (a tmpfs), uploaded, size-checked and
  removed. Restores stream `age --decrypt` into `pg_restore`.
- **Safety.** `set -euo pipefail`, a lock against overlapping runs (a second run
  exits 75), the `.sha256` is uploaded last so its presence marks a complete
  backup, failed runs delete their partial upload, retention runs only after a
  verified upload, connection strings, keys and ping URLs are never logged, and
  containers run as a non-root user with a read-only root filesystem.
