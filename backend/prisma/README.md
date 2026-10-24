# Prisma (`backend/prisma`)

The database definition for the backend: the Prisma schema (what the generated client knows about) and the SQL migrations (what actually builds the Postgres database). The app uses **Prisma 7** with the `pg` driver adapter (`@prisma/adapter-pg`) against **Postgres** (17 in `docker-compose.dev.yml`; any 15+ works).

```
prisma/
  schema/        one .prisma file per Postgres schema  -> see schema/README.md
  migrations/    ordered SQL migrations                -> see migrations/README.md
```

Configuration is in [`../prisma.config.ts`](../prisma.config.ts): schema folder `prisma/schema`, migrations folder `prisma/migrations`, datasource `DATABASE_URL` (loaded from `backend/.env` by `dotenv`). `prisma generate` gets a placeholder URL when `DATABASE_URL` is unset, so `bun install` and image builds work without a database; every other Prisma command needs it.

## Schema files

Prisma reads every `.prisma` file in [`schema/`](./schema/README.md) as one schema. `main.prisma` holds the generator and datasource; each other file holds the models of one Postgres schema (`account`, `billing`, `chat`, `course`, `file_manager`, `grading`, `public`, `student`; course discussions are in `discussion.prisma`). The table of files and the conventions for re-introspection are in [schema/README.md](./schema/README.md).

The generator writes the client to `src/generated/prisma` (gitignored, CommonJS, `partialIndexes` preview feature on). Import it as `@/generated/prisma/client`; application code uses it through `PrismaService` ([`src/prisma`](../src/prisma/README.md)).

## Generating the client

```bash
bun run db:generate        # prisma generate
```

It also runs automatically on `bun install` (`postinstall`), before `bun test` (`pretest`) and in `bun run build`. Run it after pulling someone else's schema change if you did not reinstall.

## Migrations workflow

Migrations are plain SQL in `migrations/<timestamp>_<name>/migration.sql`, applied in order by `prisma migrate deploy`, which records each one in the `_prisma_migrations` table. `0_baseline` is the whole schema as it stood when the app moved to its own Postgres, including SQL functions Prisma cannot express; everything after it is incremental. See [migrations/README.md](./migrations/README.md) for the list.

**Applying migrations** (local, CI, production):

```bash
bun run db:deploy          # prisma migrate deploy (the root `bun run db:setup` runs this)
```

`bun run preload` at the repo root runs it after starting the dev containers, and the production container runs it on start unless `MIGRATE_ON_START=false` (`infrastructure/Dockerfile`).

**Writing a migration.** The migrations in this repo are written by hand, in the same style as the baseline (commented `CREATE TABLE`, constraints, indexes and foreign keys):

1. Create a folder `prisma/migrations/<YYYYMMDDHHMMSS>_<what_it_does>/` with a `migration.sql`. The timestamp must sort after the latest existing folder.
2. Write the SQL. Keep each migration self-contained and forward-only. Postgres runs it in one transaction, so, for example, a new enum value cannot be used in the same migration that adds it (see `20261023160000_module_discussions_notifications`).
3. Update the matching `.prisma` file(s) in `schema/` so the client matches the database (or run `bun run db:pull` against a database with the migration applied and move new models to the right file - see [schema/README.md](./schema/README.md)).
4. `bun run db:deploy` to apply it locally, then `bun run db:generate`.
5. Commit the migration folder and the `.prisma` changes together.

`bunx prisma migrate dev --create-only --name <change>` can draft the SQL from `.prisma` edits as a starting point; review and edit it before applying. `bun run db:migrate` (`prisma migrate dev`) also works on a throwaway local database.

**Rules**

- **Never edit a migration that has been applied anywhere**; add a new one.
- **Never reset a shared database.** Do not run `prisma migrate reset`, `prisma db push --force-reset`, or accept the "reset the database" prompt `prisma migrate dev` shows when it detects drift, against anything other than your own disposable local database. They drop every table. On a shared or production database only `prisma migrate deploy` should run.
- To start your local database from scratch, wipe the Docker volume instead: `docker compose -f docker-compose.dev.yml down -v` at the repo root, then `bun run preload`.

## Other commands

| Command | Does |
| --- | --- |
| `bun run db:pull` | `prisma db pull && prisma generate` - re-introspect the database into the `.prisma` files. |
| `bun run db:studio` | Prisma Studio, a database browser. |
| `bun run db:migrate` | `prisma migrate dev` - development only, see the rules above. |

## See also

- [schema/README.md](./schema/README.md), [migrations/README.md](./migrations/README.md)
- [../README.md](../README.md), [docs/content/developer-guide.md](../../docs/content/developer-guide.md), [docs/content/platform-migration.md](../../docs/content/platform-migration.md)
