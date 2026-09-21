---
sidebar_label: Setting up your school
sidebar_position: 3
---

# Setting up your school

Mostly an administrator's job, done once at the start and touched lightly thereafter. **Do it in this order** — each step depends on the one before, and the commonest support question is really a missed step further up.

## 1. Academic calendar

**Academic Calendar** holds years and the terms inside them. Nothing else can exist without a year: classes belong to one, and marks belong to a term.

Create the year first (e.g. 2026/2027), then its terms. Most schools use three. A year is marked **active** or **inactive**, which is how the app knows what "now" means — remember to activate the new one when it starts.

> Terms are not optional. Work is set for a term, and a report card covers one. A year with no terms gives you classes you cannot mark.

## 2. Subjects

**Subjects** lists what your school teaches — Mathematics, English, and so on. They belong to the school, not to a year, so this is a once-and-done list you extend as the curriculum changes.

Keep names as they should appear on a report card; this is the name parents read.

## 3. Grade scales

**Grade Scales** decides how a number becomes a letter — 80–100 is an A, and so on. Set one as the **default** and it applies everywhere unless something overrides it.

Marks are always stored as numbers. The scale is presentation only, so correcting a band later re-letters existing results rather than altering anyone's marks.

## 4. Staff and roles

**Staff** lists teachers and administrators, and is where join requests are approved.

**Roles & Permissions** (administrators only) is for when the three built-in roles do not fit. A custom role is a name plus a set of permissions, each of which is a plain pair — view students, edit grades, delete classes. Assign it to staff like any other role.

Two things worth knowing before you build one:

- Permissions grant **access to a kind of thing**, not to particular classes. "Edit grades" does not mean every class in the school: class ownership still applies on top. A teacher with grade permissions still only reaches their own classes.
- Removing a permission takes effect immediately. Menu items vanish for that person on their next page load.

## 5. Students

**Students** is the roster: names, dates of birth, and the details that appear on a report card. There are two ways a student gets onto it.

### Staff add them

Add each student directly. This is the reliable route — you control the spelling, and the record exists before the student ever signs in.

### Students join themselves with a code

**School join code** issues one code for the whole school, valid for a number of days you choose. Give it to students; they redeem it when they first sign in.

The code is shown **once**, at the moment you issue it. It is not stored anywhere you can read it back — the page will only tell you whether a code is active and when it lapses. Copy it then; if you lose it, revoke and issue a new one.

Revoke it when intake is over. A live code is the one credential in the system that lets someone in without staff action.

### Merging duplicates

If a student joins with the code and the roster already held a record under their name, you end up with two: the record with their history, and an empty one created at join time. The Students page surfaces these for an administrator to **merge**.

Merging moves their login onto the record that holds their grades and drops the empty one. Nothing blocks the student in the meantime — they are already using the app — but merge promptly, because marks recorded before the merge land on whichever record their login currently points at.

## 6. Classes

Create classes under **Classes**. Each belongs to an academic year and has:

- a **class teacher**, who owns the roster and the report books;
- **subjects**, each with the teacher who takes it;
- **students**, enrolled into it.

Teachers can create classes themselves; they do not need an administrator for this.

See [Classes and attendance](./classes.md) for the day-to-day of running one.

## A setup checklist

1. Academic year created and **active**, with its terms.
2. Subjects listed.
3. A default grade scale.
4. Staff approved and given roles.
5. Students on the roster — added by staff, or joined by code with duplicates merged.
6. Classes created, each with a class teacher, its subjects and its students.

Once these are true, teachers can set work and the term will calculate.
