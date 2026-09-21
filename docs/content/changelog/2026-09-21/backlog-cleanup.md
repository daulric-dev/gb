---
sidebar_label: 2026-09-21 · Backlog cleanup
sidebar_position: 4
---

# 2026-09-21 - Per-student exclusions, delete rules, EAS profiles, mobile OTP

Four items that had been carried as known gaps rather than fixed. One of them turned out to be a live bug that made **deleting a school fail halfway through**.

## Foreign keys with no delete rule

The reported gap was a single missing `ON DELETE CASCADE` on `student_subject_profile.academic_year_id`. Sweeping the schema instead of patching the one constraint found **eight**, and the shape of the problem was worse than untidiness: a foreign key with no action defaults to `NO ACTION`, which *blocks* a delete rather than tidying up after it.

Two of the eight sat directly under `academic_year`, which school deletion cascades into. So deleting a school with any report book or subject profile in it failed on a foreign key violation **after the cascade had already begun** - the delete rolls back, but nothing in the application says why.

An eighth was missed by every earlier sweep because it is declared inline in its `CREATE TABLE` rather than as a later `ALTER`, so it never appeared in a scan of `ADD CONSTRAINT` statements.

| Constraint | Was | Now |
| --- | --- | --- |
| `report_book.academic_year_id` | none | `CASCADE` |
| `report_book_entry.report_book_id` | none | `CASCADE` |
| `report_book_entry.subject_id` | none | `CASCADE` |
| `report_book_pdf.generated_by` | none | `SET NULL` |
| `class_report_file.student_group_id` | none | `CASCADE` |
| `class_report_file.term_id` | none | `CASCADE` |
| `student_subject_profile.academic_year_id` | none | `CASCADE` |
| `student_subject_profile.student_id` | `SET NULL` | `CASCADE` |
| `school_join_request.reviewed_by` | none | `SET NULL` |

The rules are the ones the schema already used, applied to the edges that were missed: structure owned by something dies with it, and a column recording *who did something* loses the link instead. `report_book_pdf.generated_by` could not follow that second rule as it stood, because the column was `NOT NULL` and `SET NULL` would have raised instead of nulling - so the `NOT NULL` went, not the PDF.

`student_subject_profile.student_id` is the one that changed rather than being filled in. `SET NULL` blocked nothing, but it left a row linking nobody to a subject: unreachable, uncountable and permanent. That table records a link, not an action, and its `subject_id` already cascaded. The rows the old rule had **already** produced are dealt with separately, below - changing a rule and deleting data are different decisions.

Migration: `20260921120000_remaining_delete_rules.sql`. No rows are deleted by it; re-pointing a constraint revalidates the same data it already satisfied.

### Verified against a real database

The whole migration chain (48 files) was applied to a throwaway Postgres 17 with the Supabase roles and `storage`/`auth` helpers stubbed, then:

- **0** foreign keys left with no delete rule, down from 8.
- With the two `academic_year` rules put *back* the way they were, deleting a school failed with `violates foreign key constraint "report_book_academic_year_id_fkey"`. With the migration applied, the same delete succeeded and took the academic year, student, subject profile, report book, its entries and its PDFs with it.
- Deleting the user who generated a PDF left the PDF in place with `generated_by` null; deleting a join request's reviewer left the request in place with `reviewed_by` null.
- Applying the migration twice is a no-op, so a partial run can be repeated.

### Clearing what the old rule left behind

`20260921130000_clean_orphan_subject_profiles.sql` deletes the orphans and stops the table accepting another.

A subject profile is a three-way link - this student takes this subject in this year. Every read in the application filters on all three columns with `=` or `IN`, and NULL satisfies neither, so a row missing any of them **cannot appear in a class list, a subject assignment or a calculation**. It is not partial data; it is data nothing can ever load. Both insert paths always populate all three, so nothing in the application can produce such a row or is broken by refusing one.

With the rows gone and the cascade deleting rather than nulling, all three columns take `NOT NULL`. That is what makes it permanent rather than a sweep to repeat the next time a rule is wrong.

The two migrations have to stay in order: `NOT NULL` and the old `ON DELETE SET NULL` are contradictory, and with both in place deleting a student would try to null a column that refuses nulls. That is why this is a second migration rather than a statement moved into the first.

Verified on the same throwaway database, by reproducing the orphan rather than assuming one:

- Put the **old** `SET NULL` rule back, deleted a student, and confirmed the profile survived with a null `student_id` - one orphan, one live row.
- Restored the cascade, ran the cleanup: orphan gone, live row untouched, all three columns `NOT NULL`.
- Inserting a row with a null `student_id` is now rejected by the constraint.
- Deleting a student still works and takes the profile with it - the check that proves `NOT NULL` and the cascade agree. Had the FK still been `SET NULL`, that delete would now fail.
- Re-running the cleanup is a no-op.

## Excluding one student's mark

An activity could already be dropped from the term as a whole. There was no way to drop **one student's** result - the case where the work was fine but the result was not: absent for the test, sat a makeup, a paper lost. The only options were leaving a wrong mark in the average or deleting the submission, which loses the mark and the evidence with it.

`PATCH /grades/:id/exclude` had existed since the original gradebook and was **reachable from no screen in either app**.

- `GET /activities/:id/submissions` now returns the gradebook row behind each mark - `{ id, isExcluded, exclusionReason }`, or null where there is nothing to exclude yet.
- `POST /activities/:activityId/students/:studentId/exclude` sets it, with an optional reason.
- In the class activity's **Submissions** tab, a marked student gets a **Do not count** action; excluded rows show the reason inline and a **Count it** to undo. The reason is optional and cleared when the mark goes back in, so a stale note cannot reappear the next time.

### Why a new endpoint rather than the existing one

The existing route updates through RLS keyed to a **subject assignment**. That is the right rule for the gradebook at large and the wrong one on this screen: a class teacher who is not that subject's teacher can already set the mark (that path authorises by class, through the service client) and can already exclude *every* mark on the activity at once. Pointing the button at the RLS route would have given them a screen where scoring works and excluding returns 403.

The new route authorises exactly as marking the submission does, by the class the activity belongs to, which makes it strictly narrower than the activity-wide exclusion the same person already holds. The grade is looked up by **assessment and student together**, so a student id from another class cannot reach a grade this activity does not own.

Excluding is honoured where it matters: the term calculation drops the mark (`a.is_excluded || grade.is_excluded`), and the class summary and analytics edge functions read from `report_book_entry`, which is generated by that same calculation - so no edge path can disagree with it.

Seven tests cover the new method, including the unpublished case, a student with no mark, an activity outside the caller's school, and the assessment-scoped lookup.

## EAS build profiles

`mobile/eas.json` did not exist. It now defines `development` (dev client, internal), `preview` (release-mode internal APK) and `production` (store AAB, `autoIncrement`), with `appVersionSource: remote` so EAS owns the build number. `expo-dev-client` was installed, so the development profile is usable rather than decorative.

`EXPO_PUBLIC_API_URL` is present but **empty** in the two release profiles. A placeholder like `https://api.example.com` would build an app that points confidently at the wrong host; an empty value falls through to the launch guard, which names the variable. See [Mobile in production](../../mobile-production.md).

## Mobile OTP screen

The web screen was redesigned earlier; mobile still had the old layout. It now matches:

- **One primary action.** Resend and "Use a different email" became text links instead of two more full-width buttons stacked under Verify - three identical buttons gave no clue which one was the point.
- **Errors shown in place.** A failed code paints the boxes red and puts the message under them, and clears the code ready to retype. It had been a toast, which slides away exactly as you look back at the input.
- **Reserved space** for that message, so the card does not jump when it lands.

The known-gaps note claiming mobile had no auto-submit was stale - it did. The layout was the real difference.

The web version leads with a mail icon; mobile does not, because its auth shell already puts the brand mark directly above the card and a second badge under it just stacks two icons down the middle of a phone screen.

## Not done

- None of the EAS profiles has been run through an actual build.
- The mobile screens were checked by typecheck, not on a device.
