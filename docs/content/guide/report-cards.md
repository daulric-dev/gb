---
sidebar_label: Report cards and transcripts
sidebar_position: 6
---

# Report cards and transcripts

At the end of each term GradeBook can produce a printable report for every
student: their courses with the final grade and letter, each teacher's
comment, an attendance summary and a comment from the head teacher or form
tutor. Students download their published reports as PDFs, and can see a
transcript of every published term.

Report cards are on by default. Your organisation can make them unavailable,
and a school admin can switch them off in **Settings → Features**. While they
are off, every report card page and download is unavailable.

## How terms and grades work

A report belongs to a **term** from the academic calendar.

- A course set to a term appears on that term's reports, graded on its whole
  gradebook.
- A year-long course (an academic year but no term) appears on every term
  of that year. Its grade on each report counts only the work due by the end
  of that term, so the autumn report is not affected by spring work.
- Draft courses and templates never appear. Students who dropped a course
  are left off it.

The final grade is the same "current grade" the gradebook shows: only marked
work counts, excused work and work omitted from the final grade are left out,
and group weights and drop rules apply. The letter comes from the course's
grade scale, or the school's default scale.

The attendance summary counts present, late, absent and excused check-ins
from sessions held during the term. It never includes location details.

## Teachers: writing comments

1. Open the course and choose **Report comments**.
2. Pick the term if the course runs across several.
3. Write a comment for each student (up to 2,000 characters) and tick
   **Ready** when it is final. **Mark written ready** ticks every comment that
   has text.
4. Select **Save**. Only the rows you changed are sent.

The term grade is shown next to each student. If the school set a comment
deadline it is shown at the top; it is a reminder and does not lock the table.

Teaching assistants can read the comments but not change them. Once a term's
reports are published, comments are locked until an admin unpublishes them.

## Admins: reviewing and publishing

Open **Dashboard → Report cards**. Viewing needs the `report-card:read`
permission; publishing and head comments need `report-card:update`. School
admins have both and can grant them to a custom role.

- **Completion by course:** how many comments are ready, still drafts or
  missing for each course, with its teachers.
- **Comment deadline:** set or clear the date teachers should finish by.
- **Head comments:** write the head teacher or form tutor comment for each
  student and select **Save head comments**.
- **Preview:** opens any student's report as it would look now, marked
  "Preview".
- **Publish:** students see the term's reports straight away, and a PDF is
  made for every student in the background. The confirmation warns you about
  missing or draft comments first.
- **Unpublish:** hides the reports from students again and unlocks comments.
  Publishing again makes fresh PDFs.
- **Downloads:** each student's PDF, a zip of one course (class), or a zip of
  the whole term. Students whose PDF is not ready yet are listed in a
  `missing.txt` file inside the zip.
- **Retry failed:** generates the failed PDFs again.
- **Transcript:** any student's transcript across every term, published or
  not.

Each publish and unpublish is recorded in the audit log. On a large school
PDFs take a little while; the dashboard shows how many are ready, generating
or failed, and the refresh button updates it.

## Students

On the web, choose **Reports** in the portal. In the app, open **Grades** and
tap **Reports**. Each published term is listed; select **Download** (or
**Open** in the app) to get the PDF. A report that is still being prepared
says so. The **Transcript** shows every published term with its courses,
grades and letters, and can be downloaded as a PDF.

Students only ever see their own reports, and only for terms the school has
published.

## Parents

When the [parent portal](./parent-portal.md) is on, parents see the same
published reports and transcript for each linked child under **Reports** (web
and app), unless the school turns off **Published report cards and
transcript** in **Settings → What parents see**. Parents never see a term
before it is published, and lose it again if it is unpublished.

## Good to know

- With [mastery](./mastery.md) on, a school can add an **outcomes section**
  (Settings → Mastery setup → *Show an outcomes section on report cards*):
  each course then lists its learning outcomes with the student's level and
  whether mastered. Grades are not affected.

- Branding comes from your school name and logo (**Settings**). PNG and JPEG
  logos appear on the PDF. A WebP logo is converted when the server has the
  image converter (`sharp`) installed, and is otherwise left off; ask your
  administrator, or upload the logo as PNG.
- Names and comments print as written in Latin scripts (including accented
  and Vietnamese letters), Greek and Cyrillic. Other scripts, such as
  Chinese, Japanese, Korean or Arabic, print as a replacement mark unless the
  server is given an extra font (`REPORT_PDF_EXTRA_FONT`, see
  [environment variables](../environment-variables.md)).
- If the server restarts while PDFs are being made, it carries on by itself
  within about a quarter of an hour; nothing needs to be published again.
- Download links GradeBook creates for a report are private, last five
  minutes and stop working as soon as the term is unpublished.
