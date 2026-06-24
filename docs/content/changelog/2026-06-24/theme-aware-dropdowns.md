---
sidebar_label: 2026-06-24 · Theme-aware dropdowns & modal UX
sidebar_position: 2
---

# 2026-06-24 - Theme-aware dropdowns and modal UX

A frontend batch: every native dropdown moved to the theme-aware `Select` component, plus a few modal and list improvements. Frontend only.

## Dropdowns were invisible on light-theme devices

Native HTML `<select>` elements render their option popup through the operating system, which ignores the app's dark-theme CSS. On a light-theme device the popup background was light while the option text inherited a light color, so the list appeared blank.

Every dropdown now uses the existing theme-aware `Select` ([components/ui/select.tsx](../../../../frontend/components/ui/select.tsx), built on Base UI), which renders its own popup with `bg-popover` / `text-popover-foreground` tokens and is therefore correct in both themes and consistent across operating systems. The component already existed in the repo but was unused.

18 files were converted, covering roughly 22 dropdowns:

- Grading: Term, Subject, and assessment type
- Classes: rows-per-page, academic year, assign teacher, bulk-assign subject
- Reports and filters: report type and term (class-report and reports filter cards)
- Students: gender (create and edit)
- Subjects: graded / not-graded (create and edit)
- Academic calendar: term name and academic year (create and edit year)
- Staff: role; the Schools page; grade-scales scale form

Each conversion preserved the original `onChange` side effects, `required` / `disabled` semantics, value casts, and any placeholder prompt. Now-unused `selectClass` imports were removed. Typecheck is clean.

## Modal and list improvements

- **Enroll Students "Select all".** The enroll modal ([EnrollForm.tsx](../../../../frontend/app/dashboard/classes/[classId]/_components/EnrollForm.tsx)) gained a "Select all" checkbox with a live "N of M selected" count that drives the existing selection signal.
- **Subject assignment modal.** The student subjects modal added a "Select all" control ([AddSubjectsForm.tsx](../../../../frontend/app/dashboard/classes/[classId]/_components/AddSubjectsForm.tsx)), and the assigned-subjects list ([ManageSubjects.tsx](../../../../frontend/app/dashboard/classes/[classId]/_components/ManageSubjects.tsx)) is now capped with a scroll (`max-h-56 overflow-y-auto`) so a long list of assignments no longer grows the modal past the viewport.
- **Enrolled Students sorted by last name.** The enrolled students table on the class page ([page.tsx](../../../../frontend/app/dashboard/classes/[classId]/page.tsx)) now renders sorted by last name, then first name, via `localeCompare` on a copy of the signal array (no in-place mutation).
