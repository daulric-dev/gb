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
- Application code uses PostgreSQL raw SQL and locking in account setup,
  student code redemption, chat unread counts, similarity, data export,
  rostering, attendance alerts, and other schedulers. Peer-review scheduling
  and allocation now use persisted Prisma leases.
- The current raw SQL inventory includes `account/sensitive-text`, analytics,
  attendance alerts, course-library imports, data export, discussion,
  email-domain settings, erasure/replay, grading/rescore, integrations,
  organisation setup, parent notifications, report generation,
  retention, rostering, similarity, student join-code redemption, and timetable
  scheduling. Tests that assert SQL strings also need replacement with
  behavior-focused persistence tests.
- The migration history is PostgreSQL SQL, including functions, triggers,
  extensions, JSONB-specific checks, and partial indexes. It cannot be replayed
  unchanged on another provider.
- Database objects include quiz submission, chat unread counts, email-domain
  school joining, student merge/join-code redemption and duplicate matching;
  role seeding and student-leaver triggers; audit append-only triggers; and a
  `pg_trgm` extension. Each must become shared application logic or a
  documented provider implementation.
- Some database guarantees currently live only in SQL triggers/functions.
  Those guarantees need portable application implementations or explicitly
  equivalent per-provider database implementations.
- RLS-related text remains in generated Prisma model comments and historical
  documentation. Historical changelog entries should remain historical; live
  schema comments and current guidance should be corrected.

### Runtime SQL inventory

The first source scan found the following implementation areas. This list is
deliberately by subsystem: the files in each area include production code and,
in several cases, tests that currently encode PostgreSQL SQL rather than the
behavior the SQL provides.

| Area | Current PostgreSQL dependency | Portability work |
| --- | --- | --- |
| Account sensitive text | `src/account/sensitive-text.ts` raw SQL batches and locks | Use Prisma updates/transactions; preserve bounded migration and encryption behavior. |
| Analytics | `src/analytics/analytics.service.ts` SQL joins, casts, filtered counts | Use Prisma relation queries and aggregate in application code, or provider implementations behind a repository. |
| Schedulers | analytics, attendance alerts, course library, data export, parent notices, reports, rostering, timetable | Replace advisory locks with a portable claim/lease abstraction and test multi-instance behavior. Peer review now uses `job_lease`. |
| Chat and discussions | unread-count and topic-stat SQL | Replace with Prisma aggregates and relation queries; compare result semantics. |
| Email-domain and organisation | raw SQL, provider-specific unique/error handling, setup advisory lock | Move invariants to Prisma transactions and portable constraints. |
| Erasure and retention | dynamic SQL replay, PostgreSQL casts/array predicates, `set_config` trigger bypass | Replace with typed Prisma handlers; implement narrow audited purge operations without session variables. |
| Grading | activity/rubric/submission raw queries and some explicit row locks | Move remaining transaction logic into Prisma; preserve race handling, deadlines, and atomicity. Quiz submit/rescore now use shared TypeScript scoring. |
| Integrations | webhook delivery claim SQL and raw event lookups | Use conditional Prisma updates and stable ordering; test concurrent delivery workers. |
| Peer review and similarity | peer review now uses persisted leases; similarity uses Prisma hash relations; other raw comparisons remain | Use portable serialization and query batches; verify database-size/performance limits. |
| Student account | Postgres join-code redemption function and SQLSTATE-specific errors | Implement atomic Prisma transaction with conditional code consumption and normalized errors. |
| Error handling | `src/common/db-values.ts` Postgres SQLSTATE extraction | Normalize Prisma known request errors and adapter errors for all target providers. |

### Database object inventory

| Existing object | Current location | Planned replacement |
| --- | --- | --- |
| Quiz submission function | Historical `0_baseline` and grading migrations; dropped by `20261206180000_portable_quiz_answer_option_ids` | Shared transaction service and TypeScript scorer; test concurrent submissions. |
| Chat unread-count function | `0_baseline` | Prisma count/group queries with equivalent unread high-water semantics. |
| Email-domain join, student merge, join-code redemption, duplicate-candidate functions | `0_baseline` | Application services using Prisma transactions and conditional writes. |
| School role seeding and student `left_at` triggers | `0_baseline`, retention migration | Explicit school creation and student update service operations; backfill existing rows. |
| Peer-review allocation trigger | peer-review migration | Validate in the service transaction plus a uniqueness constraint where representable. |
| Audit append-only triggers and purge session setting | access-defaults and audit actor scrub migrations | Narrow audit repository operations and separate credentials/operations for retention where supported. |
| `pg_trgm` and partial/expression indexes | baseline and later migrations | Portable indexes or optional provider-specific performance indexes; never correctness dependencies. |
| JSONB checks and array columns | many migrations | Schema validation plus portable relational representation; preserve validation at the write boundary. |

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
2. Remove the remaining raw PostgreSQL operations behind shared application
   services, then generate and validate MySQL against that schema.
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
