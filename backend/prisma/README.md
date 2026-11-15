# Prisma (`backend/prisma`)

The database definition for the backend: the Prisma schema, which `prisma db push` applies to the database. The app uses **Prisma 7** with the `pg` driver adapter (`@prisma/adapter-pg`) against **Postgres** (17 in `docker-compose.dev.yml`; any 15+ with the `pg_trgm` contrib extension works). There are no SQL migration files (the old ones are in git history, last at commit `181ca40`); what Prisma cannot declare is handled by [`src/database-setup`](../src/database-setup) (see [DATABASE_PORTABILITY.md](./DATABASE_PORTABILITY.md)).

```
prisma/
  schema/                   one .prisma file per Postgres schema  -> see schema/README.md
  DATABASE_PORTABILITY.md   provider plan, setup-layer inventory, upgrade steps
```

Configuration is in [`../prisma.config.ts`](../prisma.config.ts): schema folder `prisma/schema`, datasource `DATABASE_URL` (loaded from `backend/.env` by `dotenv`). `prisma generate` gets a placeholder URL when `DATABASE_URL` is unset, so `bun install` and image builds work without a database; every other Prisma command needs it.

## Schema files

Prisma reads every `.prisma` file in [`schema/`](./schema/README.md) as one schema. `main.prisma` holds the generator and datasource; each other file holds the models of one Postgres schema (`account`, `chat`, `compliance`, `course`, `file_manager`, `grading`, `public`, `student`; course discussions are in `discussion.prisma`, the organisation in `organisation.prisma`, the setup-step ledger in `setup.prisma`). The table of files and the conventions for re-introspection are in [schema/README.md](./schema/README.md).

The generator writes the client to `src/generated/prisma` (gitignored, CommonJS, `partialIndexes` preview feature on). Import it as `@/generated/prisma/client`; application code uses it through `PrismaService` ([`src/prisma`](../src/prisma/README.md)).

## Generating the client

```bash
bun run db:generate        # prisma generate
```

It also runs automatically on `bun install` (`postinstall`), before `bun test` (`pretest`) and in `bun run build`. Run it after pulling someone else's schema change if you did not reinstall.

## Applying the schema

```bash
bun run db:deploy          # development: db:prepare, prisma db push, prisma generate, db:harden
bun run db:release         # production: db:prepare, prisma db push, db:harden under an advisory lock
bun run db:harden          # just the hardening and one-off setup steps (idempotent)
```

`bun run preload` at the repo root runs `db:deploy` after starting the dev containers; the production container runs `db:release` on start unless `MIGRATE_ON_START=false` (`infrastructure/Dockerfile`).

- **`db:prepare`** (before push): PostgreSQL creates `pg_trgm` (the student-name trigram indexes need it) and, on a database built by the old migrations, applies the unreleased ones once (the legacy bridge).
- **`prisma db push`**: makes the tables match the schema.
- **`db:harden`** (after push): PostgreSQL recreates the audit append-only triggers, the student `left_at` and peer-review not-self triggers, the expression unique indexes and the CHECK constraints when missing or different; then runs each one-off data step not yet in the `setup_step` ledger.

**Changing the schema.** Edit the `.prisma` files and run `bun run db:deploy`.

- Partial indexes go in the schema (`where: raw("...")`); push drops a partial index the schema does not declare.
- Expression indexes, CHECK constraints and triggers go in `src/database-setup/postgresql` (`objects.ts`, `checks.ts`), backed by a service check that works on every provider.
- A data change (backfill, default flip for existing rows) is a setup step in `src/database-setup/steps/steps.ts`: Prisma only, a new key, a no-op on an empty database.
- Push refuses lossy changes (dropping or retyping a populated column, adding a unique rule to an existing table) without `--accept-data-loss`. Never pass it; plan the change as add-copy-drop across releases with a setup step instead.

**Rules**

- **Never reset a shared database.** Do not run `prisma migrate reset`, `prisma db push --force-reset` or `--accept-data-loss` against anything other than your own disposable local database.
- To start your local database from scratch, wipe the Docker volume instead: `docker compose -f docker-compose.dev.yml down -v` at the repo root, then `bun run preload`.

## Other commands

| Command | Does |
| --- | --- |
| `bun run db:pull` | `prisma db pull && prisma generate` - re-introspect the database into the `.prisma` files. |
| `bun run db:studio` | Prisma Studio, a database browser. |

## See also

- [schema/README.md](./schema/README.md), [DATABASE_PORTABILITY.md](./DATABASE_PORTABILITY.md)
- [../README.md](../README.md), [docs/content/developer-guide.md](../../docs/content/developer-guide.md), [docs/content/platform-migration.md](../../docs/content/platform-migration.md)
