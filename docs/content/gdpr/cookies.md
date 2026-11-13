---
sidebar_label: Cookies and device storage
sidebar_position: 5
---

# Cookies and device storage

The full list of cookies and browser or app storage is in the privacy notice,
section **Cookies and storage on your device** (`/privacy#cookies`). It is
rendered from the `cookies` list in
[`frontend/data/privacy-policy.json`](../../../frontend/data/privacy-policy.json);
change that file when you add or remove a cookie or storage key, so the
notice stays accurate.

## Summary

GradeBook stores only what it needs to work or to remember a choice the
person made. There are no advertising, analytics or tracking cookies and no
third-party cookies, so the notice explains this instead of showing a cookie
banner. Check that this is still true for your deployment: a CDN, proxy or
monitoring script you add in front of GradeBook can set its own cookies, and
must then be listed and, if not strictly necessary, consented to.

| Kind | Examples | Why no consent is asked |
| --- | --- | --- |
| Strictly necessary | `gb_session` (signed in), `gb_sso_flow` (single sign-on in progress, 10 minutes), `gb_scan_device` (attendance QR check-in), session storage for a sign-in waiting for its authenticator code (`gb_mfa_challenge`) and for a QR check-in across sign-in (`attendance-claim:*`), the mobile app's secure storage | Needed for the service the person asked for. |
| Preferences | `sidebar_state`, `theme`, `gb_language`, `gb.theme.mode`, `gb_update_dismissed` | Remember a choice the person made, on their own device; not shared. |
| Needed for a feature the person turned on | `gb_translation_cache:*` (translations of pages viewed, until the tab closes or sign-out) | Stored only after the person chose a language. |

The mobile app also keeps offline copies and unsent quiz answers for
students; they are removed on sign-out or when the server changes.

## When you change it

- Adding a cookie or storage key: add it to the `cookies` list with where it
  is stored, its purpose, how long it lasts and its kind.
- Adding anything that is not strictly necessary (analytics, an embedded
  third-party widget): you need consent before it is set, and a way to
  withdraw it. GradeBook has no consent banner; build one first.
