# Queue handlers (`src/queue/handlers`)

The actual work behind each background job. A handler is a plain injectable class with one `run(data)` method. It knows nothing about BullMQ: `FileQueueService` calls it directly in inline mode, and a processor in [`../processors`](../processors/README.md) calls it when Redis is on. Keeping the logic here means the two modes cannot drift apart, and the handlers can be unit-tested without a queue.

Handlers must be **idempotent**, because BullMQ retries a failed job up to 3 times. To ask for a retry, throw; to give up quietly (bad input, nothing to do), log and return.

## Files

| File | Defines | What it does |
| --- | --- | --- |
| `file-share-notify.handler.ts` | `FileShareNotifyHandler.run(ShareNotifyJobData)` | Loads the share and its file, works out the recipients from `principal_type` - `user` (that user), `role` (members of the school holding that custom role, via `school_management_role`), `course` (course staff who are still members of the school, plus active students with a linked account) - removes the file owner, and writes one `file_manager.notification` per recipient with `skipDuplicates` (the `(user_id, share_id)` pair is unique, so re-runs are harmless). The body says whether the recipient can download. |
| `file-share-notify.handler.test.ts` | Tests | Covers the handler with `createMockPrisma()`. |

## How the parent module uses them

`QueueModule` provides the handler in every mode (the `HANDLERS` list). `FileQueueService.enqueueShareNotify()` either adds a BullMQ job or calls `handler.run()` inline; `FileShareNotifyProcessor` calls `handler.run(job.data)` when a job arrives.

## Adding a new job

1. Add a queue name and a payload interface to [`../queue.constants.ts`](../queue.constants.ts).
2. Write `<name>.handler.ts` here: an `@Injectable()` class with `async run(data: YourJobData): Promise<void>`. Make it safe to run twice.
3. Add a processor class to [`../processors/file.processors.ts`](../processors/file.processors.ts) (or a new file there) with `@Processor(YOUR_QUEUE)` that extends `WorkerHost` and calls the handler.
4. In [`../queue.module.ts`](../queue.module.ts): add the handler to `HANDLERS`, register the queue in `BullModule.registerQueue(...)`, and add the processor to the Redis-mode `providers`.
5. In [`../file-queue.service.ts`](../file-queue.service.ts): inject the queue with `@Optional() @InjectQueue(YOUR_QUEUE)` and the handler, and add an `enqueueX()` method that adds the job when the queue exists and otherwise calls `runInline()`.
6. Test the handler directly (see `file-share-notify.handler.test.ts` and [`src/test/README.md`](../../test/README.md)).
