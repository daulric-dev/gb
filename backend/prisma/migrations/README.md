# Migrations (`backend/prisma/migrations`)

The SQL that builds the database, applied in folder order by `prisma migrate deploy` (`bun run db:deploy`; `bun run db:setup` from the repo root). Each folder holds one `migration.sql`. Applied migrations are recorded in the `_prisma_migrations` table, so each runs once per database.

`migration_lock.toml` pins the provider to `postgresql`; Prisma manages it, do not edit it.

How to write a new migration, and the rules (never edit an applied migration, never reset a shared database), are in [../README.md](../README.md#migrations-workflow).

## Migrations

| Folder | What it does |
| --- | --- |
| `0_baseline` | The whole GradeBook schema at the point the app moved to its own Postgres, generated with `pg_dump` (row-level security removed). Creates the `extensions` schema with `pg_trgm`, the schemas `account`, `chat`, `course`, `file_manager`, `grading`, `public` and `student`, their 44 tables, enums, constraints and indexes, and the SQL functions the API calls: `public.redeem_school_join_code`, `public.student_duplicate_candidates`, `public.merge_student_records` (all three used by `src/student-account`), `public.join_school_by_email_domain`, `public.seed_school_system_roles`, `grading.submit_quiz` and `chat.unread_counts`. The 58 older migrations it replaces are in git history (see [../schema/README.md](../schema/README.md#changing-the-schema)). |
| `20261023120000_notifications_calendar` | Adds `course.course_notification`: one in-app notice per recipient about new work (`activity_published`) or a course `announcement`, unique per user and activity / announcement, with indexes for a user's list and unread count. The calendar itself needs no tables. |
| `20261023130000_grading_extras` | Adds `drop_lowest` / `drop_highest` to `course.assignment_group`; adds rubrics - `grading.rubric` (per course), `grading.rubric_criterion`, `grading.rubric_rating` and `grading.rubric_assessment` (the level chosen per submission and criterion, with its points); and `grading.activity.rubric_id` (set to null when the rubric is deleted). |
| `20261023140000_discussions` | Adds course discussions: `course.discussion_topic` (pinned, locked, published, require-initial-post), `course.discussion_reply` (threaded through `parent_id`, soft-deleted when it has replies), `course.discussion_read` (per-user read marker) and `course.discussion_setting` (per-course options such as `students_can_create_topics`). |
| `20261023150000_course_templates` | Adds `course.course.is_template` and a partial index on templates per school. |
| `20261023160000_module_discussions_notifications` | Adds the `discussion` value to `course.module_item_type`, `course.module_item.discussion_topic_id` (and updates the item-type check constraint, comparing as text because the new enum value cannot be used in the same transaction), and `course.course_notification.discussion_topic_id` with the new kinds `discussion_topic` and `discussion_reply` (one topic-published notice per user). |
| `20261024100000_billing` | Creates the `billing` schema for the hosted platform: `subscription` (one per school), `invoice` (one live invoice of ours per school and period), `payment_event` (processed webhooks, unique per provider event for idempotency), `provider_setting` (per-provider on/off switch) and `platform_admin`. Only used when `BILLING_ENABLED=true`. |
| `20261025100000_drop_unenforced_permissions` | Deletes the permission keys nothing enforces from `public.permission_catalog`: `course:read`, `course:delete`, `student:delete` and `academic-year:delete` (reading and deleting a course are decided by the course role; students and academic years have no delete route). Role grants for them go too, because `school_role_permission` cascades on the catalog row. |

The models for these tables are in [`../schema/`](../schema/README.md).
