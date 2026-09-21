---
sidebar_label: 2026-09-20 · Class grading schemes
sidebar_position: 1
---

# 2026-09-20 - Grading schemes belong to a class

A weighted scheme is now configured **per class**, and every subject that class takes follows it. Previously it was scoped to `(term, subject)` - school-wide per subject - so 5A and 5B doing the same Maths could not weight it differently.

Migration: `20260917240000_class_grading_schemes`.

## The change

`grading.grading_group.subject_id` is replaced by `student_group_id`. Resolution is two levels: **a class's own groups if it has any, otherwise the term-wide default**. That keeps the ladder short enough to explain in the editor, which matters more than the extra combinations a subject level would allow.

Subject-scoped rows have no faithful home under the new scope - one subject scheme could belong to any number of classes - so they are dropped. Assessments pointing at them fall back to their exam/coursework type, which is what deleting a group through the API already did.

`resolve_grading_groups(term_id, student_group_id)` is the single resolver, called by both the calculation engine and the teacher's editor so neither can disagree about what applies.

## Editing an inherited scheme

The editor shows the term default until a class diverges. Editing a weight there **looked local but would have changed the school default for every other class**.

Editing or removing an inherited group now forks the whole scheme to that class first and applies the change to the copy - the same rule that already covered adding a group. `resolveTarget` in [grading-group.service.ts](../../../../backend/src/grading/grading-group.service.ts) does the redirect; `PATCH`/`DELETE` take an optional `studentGroupId` to say which class is being edited.

## Every term starts with a scheme

The original seed only covered terms that existed when it ran, so **any term created afterwards resolved to nothing** and the editor opened blank. A trigger now seeds Coursework/Exam from the new term's own weights on insert, with a backfill for terms that missed the original.

## Calculation

`loadGroups` takes the class instead of the subject. The class-term path resolves **one scheme for the whole class** rather than one per subject, and the year path resolves one per term - fewer lookups than before, not more.
