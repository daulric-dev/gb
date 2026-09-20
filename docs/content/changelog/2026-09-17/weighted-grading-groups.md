---
sidebar_label: 2026-09-17 · Weighted grading groups
sidebar_position: 2
---

# 2026-09-17 - Weighted grading groups

Term grading moved from two fixed buckets to **N named groups whose weights sum to 100** - "Assignments 20%, Quizzes 20%, Exam 60%", or whatever a school uses.

Migrations: `20260917180000_grading_groups` and `20260917200000_grading_group_exam_flag`.

## What it replaces

Weighting was hardcoded to exactly two buckets: `assessment_type` was an enum of `exam | coursework`, `assessment.weight` weighted items *inside* a bucket, and `term.coursework_weight` / `term.exam_weight` combined the two. That is one configuration of a more general idea.

`grading.grading_group` generalises it. Every term is seeded with Coursework and Exam groups carrying that term's existing weights, and every existing assessment is pointed at the matching group, so **the migration changes no results**.

## The exam flag

The three grading models (`weighted_continuous`, `weighted_cumulative`, `continuous_cumulative`) differ only in how they aggregate a *year*, and all three then split into a continuous-assessment block and an exam block. With N groups, the term composite is just the weighted sum of group averages - but the year-end split still needs to know which group is the terminal exam.

`is_exam` marks it. Everything unflagged feeds the continuous block. A partial index enforces at most one exam group per scheme, because "the exam block" would otherwise be ambiguous.

## The calculation

[grouped-term.helper.ts](../../../../backend/src/calculation/helpers/grouped-term.helper.ts) computes one subject's term figures from N groups, and all three strategies share it - they differ only in year aggregation, so term scoring now lives in one place.

Two behaviours worth knowing:

- **Groups with no marks are dropped and the remainder renormalised.** A 20/20/60 scheme where only the two 20s have marks is scored out of 40, not 100. This preserves the old behaviour of falling back to whichever bucket had data, rather than scoring a term out of a total nobody attempted.
- **Weights are not forced to total 100.** The engine renormalises, so a scheme totalling 90 or 110 still produces sensible grades. The editor shows the running total instead of blocking a teacher mid-edit.

An assessment predating the scheme, or pointing at a deleted group, still lands somewhere: it falls back to its old `assessment_type`. Deleting a group nulls the reference rather than cascading, so marks are never lost with it.
