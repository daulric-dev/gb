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
be granted only to roles that need it.

## Current coverage

The current write services record changes to:

- Organisation and school settings, feature toggles, school roles and
  permissions, staff memberships and invitations, academic years and terms,
  upload limits, and school logos.
- Courses, course modules and items, pages, banners, discussion topics and
  replies, grading activities and groups, rubrics, submissions, and grade
  scales.
- Student records, school-wide announcements, and file, folder, and share
  metadata.

Coverage is explicit in the backend write services, not a database-wide
trigger. Private chat message content, authentication-provider and webhook
events, attendance, and other operational or ephemeral activity are not
included in these views. Existing SSO and webhook logs remain in their
specialized views. When adding a write path for user-managed data, use
`AuditLogService.record` inside the same Prisma transaction as the write and
include only the meaningful before/after fields. Do not log secrets or
high-volume operational state.

School-scoped entries are retained if a school is deleted; the log keeps the
school name snapshot and the entry remains visible in the organisation-wide
feed. Audit entries are not currently subject to an automatic time-based
purge.
