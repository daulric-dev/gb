---
sidebar_label: Two-step verification
sidebar_position: 19
---

# Two-step verification

Two-step verification adds a code from an **authenticator app** on your phone
(Google Authenticator, Microsoft Authenticator, 1Password, Authy and similar)
to signing in. Someone who gets hold of your email cannot sign in as you
without your phone.

Anyone can turn it on. The organisation can make it **compulsory for
administrators and safeguarding staff**, and it is compulsory for them by
default.

## Setting it up

On the website, open **Settings** (organisation admins: **Organisation →
Account**) and find **Two-step verification**.

1. Choose **Set up authenticator app**. GradeBook asks you to confirm it's you
   with a code sent to your email.
2. Scan the QR code with your authenticator app (or type in the key shown
   under it). The app lists the account as *GradeBook* unless your server
   uses another name.
3. Enter the 6-digit code the app shows. You have 15 minutes; after that,
   start again.
4. GradeBook shows **ten recovery codes**, once. Print them or store them in
   a password manager. Each works once, in place of a code from the app.

You get an email whenever two-step verification is turned on, replaced or
turned off on your account.

## Signing in

After the emailed code, GradeBook asks for the 6-digit code from your app.
The code step lasts 5 minutes. The mobile app asks for it too.

- Lost your phone? Choose **Lost your phone? Use a recovery code** and enter one of
  your recovery codes. You are emailed when one is used, with how many are
  left. Then set the app up again on your new phone.
- Too many wrong codes: after 5 wrong codes, start the sign-in again; after
  10 wrong codes in a row, codes are locked for 15 minutes.

## Managing it

In the same card you can:

- **move it to a new phone**: set up the new app; the old one keeps working
  until the new one is confirmed;
- **get new recovery codes**: the old ones stop working at once;
- **turn it off**: with a current code or a recovery code. Not possible while
  the organisation requires it for your role.

## Single sign-on

If you sign in with Google, Microsoft or your school's own sign-in, your
identity provider usually asks for its own second factor. GradeBook cannot
see whether it did. What GradeBook does:

- If the organisation requires two-step verification for your role **and**
  you have set up an authenticator app, GradeBook asks for its code after
  single sign-on as well.
- If you have not set up an app, single sign-on lets you in without one, even
  where the organisation requires it. Your identity provider's multi-factor
  rules are then the only second factor, so the IT team should enforce MFA
  there for every staff account.
- If the organisation does not require it for your role, single sign-on never
  asks for the GradeBook code; signing in with an emailed code does.

## For organisation administrators

### The requirement

**Organisation → Settings → Two-step verification**: *Require an
authenticator app for admins and safeguarding roles*. On by default. It
covers:

- organisation administrators;
- each school's administrators;
- anyone whose role (built-in or custom) includes the **Safeguarding**
  permission for pastoral notes, in any school.

It does not cover other teachers or staff; they can turn it on themselves.

What it does:

- A covered person who **has an app** is asked for its code at every new
  sign-in, by emailed code or single sign-on, and cannot turn it off.
- A covered person **without an app** who signs in **with an emailed code**
  can do nothing except set one up (or sign out) until they have.
- A covered person without an app who signs in **with single sign-on** is not
  stopped (see above).
- It takes effect at each person's **next sign-in**. Sessions already open
  when you turn it on, or when someone is given a covered role, carry on
  until they end; staff sessions end after 7 days without use and 30 days at
  most by default. To apply it at once, use **Sign out sessions** for the
  people concerned.
- "Confirm it's you" prompts for sensitive actions always use an emailed
  code, not the authenticator.

Turning the requirement off or on is recorded in the audit log.

### Resetting someone's app

When someone has lost their phone and their recovery codes, an organisation
administrator can **Reset two-step** for them. The console shows
the button next to organisation administrators (**Organisation → Admins**) and
each school's administrator (**Organisation → Schools** → a school); for other
people, the server's `POST /api/organisation/users/:userId/mfa/reset` route
does the same. School administrators cannot reset it.

A reset removes the app and the recovery codes. The person is emailed, and
the email names who reset it. They sign in with an emailed code and, if the
requirement covers them, must set up a new app before doing anything else.
**Check who is asking** (in person, or by calling a known number) before
resetting: a reset is exactly what someone trying to take over an account
would ask for.

### What is recorded

Every set-up, replacement, new recovery codes, turning off, reset, and every
code accepted, rejected or locked at sign-in is in the organisation's audit
log as *user_mfa*. Authenticator secrets are encrypted in the database and
recovery codes are stored only as one-way hashes; neither ever appears in an
export or the audit log.

Technical details: [`backend/src/mfa/README.md`](../../../backend/src/mfa/README.md).
