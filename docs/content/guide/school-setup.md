---
sidebar_label: Setting up your school
sidebar_position: 3
---

# Setting up your school

An administrator's job, done once and touched lightly after. Teachers can start building courses as soon as they are in the school; nothing below blocks them except the grade scale, which decides the letters on grades.

## 1. Grade scales

**Grade Scales** turns a percentage into a letter - 90 and above is an A, and so on. Set one as the **default** and every course uses it unless the course picks another.

Marks are stored as numbers; the scale is presentation only, so editing a band re-letters existing grades without changing anyone's marks.

## 2. Academic calendar (optional)

**Academic Calendar** holds years and the terms inside them. A course can belong to a year, or to one term of it, so students and teachers can filter by "this term". Term names are whatever your school uses - Term 1, Fall 2026, Semester 2.

Mark the current year **active**.

## 3. Staff and roles

**Staff** lists teachers and administrators and is where join requests are approved.

**Roles** (administrators only) is for when the three built-in roles do not fit: a custom role is a name plus permissions (create courses, view students, edit the calendar, ...). Inside a course, the course role - teacher, TA or student - decides what someone can do there.

## 4. Email domains and single sign-on

**Email Domains** lets people with a school address join automatically.

1. **Add domain** - e.g. `srmss.edu.gd` - and say who uses it: **Students**, **Staff**, or **Students and staff**. For staff, choose whether they join straight away (as Teacher or Member) or ask for approval. On a shared students-and-staff domain, leave staff on approval so a student cannot make themselves a teacher by choosing "staff".
2. **Verify** - publish the TXT record shown (`gradebook-verification=...`) at your DNS provider, then press **Check now**. DNS can take up to an hour. A domain does nothing until it is verified, and once verified it belongs to your school only. Public addresses such as gmail.com cannot be added.
3. **Sign-in provider** (optional) - choose **Google**, **Microsoft** (enter your Microsoft tenant ID) or **SAML** (enter your identity provider's sign-on URL, entity ID and signing certificate; give your provider the metadata URL shown). Turn on **Require single sign-on** to stop email codes for that domain - then disabling someone's school account ends their access here too.

Which providers appear depends on how your GradeBook is set up; see [Single sign-on](../sso.md) for the technical side.

## 5. Students

**Students** is the roster. Staff do not add students: each student signs up, chooses "Student" during onboarding and joins, which puts them on the roster. They join by:

- **Signing up with a school email address** on a verified student domain;
- **The school join code** - issue one under **School join code**, valid for the days you choose. It is shown once; copy it then. Revoke it when intake is over.

You can still correct a student's details and mark them inactive from the Students page.

## A setup checklist

1. A default grade scale.
2. Staff approved and given roles.
3. Your email domains added and verified (and single sign-on, if you use it).
4. Students able to join with a school address or the join code.

Then teachers create courses: see [Running a course](./courses.md).
