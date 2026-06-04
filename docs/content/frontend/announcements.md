---
sidebar_label: Announcements
---

# Announcements Page

**Route**: `/dashboard/announcements`
**File**: `app/dashboard/announcements/page.tsx`

A school-wide notice board. Any staff member with the `announcement:create` permission can post; everyone in the school can read. Backed by the [Announcement Module](../backend/announcement.md).

## Features

### Board feed

Announcements render as cards, newest first - title, author and timestamp, body, and a "Read by" row of avatars. Opening the page marks everything read.

### Composer

A permission-gated **"New Announcement"** button opens a dialog with title + body. The same form is reused for editing. Edit/delete controls appear on a card only when the current user is the **author or a school admin**.

### Unread badge

The sidebar "Announcements" item shows a count badge of notices from others the user hasn't read. It's driven by a shared signal in `lib/announcements.ts`:

| Helper | Purpose |
|--------|---------|
| `unreadAnnouncements` | Global signal read by the sidebar badge |
| `refreshAnnouncementUnread()` | Fetches `/announcements/unread-count` (called on navigation) |
| `markAnnouncementsRead()` | POSTs `/announcements/mark-read` and zeroes the badge |

Opening the board calls `markAnnouncementsRead()`, which clears the badge immediately.

### Read receipts

`ReaderAvatars` (`_components/ReaderAvatars.tsx`) shows overlapping avatars of everyone who has read a notice, each with a **name tooltip on hover** and a "+N" overflow once there are more than a handful. The author is not shown as a reader of their own post. "Read" means the user opened the board after the notice was posted.

## Components

| File | Purpose |
|------|---------|
| `page.tsx` | Board, composer dialog, edit/delete |
| `_components/AnnouncementForm.tsx` | Create/edit form (title + body) |
| `_components/ReaderAvatars.tsx` | Reader avatar stack with tooltips |
| `_components/types.ts` | `Announcement` / `AnnouncementReader` types |
