---
sidebar_label: 2026-09-20 · OTP screen redesign
sidebar_position: 8
---

# 2026-09-20 - OTP verification screen redesign

The web code-entry screen (`/login/verify`) was rebuilt. It had 32px input boxes dwarfed by the card they sat in, and three stacked full-width buttons where a disabled grey *Verify* slab was the loudest thing on screen.

## What changed

- **Properly sized boxes** - 44px on desktop, 36px on phones, digits at a readable size.
- **Auto-submits on the 8th digit.** Typing the last digit verifies; the button remains for pasting or tabbing.
- **Auto-focused on load**, with a numeric keypad on mobile.
- **Errors show in place** - red boxes, an inline message, and the code cleared ready to retype. Previously a bad code produced only a toast that vanished while the wrong digits sat there.
- **One action, not three** - "Didn't get it? **Resend code**" on one line and "Use a different email" below, instead of two identical ghost buttons.
- A mail icon anchors the top, and the email sits on its own line so long addresses do not crowd the heading.

The error is rendered into a reserved-height element so the layout does not jump when one lands, and `aria-invalid` is set on **each slot** rather than the group - that is what the slot styles key off, and the red boxes are the cue people actually notice.

## A layout bug fixed on the way

The first pass used 48px slots; eight of those plus the separator **overflowed the card on both sides**. Sizing is now responsive and the group separator hides below `sm`, verified to fit a 390px phone with room to spare.

The mobile app's own OTP screen had the same overflow for the same reason - its slots now measure the space they are given and size to fit, clamped between 26 and 44px.

## Still open

The mobile OTP screen keeps its three stacked full-width buttons and has no auto-submit. Only the web screen was redesigned.
