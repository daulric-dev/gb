---
sidebar_label: 2026-09-20 · Quiz authoring and attempts
sidebar_position: 2
---

# 2026-09-20 - Quiz authoring, question types and attempts

Three additions to the quiz feature, plus a correctness fix to when questions may change.

Migrations: `20260920120000_short_answer_questions` and `20260920140000_quiz_attempts`.

## Editing questions

Questions could be added and removed but never edited - a typo meant deleting and retyping. Each question card now opens an inline editor for its prompt, points, options and which option is right. `PATCH /activities/:id/questions/:questionId` replaces the options wholesale, which is safe because editing is confined to drafts.

The add and edit forms are one component, so the question types behave identically in both.

### Questions now lock at publish

`addQuestion` and `removeQuestion` previously worked on **published** quizzes too. The UI only offered them on drafts, but the API did not check - and `submit_quiz` scores an answer against the option the student picked, so editing or deleting after students have answered would silently rescore work already handed in.

All three operations now refuse unless the quiz is a draft.

## Short-answer questions

`question_kind` gains `short_answer`, alongside multiple choice and true/false. Accepted answers reuse `quiz_option` - a short-answer question's "options" are the wordings that count as right - so there is one shape for "what makes this question correct" rather than a second table.

Marking is automatic like the other kinds: an answer counts when it matches an accepted wording **ignoring case and surrounding space**. A quiz is marked the instant it is handed in, so a question needing a human would leave the student on a partial score; anything needing judgement belongs in an assignment.

### The leak this created

For a short answer, the option **labels are the answer key**. `getForStudent` already withheld `is_correct`, which was not enough - it would have sent the accepted wordings as selectable options. Short-answer questions now reach the student with **no options at all**.

## Attempts

`activity.max_attempts` controls how many times a student may sit a quiz. `NULL` means unlimited; `1` is the old behaviour and remains the default, so nothing changes for existing work. `submission.attempt_count` tracks usage.

`submit_quiz` was rewritten to count the attempt and enforce the limit, instead of refusing anything that was not a draft. The limit is checked **twice** - in the service before writing answers, and again inside the RPC while it holds the row lock - so two simultaneous submissions cannot slip past the cap.

Two design decisions worth stating:

- **The latest attempt counts, not the best.** A retake overwrites the previous answers and score; the gradebook holds the most recent.
- **Earlier attempts are not kept.** Only a count is stored. Keeping full history would need one submission row per attempt, and the single-row-per-student shape is what the marking screen, file upload and grade write-through are built on.

A retake also **clears the previous attempt's answers** before writing new ones. Upserting alone would have left answers to questions the new attempt skipped, silently scoring them again.

## Editing title, description, due date and points

The activity page gained an Edit panel for title, description, due date, points and (for quizzes) attempts. Unlike questions, these stay editable after publishing - renaming changes nothing already marked.

That exposed a bug: publishing copies the title onto the `grading.assessment` row, and `update` only mirrored `points` back, so **a rename left the gradebook and reports showing the old title** indefinitely. The title is now mirrored alongside the points.
