---
sidebar_label: Academic Years
---

# Academic Years Page

**Route**: `/dashboard/academic-years`  
**File**: `app/dashboard/academic-years/page.tsx`

This page manages the lifecycle of academic years for the school.

## Features

### Academic Year List

Displays all academic years as cards with:
- Year name
- Date range
- Grading model badge (`Term-Based` or `Year-Based`)
- Active status indicator (green badge if active)
- Activate/Deactivate button
- Edit button
- Delete button (if not active)

### Create Academic Year

A dialog form to create a new academic year:

| Field | Required | Description |
|-------|----------|-------------|
| Name | Yes | e.g., "2025-2026" |
| Start Date | Yes | Year start date |
| End Date | Yes | Year end date |
| Grading Model | Yes | `term_based` or `year_based` |
| Year Exam Weight | Conditional | Required when `year_based`; must sum to 100 with coursework |
| Year Coursework Weight | Conditional | Required when `year_based` |

When `year_based` is selected, two additional weight fields appear. The frontend validates that they sum to 100 before submission.

### Edit Academic Year

Same form as create, pre-filled with existing data.

### Activate / Deactivate

- **Activate**: Sets this year as the active one. Only one year can be active at a time - activating one deactivates all others.
- **Deactivate**: Removes the active status.

## API Calls

| Action | Endpoint |
|--------|----------|
| List | `GET /api/academic-years` |
| Create | `POST /api/academic-years` |
| Update | `PATCH /api/academic-years/:id` |
| Activate | `PATCH /api/academic-years/:id/activate` |
| Deactivate | `PATCH /api/academic-years/:id/deactivate` |
| Delete | `DELETE /api/academic-years/:id` |
