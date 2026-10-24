# Prisma (`src/prisma`)

The database connection for the whole API. `PrismaService` is a `PrismaClient` (Prisma 7, generated into `src/generated/prisma`) that talks to Postgres through the `@prisma/adapter-pg` driver adapter. The same client runs in a container, on serverless Node or on Workers with a pooled connection string, because nothing here is host-specific.

The API connects as an owner role and enforces every access rule in code. The schema has no row-level security, so any service that queries a table is responsible for checking that the caller may see the rows.

## What it provides

- **HTTP routes**: none.
- **Services / exports**
  - `PrismaModule` is `@Global()`, so every module can inject `PrismaService` without importing it.
  - `PrismaService` extends `PrismaClient`. Use it exactly like a Prisma client: `this.prisma.course.findMany(...)`, `this.prisma.$transaction(...)`, `this.prisma.$queryRaw\`...\``.
  - `onModuleInit()` starts a connection but does not block boot. A failure is logged (`Database connection failed: ...`) and the first query reconnects.
  - `onModuleDestroy()` disconnects.
- **Other**: none.

## Used by

Almost every feature module. `PrismaModule` is imported once, in `src/app.module.ts`, and `PrismaService` is injected by (among others) `account`, `auth` (`auth.guard.ts`, `admin.guard.ts`), `academic-year`, `announcement`, `attendance`, `billing`, `calendar`, `chat`, `common/user-school.ts`, `course` (including `course/access/course-access.service.ts`), `course-notification`, `dashboard`, `discussion`, `email-domain`, `file-manager`, `grade-scale`, `grading`, `images`, `notifications`, `permission`, `queue/handlers`, `school`, `sso`, `student`, `student-account`, `student-portal` and `term`.

Tests do not use the real client: `src/test/prisma-mock.ts` (`createMockPrisma()`) builds a mock with the same model delegates.

## Depends on

- `@/generated/prisma/client`, produced by `prisma generate` from the schema in `backend/prisma/schema/`.
- `@prisma/adapter-pg` (the `pg` driver).

## Data

Every table. The schema is split one file per Postgres schema in [`prisma/schema/`](../../prisma/schema/README.md) (`public`, `account`, `course`, `grading`, `student`, `file_manager`, `chat`, `billing`). Migrations live in `backend/prisma/migrations/`; `backend/prisma.config.ts` points Prisma at both.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | none (required) | Postgres connection string passed to `PrismaPg`. `prisma generate` alone works without it (see `prisma.config.ts`). |

Useful scripts in `backend/package.json`: `db:generate`, `db:migrate`, `db:deploy`, `db:pull`, `db:studio`. `postinstall`, `pretest` and `build` all run `prisma generate`.

## Files

| File | Purpose |
| --- | --- |
| `prisma.module.ts` | Global module that provides and exports `PrismaService` |
| `prisma.service.ts` | The Prisma client with the `pg` adapter and connect/disconnect lifecycle hooks |

## Tests

There are no tests in this folder. Services are tested against `src/test/prisma-mock.ts` instead of a database.

## See also

- [`prisma/schema/README.md`](../../prisma/schema/README.md): what each schema file holds and how to change the schema
- [`docs/content/backend/overview.md`](../../../docs/content/backend/overview.md)
