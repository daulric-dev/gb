# Queue (`src/queue`)

Background jobs for the file manager. One kind of job exists today: **share notify** (write the "a file was shared with you" notifications for a new share).

The module runs in one of two modes, decided once at boot by `QueueModule.forRoot()`:

- **Async (Redis/BullMQ)** when `USE_REDIS=true` and `REDIS_URL` is set. Jobs are added to the BullMQ queue and picked up by the processor in `processors/`, with 3 attempts and exponential backoff (2 s base). The last 1000 completed and 5000 failed jobs are kept in Redis.
- **Inline** otherwise. `FileQueueService` calls the handler straight away, in the caller's request. A failing inline job is logged and swallowed, so it can never break the request that enqueued it.

Either way the work itself lives in `handlers/`, so the behaviour is the same in both modes. The startup log says which mode is active (`File queue running in async (Redis/BullMQ) mode` or `... inline mode`).

## What it provides

- **HTTP routes** - none.
- **Services / exports** - the module is `@Global()` and exports one provider:
  - `FileQueueService.enqueueShareNotify(data: ShareNotifyJobData)` - queue (or run) the notifications for one share.
- **Other**
  - `queue.constants.ts` - the queue name `QUEUE_FILE_SHARE_NOTIFY` (`'file-share-notify'`) and the job payload type `ShareNotifyJobData` (`{ shareId }`).
  - `handlers/` - the job logic (see [handlers/README.md](./handlers/README.md)).
  - `processors/` - BullMQ workers, registered only in async mode (see [processors/README.md](./processors/README.md)).

## Used by

- `src/app.module.ts` imports `QueueModule.forRoot()`.
- `src/file-manager/file-share.service.ts` injects `FileQueueService` and calls `enqueueShareNotify({ shareId })` after it creates a share.
- No front-end, mobile or script code talks to this module directly; its effects show up as file-manager files and notifications.

## Depends on

- `@nestjs/bullmq` / `bullmq` (async mode only).
- `PrismaService` (global) - used by the handler.

## Data

All writes go through the handler. Tables are in [`prisma/schema/files.prisma`](../../prisma/schema/files.prisma) unless noted.

| Handler | Reads | Writes |
| --- | --- | --- |
| Share notify | `file_manager.file_share`, `file_manager.file`, `public.school_management_role`, `public.school_management`, `course.course`, `course.course_staff`, `course.course_student` | `file_manager.notification` |

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `USE_REDIS` | unset | Must be `true` (together with `REDIS_URL`) for async mode. |
| `REDIS_URL` | unset | `redis://` or `rediss://` (TLS) URL. Host, port (default 6379), username and password are read from it. |

## Files

| File | Purpose |
| --- | --- |
| `queue.module.ts` | `QueueModule.forRoot()`: picks async or inline mode and registers the queue, handler and processor. |
| `file-queue.service.ts` | `FileQueueService`: the one entry point other code calls to enqueue a job. |
| `queue.constants.ts` | Queue names and job payload types. |
| `handlers/file-share-notify.handler.ts` | `FileShareNotifyHandler` - writes share notifications. |
| `handlers/file-share-notify.handler.test.ts` | Tests for the handler. |
| `processors/file.processors.ts` | `FileShareNotifyProcessor` (BullMQ worker). |

## Tests

```bash
cd backend && bun test src/queue
```

The tests run the handler directly against `createMockPrisma()` (no Redis): a user share notifies that user with `skipDuplicates`, a role share notifies role holders but never the sharer, a course share notifies member staff and active students, and a missing share is skipped.

## See also

- [docs/content/backend/file-manager.md](../../../docs/content/backend/file-manager.md)
- [src/file-manager/README.md](../file-manager/README.md), [src/storage/README.md](../storage/README.md), [src/realtime/README.md](../realtime/README.md) (the other Redis user)
