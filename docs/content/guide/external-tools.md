---
sidebar_label: External tools (LTI)
sidebar_position: 12
---

# External tools (LTI 1.3)

GradeBook can launch external learning tools that support **LTI 1.3**
(simulations, practice platforms, publisher content and so on). Students open
a tool from a course module and arrive signed in as themselves; tools that
support **Assignment and Grade Services** can send scores straight back into
the gradebook.

The feature is **off by default**, because data leaves the platform when a
tool is launched (see [What is shared](#what-is-shared-with-a-tool)).

## Turning it on

1. An organisation admin turns on **External tools (LTI 1.3)** in
   **Organisation → Features**.
2. Each school can switch it off again under **Settings → Features** (a
   school can never switch it on when the organisation has it off). While it
   is off for a school, its teachers cannot add tools, launches are refused
   and tools cannot read or write that school's grades.

## Registering a tool (organisation admins)

Open **Organisation → External tools**. Registering, changing or removing a
tool asks you to confirm it's you with an emailed code, like other
integration settings, and every change is recorded in the organisation
audit log.

1. **Copy GradeBook's values into the tool.** The page shows what the tool's
   administrator needs:

   | Value | What it is |
   | --- | --- |
   | Issuer (platform ID) | GradeBook's API address, e.g. `https://api.example.com` |
   | Client ID | Issued by GradeBook when you register the tool (one per tool) |
   | Deployment ID | Issued by GradeBook; one for "every school", or one per school |
   | Authentication (OIDC auth) URL | `<issuer>/api/lti/auth` |
   | Public keyset (JWKS) URL | `<issuer>/api/lti/jwks` |
   | Access token URL | `<issuer>/api/lti/token` (only needed for grade passback) |

   Most tools ask for the issuer, client ID, deployment ID and the three URLs.
   You get the client ID and deployment ID after step 2, so you may need to
   come back to the tool's settings once.

2. **Enter the tool's values in GradeBook.** Select **Register tool** and
   fill in what the tool's documentation gives you:
   - **Login initiation URL**: where GradeBook starts a launch (OIDC login).
   - **Launch URL** (target link URI): the page the tool opens.
   - **Redirect URLs**: every URL the tool may receive a launch at, one per
     line. A launch is only ever posted to one of these, exactly as written.
   - **Public keyset URL** of the tool, or paste its **public key** (PEM, RSA
     2048 bits or more). GradeBook only fetches the keyset from public
     internet addresses.
   - **Grade passback**: turn on if the tool sends scores (Assignment and
     Grade Services).
   - **Privacy**: whether to send each user's **name** and **email** (both off
     by default).
   - **Custom parameters** the tool asks for, as `name=value` lines.
   - **Schools**: every school, or only the ones you choose. Each school
     choice gets its own deployment ID.

You can switch a tool off at any time: launches stop, its grade tokens stop
working, and students no longer see its items. A tool that is used in course
modules cannot be deleted until those items are removed; switch it off
instead.

**Rotate platform key** creates a new signing key. The old one stays in the
published keyset for seven days so tools that cached it keep working.

## Adding a tool to a course (teachers)

In a course's **Modules**, choose **Add item → External tool**, pick a tool
your school can use, give the item a title and, if the tool asks, custom
parameters. For a tool with grade passback you can set **Points**: GradeBook
then creates a published gradebook column (offline work) for it, and the
tool's scores land there.

Copying or importing a course does not copy external tool items.

## Opening a tool

Students and staff select the item; the tool opens in a new tab (on the
mobile app, in the in-app browser). Each launch link works once and only for
a few minutes.

GradeBook tells the tool the user's course role: students are *Learner*,
teachers *Instructor*, teaching assistants *Instructor* and *Teaching
Assistant*, and school admins *Instructor* and *Administrator*.

## Grades from a tool

When the tool reports a score as fully graded, GradeBook scales it to the
column's points (for example 7 / 10 on a 20-point column is 14), rounds it to
two decimals, caps it at the column's points and saves it as the student's
mark, with the tool's comment as feedback. Scores the tool marks as pending,
in progress or failed do not change the gradebook. A teacher can still
change the mark by hand; the tool's next score will replace it again.

The mark is recorded as given by the teacher who added the tool to the
course (or, if they have left the course, its longest-serving teacher), and
the audit log notes that it came from the tool.

## What is shared with a tool

Every launch sends the tool:

- an **anonymous user ID** that is different for every tool (never the
  GradeBook account ID or the student number);
- the user's **role** in the course;
- the **course's** ID, name and code, and the item's title;
- the organisation's name;
- the custom parameters set for the tool and the item;
- with grade passback on, the addresses the tool uses to send scores.

Only if you allow it for that tool: the user's **name** and **email**.

With grade passback, the tool can read back the marks in **its own** columns
for users it has seen, and nothing else in the gradebook.
