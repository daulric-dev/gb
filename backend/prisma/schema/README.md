# Prisma schema

One file per database schema. Prisma reads every `.prisma` file in this folder
as a single schema (`prisma.config.ts` points here).

| File | Database schema | Contents |
| --- | --- | --- |
| `main.prisma` | - | Generator and datasource only |
| `school.prisma` | `public` | Schools, user profiles, membership, roles and permissions, academic years and terms, announcements, email domains, push devices |
| `account.prisma` | `account` | Our own auth: users, sessions, email sign-in codes, linked SSO identities |
| `course.prisma` | `course` | Courses, staff and students, modules, pages, assignment groups, attendance, course notifications |
| `grading.prisma` | `grading` | Activities, quizzes, submissions, grade scales; legacy assessments, grades and grading groups |
| `student.prisma` | `student` | Student roster, school join codes; legacy class enrolment, subject profiles and class attendance |
| `files.prisma` | `file_manager` | Files, folders, shares, notifications |
| `chat.prisma` | `chat` | Conversations, members, messages |
| `billing.prisma` | `billing` | Hosted-platform billing: subscriptions, invoices, webhook events, provider switches, platform admins (unused unless `BILLING_ENABLED=true`) |

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
