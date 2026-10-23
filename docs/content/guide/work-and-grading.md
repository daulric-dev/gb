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

### Quiz questions

- **Multiple choice** - several options, one correct.
- **True or false**.
- **Short answer** - checked against the answers you accept, ignoring capitals and extra spaces. List every reasonable wording; students never see them.

**Attempts** sets how many tries a student gets (`0` is unlimited).

## Publishing

**Publish** makes the work visible to students. **Questions lock at publish** - changing them afterwards would silently rescore work already handed in. Title, instructions, due date and points stay editable. **Close** stops new submissions without hiding anything.

## Marking

Open the work to see every student in the course, whether they handed in or not.

- **Quizzes** mark themselves.
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
