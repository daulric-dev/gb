---
sidebar_label: Parent portal
sidebar_position: 9
---

# Parent portal

The parent portal lets parents and guardians follow their own children's
grades, work, attendance and announcements (their courses' and their school's). It is **read-only** and
**off by default**.

## Turning it on

1. The organisation makes **Parent portal** available in **Organisation →
   Features** (and, if wanted, **Parent notifications**).
2. A school administrator switches it on (or leaves it off) under
   **Settings → Features → Families**.
3. Under **Settings → What parents see**, the school chooses which areas
   parents get: grades, upcoming and missing work, attendance,
   announcements (course announcements and school announcements posted for
   **Everyone**), and published report cards and transcript (needs
   **Report cards** on too). It can also leave out students from a certain age (for
   example 18), whose parents then cannot see them at all.

Switching the feature off takes effect at once: every parent page and
request is refused.

## Linking a parent to a student

Open the student in **Dashboard → Students** and use **Parents and
guardians** (needs permission to edit students):

- **Send invitation**: GradeBook emails the parent a link. It works once,
  expires after 14 days, and only for the email address it was sent to.
- **Make a link code instead**: a one-time code (`ABCDE-FGHJK`, 7 days) to
  hand over on paper or in person. It is shown only once.

One parent can be linked to several children, and a child can have several
parents. The same card lists linked parents and open invitations; removing a
link or withdrawing an invitation takes effect immediately.

## For parents

- Open the invitation link (or go to **Sign in → "A parent or guardian?"**
  to enter a code) and sign in with your email address. You get a sign-in
  code by email; there is no password.
- The web portal is at `/parent`; the mobile app opens the parent tabs.
  With more than one child, switch between them at the top.
- In **Settings**, turn on email or push notices (both are off until you do)
  for missing work, absences, new grades and announcements (course posts and
  the school's posts for everyone), if the school offers parent notifications.
  A parent with two children at the same school gets one notice per school
  announcement.

An email address that already belongs to a student or a staff member of a
school cannot become a parent account. Use another address.

## What parents can see

For each linked child, only what the school shows parents:

- the courses the child is enrolled in, with teachers' names;
- the current course grade and the score on each **marked** piece of work
  (the same rule as for the student: nothing until it is marked);
- upcoming and missing work, by the child's own due date (extensions
  included);
- attendance per session: present, late, absent or excused, and when;
- announcements posted to the child's courses, and the child's school's
  announcements posted for **Everyone** (marked **School**). With children
  at different schools, each child's page shows only that child's school;
- the child's [report cards](./report-cards.md) for published terms (as
  PDFs, under **Reports**) and the transcript across published terms. A
  term the school has not published, or has unpublished, is never shown;
- only if the school turns on **Mastery of learning outcomes** (off by
  default) and [mastery](./mastery.md) is on: the child's level on each
  learning outcome and the evidence behind it, under **Outcomes**.

## What parents never see

- Submitted work, files, written answers or quiz answers.
- Teacher feedback and rubric comments.
- Messages, discussions and anything in chat.
- Staff-only data: Lockdown away times, attendance locations and location
  checks, attendance notes, accommodations, and anything about other
  students.
- School announcements marked **Staff only**.

## Privacy note

Parent access is limited to linked children and enforced by the server on
every request, not just hidden in the apps. A parent account belongs to no
school and holds no staff or student permissions. Linking, unlinking,
invitations and changes to "What parents see" are recorded in the
[audit log](./audit-log.md). Invitation links and codes are stored only as
one-way hashes. Parent notices contain the child's name, the course and the
title of the work or announcement; they are sent only to parents who turned
them on, and stop when the school switches parent notifications off.
Schools should tell students and families which areas are shared, and use
the age limit where older students' records should stay private.
