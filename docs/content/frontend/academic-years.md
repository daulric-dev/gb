---
sidebar_label: Academic Calendar
---

# Academic Calendar Page

**Route**: `/dashboard/academic-calendar`
**File**: `app/dashboard/academic-calendar/page.tsx`

This page hosts both academic-year and term management as tabs. The **Academic Years** tab covers the year lifecycle (described below); the **Terms** tab groups terms under each academic year (see [Terms](./terms.md)).

The legacy URL `/dashboard/academic-years` is permanently redirected to `/dashboard/academic-calendar` (see `frontend/next.config.ts`).

An academic year is a named date range. It carries no grading settings: how a course's grade is worked out lives on the course itself (its assignment groups and grade scale).

## Features

### Academic Year List

A table of the school's academic years, active year first, then newest first. Each row shows:
- Year name
- Start and end dates
- Active / Inactive badge
- Activate or Deactivate button, and an Edit button (for users with `academic-year:update`)

### Create Academic Year

A dialog form (for users with `academic-year:create`):

| Field | Required | Description |
|-------|----------|-------------|
| Name | Yes | e.g. "2025/2026" |
| Start Date | Yes | Year start date |
| End Date | Yes | Year end date; must be after the start |

New years start inactive.

### Edit Academic Year

Same form as create, pre-filled with the year's name and dates.

### Activate / Deactivate

- **Activate**: Sets this year as the active one. Only one year can be active at a time - activating one deactivates all others.
- **Deactivate**: Removes the active status.

Academic years cannot be deleted from the app.

## API Calls

| Action | Endpoint |
|--------|----------|
| List | `GET /api/academic-years` |
| Create | `POST /api/academic-years` |
| Update | `PATCH /api/academic-years/:id` |
| Activate | `PATCH /api/academic-years/:id/activate` |
| Deactivate | `PATCH /api/academic-years/:id/deactivate` |
