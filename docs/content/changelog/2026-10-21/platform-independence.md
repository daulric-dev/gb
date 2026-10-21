---
sidebar_label: 2026-10-21 · Platform independence
sidebar_position: 5
---

# 2026-10-21 - Platform independence: off Supabase

GradeBook no longer depends on Supabase for anything. It runs against any PostgreSQL, any S3-compatible store and any SMTP server, with its own sign-in and single sign-on. The full plan, decisions and the production cutover runbook are in **[Platform migration](../../platform-migration.md)**.

## What replaced what

| Was | Now |
| --- | --- |
| `supabase-js` through PostgREST, RPC | **Prisma 7** on plain Postgres (`DATABASE_URL`) |
| 58 Supabase CLI SQL migrations | **Prisma Migrate**: `backend/prisma/migrations/0_baseline` plus new migrations (`bun run db:migrate`, deploy with `bun run db:deploy`) |
| Row-level security as defence in depth | Dropped; every access rule is in the API, as it already was for the service-role client |
| Supabase Storage buckets, TUS uploads | One S3 bucket, objects keyed `<old bucket>/<path>`, presigned uploads |
| Supabase Auth, `sb-*` cookies | Own email codes and `gb_session` server sessions; users kept their ids |
| Supabase-hosted OAuth/SAML | OIDC (Google, Microsoft) and SAML handled by the API, configured per school email domain |
| Supabase SMTP and templates | Any SMTP server (`SMTP_URL`); Mailpit in development |
| Edge functions | BullMQ jobs in the backend; every function deleted |
| `bunx supabase start` | `docker-compose.dev.yml`: Postgres, Redis, SeaweedFS (S3), Mailpit |

## For developers

- `bun run preload` starts the dev containers and applies migrations; `bun run postload` stops them. `bun run db:setup`, `db:migrate`, `db:deploy`, `db:pull`, `db:studio`, `seed:demo` and `smoke` work from the repo root.
- `supabase/` is gone (migrations are in git history: `git show 13b14d1:supabase/migrations`). `db:start`, `db:stop`, `db:diff` and `db:types` were removed.
- `backend/.env.example` works as-is with the dev containers, including `ALLOW_DEV_LOGIN=true` for `seed:demo` and `smoke`.
- `prisma generate` needs no database, so `bun install` and CI run without `DATABASE_URL`.

## For deployments

- New variables: `DATABASE_URL`, `S3_*`, `SMTP_URL`, `MAIL_FROM`, `AUTH_SECRET` (required in production), and for SSO `GOOGLE_*`, `MICROSOFT_*`, `SAML_SP_ENTITY_ID`. Every `SUPABASE_*` variable is gone. See [Environment variables](../../environment-variables.md).
- The backend image applies pending migrations at start (`MIGRATE_ON_START=false` to make it a separate release step).
- Moving data: `bun run db:copy` (database) and `bun run storage:copy` (files), then rewrite old avatar URLs. **Everyone signs in again once** after the cutover.

## Still to do

- **The privacy policy** (`frontend/data/privacy-policy.json`) still names Supabase as the data processor and hosting provider. That is legal text, so it was left unchanged: the owner must update it to the new database, storage and email providers before the production cutover.
