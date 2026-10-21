---
sidebar_label: 2026-10-21 · Courses replace classes and subjects
sidebar_position: 1
---

# 2026-10-21 - Courses replace classes and subjects

GradeBook is now a course-based LMS in the mould of Canvas and Moodle. Teachers create **courses** and build them out of modules, pages, assignments and quizzes; students take courses rather than belonging to a class that takes subjects. Report cards are gone in favour of a live gradebook per course.

Deployment steps: [Upgrading to courses](../../upgrading-to-courses.md).

## What a course has

| Area | What it does |
| --- | --- |
| Home | Description (Markdown), upcoming work, recent announcements, publish button for drafts |
| Modules | Ordered sections of pages, assignments, files, links and headers; drag to reorder; publish per module |
| Assignments | Grouped by weighted **assignment groups**; quizzes, file/text assignments, and new **offline** work marked on paper |
| Pages | Markdown pages (no raw HTML) |
| Announcements | Course-only announcements, separate from school-wide ones |
| People | Teachers and TAs from the school's staff; students from the roster or by **join code** |
| Grades | Gradebook with group weighting, excused marks, omit-from-total, letter from the grade scale, CSV export |
| Settings | Name, code, year/term, grade scale, status (draft / published / archived), delete |

Courses are draft until published; students only see published courses (and archived ones, read-only).

## Who can do what

School permissions now have a single `course` resource. Teachers get `course:create`; admins (anyone with `course:update`) manage every course. Inside a course, the **course role** decides: teachers do everything, TAs read, mark and post announcements but cannot change settings, people or delete, students see published content and their own work. A course you have no role in answers 404, not 403, so ids reveal nothing.

## Grades

- An activity counts when published, not omitted, and the student's submission is marked and not excused. Unmarked work is ignored (a "current grade").
- With weighted groups, the total renormalises over groups that have marks - an empty exam group does not drag the grade down. With no weights, it is points earned over points possible.
- The submission score is now the single place a mark lives. `grading.grade` and `grading.assessment` are no longer written.
- Scores, points and percentages are rounded to two decimals everywhere they are shown; teachers can type at most two decimals.

## Existing data

A migration copies every class × subject that had a teacher, work or marks into a course, with its staff, students, grading groups, activities and every mark, including manual assessments (as offline activities). The old tables are left in place, unread, until a cleanup migration. Report books, class report files and class attendance are **not** migrated.

## Removed

- Classes, Subjects and report pages (web and mobile); `/dashboard/classes` and `/dashboard/subjects` redirect to Courses.
- Report cards, ministry reporting, the term/year calculation models.
- Backend modules: class, subject, enrollment, attendance (class), calculation, reporting, report-files, and the assessment/grade/grading-group endpoints.
- Edge functions: `dashboard-summary`, `report-class-summary`, `attendance-summary`, `grade-analytics`, `large-report-export`.
- Fixed term names (Michaelmas/Hilary/Trinity): terms now take any name.

## Security fixes found along the way

- **Quiz answers could be forged across questions.** The scorer accepted any correct option id for any question, so one known-correct option scored every question on every quiz. Answers are now checked against their own question in the API and in `submit_quiz`. This bug predates the revamp.
- Archived courses refused new hand-ins (archiving did not close their activities).
- A teacher removed from a school kept file access through old course shares.
- A module could link a colleague's private file; only your own files are accepted now.

## Mobile

Class and subject screens were removed. Students get a course list, a **Grades** tab with per-course detail, attendance check-in and QR scanning; teachers get a quick "Take attendance". The rest of course management is on the web for now.
