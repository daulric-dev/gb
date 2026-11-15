# Database setup (`src/database-setup`)

What `prisma db push` cannot create, run around it. The full inventory, the
reasoning and the upgrade steps are in
[`prisma/DATABASE_PORTABILITY.md`](../../prisma/DATABASE_PORTABILITY.md)
("Database setup without migrations").

| File | What |
| --- | --- |
| `types.ts` | `DatabaseHardening { provider; prepare(db); apply(db) }` and its report. |
| `provider.ts` | Provider from the generated client (`_activeProvider`), else the `DATABASE_URL` scheme. |
| `hardening.ts` | `hardeningFor(provider)`: PostgreSQL implementation, or `ApplicationOnlyHardening` (logs that only application-level enforcement applies). |
| `postgresql/postgres-hardening.ts` | Idempotent PostgreSQL hardening: reads the catalogue, then creates or replaces trigger functions, triggers, expression indexes and CHECK constraints (`objects.ts`, `checks.ts`); `prepare` creates `pg_trgm` and runs the legacy bridge. |
| `postgresql/legacy-bridge.ts`, `legacy-bridge/*.sql` | One-time: on a database built by `prisma migrate deploy` (v1.4.0), applies the 26 unreleased migrations (two fixed) and records them in `_prisma_migrations`. |
| `postgresql/release-lock.ts` | Session advisory lock for `db:release`. |
| `steps/runner.ts`, `steps/steps.ts` | One-off data steps: once per database, in a transaction with their `setup_step` ledger row, Prisma only. |
| `database-setup.ts` | `prepareDatabase`, `hardenDatabase` (under the `database-setup` job lease), logging. |
| `database-setup.module.ts` | Opt-in boot run (`DB_HARDEN_ON_BOOT=true`; off by default). |

Commands (`backend/package.json`): `db:prepare` (before push), `db:harden`
(after push), `db:deploy` (development: prepare, push, generate, harden),
`db:release` (production: prepare, push, harden under the advisory lock).

Adding something:

- **A CHECK, trigger or expression index (PostgreSQL)**: add it to
  `postgresql/checks.ts` or `postgresql/objects.ts` in the form PostgreSQL
  prints it, and enforce the same rule in the service/DTO so other providers
  get it too. Never add a partial index on plain columns here: declare it in
  the Prisma schema (`where:`), or push will drop it.
- **A data change**: a new `SetupStep` appended to `SETUP_STEPS` with a new
  key; Prisma only; a no-op on an empty database.
- **Another provider**: implement `DatabaseHardening` and return it from
  `hardeningFor`.

Tests: `provider.test.ts`, `sql-split.test.ts`, `database-setup.test.ts`,
`postgresql/postgres-hardening.test.ts` (idempotence against a simulated
catalogue), `postgresql/legacy-bridge.test.ts`, `steps/steps.test.ts`.
