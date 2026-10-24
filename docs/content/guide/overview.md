---
sidebar_label: Overview
sidebar_position: 1
---

# Using GradeBook

GradeBook is a learning platform for schools: teachers build **courses** out of modules, pages, assignments and quizzes, take attendance, and keep a gradebook; students do their work, check in to class and follow their grades. This guide is for the people who use it - administrators, teachers and students - and assumes nothing technical.

## Two ways in

Everything works in a browser. The mobile app covers what you do on the move: students get the full course - modules, pages, files, work and quizzes, grades, announcements, discussions and attendance - check in to class (including by scanning the QR code on the board), and get notifications for attendance, new work and announcements; teachers can mark work (with rubrics), post announcements, take part in and moderate discussions, read the gradebook and roster, publish or unpublish modules, and take attendance. Building a course - modules, pages, quizzes, rubrics - is done on the web.

## Who can do what

Your **role in the school** decides what you see in the menu; a shorter menu is normal rather than a fault.

| Role | Typically | Can |
| --- | --- | --- |
| **Administrator** | The person who set the school up | Everything: every course, staff, roles, the academic calendar, grade scales, email domains and sign-in settings |
| **Teacher** | Classroom staff | Create courses and run their own; announcements, files, messages |
| **Member** | Other staff | See the school's structure, use files and messages |
| **Student** | Learners | Their own courses, work, grades and attendance - nothing about anyone else |

Administrators can build **custom roles** if these do not fit; see [Setting up your school](./school-setup.md).

Inside a course, what you can do depends on your **role in that course**, not your school role:

| In a course | Can |
| --- | --- |
| **Teacher** | Everything: content, people, settings, marking, attendance, deleting |
| **TA** | See everything, mark work, take attendance, post announcements - but not change settings or people, or delete |
| **Student** | Published content, their own work, grades and attendance |

Whoever creates a course is its teacher. Administrators can manage every course in the school.

## How it fits together

```
School
├── Academic years and terms        optional - a course can belong to one
├── Courses                         e.g. Biology 101
│   ├── People                      teachers, TAs, students
│   ├── Modules                     ordered sections of the course
│   │   └── Items                   pages, assignments, files, links, headings
│   ├── Assignments and quizzes     grouped into weighted assignment groups
│   ├── Announcements
│   ├── Attendance                  check-in sessions
│   └── Grades                      the gradebook
└── Email domains and sign-in       how people join and sign in
```

Grade scales belong to the school and turn a course percentage into a letter.

## Where to start

- Brand new school → [Accounts and signing in](./accounts.md), then [Setting up your school](./school-setup.md).
- Teaching → [Running a course](./courses.md) and [Work and grading](./work-and-grading.md).
- A student → [The student portal](./student-portal.md).
