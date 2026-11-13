---
sidebar_label: Data inventory
sidebar_position: 2
---

# Personal data inventory

Every database table that holds personal data, with what it holds, whether it
can contain special-category data, how long it is kept, how it is erased and
whether data exports include it. Use it for the Article 30 record, DPIAs,
retention decisions and subject access requests.

Written against the schema of November 2026. It is maintained by hand; see
[Keeping it current](#keeping-it-current).

## How to read it

- **Special**: `Yes` = holds special-category data (Article 9) by design;
  `Possible` = free text where staff may write health or similar details;
  blank = not by design. Almost every table about students is **children's
  data**.
- **Retention**: the rule that removes it. "Record life" means it is kept
  until the record it belongs to is deleted; no timer removes it. Periods in
  backticks are environment variables (defaults shown); the privacy notice
  shows the configured values.
- **Erasure** paths:
  - **Account**: deleting a user account (`DELETE /api/auth/account` by the
    person, `DELETE /api/organisation/users/:userId` by an organisation
    admin, or a school-managed account erased with its student record).
    "Deleted" = the rows go with the account; "unlinked" = the row stays and
    the link to the account is set to null.
  - **Student**: erasing a student record (`DELETE /api/students/:id`, or the
    school's leaver / closed-year retention schedule).
  - **Item**: the item's own delete in the app.
  - Every erasure except fixed-period housekeeping is written to
    `compliance.erasure_log` (ids only) and re-applied after a backup
    restore. Erased data remains in backups until they expire
    (`BACKUP_RETENTION_DAYS`, 30).
- **Export**: the data-export collector (file name in the ZIP) and scopes:
  `S` self-service, `T` staff (subject access for a student), `P` parent.
  "Excluded" = deliberately not exported, with the reason in
  `backend/src/data-export/registry.ts` (`EXCLUDED`).

## `account`: sign-in and security

| Table | Personal data | Special | Retention | Erasure | Export |
| --- | --- | --- | --- | --- | --- |
| `app_user` | Email, verified / disabled / last sign-in times | | Account life | Account (deleted) | `profile` S T |
| `identity` | Sign-in provider, subject id, email, claims from the provider | | Account life | Account (deleted) | `sign-in-identities` S T |
| `session` | IP address, user agent, device label, sign-in method, times, revocation reason; token hashes | | Deleted about a day after expiry or sign-out (`SESSION_IDLE_DAYS` 30, `SESSION_MAX_AGE_DAYS` 90; staff `STAFF_SESSION_IDLE_HOURS` 168, `STAFF_SESSION_MAX_DAYS` 30) | Account (deleted) | `sessions` S T (no tokens) |
| `known_device` | One-way device fingerprint, first / last seen | | 90 days unused | Account (deleted) | `devices` S T |
| `email_code`, `email_code_attempt` | Email, code hash, hashed IP, attempts | | Deleted about a day after creation | Not linked to the account | Not exported (secrets) |
| `email_change` | Pending new email address, code hash | | Until confirmed or cancelled. **An expired request stays until replaced or the account is deleted** (no purge) | Account (deleted) | `account-security` S T |
| `mfa_totp`, `mfa_recovery_code`, `mfa_enrolment_gate` | Encrypted authenticator secret, recovery-code hashes, lockout state | | Until turned off, reset, or the account is deleted; gates go with their session | Account (deleted) | `account-security` S T (status only) |

## `public`: people, schools, logs and integrations

| Table | Personal data | Special | Retention | Erasure | Export |
| --- | --- | --- | --- | --- | --- |
| `user_profile` | Name, email, account type, role, avatar, active school | | Account life | Account (deleted) | `profile` S T |
| `school_management`, `school_management_role`, `organisation_admin` | Staff memberships and roles | | Until removed from the school | Account (deleted); leaving or removal (erasure-logged) | `memberships` S T |
| `school_join_request` | Who asked to join, message, reviewer | | **No purge** | Account (deleted) | `memberships` S T |
| `organisation_invite` | Invitee email, who invited / accepted | | **No purge** | Inviter / accepter unlinked on account deletion | Excluded (the resulting role is exported) |
| `organisation`, `school` | Owner (a person); school contact details | | Organisation / school life | Owner must transfer before account deletion | `memberships` S T |
| `announcement`, `announcement_read` | Author, body; who read what, when | | Record life | Item; author unlinked, reads deleted on account deletion | `discussions` S T |
| `notification_preference`, `notification_preference_opt_out` | Notification choices | | Account life | Account (deleted) | `notifications` S T |
| `push_device` | Push token, platform, session | | Deleted with the session that registered it (sign-out, expiry) or the account | Account (deleted) | `devices` S T (no token) |
| `audit_log` | Actor id, name and email; entity, action, redacted before/after values (can name students) | Possible | `AUDIT_LOG_RETENTION_DAYS` (730) | Not erased with a record (organisation's decision); account deletion clears the copied actor name and email | `audit-log` S T (S leaves out pastoral entries and staff emails) |
| `sso_audit_log`, `integration_audit_log` | Administrator id; configuration changes | | `AUDIT_LOG_RETENTION_DAYS` (730) | Not erased | Excluded (actor only) |
| `ai_request` | User, school, course, feature, provider, status, tokens; prompt and answer only if the organisation keeps them | Possible (prompt text) | One year; kept prompts 30 days | Account (unlinked: the row stays without the user id until it ages out) | `ai-requests` S T |
| `ai_org_setting`, `ai_school_setting`, `ai_provider`, `analytics_setting`, `attendance_alert_setting`, `privacy_setting`, `translation_setting`, `timetable_setting`, `school_retention_setting`, `school_sso_provider`, `school_email_domain` | Who last changed the setting; privacy contact details | | Setting life | Changer unlinked | Excluded (school configuration) |
| `analytics_at_risk` | Student, course, grade, missing count, attendance rate, mastery, reasons | | Recomputed hourly; a student who no longer meets the criteria drops off | Student (deleted) | `staff-records` T |
| `analytics_course_summary` | Counts only | | | | Not personal |
| `webhook_delivery` | Event payloads (names, emails, ids) | | `WEBHOOK_DELIVERY_RETENTION_DAYS` (30) | Deleted with the webhook or school | Not exported (operational) |
| `school_webhook`, `school_webhook_header`, `school_webhook_event` | Creator; encrypted secrets | | Webhook life | Creator unlinked | Excluded |
| `lti_subject`, `lti_launch` | Pseudonymous id per tool; launches | | Subjects: account life. Launch tickets: an hour after expiry | Account (deleted) | `integrations` S T |
| `lti_score` | Grades a tool sent back, by pseudonymous id | | Record life | With the subject | Via `coursework` (the resulting mark) |
| `lti_tool`, `lti_resource_link`, `lti_deployment`, `lti_line_item`, `lti_access_token`, `lti_replay`, `lti_platform_key` | Creator; tokens | | Tool life; tokens an hour after expiry | Creator unlinked | Excluded |
| `roster_link` | Match between a GradeBook person and an information-system record; email and source record | | Record life; email and source record cleared `ROSTER_HISTORY_RETENTION_DAYS` (90) after the link is disabled | Student or account (deleted) | `integrations` S T |
| `roster_change` | Per-run change sets: names, emails, diffs | | `ROSTER_HISTORY_RETENTION_DAYS` (90) after the run finished | With the run | Excluded (kept with the run for the administrator) |
| `roster_run`, `roster_source` | Who ran / applied it; encrypted credentials | | Source life | Unlinked | Excluded |
| `room`, `bell_period`, `school_closure`, `academic_year`, `term` | Creator only, or none | | | | Not personal |

## `student`: student records, families and pastoral care

| Table | Personal data | Special | Retention | Erasure | Export |
| --- | --- | --- | --- | --- | --- |
| `student` | Name, student number, date of birth, gender, enrolment and leaving dates, form tutor, linked account | | Until the school erases it (manually or by its leaver / closed-year schedule, off until configured) | Student (deleted) | `profile` S T P |
| `student_restriction` | No-AI, no-similarity, exclude-from-analytics flags, who set them | | Student life | Student (deleted) | `profile` S T P |
| `parent_student_link` | Parent account, child, relationship | | Until unlinked | Student or account (deleted) | `memberships` S T P |
| `parent_invite` | Invitee email, relationship, token hash, who created / used it | | **No purge** | Student (deleted) | `staff-records` T |
| `parent_notification_pref`, `parent_notification_kind` | Parent's notice settings | | Account life | Account (deleted) | `notifications` S |
| `parent_notification_sent` | Which notices were sent to which parent | | `NOTIFICATION_RETENTION_DAYS` (180) | Account (deleted) | `notifications` S |
| `pastoral_note` | Category, severity, date, **note text (encrypted)**, follow-up, assignee, author, withholding decision and reason | **Yes** (health, safeguarding) | School's pastoral retention for resolved notes; open notes and schools without a setting: student life | Item (erasure-logged); retention purge; Student (deleted) | `pastoral-notes` T only, minus withheld notes and notes the exporter cannot see |
| `pastoral_note_file` | Attachment links (files stay in the author's Files) | Possible | Note life | With the note | `pastoral-notes` T (copied into `files/pastoral/`) |
| `pastoral_category`, `pastoral_setting` | None | | | | Not personal |
| `attendance_alert` | Student, absence rate or streak, who acknowledged | | Student life | Student (deleted) | `staff-records` T |
| `school_join_code` | Code hash, creator | | Until revoked or expired | Creator unlinked | Excluded |

## `course`: courses, attendance, discussions

| Table | Personal data | Special | Retention | Erasure | Export |
| --- | --- | --- | --- | --- | --- |
| `course_student`, `course_staff` | Enrolments and staff roles | | Course life | Student or account (deleted); course deletion | `memberships` S T P |
| `attendance_record` | Status, method, check-in time, note; **distance, accuracy, location flags**; raw coordinates until cleared | Possible (note) | Status: student life. Coordinates: cleared when the session closes, any left `ATTENDANCE_LOCATION_RETENTION_HOURS` (24) after | Student (deleted); course deletion | `attendance` S T P (no coordinates) |
| `attendance_session` | Who opened it; the teacher's location (session point) | | Session life; point cleared `ATTENDANCE_LOCATION_RETENTION_HOURS` (24) after closing | Item (erasure-logged); opener unlinked | Excluded (staff action) |
| `discussion_topic`, `discussion_reply`, `discussion_read` | Author, text, read times | | Record life; a deleted reply purged after `SOFT_DELETE_RETENTION_DAYS` (30) | Item (erasure-logged); author unlinked on account deletion; reads deleted | `discussions` S T |
| `course_notification` | In-app notices to a person (title, body) | | `NOTIFICATION_RETENTION_DAYS` (180) | Account (deleted) | `notifications` S T |
| `course`, `page`, `module`, `module_item`, `assignment_group`, `library_*`, `timetable_*`, `discussion_setting` | Creator only | | Course life | Creator unlinked; course deletion (erasure-logged) | Excluded (school content) |

## `grading`: work, marks and reports

| Table | Personal data | Special | Retention | Erasure | Export |
| --- | --- | --- | --- | --- | --- |
| `submission` | Work text, file, score, feedback, timings, lateness, Lockdown away count and last time, excused reason | Possible (excused reason, feedback) | Student life | Student (deleted) | `coursework` S T P (P per parent settings) |
| `submission_file`, `quiz_answer`, `quiz_attempt_question`, `rubric_assessment` | Answers, files, marks, comments | Possible | With the submission | Student (deleted) | `coursework` S T P |
| `activity_extension` | Student, new due date, reason | Possible | Student life | Student (deleted) | `coursework` S T |
| `activity_accommodation`, `student_accommodation` | Extra time, Lockdown exemption, **reason (encrypted)** | **Yes** (health or disability) | Student life | Student (deleted) | `coursework` S T (in T, the reason only with *sensitive details*) |
| `peer_review_allocation` | Reviewer, comment, marks, hidden reason | | With the submission | Student (deleted) | `coursework` S T |
| `outcome_evidence` | Mastery evidence per student | | Student life | Student (deleted) | `mastery` S T P |
| `report_document` | Report card PDF per student and term | | Student life | Student (deleted; PDFs removed from storage) | `reports` S T P (P per parent settings) |
| `report_comment`, `report_head_comment` | Teacher and head comments, drafts | | Student life | Student (deleted) | `staff-records` T |
| `similarity_fingerprint`, `similarity_fingerprint_hash`, `similarity_match` | Fingerprints of submitted text; matches between students | | With the submission; removed when *No similarity checks* is set | Student (deleted) | `staff-records` T |
| `activity`, `rubric*`, `quiz_question`, `quiz_option`, `question_bank`, `grade_scale*`, `outcome*`, `mastery_setting`, `similarity_setting`, `peer_review_setting`, `report_release` | Creator only | | Course or school life | Creator unlinked | Excluded (school content) |

## `chat` and `file_manager`

| Table | Personal data | Special | Retention | Erasure | Export |
| --- | --- | --- | --- | --- | --- |
| `chat.message` | Sender, **body (encrypted with `CHAT_ENCRYPTION_KEY`)**, metadata | Possible | Record life; a deleted message is blanked at once and purged after `SOFT_DELETE_RETENTION_DAYS` (30) | Item (erasure-logged); Account (deleted) | `chat` S T (the person's own messages, decrypted) |
| `chat.conversation`, `chat.conversation_member` | Membership, role, last read; creator | | Conversation life | Account (membership deleted, creator unlinked) | `chat` S T |
| `file_manager.file`, `file_manager.folder` | Owner, name, type, size; the object in storage | Possible (content) | Until deleted; then purged after `SOFT_DELETE_RETENTION_DAYS` (30) unless attached to a submission | Item (erasure-logged); Account (deleted, with storage objects) | `files` S T (copied into the ZIP within size limits) |
| `file_manager.file_share` | Who shared with whom | | Share life | Account (deleted) | `files` S T |
| `file_manager.notification` | File-share notices | | `NOTIFICATION_RETENTION_DAYS` (180) | Account (deleted) | `notifications` S T |

## `compliance`

| Table | Personal data | Special | Retention | Erasure | Export |
| --- | --- | --- | --- | --- | --- |
| `data_export` | Who asked for an export about whom; status; the ZIP in storage | | ZIP: `DATA_EXPORT_TTL_HOURS` (24); expired rows 30 days later, failed rows after 7 days | The requester can delete it early; rows go with the requester's account or the student record, and the sweep removes the orphaned ZIP | Excluded (the request itself; audited) |
| `erasure_log` | Ids of erased records and who asked; also copied to storage | | `ERASURE_LOG_RETENTION_DAYS` (400) | Pruned by age only | Not exported |

## Outside the database

| Where | What | Retention |
| --- | --- | --- |
| Object storage (`S3_BUCKET`) | Uploads, submissions, avatars, logos, report PDFs, exports, erasure-log copies | As the rows above; staged uploads an hour; enable bucket encryption |
| Backups (`BACKUP_S3_BUCKET`, WAL-G) | Encrypted copies of the whole database | `BACKUP_RETENTION_DAYS` (30) plus the bucket's old-version expiry; `WALG_RETAIN_FULL` (7) base backups |
| Cache (Redis or in-process) | Session lookups, sign-in challenges (5 minutes), quiz presence (seconds), translated text | `TRANSLATION_CACHE_TTL_HOURS` (24) for translations; others minutes |
| Browser and app storage | See [Cookies and device storage](./cookies.md) | |
| Logs | Caddy access logs (IP addresses, paths), API logs | Your log rotation settings |
| Providers | Copies held by email, push, AI, translation, webhook and tool providers | Each provider's terms; see [Sub-processors](./sub-processors.md) |

## Known gaps

- `email_change` (expired requests), `organisation_invite`,
  `school_join_request` and `parent_invite` have no automatic purge. Decide a
  period and clean them up, or accept and record it.
- Audit-log entries about a student are not erased with the student record;
  they age out with `AUDIT_LOG_RETENTION_DAYS`.
- Student records are kept until the school erases them or configures its
  retention schedule.

## Keeping it current

There is no generator; update this page by hand when the schema changes:

1. In `backend/`, run `bun test src/data-export/registry.test.ts`. It fails
   when a column that points at a person is neither exported by a collector
   (`covers` in `src/data-export/collectors/*.ts`) nor listed in `EXCLUDED`
   (`src/data-export/registry.ts`), so new person columns surface there
   first.
2. Diff `backend/prisma/schema/*.prisma` since the date at the top and add or
   change a row for each new or changed table.
3. Take **Export** from the collectors' `covers` and `scopes` and from
   `EXCLUDED`.
4. Take **Retention** from the daily job (`src/retention/retention.service.ts`,
   the `PurgeReport` fields), `src/retention/retention.config.ts`, and module
   sweeps (AI requests, LTI launches, data exports).
5. Take **Erasure** from `src/erasure/account-erasure.ts`,
   `src/erasure/student-erasure.service.ts`, the replay registry in
   `src/erasure/erasure-plan.ts`, and the foreign keys' `ON DELETE` rules in
   the migrations.
6. Update the date at the top.
