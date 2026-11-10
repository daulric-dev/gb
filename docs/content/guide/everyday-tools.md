---
sidebar_label: Files, messages and announcements
sidebar_position: 8
---

# Files, messages and announcements

The parts of GradeBook that are not about marks.

## Files

**Files** is your own storage plus anything shared with you.

Upload by choosing a file. Large files on a weak connection resume rather than restarting, so a dropped connection is not a lost upload.

**What you can upload:** PDFs, Word documents, spreadsheets, plain text, CSV, and images (PNG, JPEG, WebP). Up to 100MB each by default; your school's administrator can set a different limit in Settings.

Anything else is refused. So is a file whose contents do not match its name — renaming a program to `.pdf` does not get it in. Documents carrying macros and PDFs with embedded actions are refused too. If an upload is rejected and you believe the file is fine, re-save it from the application that made it; that usually clears whatever the original was carrying.

**Sharing** a file with a colleague notifies them, and it appears in their Files. You can share with a person, a role, or a whole course (its staff and students). You can stop sharing later. A file is reachable by its owner, the people it is shared with, and — for a student's submission — the course's teachers. Nobody else, including other administrators.

## Messages

**Messages** is direct messaging with others at your school. Pick a person and type.

Messages are encrypted where they are stored, and the unread count sits next to Messages in the menu.

Group channels are not available yet.

## Announcements

**Announcements** are school-wide notices — a staff meeting, a deadline, a policy change, a sports day. When you post one (or edit it), choose **Who can see this?**:

- **Staff only** (the default) — the staff notice board, as before. Staff see an unread marker until they have read it, and each post shows which staff have read it.
- **Everyone — staff, students and parents** — also shown to every student of your school (on their portal home and the **Announcements** page, and in the app's **Home**) and to parents in the parent portal, if your school has the parent portal on and shows parents announcements. Students get a push notification when it is posted; parents who turned on announcement notices get an email or push. Read receipts still count staff only.

Each post on the board is badged **Staff only** or **Everyone**. You can change a post's audience later; the change is recorded in the [audit log](./audit-log.md). Opening a staff-only post up to everyone notifies students then; narrowing it back to staff only hides it from students and parents straight away (notifications already sent cannot be recalled). Every announcement posted before audiences existed is **Staff only**.

For something one course needs to know, post a **course announcement** from inside the course - those reach its students (and, if the school shows them, their parents).

## Settings

Your name, profile picture and the school you belong to. Administrators (anyone who can change school settings) also see **School logo** here: upload a JPEG, PNG or WebP up to 2MB (square works best) and it replaces the GradeBook mark in the sidebar, the student portal header and the top of the mobile home screens for everyone in the school. Replace or remove it at any time. Your email address is your identity and is not editable here — an administrator changes it if it has to change.

The light/dark toggle is in the top corner of every page and follows your device by default.

### Deleting your account

**Danger Zone** at the bottom of Settings deletes your account. Read this before using it:

- It removes **your login**, not the school's records. Work students handed in and marks you entered stay where they are — a school's records are not one person's to withdraw.
- It cannot be undone. Signing up again with the same address gives you a new, empty account that has to be re-approved and re-added to courses.

GradeBook checks first and tells you if something has to be sorted out before you can go. The delete button stays off until it is:

| What you see | Why | What to do |
| --- | --- | --- |
| *Transfer ownership of the organisation before deleting your account* | You own the organisation (you set it up, or it was handed to you). | **Organisation → Settings → Ownership**: pick another organisation administrator and press **Transfer ownership**. You stay an administrator. |
| *You're the organisation's last administrator...* | Nobody else could run the organisation. | **Organisation → Administrators**: add someone first. |
| *Transfer ownership of &lt;school&gt; before deleting your account* | You own that school (you run it as its administrator). One line per school you own. | The school's **Settings → School ownership** (or, for organisation administrators, the school's page in the organisation console): pick a member of staff. They become the school's owner and administrator; you stay on as a teacher and can then leave or delete your account. |
| *You're the only administrator of &lt;school&gt;...* | The school has no owner and you are its only administrator, with other people still in it. | Hand it over the same way. |
| *Your account is managed by your school through Google / Microsoft / your school's single sign-on. Ask your school to remove it.* | You are a student who signs in with your school's account, so the account belongs to the school. | Ask your school. There is no delete button for these accounts. |

Each transfer asks you to confirm it's you with an emailed code, appears in the audit log, and emails both of you.

Staff and parents who sign in with Google, Microsoft or the school's single sign-on can delete their own accounts, and so can students who sign in with an emailed code.

If you are simply leaving the school, ask an administrator to remove your access instead. That is the reversible version.

**For schools: removing a student account managed by single sign-on.** Deactivate or remove the student in **Students**, and suspend them in your own identity provider (Google Workspace, Microsoft Entra or your SAML system); if your school requires single sign-on they can no longer sign in. An organisation administrator can also sign them out of every device. Erasing the login itself on a data-protection request is done by whoever runs your GradeBook server.

**In the mobile app** the same check runs: blockers are listed with where to fix them on the web (transfers are made on the website), and school-managed student accounts see a notice instead of the delete button. Apple requires apps to let people delete accounts they created in the app, which GradeBook does; accounts provisioned by a school through single sign-on belong to the school, which removes them.

## Using the mobile app

The app is for the moments away from a desk: students see their courses, to-do list and grades, and check in to class (with a notification when attendance opens, and a QR scanner); teachers can take attendance with the rotating QR on screen. Building courses and marking happen on the web.

A few differences worth knowing:

- **Pull down to refresh** on any screen that lists things.
- Signing in works exactly as on the web — email, then the 8-digit code.
- You stay signed in between launches. Sign out from the menu on a shared device.
- Large uploads resume after a dropped connection, same as the web.

If the app cannot reach the server it says so plainly — *"Can't reach the server. Check your connection."* That is a network problem rather than a sign-in problem, and it is worth checking your connection before trying another email address.
