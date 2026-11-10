---
sidebar_label: Analytics
sidebar_position: 16
---

# Analytics

GradeBook shows how work is going in each course and across the school:
**submission rates**, **grade distributions**, **averages by assignment group**,
a **weekly trend** and the **students who may need support**, each with a CSV
download.

Analytics are **on by default**. Your organisation or a school admin can switch
them off in **Settings → Features**. Students and parents never see them.

## Course analytics (teachers)

Open a course and choose **Analytics**. Every teacher and teaching assistant of
the course sees it. The figures are worked out when you open the page, so they
are always current.

- **Overview**: students, average and median grade, submission rate (with late
  and missing counts), attendance over recent weeks (when attendance is on) and
  the number of students at risk.
- **Students at risk**: each student who meets one of the school's rules, with
  the reasons written out (for example "Current grade 52.3% is below 60%" or
  "3 pieces of work missing in the last 4 weeks").
- **Submissions per activity**: handed in on time, late and missing, and the
  submission rate, plus the median mark and the middle half of marks.
- **Course grade distribution**: students' current grades in 10-point bands,
  with median and quartiles. **Marks for one activity** does the same for a
  single piece of work.
- **Average by assignment group**, and the **weekly trend** of the average mark.

Grades are the same "current grade" the gradebook shows: only marked work
counts, drop rules apply and late penalties are included.

### How work is counted

| A student's work is… | When |
| --- | --- |
| **On time** | Handed in (or marked) by their due date. An extension counts as their due date. |
| **Late** | Handed in after their due date (in a late window). |
| **Missing** | Not handed in and their due date has passed. |
| **Not yet due** | Not handed in, but not due yet (or no due date). Not counted. |
| **Excused** | Left out completely. |

The **submission rate** is on time plus late, out of on time plus late plus
missing. **Offline work** (marked on paper) is never "missing"; it counts once
you enter a mark.

## School analytics

**Analytics** in the dashboard sidebar shows every course and teacher side by
side. It needs the **View school analytics** permission (`analytics:read`):
admins have it, and you can add it to a custom role on the **Roles** page.
Anyone holding it can also open any course's Analytics tab from the course list
on this page.

- **Totals**: courses, enrolments, average grade, submission rate, attendance
  and the number of students at risk.
- **Courses** and **Teachers**: average grade, submission rate, attendance and
  at-risk counts. A teacher's figures combine all their courses (a large course
  counts for more than a small one).
- **Students at risk**: one row per student and course with the reasons.
- Filter by **academic year** and **term** (courses are matched by the year and
  term set on the course).

The school page reads figures the server **refreshes every hour**; the page
says when they were last updated. **Refresh now** starts a refresh straight
away (it takes a minute or so for a large school).

### What school analytics show

Courses and teachers are shown as counts and averages only. The at-risk list is
the one place that names students from courses you do not teach, which is why
it needs the analytics permission. Give that permission only to staff who
should see it (for example heads of year).

## The at-risk rules

A student is at risk when **any** rule applies. Admins (anyone who can change
school settings) set them at the bottom of the school Analytics page. Leave a
box empty to switch that rule off.

| Rule | Default |
| --- | --- |
| Current grade below | 60% |
| Missing work, at least | 3 pieces in the window |
| Window | 4 weeks (for missing work and attendance) |
| Attendance below | 90% in the window (only when attendance is on) |
| Average mastery below level | 2 (only when mastery is on) |

A rule with nothing to go on never applies: a student with no marks yet is not
at risk for their grade. Course pages use new rules at once; the school page
after the next refresh (saving starts one).

## Downloads

Every table has a **CSV** button: on a course, activities, grade distribution,
group averages, weekly trend and students at risk; on the school page, courses,
teachers and students at risk. Names and titles that look like spreadsheet
formulas are made safe.

## Accessibility

Every chart has a written summary above it and a **Chart / Table** switch that
shows the same numbers as a table. Charts use a single colour and print their
values, so nothing depends on telling colours apart.
