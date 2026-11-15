---
sidebar_label: Answering data requests
sidebar_position: 18
---

# Answering data requests

Students, parents and staff have rights over their personal data under the
GDPR: to get a copy (access), to have it corrected (rectification), erased,
restricted, or to object to some uses. This page shows how a school answers
each kind of request in GradeBook.

## Before you start

- **Deadline.** Answer without undue delay and **within one month** of
  receiving the request. For complex or numerous requests you can extend by
  up to two more months, but you must tell the person within the first month
  and say why.
- **Who answers.** The school is responsible for its own records (grades,
  attendance, notes). Requests about the GradeBook installation as a whole go
  to the organisation's privacy contact, shown in the privacy notice
  (`/privacy`). Agree who handles what before you need it.
- **Check identity.** Make sure the request comes from the person, or from
  someone entitled to act for them (for a younger child, usually a parent).
  An older child can make their own request.
- **Record it.** Log each request, the date received, what you did, the date
  you replied and any decision to withhold or refuse, in your rights-request
  register (see [GDPR preparation](../gdpr/index.md)).
- **Remember data outside GradeBook.** Emails, paper files and other systems
  are part of the answer too.

## Access: giving someone a copy of their data

### What people can download themselves

| Who | Where | What it contains |
| --- | --- | --- |
| Staff | **Settings → Download your data** | Their own account in every school. |
| Students | Student portal **Settings → Download your data** | Their own account and student records, except records staff keep about them (pastoral notes, at-risk flags, attendance alerts, similarity matches, draft report comments). |
| Parents | Parent portal **Settings** | Their own account; and, for each child, only what the school shows parents in the parent portal. No messages, files, sign-in history or staff records. |

A self-service download is often enough for a simple request. For a formal
subject access request about a student, the school should make the copy.

### Making a copy for a student (staff)

You need the student export permission (*Export everything held about a
student*). Administrators have it.

1. Open **Students** → the student.
2. In **Download your data** on the student's page, request a download and
   confirm it's you with the emailed code.
3. GradeBook prepares it in the background and emails you when it is ready.
   Only you can download it.
4. Download the ZIP, check it (below) and send it to the person securely.

The download contains everything this school holds about the student in
GradeBook:

- the student record (name, number, date of birth, gender, enrolment, form
  tutor, parent links; guardian contact details and accommodation reasons
  only if you have the *sensitive details* permission);
- courses, coursework, quiz answers, marks, feedback, grades, mastery,
  attendance and report cards (with the PDFs);
- if the student has a GradeBook account: their sign-in identities, sign-in
  sessions (dates, IP addresses, browser or app), devices, two-step
  verification status, the **files** they own or were shared, the **chat
  messages they sent** in this school (decrypted) and the conversations they
  are in, discussion posts, notifications and settings, AI requests, external
  tools and rostering records, and audit-log entries about them or made by
  them;
- **records staff keep**: pastoral notes (see below), at-risk flags,
  attendance alerts, similarity matches and report comments, including
  drafts.

It does **not** contain messages other people sent to the student (they are
the sender's personal data), files other people shared (listed by name only),
sign-in secrets, or copies in backups. If the request reasonably covers
messages from others, review those conversations yourself and disclose what
is appropriate, removing other people's information where needed.

**Pastoral notes.** The download includes the notes **you** can see: your
own, every non-safeguarding note with *View pastoral notes*, and safeguarding
notes only if you also hold *Safeguarding*. The download shows whether it
covered every note. The person answering a subject access request should
hold both permissions; *Safeguarding* is never given automatically, not even
to administrators.

**Withholding notes.** Where the law allows information to be held back (for
example where disclosure could put the child or someone else at risk of
serious harm, or would reveal a third party), mark the note **Withhold from
data requests** before making the download, with the exemption you rely on.
Withheld notes are left out and the download shows how many were withheld.
Each decision and its reason is in the audit log. Record the decision in your
register too. See [Pastoral notes](pastoral-notes.md#data-requests-and-withholding-a-note).

**Check before sending.** Read `README.txt` in the ZIP: it lists every file
and what is not included. Files larger than the server's limits are listed in
`files-not-included.json`; fetch those yourself if they are needed. The
audit-log extract stops at 10,000 entries. Add the information Article 15
also requires (purposes, recipients, retention, rights, source); the privacy
notice covers it, so send a link to it with the copy.

**Expiry.** A finished download can be fetched for 24 hours by default (the
server can set 1 hour to 7 days), then GradeBook deletes it. You can delete it
earlier, and ask for a new one at any time. Every request, download and
deletion is recorded in the audit log.

**Portability.** The download is machine-readable (JSON plus the original
files), so it also answers a data portability request.

## Rectification: correcting data

| What is wrong | Who fixes it, where |
| --- | --- |
| Student details (name, number, date of birth, gender, form tutor) | Staff who can edit students: **Students** → the student → edit. |
| Marks, feedback, grades | The teacher, in the course gradebook. |
| Attendance | The teacher, in the course's attendance; changes are recorded. |
| Their own name or photo | The person, in their settings. |
| Their own email address | The person, in account settings: they confirm it's them, enter the new address and confirm it with a code sent there. |
| Records from the school's information system | Correct them in that system; rostering copies the correction in. |

Most changes to school records are in the audit log. Tell the person what
you changed, or why you did not.

## Erasure: deleting data

First decide whether the school must keep the data (for example attendance
or assessment records it is legally required to keep). Erasure is not
automatic; record the decision either way.

- **A student record.** Staff with *Erase a student record*: **Students** →
  the student → **Danger zone** → **Erase student record**, and confirm it's
  you. Before you confirm, GradeBook shows what happens to the student's
  sign-in account: a school-managed single sign-on account used only in this
  school is deleted with the record; the person's own account is kept and
  removed from the school. Erasing deletes the record with its enrolments,
  work, marks, attendance, alerts, accommodations, report comments and PDFs,
  pastoral notes, parent links and analytics rows. It does not delete audit
  entries about the student, files staff attached to pastoral notes (they stay
  in that person's Files), or discussion posts when the account is kept.
- **Leavers and closed years.** **Dashboard → Settings → Student-record
  retention** erases records automatically after the periods you set, once
  you have confirmed the schedule.
- **An account.** People delete their own account in their account settings
  (web for staff, and the mobile app). An organisation administrator can
  delete an account from the organisation console; it is refused while the
  person owns the organisation or a school or is its last administrator.
  Student records stay with the school.
- **Single items.** Deleted files, folders, chat messages and discussion
  posts are erased for good after 30 days by default.

Erased data stays in database backups until they expire (30 days by
default). Every erasure is logged by id, so it is applied again if a backup
is ever restored.

## Restriction and objection

When a student or parent objects to, or asks to restrict, a kind of
processing, staff who can edit students open **Students** → the student →
**Processing restrictions**:

| Switch | Effect |
| --- | --- |
| **No AI processing** | The student's work is never sent to the AI provider; AI features refuse it. |
| **No similarity checks** | The student's submissions are not fingerprinted or compared, and existing fingerprints are removed. |
| **Exclude from at-risk lists** | The student is left out of the course and school at-risk lists. They still count in course totals and averages. |

Changes are recorded in the audit log. Other ways to restrict or stop
processing:

- **Notifications.** Each person can switch kinds of email and push
  notification off in their settings; parents set notices about each child in
  the parent portal.
- **Push notification content.** In school settings (and for all schools in
  **Organisation → Settings**), choose whether push notifications show their
  full text or only "You have a new update". By default, notifications about a
  child are generic and course news is full.
- **Whole features.** A school can switch off features it does not need (for
  example AI assistance or analytics) for everyone, and teachers decide
  whether to use the location check on attendance.
- **Anything else.** If GradeBook has no switch for it, stop the processing in
  how the school works (for example, do not record a kind of note), and
  record what you agreed.

While you decide whether a restriction or objection is justified, consider
setting the relevant switch straight away.

## Checklist

1. Log the request and the date received; check identity.
2. Decide who answers (school or organisation) and the deadline (one month).
3. Access: make the download, withhold only where the law allows, check the
   README, add the privacy notice, send securely before the download expires.
4. Correct, erase or restrict as asked, or record why not.
5. Reply to the person, explaining what you did and their right to complain
   to the supervisory authority.
6. Close the entry in the register.

Technical details: [`backend/src/data-export/README.md`](../../../backend/src/data-export/README.md).
