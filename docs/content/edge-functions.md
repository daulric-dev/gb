---
sidebar_label: Edge Functions (removed)
sidebar_position: 4
---

# Edge functions (removed)

GradeBook no longer has any edge functions. `supabase/functions/` was deleted in phase 2 of [Leaving Supabase](./platform-migration.md):

| Function | Now |
| --- | --- |
| `file-share-notify` | `backend/src/queue/handlers/file-share-notify.handler.ts` writes the notifications itself (BullMQ job, or inline without Redis) |
| `file-ingest` | `backend/src/queue/handlers/file-ingest.handler.ts` checks the object in S3 and records it |
| `announcement-feed`, `notification-summary`, `bulk-import-preview` | Unused; the backend's own endpoints cover them |

Nothing needs deploying besides the backend. Prefer Postgres functions for pure SQL aggregation, BullMQ for long-running or retry-heavy work, and the NestJS API for everything else.
