# Relational database portability plan

## Goal and scope

Make the backend run against every relational database supported by the
project's Prisma ORM version, with the same authorization, integrity, and
transaction guarantees. MongoDB and other document databases are out of scope.

The initial provider matrix is PostgreSQL, MySQL, MariaDB, SQLite, Microsoft
SQL Server, and CockroachDB. Treat hosted products as a provider plus a
conformance check (for example, PlanetScale as MySQL), rather than assuming
that Prisma support alone guarantees application compatibility. Recheck this
matrix when upgrading Prisma.

| Prisma provider | Relational target | Portability concerns to verify |
| --- | --- | --- |
| `postgresql` | PostgreSQL | Preserve current behavior while removing PostgreSQL-only dependencies. |
| `mysql` | MySQL | No PostgreSQL namespaces, arrays, partial indexes, or PostgreSQL SQL functions. |
| `mysql` | MariaDB | Verify adapter and migration behavior independently from MySQL. |
| `sqlite` | SQLite | Verify transaction/concurrency limits, foreign keys, JSON behavior, and deployment storage. |
| `sqlserver` | Microsoft SQL Server | Verify identifier limits, filtered indexes, uniqueness semantics, and adapter behavior. |
| `cockroachdb` | CockroachDB | Verify transaction retry behavior and PostgreSQL compatibility differences. |

The exact Prisma 7 versions and adapter packages must be pinned from the
versioned Prisma documentation before implementation; support should not be
inferred from another Prisma major version. Reference: [Prisma ORM 7 supported
databases and adapters](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases).

RLS is not active in the current application. Authorization is already enforced
in API guards and service queries. The portability work must preserve that as
the common enforcement boundary; it must not introduce a second, provider-
specific authorization system.

## Current blockers found

- The Prisma datasource is fixed to PostgreSQL and declares eight Postgres
  schemas. The models use `@@schema`, PostgreSQL native types, database
  generated UUIDs, partial indexes, and PostgreSQL-specific defaults.
- `PrismaService` directly constructs `PrismaPg`; the dependency list includes
  only the PostgreSQL adapter.
- Application code still uses PostgreSQL raw SQL and row locks in grading
  (quiz attempt/answer locks, mark/points and rubric lock pairs), the
  school retention closed-year query, erasure replay, and the audit purge
  session setting. Schedulers, sensitive-text re-encryption, organisation
  setup, chat, discussion, analytics, report resume, webhook claims, library
  import, join-code redemption and email-domain joining no longer do (see
  "Phase 4 progress" below for the per-item record).
- Tests that assert SQL strings remain only for the items above (grading,
  erasure replay, retention); converted areas have behaviour tests on the
  Prisma mock.
- The SQL migration history has been removed (it is in git history; see
  "Database setup without migrations" below). The schema is now created by
  `prisma db push`; what Prisma cannot declare is enforced in application
  code on every provider and, on PostgreSQL, also recreated by the
  idempotent hardening step (`src/database-setup`).
- Database objects PostgreSQL still gets, as defence in depth only: the
  student `left_at` trigger, the peer-review not-self trigger, the audit
  append-only triggers, five expression unique indexes, 231 CHECK
  constraints and the `pg_trgm` extension. Quiz submission, chat unread
  counts, email-domain joining, join-code redemption and school role seeding
  are TypeScript; student merge and duplicate matching were dropped earlier.
- RLS-related text remains in generated Prisma model comments and historical
  documentation. Historical changelog entries should remain historical; live
  schema comments and current guidance should be corrected.

### Runtime SQL inventory

Status after the phase 4 round of 2026-11-13. "Converted" means the code
now uses Prisma queries/transactions only and has behaviour tests on the
Prisma mock (`src/test/prisma-mock.ts`); it does **not** mean another
provider has been tested.

| Area | Former PostgreSQL dependency | Status |
| --- | --- | --- |
| Schedulers | `pg_try_advisory_xact_lock` in analytics, attendance alerts, course-library import resume, data export, parent notices, report-card resume, retention purge, rostering, timetable | **Converted** to `withJobLease` (`src/common/job-lease.ts`), keyed by the old lock names. Peer review already used `job_lease`. |
| Account sensitive text | `$queryRawUnsafe`/`$executeRawUnsafe` batches, `!~` regex filter, advisory lock per batch | **Converted**: per-model Prisma pages by id, sealed values skipped in TypeScript, compare-and-set `updateMany`, a `job_lease` per batch. |
| Organisation setup | `pg_advisory_xact_lock` around first-run setup | **Converted**: lock removed; the in-transaction re-check plus the `organisation_singleton` unique index (P2002 -> 409) settle a race. The index is an expression index (see "Remaining", schema). |
| Chat | `chat.unread_counts()` and a `LATERAL ... LIMIT 1` preview query with `::uuid[]`/`::text` casts | **Converted**: one grouped `message.groupBy` count; previews as a grouped max plus one row lookup. Per-conversation fallbacks kept. |
| Discussions | topic-stat SQL with `FILTER`, `IS DISTINCT FROM`, casts | **Converted**: two grouped counts over the listed topics. |
| Analytics | joined cell query and filtered attendance counts with casts | **Converted**: submissions, extensions and a grouped attendance count; cells assembled in `courseCells`, rates in `attendanceRows`. |
| Report cards | stale-row join of `report_document` and `report_release` | **Converted**: three plain queries (`stalePending`). |
| Integrations | webhook delivery claim `UPDATE ... FOR UPDATE SKIP LOCKED` | **Converted**: candidates read oldest first, each claimed by a compare-and-set `updateMany` that still requires pending and due. |
| Course library | `SELECT ... FOR UPDATE` of the import row | **Converted**: compare-and-set `updateMany` on `status = 'copying'` as the first statement of the import transaction (holds the row lock like `FOR UPDATE`). |
| Student account | `public.redeem_school_join_code()` and SQLSTATE handling | **Converted**: Prisma transaction, profile bound by compare-and-set; errors mapped from exceptions, not SQLSTATEs. |
| Email-domain | `public.join_school_by_email_domain()` | **Converted**: Prisma transaction (`seat`), compare-and-set bind. |
| Search | `mode: 'insensitive'` (ILIKE) backed by `pg_trgm` GIN indexes | **Interface**: `TextSearch` (`src/common/text-search.ts`), PostgreSQL implementation only; see "Search interface". Auth/rostering email and name equality lookups (`email-change`, `parent-link`, `roster-apply`) still use `mode: 'insensitive'` directly. |
| Grading | `FOR UPDATE` on `submission` (quiz start/save), `FOR SHARE`/`FOR UPDATE` pairs on `activity` (manual mark vs points change) and `rubric` (assess vs edit) | **Remaining** (item 1 below). |
| Retention | closed-year due query (`GROUP BY`/`HAVING bool_and`, `::date`) | **Remaining** (item 2 below). |
| Erasure and audit | dynamic SQL replay (`$queryRawUnsafe`/`$executeRawUnsafe`), `set_config('gradebook.audit_purge', …)` in retention purges, account erasure and replay | **Kept as provider-specific** (audit store, below) / **remaining** (replay handlers, item 3). |
| Health | `SELECT 1` liveness probe | **Portable SQL**, kept; classify as provider-neutral. |
| Error handling | `pgCode`/`raisedMessage` in `src/common/db-values.ts` | No production caller left (tests only); remove with item 6. `isUniqueViolation` etc. already recognise several providers' codes. |

### Database object inventory

| Existing object | Status |
| --- | --- |
| `grading.submit_quiz` | Dropped by `20261206180000_portable_quiz_answer_option_ids`; shared TypeScript scorer. |
| `chat.unread_counts` | Dropped by `20261207100000_portable_database_functions`; `ChatService.unreadCountsFor`. |
| `public.join_school_by_email_domain` | Dropped by `20261207100000_portable_database_functions`; `EmailDomainService.seat`. |
| `public.redeem_school_join_code` | Dropped by `20261207100000_portable_database_functions`; `StudentMembershipService.redeem`. |
| `public.student_duplicate_candidates`, `public.merge_student_records` | Dropped by `20261027140000_drop_student_merge`. |
| `public.seed_school_system_roles` + trigger on `public.school` | Dropped by `20261207100000_portable_database_functions`; `seedSchoolSystemRoles` (`src/permission/system-roles.ts`) in every school-creating path: `OrganisationService.createSchool`, `scripts/seed-demo.ts`, `scripts/student-flow-check.ts`. Existing schools already have their roles. A school inserted by hand-written SQL no longer gets roles automatically. |
| `student.set_student_left_at` trigger | **Application first, trigger as backstop.** Every write of `student.is_active` stamps `left_at` through `withLeftAt` (`src/student/student-left-at.ts`): `StudentService.update`, rostering apply (create, reactivate, disable), join-code redemption and email-domain joining. `student-left-at.test.ts` fails on any student write that sets `is_active` without it. The PostgreSQL hardening step keeps the trigger. |
| `grading.peer_review_allocation_not_self` trigger | **Application first, trigger as backstop.** `addAllocation` and `reassign` (`requireReviewer` refuses reviewer = author; tested) and `allocateNow` (algorithm excludes self-review; the transaction refuses any self pair). No other write changes `reviewer_id`/`submission_id`. The PostgreSQL hardening step keeps the trigger. |
| Audit append-only triggers (`audit_log_append_only`, `audit_log_no_truncate` on `audit_log`, `sso_audit_log`, `integration_audit_log`) and the `gradebook.audit_purge` session setting | **`AuditStore` boundary on every provider** (`src/audit-log/audit-store.ts`) plus the triggers on PostgreSQL (hardening step). See "Audit store". |
| `pg_trgm` extension and GIN trigram indexes on student names | **PostgreSQL performance feature** behind `TextSearch`. The indexes are declared in the Prisma schema, so `db:prepare` creates the extension before `db push` (see "What could not be made portable"). |
| Expression indexes, partial indexes | Partial indexes on plain columns: in the Prisma schema (`partialIndexes` preview). Expression indexes: PostgreSQL hardening step, with service checks on every provider. See "Database setup without migrations". |
| `dbgenerated` defaults | Schema work, phase 3 (see "Remaining"). |

### Audit store (implemented)

The audit tables are append-only for the application. `AuditStore`
(`src/audit-log/audit-store.ts`) is the only code that writes them:

```ts
interface AuditStore {
  appendAuditLog(tx, row): Promise<audit_log>;                  // AuditLogService
  append(tx, table, rows): Promise<number>;                      // SSO and integration audit services
  purgeExpired(tx, table, ids, olderThan): Promise<number>;      // RetentionService (three purges)
  scrubActor(tx, actorIds): Promise<number>;                     // account erasure, erasure replay
}
```

- Every provider: `audit-store.test.ts` fails on any Prisma
  create/update/delete of the three tables, any raw `UPDATE`/`DELETE`/
  `TRUNCATE` of them and any use of `gradebook.audit_purge` outside the
  store (and the PostgreSQL setup layer). Erasure replay routes its
  `public.audit_log` step to `scrubActor` (`auditScrubActors` refuses
  anything but clearing `actor_name`/`actor_email` by `actor_id`), and
  `compileStep` refuses to compile an apply of that step.
- PostgreSQL: `purgeExpired` and `scrubActor` run
  `set_config('gradebook.audit_purge','on', true)` and then the Prisma
  `deleteMany`/`updateMany`, in the caller's transaction; the triggers
  (installed by the hardening step) refuse every other update, delete and
  truncate. Verified against PostgreSQL 17 (PGlite): a plain update/delete is
  refused, the store's scrub and purge succeed, and the setting does not
  leak past the transaction.
- Other providers: no session variables. Options, per provider: a separate
  database role/credential that alone has UPDATE/DELETE on the audit tables
  (used only by `purgeExpired`/`scrubActor`), or triggers keyed on that role
  where the provider has triggers (MySQL, SQL Server, SQLite), and the
  application-level rule that nothing else writes these tables. A provider
  without any enforcement must be documented as weaker, not silently
  accepted.
- The interface must keep both privileged operations narrow (by id / by
  actor), transaction-scoped, and covered by the retention and erasure tests.

### Search interface

`TextSearch` (`src/common/text-search.ts`) returns Prisma string filters for
case-insensitive `contains` and `equals`. `postgresTextSearch` (Prisma
`mode: 'insensitive'`, i.e. ILIKE) is the only implementation and is used by
the student roster search, the course library, organisation school search
and rostering change search. The `pg_trgm` GIN indexes on
`student.first_name`/`last_name` only speed up the student search: results
are the same without them. Per provider: MySQL/MariaDB match
case-insensitively through a `_ci` collation (filters without `mode`);
SQLite and SQL Server need a collation or a lowered shadow column. Optional
indexes are provider-specific migrations, never correctness dependencies.

### Phase 4 progress (2026-11-13)

Converted this round (PostgreSQL behaviour intended to be unchanged):

- **Schedulers / advisory locks.** Every `pg_try_advisory_xact_lock` sweep
  now uses `withJobLease(db, key, leaseMs, work)`: acquire with the root
  client (never inside an interactive transaction), run, release in
  `finally`. Lease lengths equal the old transaction timeouts: analytics
  30 min, attendance alerts and parent notices 10 min, rostering 1 min,
  report resume, library resume, data export and timetable 5 min, retention
  `maxRunMs() + 5 min`, sensitive-text 5 min per batch. Difference: an
  advisory lock was released when a crashed instance's connection closed; a
  lease is held until it expires, so after a crash the next sweep can be
  delayed by up to the lease length. Work that runs past its lease could
  overlap with another instance, as it could when the old transaction timed
  out.
- **Database functions.** Join-code redemption, email-domain joining, chat
  unread counts and school role seeding moved to services; migration
  `20261207100000_portable_database_functions` drops the functions and the
  role-seeding trigger.
- **Aggregates.** Chat previews and unread counts, discussion topic stats,
  analytics cells and attendance, report resume selection.
- **Row locks.** Webhook claims and the library import claim are
  compare-and-set `updateMany` calls checked by `count`.
- **Search.** `TextSearch` interface (above).

Behaviour notes to verify against a real PostgreSQL database:

- Time now comes from the application clock where SQL used `now()`
  (join-code expiry, webhook due time). Clock skew between app and database
  shifts these by the skew.
- Chat previews read `_max(created_at)` at JavaScript millisecond precision
  and match `created_at >= max - 1 ms`, letting the database order those
  rows at microsecond precision; exact ties go to the lowest id (the old
  query's choice was unspecified).
- Join-code redemption and email-domain joining did not lock the profile
  (redemption) or used `FOR UPDATE` (domain join); both now bind with
  `updateMany ... WHERE school_id IS NULL` and roll back on count 0, so a
  concurrent bind yields 409 instead of a duplicate student record (the
  partial unique index on `student.user_profile_id` was the old backstop).
- `skipDuplicates`, `createManyAndReturn`, `mode: 'insensitive'` and
  `nulls: 'first'` are Prisma features with provider limits; they remain in
  code and are listed under "Remaining".

### Remaining, in order

1. **Grading row locks** (`src/grading/submission.service.ts`
   `startQuizAttempt`/`saveQuizAnswers` `FOR UPDATE` on `submission`;
   manual mark `FOR SHARE` on `activity` paired with
   `ActivityService.changePoints` `FOR UPDATE`; `RubricService` update
   `FOR UPDATE` paired with assess `FOR SHARE`). These are lock *pairs*
   that order two different writers. Portable design: an integer
   `lock_version` on `activity`, `rubric` (and `submission` for the quiz
   timer) bumped by the writer that changes the guarded state, with the
   other writer's final update conditioned on the version it read
   (`updateMany` + count check, retry or 409). Needs a schema migration and
   concurrency tests against PostgreSQL before the locks go.
2. **School retention closed-year query** (`SchoolRetentionService.dueStudents`):
   `GROUP BY ... HAVING bool_and(ay.end_date IS NOT NULL) AND
   max(ay.end_date) <= $1::date`. Replace with a Prisma relation read of
   each enrolled student's courses' academic-year end dates and a pure,
   tested TypeScript filter (every course in a year with an end date;
   latest end on or before the UTC calendar date). Deferred this round: it
   selects students for erasure, so it should land with, and be reviewed
   alongside, the GDPR retention fixes; confirm the database session time
   zone used by the current `::date` cast first.
3. **Erasure replay** (`src/erasure/erasure-replay.service.ts`,
   `compileStep`): replace dynamic SQL with typed per-table handlers
   (Prisma `count`/`deleteMany`/`updateMany` per allow-listed table) and
   keep replay idempotent. The audit-table step already goes through
   `AuditStore.scrubActor`.
4. ~~Audit store extraction~~: done (see "Audit store"). Per-provider
   database enforcement (a role or triggers for MySQL, SQL Server, SQLite)
   is still to design.
5. ~~Student `left_at` and peer-review not-self in services~~: done. The
   triggers stay as a PostgreSQL backstop in the hardening step.
6. **Shared error handling**: delete the unused `pgCode`/`raisedMessage`
   helpers and their tests; keep provider codes in `isUniqueViolation` and
   friends, adding adapter codes as providers are pinned.
7. **Prisma features with provider limits** found in code:
   `createMany({ skipDuplicates })` (peer-review allocation, library file
   reservation, others: 37 uses of `skipDuplicates`/`createManyAndReturn`/
   `updateManyAndReturn` in `src`), `mode: 'insensitive'` outside
   `TextSearch`, and `orderBy ... nulls`. Each needs a portable form (read
   then insert inside the transaction, unique-violation tolerant inserts,
   or the `TextSearch` interface) or a provider implementation.

## Next steps after phase 4

- **Phase 3, canonical schema:** single-namespace logical schema and a
  deterministic generator for provider variants. Known schema items: the
  `organisation_singleton` expression index (`((true))`) and the two
  `lower(name)` unique expression indexes, partial unique indexes,
  `dbgenerated` defaults (`gen_random_uuid()`, `now() AT TIME ZONE 'utc'`),
  native types, `pg_trgm` GIN indexes (optional per provider), and the
  remaining triggers above.
- **Phase 5, per-provider setup:** superseded by `prisma db push` plus a
  `DatabaseHardening` implementation per provider (`src/database-setup`);
  a new provider adds its implementation (triggers, CHECKs, optional
  indexes) instead of a migration history.
- **Phase 6, conformance CI:** run the persistence and concurrency
  scenarios (job leases across instances, compare-and-set claims, join
  races, audit append-only and purge, erasure replay) against a real
  database per provider. Until then the mock-based tests above prove only
  the queries issued, not provider behaviour.

PostgreSQL remains the only supported provider.

## Database setup without migrations

Decision (owner): the schema is created and updated with `prisma db push`;
there is no migration history any more. What Prisma cannot declare lives in
an idempotent, provider-aware setup layer, `src/database-setup/`:

| Command | Does |
| --- | --- |
| `bun run db:prepare` | **Before** push. PostgreSQL: creates `pg_trgm` (the schema's trigram indexes need it) and runs the one-time legacy bridge for databases built by the old migrations (below). Other providers: logs that nothing is implemented. |
| `bun run db:harden` | **After** push. The provider's `DatabaseHardening.apply` (PostgreSQL: trigger functions, triggers, expression indexes, CHECK constraints), then the one-off data steps (`setup_step` ledger). Holds the `database-setup` job lease (taken with the root client, never inside a transaction). |
| `bun run db:deploy` | Development: `db:prepare && prisma db push && prisma generate && db:harden`. |
| `bun run db:release` | Production (container start, PM2 deploy, compose `migrate` service, CI): prepare, push, harden under one PostgreSQL session advisory lock, without `prisma generate`. |
| `DB_HARDEN_ON_BOOT=true` | Opt-in: each API instance runs `db:harden` in the background after boot. **Off by default, production included**: the release step already runs it once per deploy before the new code serves traffic; a boot run in every replica competes for DDL locks, and `VALIDATE CONSTRAINT` scans tables while serving traffic. Never runs push or prepare. |

The interface (`src/database-setup/types.ts`):

```ts
interface DatabaseHardening {
  provider: DatabaseProvider;
  prepare(db): Promise<HardeningReport>; // before db push
  apply(db): Promise<HardeningReport>;   // after db push
}
```

The provider comes from the generated client (`_activeProvider`, from
`datasource.provider` in `schema/main.prisma`), falling back to the
`DATABASE_URL` scheme (`src/database-setup/provider.ts`). PostgreSQL gets
`PostgresHardening`; every other provider (CockroachDB included: it lacks
plpgsql triggers and `NOT VALID`) gets `ApplicationOnlyHardening`, which logs
that only application-level enforcement applies.

`PostgresHardening.apply` reads the catalogue before each object and does
nothing when the object is present with the expected definition; otherwise
it uses `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` + `CREATE
TRIGGER`, `CREATE [UNIQUE] INDEX IF NOT EXISTS` (drop + create in one
transaction when the definition differs) and `ALTER TABLE ... ADD
CONSTRAINT ... NOT VALID` followed by `VALIDATE CONSTRAINT` (drop + add in
one transaction when the definition differs). A CHECK that existing rows
violate stays `NOT VALID` (enforced for new writes), is reported as
`partial`, and is validated again on the next run. One failing object never
stops the others; any failure makes the command exit 1.

Verified against PostgreSQL 17 (PGlite over a socket; the local
PostgreSQL/Docker was not running): fresh database `db:deploy` creates
everything, a second run reports all 248 objects unchanged and `prisma
migrate diff` is empty (push and hardening do not fight); a database at the
v1.4.0 migration state with sample rows goes through bridge, push (additive
only) and harden with every object unchanged and the array data preserved;
triggers, CHECKs and the singleton index refuse bad writes. Not verifiable
there: the release advisory lock (PGlite serves one connection at a time).

### Setup-layer inventory

Everything the old migrations created that `prisma db push` does not, with
what it guarantees and how it is now enforced. Source of the PostgreSQL
definitions: a database built by replaying all 89 migrations (git
`181ca40`), so the hardening objects are byte-for-byte what migrated
databases already have.

**Triggers and trigger functions (PostgreSQL)**

| Object | Guarantees | Every provider | PostgreSQL |
| --- | --- | --- | --- |
| `public.audit_log_append_only()` on `audit_log`, `sso_audit_log`, `integration_audit_log` (BEFORE UPDATE OR DELETE) | Audit rows cannot be changed or deleted, except the school-deletion FK action and the transaction-local `gradebook.audit_purge` path | `AuditStore` is the only writer; `audit-store.test.ts` greps `src` and `scripts` for any other write | Hardening recreates the function and the three triggers |
| `public.audit_log_no_truncate()` (BEFORE TRUNCATE, same tables) | No truncation outside the purge path | Nothing in the app truncates | Hardening |
| `student.set_student_left_at()` / `student_set_left_at` | `left_at` = now when a student first becomes inactive, kept while inactive, null while active (starts leaver retention) | `withLeftAt` in every `is_active` write path; guard test; setup step `student-left-at-backfill` | Hardening (backstop for writes that bypass the app) |
| `grading.peer_review_allocation_not_self()` / `peer_review_allocation_not_self` | A student never reviews their own submission | `PeerReviewService` (`requireReviewer`, allocation check); tests for add, reassign, allocate | Hardening |

**Extension:** `pg_trgm` (performance of the student name search behind
`TextSearch`; results are the same without it). The two GIN indexes are in
the Prisma schema, so `db:prepare` creates the extension before push.
Migrated databases have it in schema `extensions`; fresh ones in `public`.

**Expression indexes** (push ignores them; hardening creates them):

| Index | Guarantees | Every provider |
| --- | --- | --- |
| `organisation_singleton` (`((true))`) | One organisation row | `OrganisationService.setup` re-checks inside its transaction |
| `data_export_one_active_key` (partial, `COALESCE(student_id, subject_user_id)`) | One pending/running export per requester, kind and subject | `DataExportService.create` returns the active one first; P2002 falls back to it |
| `assignment_group_course_name_key` (`lower(name)`) | Group names unique per course, ignoring case | `AssignmentGroupService.requireFreeName` in the create/rename transaction (tested) |
| `course_join_code_key` (`upper(join_code)`) | Join codes unique ignoring case | Codes are generated upper-case; `regenerateJoinCode` skips a taken code before writing (tested) |
| `school_webhook_header_name_key` (`lower(name)`) | Header names unique per webhook, ignoring case | `webhook-headers.ts` refuses duplicate names (case-insensitive) in the set it replaces in one transaction |

The service checks are not atomic under concurrency on their own: on a
provider without these indexes two simultaneous requests can both pass the
check. See "What could not be made portable".

**Partial indexes.** The generator enables `partialIndexes`, so `db push`
manages every partial index declared with `where:` and **drops partial
indexes that are not in the schema**. All plain-column partial indexes are
therefore in the schema; the hardening step never creates one (it would be
dropped on the next push). This round moved into the schema the ones only
the migrations had: `organisation_invite_open_organisation_admin`,
`organisation_invite_open_school_admin`, `organisation_invite_open_school_staff`,
the predicate of `organisation_invite_open_email_idx` and
`idx_submission_quiz_expires`, `idx_student_left_at`,
`attendance_record_coordinates_idx`, `attendance_session_coordinates_idx`,
`course_school_template_idx`, `roster_link_disabled_at_idx`; plus plain
indexes `course_notification_created_at_idx`,
`file_notification_created_at_idx`, `roster_link_target_id_idx`.

Uniqueness that rests on partial unique indexes in the schema (enforced by
the database on PostgreSQL, SQLite, SQL Server and CockroachDB; MySQL/MariaDB
have no partial indexes): `ai_provider_one_default`,
`attendance_alert_open_key`, `idx_conversation_direct_key`,
`attendance_session_one_open_per_course`, the five
`course_notification_user_*_key` kind indexes, the three
`organisation_invite_open_*` indexes (InviteService also revokes the open
invite in the same transaction), `grade_scale_one_default_per_school`,
`idx_folder_unique_child`/`_root`, `lti_platform_key_one_active_key`,
`lti_deployment_tool_all_schools_key`, `school_email_domain_verified_key`,
`school_join_request_pending_unique`, `school_management_one_admin_per_school`,
`idx_school_join_code_one_active`, `idx_student_user_profile_unique`
(join flows also bind with compare-and-set), `student_school_number_key`.

**Foreign keys.** Nine foreign keys existed only in migrations; push would
have dropped them on a migrated database (and never created them on a fresh
one), losing their `ON DELETE CASCADE`s, which erasure relies on. They are
now Prisma relations with their original names: `data_export` (requested_by,
subject_user_id, student_id, school_id), `student_restriction.student_id`,
`notification_preference.user_profile_id`,
`notification_preference_opt_out.user_profile_id`, `email_change.user_id`,
`school_retention_setting.school_id`. Six FK/index names are mapped
(`map:`) so push does not rename them.

**CHECK constraints** (231, `src/database-setup/postgresql/checks.ts`).
Prisma does not manage CHECKs at all. By kind: 67 allowed-value lists
(`kind`, `status`, `provider`, `locale`, `action`, ... - e.g.
`permission_catalog_action_check`), 60 cross-column / nullability rules
(e.g. a location is all-or-nothing, `resolved` <-> `resolved_at`), 45
lengths, 41 numeric ranges, 12 format rules (lower-cased, trimmed emails
and domains), 6 others (singleton settings rows such as
`translation_setting_singleton`, JSON shape such as
`erasure_log_subject_ids_check`). PostgreSQL: hardening. Every provider:
request DTO validation (class-validator) and the services that build the
values. Allowed-value lists stay `text` + CHECK rather than Prisma enums:
converting a populated column to an enum type is a drop-and-add for `db
push` (data loss), so enums are only for new columns.

**One-off data steps** (`setup_step` ledger; runner in
`src/database-setup/steps/runner.ts`). Each step runs once per database in
one transaction with its ledger row (inserted first, so a concurrent runner
blocks, then sees a unique violation and skips), Prisma only, and is a no-op
on an empty database.

| Data step in the old migrations | Now |
| --- | --- |
| Backfill `left_at = now()` for inactive students (`20261205110000`) | Bridge (migrated DBs); setup step `student-left-at-backfill` (DBs created by push before the app stamped `left_at`) |
| Scrub copied actor name/email of erased accounts from `audit_log` (`20261205170000`) | Bridge; on push-created DBs every account erasure scrubs through `AuditStore.scrubActor` |
| `require_mfa_for_admins = true` for existing organisations (`20261205180000`) | Bridge; fresh DBs get the schema default `true` |
| Array -> child table / JSON copies (12 migrations, `20261205190000`-`20261206180000`) | Bridge only (fresh DBs never had arrays) |
| `permission_catalog` rows (several migrations) | `PermissionCatalogSyncService` at boot (already) |
| Released-history data steps (`submission_files`, first `organisation_admin`, ...) | Already applied on every released database; nothing on fresh ones |
| Analytics default changed to off (`feature.catalog.ts`) | Setup step `analytics-default-off-keep-existing`: organisations that exist when it first runs and have no boolean `analytics` key get `analytics: true`; later organisations start off |

**Legacy bridge** (`src/database-setup/postgresql/legacy-bridge.ts`,
`legacy-bridge/*.sql`). Released databases (v1.4.0) stop at
`20261204100000_custom_oidc_sso`; the 26 later migrations were never
released. Several convert arrays to child tables or JSON while copying the
data, which push would instead do as drop-and-add (it refuses without
`--accept-data-loss`). On a database that has `_prisma_migrations`,
`db:prepare` applies the missing ones in order, one transaction each, and
records them in `_prisma_migrations` like `migrate deploy`. Two of them
failed on every database and are fixed in the bridge copies:
`20261206110000_portable_attendance_flags` named the table
`course.course_attendance_record` (it is `course.attendance_record`), and
`20261206140000_portable_erasure_subject_ids` converted `subject_ids` to
JSON while a `cardinality()` CHECK was still on it (now dropped first and
re-added in JSON form). A database older than v1.4.0 is refused with
instructions. Databases created by push have no `_prisma_migrations` and are
skipped.

### Moving an existing production database from `migrate deploy` to `db push`

Behaviour of `prisma db push` that matters here (Prisma 7.10, checked with
`prisma migrate diff` against migrated databases):

- Tables and columns not in the schema: push wants to drop them and refuses
  without `--accept-data-loss`. A column type change it cannot cast is a
  drop-and-add, also refused. **Never pass `--accept-data-loss`**: no release
  step does; if push asks for it, stop.
- Adding a unique index or constraint to an existing table is also reported
  as possible data loss and refused (tried with an `organisation.singleton`
  unique key, then dropped). A new unique rule on an existing table needs a
  setup step that checks the data first, or an expression/partial index in
  the hardening step.
- Indexes and foreign keys not in the schema: dropped silently (no warning).
  Hence every index and FK of the migrated schema is now declared.
- CHECK constraints, triggers, functions, extensions and expression indexes:
  ignored (never created, never dropped). That is what the hardening step
  owns. The `postgresqlExtensions` preview is not enabled, so push leaves
  `pg_trgm` alone.
- Partial indexes on plain columns: managed by push (`partialIndexes`
  preview), so they live in the schema only.

Operator steps for a database at v1.4.0:

1. Back up the database (`infrastructure/BACKUPS.md`).
2. Deploy this release. The container runs `bun run db:release` at start
   (or run it once as the release step with `MIGRATE_ON_START=false`):
   prepare (pg_trgm present; the bridge applies the 26 unreleased
   migrations), `prisma db push` (adds `setup_step`, drops nothing), harden
   (everything already present: no-op), steps (left_at backfill, analytics
   kept on).
3. Check: `bun run db:harden` again reports every object `unchanged` and
   both steps `already-applied`; `bunx prisma migrate diff
   --from-config-datasource --to-schema prisma/schema --script` prints an
   empty migration.
4. A database older than v1.4.0: deploy v1.4.0 first (its container runs
   `prisma migrate deploy`), then this release.
5. `_prisma_migrations` stays as a historical record; nothing reads it after
   the bridge. Do not run `prisma migrate dev`/`reset` against the database.

Development databases created with plain `prisma db push` from this branch
before this change may lack the three `organisation_invite_open_*` unique
indexes; push then asks for `--accept-data-loss` to add them. Recreate such a
database (`docker compose -f docker-compose.dev.yml down -v`, then `bun run
preload`) rather than accepting.

### What could not be made portable

- **Atomic uniqueness without a database index.** The expression-index
  rules (organisation singleton, one active export, case-insensitive group
  names, join codes, webhook header names) and, on MySQL/MariaDB, every
  partial unique index above, are checked by services inside their
  transactions; under READ COMMITTED two concurrent requests can both pass a
  check. Only PostgreSQL (all of them) and SQLite/SQL Server/CockroachDB
  (the partial ones) close that race in the database. A provider needs its
  own index form (generated columns, filtered indexes) or a lock per rule
  before it is supported.
- **Audit append-only against direct database access.** On providers
  without hardening, append-only rests on the `AuditStore` boundary and its
  test; anyone with the application's database credentials can still change
  rows. PostgreSQL's triggers stop the application role (not the owner, who
  can drop them).
- **left_at and peer-review not-self for writes outside the app** (manual
  SQL, other tools): only the PostgreSQL triggers cover them.
- **CHECK constraints:** application coverage is request validation plus
  the services that derive values; a per-CHECK audit against the DTOs is
  still owed before a non-PostgreSQL provider is supported.
- **pg_trgm is required on PostgreSQL, not optional.** The trigram GIN
  indexes are declared in the schema (moving them to the hardening step
  would make push drop them on every deploy), so push cannot run without
  the extension. `db:prepare` creates it and fails with instructions when the
  server lacks it (`contrib`) or the role may not create it.
- **The release lock is PostgreSQL-only** (`pg_advisory_lock` on its own
  connection, since `job_lease` may not exist before the first push). On
  other providers run one release at a time.

## Provider contract

Each provider must pass the same behavioral contract:

1. Build and generate the correct Prisma client for that provider.
2. Create a fresh database from that provider's baseline migration.
3. Upgrade a database from the previous supported release using that
   provider's migration path.
4. Pass the same API authorization, transaction, integrity, erasure, retention,
   and concurrency scenarios as PostgreSQL.
5. Run the backend's persistence integration suite against that database in CI.

Do not label a provider supported until both clean-install and upgrade paths
pass. Unit tests with mocked Prisma are useful but do not count as provider
conformance.

## Implementation phases

### 1. Lock the compatibility matrix and inventory

- Pin the relational provider matrix to the Prisma 7 release used by this repo.
- Add an inventory table for each provider-specific schema feature, raw query,
  function, trigger, extension, migration, and operational script.
- Classify each item as portable Prisma, shared application implementation,
  or provider-specific implementation with a common interface.
- Record behavioral guarantees before replacing database code, particularly
  serialization/locking, uniqueness, append-only audit behavior, and deletion
  cascades.

**Exit condition:** every live PostgreSQL dependency has an owner, a target
replacement, and a testable invariant.

### 2. Establish provider-specific build outputs

- Make the selected provider explicit in build and deployment configuration.
- Generate a Prisma client and adapter for one provider per build artifact;
  do not pretend one generated client can switch datasource providers at
  runtime.
- Hide adapter construction behind `PrismaService` configuration and validate
  that the selected adapter, generated client, and connection URL agree.
- Add startup diagnostics that report the configured provider without
  disclosing credentials.

**Exit condition:** CI can build and connect a minimal app for every matrix
entry without importing another provider's driver.

### 3. Create a provider-neutral schema contract

- Normalize the model schema around relational concepts rather than Postgres
  namespaces. Keep logical model names stable for the application.
- Replace native UUID and timestamp annotations with provider-neutral Prisma
  types and choose portable storage mappings.
- Replace Postgres arrays with normalized child tables or JSON only where the
  application semantics and query patterns remain equivalent.
- Replace Postgres-only partial indexes and generated defaults with portable
  constraints or explicit application transactions. Keep a provider-specific
  index only when it is an optional performance optimization.
- Preserve foreign keys, uniqueness, nullability, and check semantics. Where a
  provider cannot express an invariant, enforce it in a shared service and add
  concurrency tests.
- Keep one canonical schema source and generate provider-specific schema
  variants only through a deterministic, checked-in process. Avoid hand-edited
  copies that can drift.

**Exit condition:** Prisma schema validation and client generation succeed for
all six providers; a schema-diff check reports no accidental model/field drift.

### 4. Remove PostgreSQL-only runtime SQL

- Replace advisory locks with a shared locking abstraction. Prefer database
  constraints and compare-and-set updates where possible; use provider-specific
  lock implementations only behind this interface where serialization is
  required.
- Move SQL functions for quiz submission, student join-code redemption,
  student merging, duplicate detection, and chat unread counts into
  transaction-scoped Prisma service code where behavior can be preserved.
- Replace dynamic SQL in erasure replay with typed table handlers and Prisma
  operations. Keep replay idempotent and safe for every provider.
- Replace session settings such as `set_config` and trigger-only audit
  exceptions with explicit, narrowly scoped service operations and database
  transactions.
- Remove Postgres error-code assumptions from shared error handling; normalize
  unique, foreign-key, and serialization failures by Prisma error code and
  provider adapter metadata.

**Exit condition:** application source contains no unclassified raw SQL or
PostgreSQL driver imports outside the provider implementation layer.

### 5. Split migration histories by provider

- Keep the existing migration history as the PostgreSQL path; never rewrite
  migrations that deployed installations have already applied.
- Create a fresh baseline for each newly supported provider from the canonical
  schema and provider-specific constraints/indexes.
- Add incremental migration directories and deployment commands selected by
  provider. A new database must not attempt to run PostgreSQL SQL.
- Represent non-Prisma database features in reviewed provider-specific
  migrations and pair each with a common application behavior test.
- Document backup, migration, rollback, and data-conversion procedures,
  including UUIDs, JSON/arrays, timestamps, and enum conversion.

**Exit condition:** clean-install and previous-release upgrade checks pass for
each provider in an isolated database.

### 6. Add provider conformance CI

- Run schema validation, generation, lint, unit tests, and persistence tests
  for every provider.
- Use service containers or provider-supported test instances; include SQLite
  in-memory/file behavior and CockroachDB transaction retry behavior.
- Exercise tenant isolation and permission checks through API routes, not only
  direct Prisma calls.
- Exercise concurrent operations for locks, unique constraints, audit writes,
  erasure replay, and background scheduler claims.
- Capture supported provider and version in CI artifacts; make matrix failures
  block releases claiming that provider.

**Exit condition:** required CI jobs pass on all matrix entries for two
consecutive release candidates, including migration upgrade tests.

### 7. Clean up documentation and release support

- Correct live references that imply RLS is active. Preserve dated changelog
  entries that accurately describe historical Supabase behavior.
- Publish a provider support table with tested versions and limitations.
- Update environment variables, local compose/dev setup, deployment, backup,
  migration, and troubleshooting docs.
- Release providers incrementally only after their conformance gate passes;
  retain PostgreSQL as the supported default during the migration.

## Immediate next work

1. Design the canonical single-namespace logical schema and deterministic
   provider-generation pipeline. The MySQL proof demonstrated that schema
   generation must preserve correctness invariants, not simply validate.
2. Finish phase 4: work through "Remaining, in order" above (grading lock
   pairs, retention closed-year query, erasure replay, audit store, the two
   invariant triggers, error helpers, provider-limited Prisma features),
   then generate and validate MySQL against the canonical schema.
3. Pin adapter packages and provider versions from the Prisma 7.10.1 docs and
   establish clean-install and upgrade migration paths before claiming a
   provider supported.

## MySQL schema prototype findings (Prisma 7.10.1)

A temporary, non-production transformation of the current schema was validated
with `prisma validate` against the MySQL connector. It flattened PostgreSQL
schemas into namespaced table names, removed native PostgreSQL types, changed
scalar arrays to JSON, dropped partial/Gin indexes, and changed constraint
names. The result validates, but **is not semantically portable and is not a
supportable MySQL schema**. This proves that mechanical flattening alone is
insufficient and provides a concrete blocker list:

- Scalar array fields have been converted to JSON or normalized child tables;
  provider-specific schema validation and migration behavior still need proof.
- PostgreSQL's multiple-schema namespace currently distinguishes tables and
  enum names. A single-schema provider needs stable, collision-free physical
  mappings without changing logical Prisma model names.
- PostgreSQL partial unique indexes express kind-specific notification
  uniqueness and other conditional invariants. These must be redesigned with
  portable compound keys or service transactions; deleting the predicates
  changes correctness.
- GIN/trigram and array indexes are performance and search dependencies.
  Search must get a portable implementation (or an explicitly optional
  provider feature) before those indexes can be dropped.
- PostgreSQL native UUID generation is used by hand-written SQL inserts as
  well as Prisma creates. Replacing it with Prisma-side `uuid()` defaults
  requires removing those SQL inserts first or providing matching database
  defaults per provider.
- Constraint/index names are currently mapped from Postgres migrations and
  can collide or be unsupported when tables are flattened. Logical uniqueness
  and referential semantics must be retained independently of those names.
- The current migration chain contains 15-plus triggers/functions/extensions
  and JSONB-only checks, so the MySQL schema proof does not validate data
  creation, upgrade, cascade, or transaction behavior.

Prototype command used for validation was `bunx prisma validate --schema
/tmp/gb-prisma-mysql/schema.prisma`; only the temporary candidate was changed.
The production PostgreSQL schema and its migration history remain the source
of truth until a canonical portable model representation is designed.

The production-schema portability changes so far normalize notification
preferences (`push_off` and `email_off`) into
`public.notification_preference_opt_out`, timetable weekdays into
`public.timetable_school_day`, and webhook subscriptions into
`public.school_webhook_event`, plus parent notification kinds into
`student.parent_notification_kind`. Opaque library import notes and rostering
error lists have also moved to JSON fields, and searchable library tags now
use `course.library_item_tag`, and registered LTI redirect URLs now use
`public.lti_tool_redirect_uri`. Attendance location flags, LTI launch roles,
and access-token scopes use JSON because they are opaque metadata or ordered
protocol lists. School feature opt-outs now use `public.school_feature_disabled`.
Erasure subject IDs now use JSON while preserving the signed export shape.
Quiz file type settings and saved quiz option order now use JSON. These
changes remove all eighteen scalar arrays from the current Prisma schema.
Quiz scoring and rescore now use the shared TypeScript rules and Prisma
transactions; migration `20261206180000_portable_quiz_answer_option_ids`
converts the final UUID array and removes the obsolete database function.
Each change has a PostgreSQL migration and the affected
services were updated. They do not yet establish support for any additional
provider.
