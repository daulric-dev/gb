---
sidebar_label: Mastery and learning outcomes
sidebar_position: 14
---

# Mastery and learning outcomes

GradeBook can track how well each student has mastered your **learning
outcomes** (standards), **alongside** the normal points gradebook. Nothing
changes in grades, totals, letters or report card grades: outcomes are an
extra layer worked out from the same marks.

This is **off by default**. Your organisation makes **Mastery & learning
outcomes** available and a school admin turns it on in **Settings →
Features**.

## Setting up (school admins)

Open **Settings → Mastery setup**.

### The proficiency scale

- **Levels**: 2 to 10, lowest first. The default is 1 Beginning, 2
  Developing, 3 Proficient, 4 Exceeding. Rename them or change how many.
- **Mastered at**: the level a student must reach (default Proficient).
- **Calculation**: how a student's evidence on one outcome becomes their
  mastery:
  - **Decaying average** (default): each new piece of evidence counts 65%
    (you can change it) and everything before it 35%. Evidence at levels 2,
    then 3, then 4 gives 2.65 after the second and **3.53** after the third,
    so recent work matters most but one bad day does not wipe out progress.
  - **Most recent**, **Highest**, or **Average (mean)**.
- **Evidence needed before "mastered"**: for example 3, so a single good
  result is not enough. A student at the level with too few pieces shows
  **Needs more evidence**.
- **Score bands**: how an activity's percent becomes a level (default: 0%
  Beginning, 50% Developing, 70% Proficient, 90% Exceeding).
- **Report cards**: switch on **Show an outcomes section on report cards**
  to list each course's outcomes and levels under the course on term reports.

Changing the scale applies to all past evidence straight away.

### Outcome sets

An outcome set is a school-wide framework, such as a national curriculum.
Each outcome has a **code**, a **title**, and optionally a description,
subject and grade level, and outcomes can sit inside other outcomes.

- **Import from CSV**: columns `code`, `title`, and optionally
  `description`, `subject`, `grade_level`, `parent_code` (the code of the
  outcome it sits inside, in the same file). Use **Check file** first: any
  error stops the whole import. Importing into an existing set updates the
  outcomes with the same code and adds the rest.
- **Archive** a set or an outcome you no longer use. Outcomes that already
  have evidence can only be archived, never deleted, so students' history is
  kept.

## In a course (teachers)

Open the course's **Outcomes** tab.

### Outcomes and links

- **Course outcomes**: add outcomes that belong to this course only. School
  outcomes are available in every course.
- **Link** an outcome to what measures it:
  - a **whole activity** (its score),
  - a **rubric row** (the level chosen for that criterion), or
  - a **quiz question** (including question bank questions).

  Marks already given count straight away; from then on every mark counts
  as it is entered. Removing a link removes the evidence it produced.

### How marks become evidence

Every marked piece of work gives one piece of evidence per linked outcome:

- **Whole activity**: the score as a percent, through the school's score
  bands.
- **Rubric row**: the level picked on that row, spread over the scale (with
  four rubric levels on a four-level scale, the first level is Beginning and
  the last Exceeding).
- **Quiz question**: the credit the student got on that question, through
  the score bands. Essay and file questions count once you have marked them.

**Late penalties never count.** Mastery measures learning, not punctuality,
so a 90% piece of work handed in late is still 90% here, even though the
gradebook shows the penalised mark. Excused work is not evidence.

When you change a mark (by hand, with a rubric, by marking a quiz question,
through a gradebook import, or when an external tool sends a score) the
evidence updates with it.

### The mastery grid

**Mastery** shows every student against every outcome. Each cell shows the
level's **name and score** (for example "Proficient · 3.3") in its colour, a
✓ when mastered and … when the student is at the level but needs more
evidence; the colour is never the only signal. Select a student to see each
outcome's evidence, newest first: which activity, what was assessed, the
level and the percent.

**Export CSV** downloads the grid.

## Students

Students see **Outcomes** in the portal (and under **Grades → Outcomes** in
the app): each course's outcomes with their level, whether mastered, and the
evidence behind it. They never see other students.

## Parents

Parents see outcomes only when the school switches on **Mastery of learning
outcomes** under **Settings → What parents see** (off by default) and
mastery is on for the school. They then get an **Outcomes** tab for their
child with the same view the student has.

## Audit log

Changes to the proficiency scale and mastery settings, outcome sets
(including each CSV import, recorded once with how many outcomes were added
and updated), school and course outcomes, and outcome links appear in the
[audit log](./audit-log.md) with who made them and the old and new values.
Students' evidence is worked out from marks automatically and is not logged
separately; the marks and links behind it are.
