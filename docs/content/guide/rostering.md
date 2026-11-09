---
sidebar_label: SIS & Rostering sync
sidebar_position: 13
---

# SIS & rostering sync (OneRoster, CSV)

GradeBook can import and keep in sync your **students, staff, classes and
enrolments** from a Student Information System (SIS): either by uploading
CSV files, or by connecting to the SIS's **OneRoster 1.2** API. Every sync
starts with a **dry run** that lists exactly what would change; nothing is
written until you review it and apply it, and nothing is ever deleted.

Rostering is an **organisation-level** feature, off by default, managed by
organisation admins in the organisation console.

## Turning it on

1. In **Organisation → Features**, turn on **Rostering sync (OneRoster, CSV)**.
2. **Rostering** appears in the organisation menu.

A school's own feature switch does not affect rostering: it is decided for the
whole organisation.

## Adding a source

Open **Organisation → Rostering → Add source**. Adding a source, changing a
OneRoster endpoint or secret, and deleting a source ask you to confirm it's you
with an emailed code.

### CSV upload

Choose **CSV upload**. Each sync, you upload the files and run a dry run. You
can upload:

- **A OneRoster CSV bundle**: the `.zip` your SIS exports (or its CSV files
  uploaded together). GradeBook reads `orgs.csv`, `academicSessions.csv`,
  `users.csv` (with `roles.csv` in OneRoster 1.2, or the `role` and
  `orgSourcedIds` columns of 1.1), `classes.csv` and `enrollments.csv`. Other
  files are ignored.
- **GradeBook's CSV templates**, if your SIS has no OneRoster export. Download
  them from **Organisation → Rostering → CSV templates**:

| Template | Columns (required in bold) |
| --- | --- |
| Students | **student_id**, **first_name**, **last_name**, email, student_number, school, date_of_birth (YYYY-MM-DD) |
| Staff | **staff_id**, **first_name**, **last_name**, **email**, school |
| Classes | **class_id**, **name**, code, school, academic_year, term |
| Enrolments | **class_id**, **person_id**, role (`student` (default), `teacher` or `ta`) |

The `*_id` columns are your own ids for each record: keep them stable between
uploads, because that is how GradeBook recognises a record it has seen before.
`school` is any name or code you like (you map it to a GradeBook school after
the first dry run); leave it blank to use the school you map **Default
school** to. `academic_year` and `term` are names: GradeBook uses an existing
academic year or term of that name in the school, or creates it.

Files are up to 50 MB each, 10 per upload. **Only the kinds of record you
upload are compared**: uploading only `students.csv` never proposes disabling
staff, classes or enrolments.

### OneRoster 1.2 endpoint

Choose **OneRoster 1.2 endpoint** and enter what your SIS gives you:

| Setting | What it is |
| --- | --- |
| Endpoint URL | The rostering service root, usually ending `/ims/oneroster/rostering/v1p2`. GradeBook reads `/orgs`, `/academicSessions`, `/users`, `/classes` and `/enrollments` under it, 100 records a page. |
| Token URL | The OAuth 2.0 token endpoint (client credentials grant). |
| Client ID, Client secret | The OAuth 2.0 credentials. The secret is encrypted and never shown again. |

Use **Test connection** to check the credentials and that the endpoint answers.
The endpoint must use `https` and must not be on a private network (unless
your install allows private destinations, the same setting as webhooks).
GradeBook backs off and retries when the SIS answers "too many requests" or
is briefly unavailable.

**Sync daily** runs a dry run once a day. With **Apply new and changed records
automatically**, a daily dry run's creates and updates are applied on their
own; records to disable always wait for you.

## Mapping schools

Run a first dry run, then open the source: under **Schools**, each org
(school) found in the source is listed. Map each to a GradeBook school, or
choose **Ignore this org**. Records of an org that is not mapped wait (the dry
run shows one error row per org) until you map it and run again.

## What becomes what

| Source | GradeBook |
| --- | --- |
| Org | The school you map it to (schools are never created). |
| School year session | An academic year in that school (matched by name). |
| Term / semester / grading period | A term in its school year (matched by name). |
| Class | A course, created as a **draft**, with the class's term. |
| User with role student | A student record. |
| User with role teacher, administrator, aide | A staff member: always a **teacher** membership, never an admin. |
| Enrolment as student | The student enrolled in the course. |
| Enrolment as teacher / aide | A course teacher / teaching assistant. |

Parents and guardians in the source are not imported.

### Matching existing records

A record the source sent before is always matched by its id (the mapping is
kept per source, so a re-sync updates instead of duplicating). A record seen
for the first time is matched to someone already in GradeBook:

- **Students**: by student number (OneRoster `identifier`), then by email (the
  student's account email, or a roster email). Either can be switched off
  under **Matching and emails**. A student number already used by another
  student is reported as an error, never duplicated.
- **Staff**: by account email.

### Student and staff accounts

- **Students** get a record without a login. When a student signs in with the
  email the roster gave them, their account is linked to that record. No email
  is sent to students unless you turn on **Email new students that they can
  sign in**.
- **Staff** who already have an account join the school as teachers. Staff
  without one get an invite (listed with the organisation's invites); they
  join as teachers when they first sign in. Turn off **Email staff their
  invite** to create the invites without emailing them. Their course roles
  are added by the next sync after they sign in.

## Reviewing a dry run

The review page shows a summary per kind of record, then every change:
**Create**, **Update** (with each field's old and new value), **To disable**
and **Error** (a row that could not be read or used, with the reason). Filter
by kind of record, change and status, or search by name or source id.
**Errors CSV** downloads every error row.

## Applying

**Apply changes** applies the creates and updates in the background; you can
leave the page and come back to the progress. Records missing from the source
are only touched if you tick **Also disable the records missing from the
source**. Disabling never deletes anything:

| Record | Disabled means |
| --- | --- |
| Student | Marked inactive. |
| Course | Archived. |
| Enrolment | Dropped. |
| Course teacher | Removed from the course (the last teacher of a course is kept). |
| Staff member | A pending invite is revoked; an existing membership is left for you to remove. |

If a record comes back in a later sync it is re-activated.

Each change is applied on its own: one that fails (shown on the review page
and in the errors CSV) does not stop the rest. If the server restarts during
an apply, it carries on from where it stopped. Applies are recorded in the
audit log.

Only the newest dry run of a source can be applied; **Discard** a dry run you
don't want.
