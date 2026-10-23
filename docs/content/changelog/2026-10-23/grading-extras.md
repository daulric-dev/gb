---
sidebar_label: 2026-10-23 · Rubrics, drop rules and gradebook import
sidebar_position: 3
---

# 2026-10-23 - Rubrics, drop rules and gradebook import

Three additions to marking and the gradebook. Migration `20261023130000_grading_extras`.

## Rubrics

Teachers build **rubrics** per course - criteria, each with rating levels - and attach one to any assignment or offline work from its new **Rubric** tab. Staff (TAs included) mark a student by picking a level per criterion, with an optional comment on each; the sum becomes the score, and a teacher can override it. Students see the rubric on the work page and, once marked, the levels and comments they were given.

The submission is still the one place a mark lives: a rubric assessment (`grading.rubric_assessment`, one row per submission and criterion) records how the mark was reached, and its total is written to `submission.score` in the same transaction. Once a rubric has been used for marking its criteria are frozen (`409`); rename it, or copy it to make a changed version. Deleting a rubric detaches it and drops its criterion marks; the scores stay.

## Drop lowest / drop highest

Assignment groups have `drop_lowest` and `drop_highest` (0-50, default 0), set in **Manage groups**. Per student, among the counted marks in the group, the calculation leaves out the marks that hurt (then help) the group percentage most - with unequal points that is the set whose removal leaves the best percentage, not the smallest individual percentages, as in Canvas. At least one mark always counts. Dropped marks are struck through in the gradebook and labelled on the student's grades page; the API reports them as `dropped` on cells, on each grade and on each group score.

`gradebook.calc.ts` gained `applyDrops` (exhaustive for small groups, an exact ratio search for large ones), with tests checking both against brute force.

## Gradebook CSV import

**Import** on the course Grades page takes a CSV in the export's shape. `POST /courses/:courseId/gradebook/import/preview` reports what would change and every error (unknown or ambiguous student, a mark outside 0..points or with more than two decimals); `POST .../gradebook/import` re-plans from the current marks and writes all changes in one transaction, or refuses the whole file if it has errors. Blank cells are skipped, `EX` excuses, and a cell equal to the current mark at two decimals is not a change - so re-importing an untouched export changes nothing and quiz auto-scores are only replaced where the sheet holds a different number.

The export gains a **Student ID** column after the names, so a sheet comes back without guessing from names. Anything parsing the export by column position needs to allow for it.

## Deploying

- Apply migrations (`bunx prisma migrate deploy`). The migration only adds tables and columns: `course.assignment_group.drop_lowest` / `drop_highest` (default 0, so totals are unchanged), `grading.activity.rubric_id`, and `grading.rubric`, `rubric_criterion`, `rubric_rating`, `rubric_assessment`.
- No configuration changes.
