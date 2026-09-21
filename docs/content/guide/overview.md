---
sidebar_label: Overview
sidebar_position: 1
---

# Using GradeBook

GradeBook is a school management system: rosters, attendance, classwork, marks and report cards, in one place. This guide is for the people who use it — administrators, teachers and students — and assumes nothing technical.

## Two ways in

Everything below works the same in a browser and in the mobile app. Use whichever suits the moment: most staff set up the year on a laptop and take attendance on a phone.

## Who can do what

Your **role** decides what you see. Menu items you have no permission for do not appear at all, so a shorter menu is normal rather than a fault.

| Role | Typically | Can |
| --- | --- | --- |
| **Administrator** | The person who set the school up | Everything, including staff, roles, subjects, the academic calendar and grade scales |
| **Teacher** | Classroom staff | Their classes: attendance, work, marks, reports, announcements, files and messages. Can create a class |
| **Member** | Other staff | Read-only visibility into the structures they belong to, plus their own files |
| **Student** | Learners | Only their own work, grades, attendance and reports — nothing about anyone else |

Administrators can also build **custom roles** if these three do not fit; see [Setting up your school](./school-setup.md).

Two rules underpin the rest of this guide:

- **A class has one class teacher**, who owns the roster, the report books and anything that commits the class as a whole.
- **Subject teachers** are assigned to a subject within a class. They can set and mark work for their own subject and read the class's reports, but cannot change the roster or generate report books.

Students hold no permissions at all. They cannot be given any, by design — the student portal is a separate surface that only ever shows one person their own record.

## How a year fits together

The pieces stack, and each one depends on the one above it. Setting them up out of order is the most common reason something "will not let you" later.

```
School
└── Academic year          e.g. 2026/2027
    ├── Terms              Term 1, Term 2, Term 3
    └── Classes            Form 1A, Form 2B
        ├── Students       enrolled in the class
        ├── Subjects       taught in the class, each with a teacher
        └── Work           quizzes and assignments, per subject per term
            └── Marks      which become the term grade, then the report card
```

Subjects and grade scales belong to the school rather than to a year, so they are set up once and reused.

## Where to start

- Brand new school → [Accounts and signing in](./accounts.md), then [Setting up your school](./school-setup.md).
- Joining a school that already exists → [Accounts and signing in](./accounts.md).
- Teaching a class that is already set up → [Classes and attendance](./classes.md) and [Work and grading](./work-and-grading.md).
- A student → [The student portal](./student-portal.md).
