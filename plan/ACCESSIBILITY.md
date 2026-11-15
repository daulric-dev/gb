# Accessibility

GradeBook is used by students, teachers and school staff with a wide range of needs. Everyone should be able to sign in, do their work, check in to class and follow their grades, on the web and in the mobile app, whatever device or assistive technology they use.

This document says what we aim for, where we are today, what we know is missing, and how to report a problem.

## Our target

We aim to meet the **[Web Content Accessibility Guidelines (WCAG) 2.2, level AA](https://www.w3.org/TR/WCAG22/)** on the web app, and the equivalent platform guidelines in the mobile app ([Apple](https://developer.apple.com/accessibility/) and [Android](https://developer.android.com/guide/topics/ui/accessibility)).

**GradeBook has not been formally audited against WCAG.** We do not claim conformance. The sections below describe the current state honestly; schools that need a conformance report (for example a VPAT) should contact us first.

## What works today

**Web app**

- Interactive components (dialogs, menus, popovers, selects, tabs, checkboxes, date pickers) are built on [Base UI](https://base-ui.com/) primitives through shadcn/ui, which provide keyboard support, focus management and ARIA roles.
- Visible focus indicators on interactive controls.
- Light and dark themes, following the system setting by default.
- The page language is declared (`lang="en"`).
- Icon-only buttons and decorative elements use `aria-label` / screen-reader-only text where they have been reviewed.
- Course pages are written in Markdown and rendered as semantic HTML (headings, lists, links, tables).

**Mobile app**

- Follows the system light or dark appearance.
- Uses the platform's native controls, so text scales with the system font size.
- Some screens have accessibility labels and roles (see the gaps below).

**Course design**

- Teachers can give an individual student a later due date, excuse a student from a piece of work, and mark work done offline or on paper, so students are not forced through one online format.
- **Quiz question types work without dragging:** ordering questions use Move up / Move down buttons and matching questions use a labelled choice per item, on the web (keyboard) and in the app (VoiceOver and TalkBack labels say which item and where it is).
- **Late work:** teachers can accept work after the due date (with or without a penalty) and waive the penalty for one student.
- **Peer review:** rubric levels are a labelled radio group (web: keyboard; app: VoiceOver/TalkBack roles and checked state), and a classmate's files open in the same viewer as marking (in the app, the system viewer). A teacher can add, move or remove a student's reviews.
- **Mastery levels are never colour-only:** the mastery grid, outcome pages and the app show each level's name (and score) next to its colour, mark mastered outcomes with a symbol and text, and give screen readers a full description of each cell.
- **Analytics charts are never chart-only or colour-only:** every chart has a written summary and a Chart / Table switch with the same numbers as a table; charts are single-colour with values printed on them, and at-risk reasons are text labels, not colours.
- **AI drafts are labelled in text, not only by colour or icon:** every AI suggestion carries the words "AI-generated — review before using"; a page summary is plain text in labelled, editable fields, and a summary inserted into a page uses real headings and a list. Rubric suggestions sit under their criterion with a "Use" button named after it.
- **Quiz accommodations:** a student can get extra time on timed quizzes (×1.25, ×1.5, ×2 or extra minutes) and be exempt from Lockdown, on one quiz or as a school-wide default. An exempt student takes a Lockdown quiz without fullscreen or app pinning and is never reported as away. Accommodations are shown only to staff.

## Known gaps

These are the problems we know about. They are tracked and will be fixed; if one affects you, please tell us so we can prioritise it.

**Web**

- No "skip to main content" link.
- Animations do not yet respect the `prefers-reduced-motion` setting.
- Accessibility is not checked automatically: there is no accessibility linting (`eslint-plugin-jsx-a11y`) or automated testing (axe) in CI.
- Colour contrast has not been checked across both themes.

**Mobile**

- Most screens are missing `accessibilityLabel`s and `accessibilityRole`s on icon buttons, cards and custom controls, so VoiceOver and TalkBack users will hit unlabelled controls.
- Layouts have not been tested at the largest text sizes.

**Quizzes and attendance**

- **A Lockdown exemption is not automatic.** Until a teacher or school staff exempt a student (see *Quiz accommodations* above), Lockdown may conflict with assistive technology: on the web, moving focus to a separate dictation, magnifier or screen-reader window can be reported as leaving the quiz; in the mobile app, pinning (Guided Access on iPhone, screen pinning on Android) blocks switching to other apps, including some assistive apps. Treat "away" reports for students without an exemption with that in mind.
- **Attendance check-in** by QR code needs a camera. The 4-digit room code is the alternative, and teachers can also mark attendance by hand.
- **Location-based check-in** depends on the device's location services and can be refused indoors. Teachers can turn the location check off for a session.
- **Automatic check-in from the timetable** opens and closes on the bell schedule, which can be too short for some students. Teachers can mark any student present by hand at any time, including after the session closes, and a school can turn the room-code requirement and the location check off (a room without a saved location has no location check).

## Reporting an accessibility problem

If something in GradeBook is hard or impossible to use with your setup:

- **Open a GitHub issue** with the title starting `Accessibility:`, or
- **Contact us** at [daulric.dev](https://daulric.dev).

Please include:

- what you were trying to do and where (web page or app screen);
- your device, browser or app version, and any assistive technology (for example NVDA with Firefox, VoiceOver on iOS 27, TalkBack, switch access, browser zoom at 200%);
- what happened, and what you expected.

Accessibility bugs that block a task (signing in, submitting work, taking a quiz, checking in) are treated as high priority.

If you are a student and something blocks you from completing graded work, also tell your teacher: they can extend the due date or excuse the work while we fix the problem.

## For contributors

Accessibility is part of "done". Before opening a pull request that changes the UI, check:

**Web**

- [ ] Everything works with the keyboard alone: Tab order is logical, focus is visible, and nothing traps focus except open dialogs.
- [ ] Every control has an accessible name. Icon-only buttons have an `aria-label`; form fields have a `<Label>`.
- [ ] Use the existing `components/ui` primitives instead of building custom widgets from `div`s.
- [ ] Headings are in order (one `h1` per page, no skipped levels).
- [ ] Status changes that appear without a page load (toasts, live rosters, timers) are announced, or don't need to be.
- [ ] Text and controls have enough contrast in **both** light and dark themes (4.5:1 for text, 3:1 for large text and UI components).
- [ ] Colour is never the only way information is shown (badges also have text or an icon with a label).
- [ ] Pages still work at 200% browser zoom and at 320 px wide.

**Mobile**

- [ ] Every touchable has an `accessibilityLabel` and the right `accessibilityRole`; state is exposed with `accessibilityState` (selected, disabled, checked).
- [ ] Touch targets are at least 44×44 pt.
- [ ] Screens work with VoiceOver (iOS) and TalkBack (Android), in a sensible reading order.
- [ ] Layouts survive the largest system text size.

**Testing tools**

- Web: keyboard only; a screen reader (VoiceOver on macOS, NVDA on Windows); the browser's accessibility inspector; [axe DevTools](https://www.deque.com/axe/devtools/) or Lighthouse.
- Mobile: VoiceOver and TalkBack on a real device; the Accessibility Inspector in Xcode; Android's Accessibility Scanner.

See also [CONTRIBUTING.md](CONTRIBUTING.md) for the general workflow.
