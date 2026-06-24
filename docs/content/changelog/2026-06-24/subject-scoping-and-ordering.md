---
sidebar_label: 2026-06-24 · Subject scoping & ordering
sidebar_position: 1
---

# 2026-06-24 - Subject scoping and ordering

Two backend fixes around how subjects are selected and ordered. No migrations, no API shape changes.

## Subject dropdown leaked other schools' subjects

The "Manage Grades" Subject dropdown showed subjects from every school, with duplicates (multiple "Mathematics", "Grammar", and so on), instead of only the current school's subjects.

The cause was in `getMySubjectsForClass` ([class.service.ts](../../../../backend/src/class/class.service.ts)). For admins and class teachers the query selected from `subject` with no `school_id` filter, so it returned the global subject table. The non-admin teacher path was already correctly scoped through `teacher_subject_assignment`.

The fix resolves the class's school first (`student_group` to `academic_year.school_id`, the same lookup used by the `ClassTeacherGuard`) and filters subjects by that `school_id`. If the class has no resolvable school the endpoint now returns an empty list rather than the whole table.

Note on caching: results are cached under `my-subjects:<userId>:<classId>`, so an admin who already opened the dropdown keeps the stale global list until the cache TTL expires.

## Inconsistent subject order between the dropdown and reports

Subjects were ordered by `sort_order` everywhere, but the tie-breaker differed. The subject list and the grading dropdown ordered by `sort_order` then `name`, while the calculation engine (which drives both the report card and the class report) ordered by `sort_order` only. When two subjects shared a `sort_order` value the report card and the class report could list them in a different order from the school's subject list.

[calculation.service.ts](../../../../backend/src/calculation/calculation.service.ts) now uses `sort_order` then `name` in all five places it orders subjects: the three Supabase `subject` queries (term result, class-term results, year results) gained a secondary `.order('name')`, and the two in-memory `subjectResults.sort` comparators gained a `localeCompare(name)` tie-breaker. Report card, class report, the subject list, and the grading dropdown now share one ordering.

## Behavior note

Report book entries store their `sort_order` positionally at generation time, so already-generated reports keep the order they were built with. New or regenerated reports use the corrected ordering.
