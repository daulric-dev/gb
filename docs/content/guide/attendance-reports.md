---
sidebar_label: Attendance reports and alerts
sidebar_position: 11
---

# Attendance reports and alerts

GradeBook works out an **attendance percentage** for every student, course and
the whole school over any date range, with a CSV download, and can **alert** a
student's form tutor, the school's admins and (if you use the parent portal)
their parents when attendance drops below the levels your school sets.

This is **off by default**: your organisation makes it available and a school
admin turns it on in **Settings → Features** (it needs Attendance on).

## How the percentage works

Present and late both count as attending. Absent counts against. **Excused**
does not count either way. So 8 present, 1 late, 1 absent and 2 excused is
9 out of 10: **90%**. A student is only measured over the sessions they have a
record in, so joining a course halfway through is not counted as absence.
With nothing to count, the percentage shows as "-".

Dates are days in your school's time zone (set in **Timetable setup**). Until
an admin sets it, days are counted in UTC and the reports show a "School time
zone not set" warning.

## Reports (staff)

Open **Attendance** in the sidebar and pick a date range (the last four weeks to
start with).

- **School**: the overall percentage, each course and each student (lowest
  first is easy to sort to), with open alerts marked. Needs the *View
  attendance reports* permission (`attendance-report:read`; admins have it).
  *View report cards* alone does not give it.
- **A student**: their percentage per course, every session in the range, and
  their alert history. Staff with *View attendance reports* can open any student;
  a **form tutor** can open their own tutees.
- **A course**: from the course's **Attendance** tab, the course's students
  over the range (any of the course's staff).

Upgrading: attendance reports used to be gated on *View report cards*. Every
custom role that had *View report cards* was given *View attendance reports*
too, so nobody lost access; remove it from a role on the **Roles** page if
that role should see report cards but not attendance.

Each has **Download CSV**. Values that a spreadsheet might run as a formula are
neutralised.

## Alerts

In **Attendance → Alert settings** (needs *Edit school settings*) choose:

- **Below a percentage**, for example **below 90% over the last 4 weeks**. A
  student needs a minimum number of sessions in that window (5 by default)
  before they are judged, so one missed lesson in a quiet week is not "0%".
- **Absences in a row**, for example **3**. Excused sessions are skipped; a
  present or late check-in ends the run.
- Who is told: the **form tutor**, the school's **admins**, and **parents**;
  and whether staff also get an **email**.

GradeBook checks every hour. A student who falls below a level gets **one**
alert; nobody is told again while it stays that way. The alert closes by itself
once the student is back at or above the level (or attends again, for absences
in a row); if they fall below again later, that is a new alert and people are
told again.

Open alerts are listed on the Attendance page. **Acknowledge** one to show
you have seen it (it stays open until the student recovers).

### Form tutors

In **Attendance → Form tutors** (needs *Edit students*) choose students and a
member of staff as their form tutor. The tutor gets their tutees' alerts and
can open their reports.

### Parents

When the [parent portal](parent-portal.md) and parent notifications are on, your
school shows attendance to parents, and **Tell parents** is on, parents who
chose **Attendance alerts** in their notification settings get an email or push
notice with the alert. Each alert reaches a parent once. Parents also see the
percentage on their child's Attendance page.

## Students

Students see their own percentage, overall and per course, on **Attendance** in
the student portal, and in each course's Attendance tab.
