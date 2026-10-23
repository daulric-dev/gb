---
sidebar_label: Running a course
sidebar_position: 4
---

# Running a course

**Courses** lists the courses you teach or assist in (administrators see all of them). **New course** asks for a name, an optional code, a description and, if you like, the year and term. You become its teacher.

A course starts as a **draft**: students cannot see it. **Publish** it when it is ready, and **archive** it at the end - archived courses stay readable for students but take no more work or attendance.

Inside a course the tabs are **Home, Modules, Assignments, Pages, Announcements, Discussions, People, Attendance, Grades, Settings**.

**In the mobile app**, **More → Courses** (or a course on the dashboard) opens the same course with **Marking, Modules, Announcements, Discussions, Gradebook and People**. Modules are read-only there apart from a publish switch per module; pages open read-only; announcements can be posted, edited and deleted; discussions work as on the web, moderation included; the gradebook is read-only (tap a student for their breakdown, then a piece of work to mark it). **Take attendance** sits at the top of a published course. Creating or editing modules, pages, quizzes, rubrics and settings stays on the web, and the app says so where it applies.

## Modules and pages

**Modules** are the course's sections - Week 1, Unit 2. Each holds items in order: a **page**, an **assignment or quiz**, a **file**, a **discussion** topic, an external **link**, or a **heading** to break it up. Drag to reorder, indent items under a heading, and publish modules one at a time; students only see published modules and published items. A file you link in a published module opens for every enrolled student - you do not need to share it with them separately - and for the course's other teachers and TAs, even though it is in your Files: click it in Modules. A discussion item opens the topic; students only see it once the topic is published.

**Pages** are written in Markdown - headings, lists, tables, links. Use **Preview** to check how it reads.

## People

- **Staff** - add colleagues as **Teacher** or **TA**. A course always keeps at least one teacher.
- **Students** - add them from the school roster, or turn on the **join code** and give it to the class; they enter it under **Join a course**. Regenerate the code to cut off the old one, or turn it off.

Removing a student who already has work in the course keeps their marks; adding them back restores them.

## Announcements

Course announcements go to the course's students and staff, and are separate from school-wide announcements. They are written in Markdown.

Posting one in a published course notifies its active students: a push on the app and an entry under the bell in the portal. So does **publishing** an assignment or quiz. Students are told once per piece of work, so closing and reopening it does not notify them again.

The **Calendar** in the dashboard sidebar shows due dates across every course you teach or assist, drafts included (dashed), so you can see when work bunches up. **Export .ics** downloads the visible month.

## Discussions

**Discussions** is the course's forum. Teachers and TAs start a **topic** - a title and a Markdown prompt - and everyone in the course replies underneath. Replies can be answered once more, so a conversation stays one level deep rather than wandering off to the right.

When you start or edit a topic you can set:

- **Published** - off keeps it as a draft only staff see.
- **Pinned** - keeps it at the top of the list.
- **Locked** - no more replies (a teacher can still add a closing word).
- **Post before seeing replies** - each student sees classmates' replies only after posting their own, so the first answers are their own thinking.

Everyone can edit or delete their own posts. Teachers and admins can edit or delete anyone's, and lock or pin any topic; TAs manage only their own. A deleted reply that others have answered stays as *"This post was deleted"* so the answers keep their place.

The list shows each topic's reply count and how many replies are new since you last opened it. Students are notified when a topic is published, and when someone replies to a topic they started or posted in; staff get those reply notifications as a push in the app. Turn on **Students can start topics** above the list to let students open their own threads (off by default). An archived course's discussions stay readable but take no new posts.

## Attendance

1. Press **Take attendance**. Choose how long check-in stays open, whether a **room code** is needed, an optional "late after" time, and optionally **check location** (uses your device's position and a radius).
2. Students with the app get a notification; everyone sees a banner in the portal.
3. Show the screen: it has the 4-digit code and a **QR code that changes every 15 seconds**. **Present** makes it fullscreen for a projector. Students scan the QR (with their phone camera or the app) or type the code.
4. The list fills in as students check in. When time runs out, or you press **Close now**, everyone who has not checked in is marked **absent**.

You can change anyone's status - present, late, absent, excused - at any time, including after closing. The Attendance tab keeps every session, each student's attendance rate, and a CSV export.

Why it is hard to cheat: the code is never sent to students, the QR stops working seconds after it is shown, five wrong codes lock a student out of that session, and the location check refuses anyone too far from the room.

## Settings

Name, code, description, year and term, grade scale and status. **Delete** removes the course and everything in it; if students have handed in work, archive it first.

## Copying a course and templates

**Copy course** (Settings → Copy and templates) starts a new course from this one - next term's section, say. Give it a name, code, year and term, and choose what happens to due dates:

- **Keep** them as they are,
- **move every due date** by a number of days (negative moves them earlier),
- **move from the old start date to a new one** - GradeBook works out the gap in whole days, so a due time keeps its time of day, or
- **remove** them.

The copy is a new **draft** course and you are its teacher. It takes the description, grade scale, assignment groups (weights and drop rules), rubrics, pages, modules and their items, every activity with its quiz questions and rubric, and the discussion prompts staff wrote. Activities arrive as **drafts** so you can check dates before publishing them (publishing notifies students as usual); discussion topics arrive unpublished. Pages, modules and items keep whether they were published, so once you publish the course and its activities the layout is as you left it. Files linked from modules are the same files - nothing is re-uploaded.

Nothing about the old class comes along: no students, enrolments, submissions, marks, rubric scores, attendance, announcements, replies or topics students started. The join code is not copied; create one in People when you are ready.

**Import content** (also in Settings → Copy and templates) works the other way round: it brings another course's content into *this* one. Pick one of your courses (where you are a teacher or admin) or a school template, choose what happens to due dates as above, confirm, and you'll see how many modules, pages, activities and so on were added. Nothing in this course is replaced: the imported modules go after your own, activities arrive as drafts, and assignment groups with the same name are merged.

**Templates.** Turn on **School template** in Settings to offer a course to the whole school. Anyone who can create courses sees it under **New course → Start from a template** and gets their own copy, without needing a place in the template course. A template never takes students: it has no join code, enrolling is refused, and it never shows in the student portal. A course that already has students can't be made a template.

You need permission to create courses to copy one, and must teach the course (or be a school admin) unless it is a template.
