---
sidebar_label: 2026-09-20 · Manual assessments retired
sidebar_position: 4
---

# 2026-09-20 - Manual assessment authoring retired

Assessments can now only come from **publishing a quiz or an assignment**. The separate Grading screens, where assessments were created by hand and grades typed into a table, are gone.

No migration. `grading.assessment` is unchanged - it is still the gradebook - only the way rows get into it has narrowed.

## Removed

- The web **Grading** page (`/dashboard/classes/[classId]/grading`) and its nav entry. Work takes over its slot.
- The **mobile** grading screen, its stack entry and menu row.
- `POST`, `PATCH`, `DELETE /assessments` and `PATCH /assessments/:id/exclude`, plus the service methods behind them.

`GET /assessments` and `GET /assessments/:id` remain - reports and anything reading the gradebook still need them. Those two screens were the only callers of the write endpoints.

Keeping a single authoring path means the work students see and the row the calculation engine reads cannot drift apart.

## Added, so nothing is lost

The old form had two things Work had no equivalent for. One was kept and one was deliberately dropped.

### Exclusion, kept

**Do not count** on any published activity flips `assessment.is_excluded` - exactly what the old page wrote. The marks are kept and only their effect on the term is dropped, with an amber banner while it is off. This has no substitute: deleting the activity would take the submissions with it.

A draft refuses it, because there is nothing to exclude until it is published.

### Per-assessment weight, dropped

Weighting items against each other inside a bucket is the job the [weighted groups](../2026-09-17/weighted-grading-groups.md) took over - "Assignments 20%" *is* the weight now - and equal weighting within a group is what most systems do. If one test should be worth double, the cleaner answer is its own group.

## Known gaps

- **Mobile has no grading screen at all** until a mobile Work screen exists. That screen would have 404'd against the retired API anyway.
- **Per-student grade exclusion** went with the page. The old grade table had a per-row exclude (`/grades/:id/exclude`) for cases like an absent student; the Work submissions tab has no equivalent, so a score can only be zeroed. **The API still exists and is untouched** - only the control is missing.
