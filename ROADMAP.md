# GradeBook roadmap

Features planned for implementation, grouped by priority. Each entry says why it matters, what it covers, and what it touches. Tick the box when it ships and link the pull request.

New features that a school might not want go behind a **feature flag** in the catalog (`backend/src/features/feature.catalog.ts`). The organisation makes a feature available, and each school's admin can switch it off. Routes are guarded with `@RequireFeature(...)`, and the web and mobile apps hide what is off. See [backend/src/features/README.md](backend/src/features/README.md).

**Priority:** P1 = next up; P2 = after P1; P3 = later or needs a decision first.

---

## P1: next up

### 1. Per-student quiz accommodations — [x] (PR #TBD)

**Why.** A quiz's time limit and Lockdown apply to every student. A student who needs extra time, or who relies on assistive software that Lockdown blocks, has no fair way to take the quiz (see [ACCESSIBILITY.md](ACCESSIBILITY.md#known-gaps)).

**Scope**
- A per-student accommodation on a quiz: a time multiplier (×1.25, ×1.5, ×2) or extra minutes, and **exempt from Lockdown**.
- Optional school-wide default per student ("always ×1.5"), applied to every timed quiz unless overridden.
- Shown to the teacher in the roster ("×1.5 time", "No lockdown"), never to other students.

**Touches**
- Schema: `grading.activity_accommodation` (activity, student, time multiplier or extra minutes, lockdown exempt, reason, created by), modelled on `grading.activity_extension`.
- Backend: `quiz_expires_at` is computed from the accommodation when the attempt starts; the presence endpoint and the roster's away logic skip lockdown-exempt students; audit-logged like extensions.
- Web and mobile: an "Accommodations" action next to "Extend due date" in the teacher roster; the student's quiz screen shows the adjusted time and skips the lockdown rules card.

**Done when** a ×1.5 student gets 45 minutes on a 30-minute quiz, an exempt student takes a Lockdown quiz without pinning or fullscreen, and neither shows as away.

### 2. Parent / guardian portal — [x] (PR #TBD)

**Feature flag:** `parent_portal`, **off by default**. The organisation makes it available; each school turns it on when it is ready.

**Why.** Parents expect to see grades, attendance and upcoming work. The data model already has `parent_student_link` (`backend/prisma/schema/student.prisma`), but almost nothing uses it.

**Scope**
- **Linking:** the school invites a parent by email for a student (or a parent redeems a one-time link code from the school). One parent can link several children; one child can have several parents. Staff can see and remove links.
- **Parent view (read-only):** for each linked child, current grades per course, upcoming and missing work, attendance history, school and course announcements. No submissions, quiz answers, chat, or teacher-only data (lockdown flags, attendance location flags).
- **Notifications** (push and email, each opt-in): missing work, an absence, a new grade, an announcement.
- **Controls:** a school setting for what parents see (for example hide grades until released); students over a configured age can be excluded by the school.

**Touches**
- `features/feature.catalog.ts`: add `parent_portal` (default off); `parent_notifications` requires `parent_portal`.
- New role: parent accounts sign in with the same email-code flow; a `ParentGuard` resolves the linked children and checks each request against `parent_student_link` (every query scoped to linked students only).
- Backend module `parent-portal/` with read endpoints reusing the student-portal services, plus link and invite endpoints for staff.
- Web: `app/parent/` (child switcher, overview, grades, attendance). Mobile: a parent tab group.
- Docs: guide page for schools and parents; privacy note on what parents can see.

**Done when** a school with `parent_portal` on can invite a parent, the parent sees exactly their own children's grades and attendance and nothing else, and turning the flag off returns 403 `FEATURE_DISABLED` on every parent route.

### 3. Report cards and transcripts — [x] (PR #TBD)

**Feature flag:** `report_cards` (default on).

**Why.** Schools need a printable record each term; today they would rebuild it by hand from the gradebook.

**Scope**
- A term report per student: courses, final grade and letter (from the school's grade scale), attendance summary, teacher comment per course, form-tutor or head comment.
- Teacher comment entry per course, with a deadline and a "ready" state; admin review before publishing.
- PDF export per student and in bulk (zip per class); a student (and parent, if the parent portal is on) can download published reports.
- A transcript across terms and years.

**Touches**
- Schema: `grading.report_comment`, `grading.report_release` (term, school, published at).
- Generation in a queue job (BullMQ) so a whole school doesn't block a request.
- School branding (logo, name) from the existing school settings.

**Done when** an admin can publish a term's reports and a student can download a correct PDF.

---

## P2: after P1

### 4. Late-work policy — [ ]

**Why.** Due dates now hard-close. Many teachers accept late work with a penalty.

**Scope**
- Per assignment or quiz: **accept late until** (a final lock date after the due date) and a **penalty** (X% per day or per hour, a cap, or none).
- Late submissions are marked "Late (2 days)" in the roster and the student's view; the penalty is applied to the mark and shown separately ("85 − 10% late = 76.5").
- Per-student extensions still win over the policy.

**Touches:** `grading.activity` (`late_until`, `late_penalty_*`), `due-date.ts` (an effective "closed at" separate from "due at"), submission marking, gradebook display, CSV export.

### 5. More quiz question types and question banks — [ ]

**Why.** Only multiple choice, true/false and short answer exist; teachers need open answers and maths, and randomisation helps more against cheating than lockdown does.

**Scope**
- New types: **essay** (teacher-marked, optional rubric), **multiple select** (all-or-nothing or partial credit), **numeric** (with a tolerance), **matching**, **ordering**, **file upload**.
- **Question banks:** reusable pools per course; a quiz draws N questions at random per student.
- **Shuffle** question order and options per student.
- A quiz with essay or file questions stays "needs marking" until the teacher marks those parts; auto-scored parts are scored immediately.

**Touches:** `question_kind` enum, `grading.submit_quiz` (and the TypeScript re-scoring copy in `quiz-rescore.ts`, which has a test that keeps them identical), quiz builder UI, student quiz screens on web and mobile.

### 6. Timetable and automatic attendance sessions — [x] (PR #TBD)

**Feature flag:** `timetable` (requires `attendance`).

**Scope:** periods, rooms and a weekly or rotating timetable per course; check-in sessions open (and close) automatically at the start of each period, with the room's saved location for the location check; teachers can cancel or move a single period.

### 7. Attendance reports and alerts — [x] (PR #TBD)

**Feature flag:** `attendance_alerts` (requires `attendance`).

**Scope:** attendance percentage per student, course and school; thresholds (for example below 90% over 4 weeks) that alert the form tutor or admin, and the parent if the parent portal is on; CSV export.

### 8. SIS / rostering sync (OneRoster, CSV) — [ ]

**Feature flag:** `rostering` (organisation only).

**Scope:** import or sync students, staff, classes and enrolments from a CSV upload or a OneRoster 1.2 endpoint; a dry run that shows changes before applying; nothing is deleted without confirmation. Webhooks already send data out; this brings it in.

### 9. LTI 1.3 tool support — [x] (PR #TBD)

**Feature flag:** `lti` (organisation only, off by default: data leaves the platform).

**Scope:** register external LTI 1.3 tools; add them as module items; launch with the student's identity; receive grades back (Assignment and Grade Services) into the gradebook.

---

## P3: later or needs a decision

### 10. Mastery / standards-based grading — [ ]

Link assignments and rubric rows to learning outcomes; track each student's mastery per outcome over time; an optional outcome-based report card view. Decision needed: alongside the points gradebook, or as a per-course alternative.

### 11. Peer review — [ ]

Students review classmates' submissions against a rubric, optionally anonymous; the teacher sets how many reviews each student does and whether review quality counts toward the grade.

### 12. Similarity check on text submissions — [ ]

Flag text submissions that closely match others in the same class or school (not an external database). Decision needed on how results are shown, so a flag is a prompt to look, not a verdict.

### 13. Course template library — [ ]

A shared library of modules, quizzes and rubrics across courses and schools. **Decision needed first:** today, importing a template keeps the author's linked files, which gives the importer access to them. Decide whether import should copy those files, drop them, or ask the author.

### 14. Behaviour and pastoral notes — [ ]

**Feature flag:** `pastoral_notes` (default off). Private staff notes per student with categories and a timeline; visible only to staff with a dedicated permission; never shown to students or parents.

### 15. Offline mode in the mobile app — [ ]

Read course pages and assignment instructions without signal; draft text submissions and quiz answers offline and sync them when back online, with conflict handling if the deadline passed meanwhile.

### 16. Analytics dashboard — [ ]

Submission rates, grade distributions and at-risk students per course and school. Heavy queries run in background jobs or on cached aggregates, not on request.

### 17. AI assistance — [ ]

**Feature flag:** `ai_assistance`, off by default; the organisation chooses whether to enable it and each school can switch it off.

**Scope (all opt-in, teacher-approved):** draft quiz questions from a course page; suggest rubric feedback for the teacher to edit; summarise a page for students. **Never** grades on its own, never sees data from a school that has the flag off, and every request is logged.

---

## How to work on an item

1. Open a branch off `staging` (see [CONTRIBUTING.md](CONTRIBUTING.md)).
2. Start with the schema and a migration, then the backend (with tests for every refusal path), then web and mobile.
3. Add the feature flag to the catalog if the entry names one, guard every route with `@RequireFeature`, and hide the UI when it is off.
4. Update the module `README.md`, the user guide in `docs/content/guide/`, and [ACCESSIBILITY.md](ACCESSIBILITY.md) if the feature affects it.
5. Tick the box here and link the pull request.
