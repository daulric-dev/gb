# Subjects Page

**Route**: `/dashboard/subjects`  
**File**: `app/dashboard/subjects/page.tsx`

This page manages the catalog of subjects offered by the school. Subjects defined here are used for teacher assignments, student subject profiles, and grading.

## Features

### Subject List

A table showing all subjects with drag-to-sort reordering:

| Column | Description |
|--------|-------------|
| Drag handle | Grip icon for drag-and-drop reordering |
| Name | Subject name |
| Code | Short code (e.g., "MATH") |
| Graded | Badge indicating if the subject is graded or remarks-only |
| Sort Order | Numeric ordering value (updated automatically on drag) |
| Actions | Edit and Delete buttons |

### Drag-to-Sort

Subjects can be reordered by dragging the grip handle. Uses `@dnd-kit/core` and `@dnd-kit/sortable`. On drop:

1. The UI updates optimistically with the new order
2. A `PATCH /api/v1/subjects/reorder` request sends the new sort order for all items
3. On failure, the list reverts to the previous order

### Create Subject

A dialog form with:

| Field | Required | Description |
|-------|----------|-------------|
| Name | Yes | e.g., "Mathematics" |
| Code | No | e.g., "MATH" |
| Is Graded | No | Toggle; defaults to true |
| Sort Order | No | Numeric display order |

When **Is Graded** is off, the subject won't have grades recorded - only remarks. This is useful for subjects like Physical Education.

### Edit Subject

Same form pre-filled with existing data.

### Delete Subject

Confirmation dialog. Fails with an error if the subject has existing assessments or student assignments.

## API Calls

| Action | Endpoint |
|--------|----------|
| List | `GET /api/v1/subjects` |
| Create | `POST /api/v1/subjects` |
| Update | `PATCH /api/v1/subjects/:id` |
| Delete | `DELETE /api/v1/subjects/:id` |
| Reorder | `PATCH /api/v1/subjects/reorder` |
