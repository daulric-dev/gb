# Prisma schema

One file per database schema. Prisma reads every `.prisma` file in this folder
as a single schema (`prisma.config.ts` points here).

| File | Database schema | Contents |
| --- | --- | --- |
| `main.prisma` | - | Generator and datasource only |
| `school.prisma` | `public` | Schools, user profiles, membership, roles and permissions, academic years and terms, announcements, email domains, push devices |
| `account.prisma` | `account` | Our own auth: users, sessions (with the step-up window `elevated_until`), known devices (new sign-in alerts), email codes (`purpose` `sign_in` / `step_up`), linked SSO identities |
| `course.prisma` | `course` | Courses, staff and students, modules and items, pages, assignment groups, attendance, course notifications |
| `discussion.prisma` | `course` | Discussion topics, replies, read markers, per-course discussion settings |
| `grading.prisma` | `grading` | Activities, quizzes, submissions, rubrics and rubric assessments, grade scales |
| `student.prisma` | `student` | Student roster, school join codes |
| `files.prisma` | `file_manager` | Files, folders, shares, notifications |
| `chat.prisma` | `chat` | Conversations, members, messages |
| `compliance.prisma` | `compliance` | The GDPR erasure log (`erasure_log`): ids-only record of every erasure, replayed after a backup restore (see `src/erasure`) |
| `organisation.prisma` | `public` | The organisation that self-hosts the install (`organisation`, one row; the singleton index is in the migration, Prisma cannot express it; `features` holds its platform feature overrides) its admins (`organisation_admin`) and invites for people without an account yet (`organisation_invite`; its partial unique indexes are in the migration). `school.disabled_features` (in `school.prisma`) holds a school's opt-outs; see `src/features`. |
| `integration.prisma` | `public` | School webhooks (`school_webhook`: name, URL - any http(s), events as explicit type keys, signing secret encrypted and bound to the school and webhook, on/off, consecutive failures and why it was switched off), their deliveries (`webhook_delivery`: event id and type, the JSON payload, `pending`/`succeeded`/`failed`/`abandoned`, attempts, next attempt, last status/error, a 1 KB response excerpt; purged after `WEBHOOK_DELIVERY_RETENTION_DAYS`) and the integrations audit log (`integration_audit_log`, never a secret). See `src/integrations`. |
| `sso.prisma` | `public` | Each school's own sign-in apps (`school_sso_provider`, keyed by school and provider `google`/`azure`: on/off, client ID, client secret encrypted and bound to the school and provider, non-secret `settings`); no row = the env fallback. The SSO audit log (`sso_audit_log`): one row per change to a school's SSO settings, never a secret. See `src/sso`. |

## Changing the schema

Prisma Migrate owns the schema. Migrations live in `prisma/migrations`;
`0_baseline` is the whole schema as it stood when the app left its hosted
database (row-level security removed). The 58 older SQL migrations it
replaces are in git history: `git show 13b14d1:supabase/migrations`.

1. Edit the `.prisma` files.
2. `bun run db:migrate --name <change>` - writes
   `prisma/migrations/<timestamp>_<change>/migration.sql`, applies it to the
   development database and regenerates the client. Commit the folder.
3. Production and fresh checkouts apply pending migrations with
   `bun run db:deploy` (`prisma migrate deploy`).

SQL functions, triggers, extensions and anything else Prisma can't express:
`bunx prisma migrate dev --create-only --name <change>`, edit the generated
`migration.sql`, then `bun run db:migrate` to apply it.

`bun run db:pull` re-introspects a database into these files (new models land
in `main.prisma`; move them to the right file) - useful after a hand-written
SQL migration adds tables. Re-introspection keeps models in the file they are in and keeps renamed
fields (e.g. `student.legacy_attendance_record`), but drops plain `//`
comments - keep notes here, not in the `.prisma` files.

The generated client is written to `src/generated/prisma` (gitignored);
import it as `@/generated/prisma/client`.
