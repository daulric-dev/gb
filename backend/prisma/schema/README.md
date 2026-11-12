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
| `student.prisma` | `student` | Student roster, school join codes, parent links, parent invitations and parent notice preferences / sent log (see `src/parent-portal`) |
| `files.prisma` | `file_manager` | Files, folders, shares, notifications |
| `chat.prisma` | `chat` | Conversations, members, messages |
| `compliance.prisma` | `compliance` | The GDPR erasure log (`erasure_log`): ids-only record of every erasure, replayed after a backup restore (see `src/erasure`) |
| `organisation.prisma` | `public` | The organisation that self-hosts the install (`organisation`, one row; the singleton index is in the migration, Prisma cannot express it; `features` holds its platform feature overrides) its admins (`organisation_admin`) and invites for people without an account yet (`organisation_invite`; its partial unique indexes are in the migration). `school.disabled_features` (in `school.prisma`) holds a school's opt-outs; see `src/features`. |
| `integration.prisma` | `public` | School webhooks (`school_webhook`: name, URL - any http(s), events as explicit type keys, signing secret encrypted and bound to the school and webhook, on/off, consecutive failures and why it was switched off), their deliveries (`webhook_delivery`: event id and type, the JSON payload, `pending`/`succeeded`/`failed`/`abandoned`, attempts, next attempt, last status/error, a 1 KB response excerpt; purged after `WEBHOOK_DELIVERY_RETENTION_DAYS`) and the integrations audit log (`integration_audit_log`, never a secret). See `src/integrations`. |
| `audit.prisma` | `public` | The school- and organisation-scoped, field-level audit log (`audit_log`): actor and school-name snapshots, entity and record id, action, previous/new values, and timestamp. See `src/audit-log` and [the audit log guide](../../../docs/content/guide/audit-log.md). |
| `sso.prisma` | `public` | Each school's own sign-in apps (`school_sso_provider`, keyed by school and provider `google`/`azure`: on/off, client ID, client secret encrypted and bound to the school and provider, non-secret `settings`); no row = the env fallback. The SSO audit log (`sso_audit_log`): one row per change to a school's SSO settings, never a secret. See `src/sso`. |
| `report.prisma` | `grading` | Report cards: `report_release` (per school and term: comment deadline, published at/by), `report_comment` (teacher comment per term, course and student, `draft`/`ready`), `report_head_comment` (head / form tutor comment per term and student) and `report_document` (each student's generated term PDF: status, storage key, attempts, error). See `src/report-card`. |
| `mastery.prisma` | `grading` | Mastery / standards-based grading: `mastery_setting` (one per school: proficiency scale, calculation, score bands, report-card section), `outcome_set`, `outcome` (in a set or a course, nested), `outcome_alignment` (outcome to an activity, rubric criterion or quiz question) and `outcome_evidence` (one per alignment and submission). See `src/mastery`. |
| `peer-review.prisma` | `grading` | Peer review: `peer_review_setting` (one per assignment: on/off, reviews per student, anonymous, `after_due`/`manual` opening, close date, optional rubric, review-quality points and the offline column holding them, seed, `started_at`, `ready_notified_at`) and `peer_review_allocation` (reviewer, reviewed submission, comment, rubric marks as jsonb, handed in at, hidden by staff; a trigger refuses a reviewer reviewing their own submission). See `src/peer-review`. |
| `similarity.prisma` | `grading` | Similarity check: `similarity_fingerprint` with indexed `similarity_fingerprint_hash` child rows, `similarity_match` (directed containment score between two fingerprints), `similarity_setting` (per school: pool, recent terms, threshold) and `similarity_school_lock` (serializes fingerprint jobs per school). See `src/similarity`. |
| `library.prisma` | `course` | The course template library: `library_item` (title, subject, grade level, tags, visibility school/organisation, unpublished), `library_item_version` (immutable design snapshot + counts; files copied under `course-library/`), `library_import` (background import with progress). See `src/course/library`. |
| `pastoral.prisma` | `student` | Behaviour and pastoral notes: `pastoral_category` (per school, safeguarding flag), `pastoral_note` (student, category, severity, dates, body, follow-up, assignee, status; `is_safeguarding` copied from the category), `pastoral_note_file`, `pastoral_setting` (retention). See `src/pastoral`. |
| `analytics.prisma` | `public` | Analytics dashboard: `analytics_setting` (one per school: at-risk rules), and the cached aggregates the school views read: `analytics_course_summary` (one per course: counts for exact roll-ups), `analytics_at_risk` (one per course and student at risk, with reasons) and `analytics_refresh` (last refresh per school). Cascade with school, course and student. See `src/analytics`. |
| `ai.prisma` | `public` | AI assistance: `ai_provider` (the organisation's providers: kind, base URL, model, API key encrypted, monthly cap, one default, `allow_private_network` (local model server: private addresses and http for this provider only), `available_to_schools`), `ai_org_setting` (one row: keep prompts, per-user hourly limit), `ai_school_setting` (per school: allow sending student work, `provider_id` choice → `ai_provider` SET NULL, null = organisation default), `ai_request` (the request log: who, feature, provider, model, tokens, status; prompts only while kept, 30 days). See `src/ai`. |
| `translation.prisma` | `public` | Machine translation: `translation_setting` (one row: engine `google`/`deepl`/`libre`/`yandex`, LibreTranslate `url`, API key encrypted (`key_enc`, never returned), `allow_private_network`, `enabled`). See `src/translation`. |
| `rostering.prisma` | `public` | Rostering sync: `roster_source` (CSV or OneRoster 1.2 endpoint; client secret encrypted, bound to the source), `roster_link` (sourcedId -> GradeBook id per source and entity), `roster_run` (dry run / apply status, summary, progress) and `roster_change` (the change set: diff, data, errors, apply status). Also `student.student_number`. See `src/rostering`. |
| `job-lease.prisma` | `public` | Expiring `job_lease` rows for cross-instance background job coordination and serialized work. See `src/common/job-lease.ts`. |

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
