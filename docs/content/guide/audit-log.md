---
sidebar_label: Audit log
sidebar_position: 8
---

# Audit log

The audit log records selected changes to user-managed school and
organisation records. Each
entry identifies the person who made the change, the record, the time, and the
previous and new values for each changed field. Creates have no previous
value; deletes have no new value.

## Who can read it

- School staff need the `audit-log:read` permission. A school administrator
  can grant it to a custom role in **Roles & Permissions**.
- Organisation administrators can review the entries across all schools in
  the organisation.

The school view is at **Dashboard → Audit log**. Organisation administrators
can use **Organisation → Audit log** to see a cross-school feed. The API
enforces these access rules; hiding a navigation link is not the security
boundary.

## Recorded data and privacy

Audit entries are written in the same database transaction as the change.
If the change rolls back, its audit entry rolls back too. The application has
no endpoint to edit or delete audit entries.

Credentials, passwords, tokens, verification codes, join codes, and private
keys are redacted before storage. Authentication and session data, read
receipts, notifications, and ephemeral system activity are not audit-log
targets. Other changed values can include personal information; access should
be granted only to roles that need it. When an account is erased, its copied
actor name and email are cleared from the audit history. The event remains
until the two-year audit retention period expires.

**Read access to personal records is recorded for selected high-impact
screens.** Opening the student roster, a student record or profile, a
gradebook, attendance sessions or summary, school/course at-risk analytics,
or a report release/individual report produces an action **viewed** (`read`)
entry. These entries store the actor, school, record or scope, and limited
access metadata (such as row count or whether guardian contacts were included);
they do not copy the viewed names, grades, attendance values, or note text.
Pastoral notes have their own more detailed access auditing: opening, listing,
exporting or opening an attachment writes an entry with action **viewed**
(`read`). Pastoral entries contain ids and settings only and are never sent to
webhooks. Student self-service reads are not logged as staff access events.

## Current coverage

The current write services record changes to:

- Organisation and school settings, feature toggles, school roles and
  permissions, staff memberships and invitations, academic years and terms,
  upload limits, school logos, and student-record retention periods and
  confirmations.
- Courses, course modules and items, pages, banners, discussion topics and
  replies, grading activities and groups, rubrics, submissions, and grade
  scales.
- Student records, school-wide announcements, and file, folder, and share
  metadata.
- Mastery: the school's proficiency scale and mastery settings, outcome sets
  (a CSV import is one entry with created/updated counts), school and course
  outcomes, and outcome alignments. Student evidence, which is recalculated
  from marks automatically, is not recorded; the marks and alignments that
  produce it are.

Coverage is explicit in the backend services, not a database-wide trigger.
Read coverage is deliberately selected, not a record of every API read.
Private chat message content, authentication-provider and webhook events,
student and parent self-service reads, and other operational or ephemeral activity are
not included in these views. Existing SSO and webhook logs remain in their
specialized views. When adding a write path for user-managed data, use
`AuditLogService.record` inside the same Prisma transaction as the write and
include only the meaningful before/after fields. Do not log secrets or
high-volume operational state. For an audited read, use
`AuditLogService.recordRead`; include only the scope and minimum metadata
needed to explain the access, never the personal data returned to the caller.

School-scoped entries are retained if a school is deleted; the general log
keeps the school name snapshot, and the SSO and integration logs retain the
school UUID snapshot. Entries are purged after `AUDIT_LOG_RETENTION_DAYS`
(730 days by default) by the daily retention job. School-scoped entries can
also be sent to a school's webhook when the
webhook explicitly subscribes to **Audit log change**; organisation-wide
entries are not sent to school webhooks. This sends the redacted before/after
values and actor details outside the platform, so subscribe only trusted
receivers. Webhook delivery payloads follow the separate webhook delivery
retention policy.

## Reverting changes

Organisation administrators can use **Revert** in the organisation audit-log
view when a safe reversal is supported. A confirmation warns that the action
can change or remove a record. Reverts are checked against the current record
to avoid overwriting later changes, and the reversal is itself recorded as a
new audit entry. The API action is `POST /api/organisation/audit-log/:id/revert`
and is guarded as an organisation-admin route.

Currently, supported reversals are creation removal and field updates for
academic years and terms, subject to foreign-key and concurrency checks.
Deleted-record restoration, academic-year activation changes, and other
record types are not currently supported; entries that cannot be safely
reverted are disabled in the view. Redacted fields cannot be restored.
