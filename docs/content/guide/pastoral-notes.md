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
webhooks or external tools, never on report cards, and never in any export
except the staff CSV described below.

## Who can see what

Your school decides with roles (**Roles**), using four permissions:

| Permission | What it allows |
| --- | --- |
| View pastoral notes | See the school's notes (not safeguarding ones) and export them. |
| Write pastoral notes | Add notes. Teachers have this by default. |
| Edit pastoral notes | Edit, resolve, reopen and delete notes. |
| Safeguarding | Needed **as well** to see, write or change notes in a safeguarding category. |

Administrators have all four. **You always see the notes you wrote.** A
teacher with only *Write* can record what happened and see their own notes,
but not colleagues'.

Every time a safeguarding note is opened, listed or exported it is recorded in
the [audit log](audit-log.md) as *viewed*.

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

## Privacy and erasure

Notes are personal data. They are deleted with the student, erased after the
retention period, and deleting a note removes it for good. Every erasure is
recorded in the erasure log (ids only), so it is applied again if a backup is
ever restored. Files attached to a note remain in their owner's Files.
