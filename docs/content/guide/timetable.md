---
sidebar_label: Timetable and automatic attendance
sidebar_position: 10
---

# Timetable and automatic attendance

With a timetable, GradeBook knows when each class meets and in which room. At
the start of every period it **opens attendance check-in by itself**, using the
room's saved location for the location check, and closes it when the period
ends; anyone who has not checked in by then is marked absent, exactly as when a
teacher opens attendance by hand. Teachers can cancel or move a single period,
and students see their week.

The timetable is **off by default**. Your organisation makes it available and a
school admin turns it on in **Settings → Features** (it needs Attendance on).

## Setting it up (school admins)

Open **Timetable → School setup**. You need the *Edit school settings*
permission to change anything here.

1. **Time zone.** Every time in the timetable is local to your school. Choose
   your school's time zone first: until you do, GradeBook uses UTC and periods
   would open at the wrong time. Clock changes (summer time) are handled for
   you.
2. **School days and cycle.** Choose the weekdays your school is open. Pick a
   **weekly** timetable (the same every week) or a **rotating** one of 2-20
   days (for example a two-week, ten-day cycle). For a rotating timetable, set
   the date of **day 1**; the preview shows which cycle day each date is.
   Weekends and closures do not count, so the cycle picks up where it left off
   after a holiday.
3. **Bell schedule.** Add the periods of the day (Period 1, Break, Period 2…)
   with their start and end time **for each weekday**. A shorter Friday is just
   different Friday times; leave a weekday empty if the period does not run
   that day.
4. **Rooms.** Add your rooms. To use a room for the location check, stand in it
   and press **Use my current location**, then choose a radius (50 m is a good
   start). A room without a location gets no location check.
5. **Holidays and closures.** Add each holiday or closure (one day or a date
   range). Nothing is scheduled on these days.
6. **Automatic check-in.** Choose whether sessions open automatically, how many
   minutes before the period they open (0-30), whether students need the room
   code, and after how many minutes from the start of the period a check-in
   counts as late.

## A course's timetable (teachers)

In a course, open **Timetable** and add a slot for each lesson: the period, the
weekday (or cycle day), and the room. If a slot only applies for part of the
term, give it dates; they must be inside the course's term. TAs can see the
timetable but not change it.

The course must be **published** for attendance to open.

## Today (teachers)

**Timetable** in the sidebar shows your periods for the day, with the room and
whether check-in has opened. Open a period's session to show the QR code and
the room code, mark students by hand, or close early - everything works as on a
session you opened yourself.

To change a single lesson before it starts:

- **Cancel** it (for example for a trip) - no check-in opens and students see
  it as cancelled, with your note;
- **Move** it to another time, day (within a month) or room - check-in opens at
  the new time, in the new room;
- **Restore** undoes either.

Once check-in for a period has opened, you can't cancel or move it any more:
close or delete that session instead. If a session was already open in the
course when the period started (for example one you opened by hand), the
automatic one is skipped for that period.

### Location

The automatic session uses the **room's saved location** as the check-in point.
If you are teaching somewhere else, open the session and turn on **Share my
location**: the point then follows your device, as for a session you open
yourself. The location check is advisory - the room code and QR code are the
proof of presence (see [Courses → Attendance](courses.md#attendance)).

## Students

Students see **Timetable** in the student portal (web and app): their week,
period by period, with the room and any cancelled or moved lessons. Check-in
works as before: when a period starts they get the usual "Attendance is open"
notification.
