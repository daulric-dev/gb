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
- The migration history is PostgreSQL SQL, including functions, triggers,
  extensions, JSONB-specific checks, and partial indexes. It cannot be replayed
  unchanged on another provider.
- Database objects still in the PostgreSQL schema: the student `left_at`
  trigger, the peer-review not-self trigger, the audit append-only triggers
  and the `pg_trgm` extension/indexes. Quiz submission, chat unread counts,
  email-domain joining, join-code redemption and school role seeding are
  now TypeScript (functions dropped by migrations); student merge and
  duplicate matching were dropped earlier.
- Some database guarantees currently live only in SQL triggers/functions.
  Those guarantees need portable application implementations or explicitly
  equivalent per-provider database implementations.
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
| `student.set_student_left_at` trigger | **Kept.** It starts the leaver-retention clock, so it is privacy-critical. Before dropping it, every write of `student.is_active` must set `left_at` the same way (null while active; first deactivation sets it; staying inactive keeps the original). Paths that write `is_active` or create students today: `StudentService` create/update (`src/student/student.service.ts`), rostering apply (create, reactivate, disable: `src/rostering/roster-apply.service.ts`), student creation in join-code redemption and email-domain joining, and the seed/check scripts (re-check with a search for `student.create`/`student.update` before dropping). Plan: one `studentActiveChange(before, next, now)` helper used by all of them, a test per path, then a migration that drops the trigger. |
| `grading.peer_review_allocation_not_self` trigger | **Kept as a backstop.** The service enforces it on every write path: `addAllocation` and `reassign` (`requireReviewer` refuses reviewer = author) and `allocateNow` (the allocation algorithm excludes self-review; the transaction now also refuses any self pair before inserting). Drop once a provider without triggers is targeted and a conformance test proves it. |
| Audit append-only triggers (`audit_log_append_only`, `audit_log_no_truncate` on `audit_log`, `sso_audit_log`, `integration_audit_log`) and the `gradebook.audit_purge` session setting | **Kept, provider-specific by design** (see "Audit store interface"). |
| `pg_trgm` extension and GIN trigram indexes on student names | **Kept as an optional PostgreSQL performance feature** behind `TextSearch`. |
| Expression/partial indexes, `dbgenerated` defaults | Schema work, phase 3 (see "Remaining"). |

### Audit store interface (design; behaviour unchanged)

The audit tables are append-only for the application. Today PostgreSQL
enforces that with row triggers, and the three privileged operations open a
transaction-local bypass with `set_config('gradebook.audit_purge', 'on',
true)`. That is the PostgreSQL implementation of this interface, which a
later round should extract (no behaviour change) so other providers can
supply their own:

```ts
interface AuditStore {
  /** Append one entry (the only write ordinary code may do). */
  append(tx: Tx, table: AuditTable, row: AuditRow): Promise<void>;
  /** Retention: delete expired entries by id, inside `tx`. */
  purgeExpired(tx: Tx, table: AuditTable, ids: string[], olderThan: Date): Promise<number>;
  /** Erasure: clear actor_name/actor_email of one account's entries. */
  scrubActor(tx: Tx, actorId: string): Promise<number>;
}
```

- PostgreSQL (current): `purgeExpired` and `scrubActor` run
  `set_config('gradebook.audit_purge','on', true)` and then the Prisma
  `deleteMany`/`updateMany`, in the caller's transaction; the triggers
  refuse every other update, delete and truncate. Callers today:
  `RetentionService` (three purges), `account-erasure.ts` (actor scrub),
  `ErasureReplayService` (replayed scrub).
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
   keep replay idempotent; the audit-table step goes through
   `AuditStore.scrubActor`.
4. **Audit store extraction**: move the three retention purges, the account
   erasure scrub and the replay scrub behind `AuditStore` (PostgreSQL
   implementation unchanged), then design per-provider enforcement.
5. **Student `left_at` trigger** and **peer-review not-self trigger**: the
   service work described in the object inventory, then drop migrations.
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
- **Phase 5, per-provider migrations:** keep this history as the
  PostgreSQL path; new providers start from a generated baseline plus their
  own reviewed migrations for triggers, optional indexes and the audit
  store.
- **Phase 6, conformance CI:** run the persistence and concurrency
  scenarios (job leases across instances, compare-and-set claims, join
  races, audit append-only and purge, erasure replay) against a real
  database per provider. Until then the mock-based tests above prove only
  the queries issued, not provider behaviour.

PostgreSQL remains the only supported provider.

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
