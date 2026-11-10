---
sidebar_label: Work and grading
sidebar_position: 5
---

# Work and grading

Everything that counts towards a grade lives under a course's **Assignments** tab: quizzes, assignments, and offline work. A mark exists because a piece of work produced it.

## Assignment groups

Groups are the course's weighting - for example Labs 40, Quizzes 30, Exams 30. **Manage groups** adds, renames, reorders and weights them.

- If groups have weights, the course grade combines each group's percentage by those weights. **A group with nothing marked yet is left out** and the rest rescale, so an Exams group set up in week one does not drag every grade down until the exam happens.
- If no group has a weight, the grade is simply points earned out of points available.
- Work in no group sits in **Ungrouped**.

Weights need not add up to 100.

### Dropping the lowest marks

Each group can **drop lowest** and **drop highest** marks - for example "drop each student's lowest quiz". Set them under **Manage groups**, next to the weight.

- Drops are worked out per student, among the marks that count (marked, not excused, not omitted). Unmarked work is never dropped.
- "Lowest" means the marks whose removal raises the student's group percentage most, which is not always the smallest percentage: with a 2-point quiz and a 50-point test, dropping the test can help more than dropping the quiz.
- A group never drops all of a student's marks - at least one always counts.
- In the gradebook a dropped mark is shown ~~struck through~~, and students see it marked "dropped, not counted" on their grades page. The mark itself is kept; change the rule and it counts again.

## Setting work

**New** under Assignments creates one of:

- **Quiz** - questions, marked automatically the moment the student submits.
- **Assignment** - students hand in a file, typed text, or both.
- **Offline** - done on paper or in person; nothing to hand in online, you enter the marks.

Give it a title, instructions (Markdown), a points total, a due date and its group. New work is a **draft**: students cannot see it.

### Late work

By default work closes at its due date. To accept late work, set **Accept late work until** (a date after the due date) and, if you want, a **late penalty**:

- **None**, **% per day** or **% per hour** late, and an optional **cap** (the most the penalty can take, for example 50%).
- Every started day or hour counts in full: one minute late on 10% per day loses 10%; 25 hours late loses 20%.
- The penalty is a percentage of the mark, not of the points: 85 handed in a day late at 10% per day is 85 − 10% = 76.5.
- A quiz is late by when the student **started** it, not when they submitted: an attempt started before the due date runs its full time without a penalty. An untimed attempt started on time still ends at the due date; one started late runs until late work closes.
- **Extensions win.** A student with an extension is due at, and closes at, their extension, with no late window and no penalty if they hand in before it.

Late hand-ins show **Late (2 days)** on the marks table with the breakdown "85 − 10% late = 76.5"; **Waive penalty** (and **Apply penalty**) on the row restores the student's full mark and is recorded in the audit log. Students see the due date, until when late work is accepted, and the penalty that applies. The gradebook, CSV export, report cards and the student's grades all use the mark after the penalty (a cell with a penalty shows a small **L**; hover it for the breakdown). A mark you import from a CSV is taken as the final mark, as typed.

### Quiz questions

- **Multiple choice** - several options, one correct.
- **True or false**.
- **Short answer** - checked against the answers you accept, ignoring capitals and extra spaces. List every reasonable wording; students never see them.
- **Multiple select** - several correct options. **All or nothing** (exactly the right ones) or **partial credit**: (right picks − wrong picks) ÷ correct options, never below zero.
- **Numeric** - a number, right when it is within the **tolerance** of your answer (3.14 with tolerance 0.01 accepts 3.13 to 3.15).
- **Matching** - pairs of items; students choose the match for each from a list. All or nothing, or partial credit per pair.
- **Ordering** - items in the right order (the order you type them); students see them shuffled and move them up and down. All or nothing, or partial credit per item in place.
- **Essay** - a written answer you mark by hand, optionally with a course rubric as a guide.
- **File upload** - a file you mark by hand. You can limit the file types (`.pdf`, `image/*`) and size.

Auto-marked questions are scored the moment the student submits. A quiz with an answered essay or file question shows **Needs marking** until you mark them: open the student's **Answers** on the marks table, give each essay and file question its points and a comment, and the quiz is marked once every one has a mark (auto parts + your marks). Students see "Waiting for teacher to mark" until then, and never see the right answers.

**Attempts** sets how many tries a student gets (`0` is unlimited).

### Question banks and shuffling

**Question banks** are pools of questions that belong to the course. Build them from **Question banks** on a quiz, then use **Question bank draws** on a draft quiz: each student gets that many questions picked at random from the bank, as well as the quiz's own questions. **Shuffle questions** and **Shuffle options** give each student their own order. A student's questions and order are fixed when they start an attempt, so leaving and coming back shows the same quiz, and a retake draws again. A bank question becomes locked once a student has been given it.

### Lockdown quizzes in the mobile app

A lockdown quiz taken in the GradeBook app is pinned to the screen for the attempt, screenshots and screen recordings are blocked where the phone allows it, and the screen stays on. Anything that breaks the lockdown is reported on the live roster as **Away** with a reason, and adds to the student's "Left N times" count:

| Shown to you | What happened |
| --- | --- |
| Left the app | Went to the home screen or another app |
| Unpinned the app | Ended pinning or Guided Access during the attempt |
| Recording the screen | Screen recording or mirroring was running (iPhone/iPad; Android 15+) |
| Took a screenshot | Took a screenshot; reads as away for a few seconds |
| App not pinned | The student started without pinning because their device could not pin; it shows for as long as the app stays unpinned |

What students see on each platform:

- **Android** - tapping **Start quiz** shows the system **Pin this app?** prompt; the quiz starts once they confirm. To unpin afterwards, the app releases the pin itself after submitting, or they hold **Back** and **Overview**.
- **iPhone and iPad** - the app uses **Guided Access**, which must be switched on once in **Settings > Accessibility > Guided Access** (with a passcode). Before starting, the student triple-clicks the side (or Home) button and taps **Start**; **Start quiz** unlocks once Guided Access is on. After submitting they triple-click again and enter the passcode to end it.
- **School-managed iPads/iPhones** - an MDM profile can allow GradeBook for **Autonomous Single App Mode**. On those supervised devices the app turns Guided Access on and off by itself, with no triple-click or passcode.

If pinning does not work on a device (for example Guided Access was never set up and the student cannot change Settings), the student can **Start without pinning**; you see **App not pinned** for that attempt. Phones still cannot be locked down completely - treat these reports as signals, not proof.

### Accommodations: extra time and Lockdown exemption

Some students need more time, or rely on assistive technology (a screen reader, dictation, a magnifier) that Lockdown would block or report as leaving the quiz. Give them an **accommodation** instead of a separate quiz:

- **Extra time** - ×1.25, ×1.5 or ×2 the time limit, or a number of extra minutes (1 to 600). A ×1.5 student gets 45 minutes on a 30-minute quiz; their timer shows their own time.
- **Exempt from Lockdown** - the student takes a Lockdown quiz without the rules screen, fullscreen or app pinning, and is never shown as **Away**.

**On one quiz:** in the quiz's marks table, use the accessibility icon on a student's row (next to the due date action) and choose **Accommodations**. The row shows a badge such as **×1.5 time** or **No lockdown**.

**For every quiz (school-wide):** on the student's page (**Students**, then the student), **Quiz accommodations** sets a default that applies to every timed or Lockdown quiz. Changing it needs permission to edit students. An accommodation set on one quiz replaces the default on that quiz; removing it brings the default back.

Good to know:

- Extra time only applies to quizzes with a time limit. A quiz without one already runs until it is due; to give more time there, **extend the due date** instead.
- A timed attempt runs its full time, even past the due date, as for everyone else.
- Adding or increasing an accommodation while the student is mid-quiz gives them the extra time straight away; reducing or removing one applies from their next attempt.
- Accommodations and their reasons are only shown to staff. Other students never see them, and the student only sees their own time limit.
- Every change is recorded in the audit log.

## Publishing

**Publish** makes the work visible to students. **Questions lock at publish** - changing them afterwards would silently rescore work already handed in. Title, instructions, due date and points stay editable. **Close** stops new submissions without hiding anything.

## Marking

Open the work to see every student in the course, whether they handed in or not.

- **Quizzes** mark themselves, except essay and file questions, which you mark question by question from **Answers**.
- **Assignments and offline work**: type the score (up to two decimal places) and optional feedback. Students see the mark and feedback once it is marked.

### Rubrics

A rubric breaks a mark into **criteria** (Argument 10 points, Evidence 5 points...), each with **levels** (Excellent 10, Good 7, Needs work 3). Open an assignment or offline work and use its **Rubric** tab:

- **New rubric** builds one. Rubrics belong to the course, so the next piece of work can pick the same one from the list instead of building it again.
- To mark with it, click the rubric icon on a student's row in the marks table, pick a level for each criterion and add a comment where it helps. The total becomes the student's mark. You can type a **score override** if the total is not what you want to give - for example when the rubric is worth more points than the work.
- Students see the rubric on the work page before they hand in, and the levels and comments you gave them once it is marked.
- Once a rubric has been used to mark anyone its criteria can no longer change (the marks would stop matching what they say). Rename it freely, or **Copy to edit** to make a changed version.
- Quizzes mark themselves and cannot have a rubric.

### When a mark should not count

- **The work went wrong** (a bad question, a test nobody could sit): turn on **Omit from final grade** on the work. Marks are kept and visible but do not count.
- **One student's result should not count** (absent, sat a makeup): **Excuse** them, with an optional reason. Their row shows "EX" and it is left out of their grade.

Prefer either to deleting work or entering a zero - a zero is a real mark that pulls the average down.

### Marking on your phone

In the app, a course's **Marking** section lists its work; open one for the roster (filter **To mark** / **Marked**) and tap a student. You see what they typed, can open their file (it downloads and opens in your phone's viewer), and enter a score from 0 to the work's points with at most two decimals, plus feedback. If the work has a rubric, tap a level per criterion: the score fills in with their sum and can still be overridden. **Excuse from this work** (and **Remove excuse**) is there too, and **Previous / Next** steps through the roster.

### Peer review

Turn on **Peer review** on an assignment (its **Peer review** tab) to have students review each other's work. A school can switch the feature off.

- **Settings:** how many classmates' submissions each student reviews (1-10), whether it is **anonymous** (reviewers and authors never see each other's names; file names are replaced with "Attachment 1.pdf"), when it opens (**after the due date**, or **when I start it**), when it **closes**, and the review form: one of the course's **rubrics**, or **comments only**.
- **Who reviews whom:** when the window opens, every student who handed in (not excused) is given that many classmates' submissions, never their own, and every submission gets the same number of reviews. The allocation is stored, so it does not change between visits. A student who hands in later (in a late window) is added: they review the submissions with the fewest reviews, and theirs is reviewed by the students with the lightest load (no one gets more than one extra). **Allocate late submitters** does the same on demand. You can move a review that has not been handed in to another student, add one, or remove one.
- **Students** see "Reviews for you to write" on the assignment, open each classmate's work (text and files, through the same protected viewer as marking), fill in the rubric or comment, and hand it in. They can edit until the window closes. When it closes, each author sees the reviews of their own work. Both are on the web and in the app, with notifications when reviews are assigned and when they are ready.
- **You** see every review, including drafts, and can **hide** an inappropriate one from its author (with a reason; recorded in the audit log). Hiding never deletes it.
- **Review quality can count.** Turn on **Review quality counts** with a number of points: a separate offline column, "Peer review: <title>", is added to the gradebook, and you mark each reviewer there like any offline work. It never changes the assignment's own mark. Turning it off removes the column if nobody has a mark in it yet (otherwise it stays, as an ordinary offline column).
- Once reviews are assigned, the number per student can only go up and an anonymous review cannot be made named. The review form cannot change after a review is handed in.

### Similarity check

When the organisation turns on **Similarity check**, text answers (assignment text and essay quiz answers) are compared with other students' answers to the same work, and optionally the school's other work from recent terms (**Settings → Similarity check**: what to compare with, how many recent terms, and the marker threshold, 40% by default).

- It is **a prompt to look, not a verdict.** Quoting the same source, common phrases or agreed group work all match. It never changes a mark, and **students never see it**.
- In the roster, a small "Similar to 2 submissions · 62%" link appears under a student only above the threshold. It opens the list of matches and a side-by-side view with the shared passages highlighted. For work from a course you do not teach, the other student's name and the rest of their text are hidden; only the shared passages show.
- Texts under about 50 words are not checked, and anything also in the work's instructions (or an essay question's prompt) is ignored, so quoting the question is not a match.
- Nothing leaves the school: there is no external database. Fingerprints are deleted with the submission.

## The gradebook

**Grades** shows every student against every published piece of work, grouped by assignment group, with each student's percentage and letter (from the course's grade scale, or the school default). Hover a total for the per-group breakdown. **Export** downloads a CSV.

### Importing marks

**Import** next to Export takes a CSV back - the easiest way is to export, fill in marks in a spreadsheet, and import the same file.

- Students are matched by the **Student ID** column the export includes (or an Email column, or first and last name). Work columns are matched by their titles. Other columns, like totals and letters, are ignored.
- A number sets the mark, **EX** excuses the student, and a blank cell is left alone.
- You see every change - who, which work, the mark now and the new one - and any problems (a mark over the points, a name that matches two students) before anything is saved. A file with problems cannot be imported until they are fixed.
- Only cells that differ from the current mark are changed, so quizzes keep their automatic scores unless you typed a different number in.
- Everything in the file is saved together, or nothing is.

Grades are worked out from the marks each time, so correcting a mark changes the grade immediately. Unmarked work does not count yet: the grade is the student's grade *so far*. Scores and percentages are shown to two decimal places.
