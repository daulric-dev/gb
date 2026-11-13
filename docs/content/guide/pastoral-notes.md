---
sidebar_label: Pastoral notes
sidebar_position: 15
---

# Behaviour and pastoral notes

Private notes staff keep about a student: good behaviour, concerns, pastoral
care, safeguarding, medical-related notes and anything else your school
needs, with follow-ups and a timeline. **Off by default**: the organisation
makes it available (Features) and each school can switch it off.

Pastoral notes are **never shown to students or parents**, never sent to
webhooks or external tools, and never on report cards. They are not in the
data downloads students and parents make themselves. They **are** included
when the school answers a subject access request with a staff data download
for the student (see [Answering data requests](data-requests.md)), unless a
note is withheld, and in the staff CSV export described below.

## Who can see what

Your school decides with roles (**Roles**), using four permissions:

| Permission | What it allows |
| --- | --- |
| View pastoral notes | See the school's notes (not safeguarding ones) and export them. |
| Write pastoral notes | Add notes. Teachers have this by default. |
| Edit pastoral notes | Edit, resolve, reopen and delete notes. |
| Safeguarding | Needed **as well** to see, write or change notes in a safeguarding category. |

Administrators have the first three. **Safeguarding is never given
automatically, not even to administrators**: add it to a role (for example a
designated safeguarding lead role) and assign that role. Giving it needs
"Confirm it's you" and is recorded in the audit log. **You always see the
notes you wrote.** A
teacher with only *Write* can record what happened and see their own notes,
but not colleagues'.

Every time a note is opened, and every time a safeguarding note is listed or
exported, it is recorded in the [audit log](audit-log.md) as *viewed*; a list,
timeline or follow-up view is also recorded with the notes it showed.

## Writing a note

Open a student (**Students** → a student) and use **Pastoral notes → Add a
note**: pick a category, severity (low, medium, high), the date, and write the
note. Optionally set a **follow-up** date and **assign** it to a colleague
(only staff who could read the note can be chosen) and attach files from your
own Files. Attachments open only through the note, for people who can see it.

In the **mobile app**, **Students → Notes** on a student shows their timeline
and has a **Quick note** (category, severity, text; dated today).

## The timeline and follow-ups

The student's **Pastoral notes** card is their timeline, newest first, with
filters for category, status, severity and dates. Mark a note **resolved**
when it is dealt with (you can reopen it).

**Pastoral** in the sidebar has **My follow-ups** - open notes assigned to you,
overdue ones highlighted - and, if you can view notes, **All notes** with the
same filters and **Export CSV** (the export follows the same rules: no
safeguarding notes without the safeguarding permission).

## Settings (administrators)

**Pastoral → Categories and retention**:

- **Categories.** Schools start with Behaviour (positive), Behaviour (concern),
  Pastoral, Safeguarding, Medical-related and Other. Add your own, rename,
  archive (existing notes stay), and mark any category **restricted** so its
  notes need the safeguarding permission.
- **Retention.** Resolved notes are erased automatically this many days after
  they were resolved (at least 30). Leave it empty to keep notes until the
  student is removed from the school.

## Data requests and withholding a note

A staff data download for a student (subject access request) contains the
notes **the person making it can see**: their own notes, every
non-safeguarding note with *View pastoral notes*, and safeguarding notes only
with *Safeguarding* as well. The download says whether it covered every note,
so whoever answers the request should hold both permissions.

Where the law allows information to be held back (for example where
disclosure would put a child or someone else at risk, or reveal another
person), find the note in **Pastoral → All notes** or on the student's
**Pastoral notes** card and choose **Withhold from data requests**, giving the reason (the exemption relied on). Withheld notes
are left out of staff data downloads, which show how many were withheld. The
change and its reason are recorded in the audit log; **Include in data
requests** reverses it. This needs permission to change the note and either
*Safeguarding* or the student export permission (*Export everything held
about a student*).

## Privacy and erasure

Notes are personal data. They are deleted with the student, erased after the
retention period, and deleting a note removes it for good. Every erasure is
recorded in the erasure log (ids only), so it is applied again if a backup is
ever restored. Files attached to a note remain in their owner's Files.
