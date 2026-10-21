# Prisma schema

One file per database schema. Prisma reads every `.prisma` file in this folder
as a single schema (`prisma.config.ts` points here).

| File | Database schema | Contents |
| --- | --- | --- |
| `main.prisma` | - | Generator and datasource only |
| `school.prisma` | `public` | Schools, user profiles, membership, roles and permissions, academic years and terms, announcements, email domains, push devices |
| `account.prisma` | `account` | Our own auth: users, sessions, email sign-in codes, linked SSO identities |
| `course.prisma` | `course` | Courses, staff and students, modules, pages, assignment groups, attendance |
| `grading.prisma` | `grading` | Activities, quizzes, submissions, grade scales; legacy assessments, grades and grading groups |
| `student.prisma` | `student` | Student roster, school join codes; legacy class enrolment, subject profiles and class attendance |
| `files.prisma` | `file_manager` | Files, folders, shares, notifications |
| `chat.prisma` | `chat` | Conversations, members, messages |
| `staff.prisma` | `staff` | Legacy class/subject teacher assignments (unused since courses) |
| `reporting.prisma` | `reporting` | Legacy report cards (unused since courses) |
| `auth.prisma` | `auth` | The current auth provider's tables, present only because `user_profile` references `auth.users`. Replaced by our own auth in phase 3 |

## Changing the schema

Until phase 4 of `docs/content/platform-migration.md`, SQL migrations in
`supabase/migrations` are the source of truth:

1. Write the migration in `supabase/migrations` and apply it.
2. `bun run db:pull` - re-introspects into these files (new models land in
   `main.prisma`; move them to the right file) and regenerates the client.

Re-introspection keeps models in the file they are in and keeps renamed
fields (e.g. `student.legacy_attendance_record`), but drops plain `//`
comments - keep notes here, not in the `.prisma` files.

The generated client is written to `src/generated/prisma` (gitignored);
import it as `@/generated/prisma/client`.
