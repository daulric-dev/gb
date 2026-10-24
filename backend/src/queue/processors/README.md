# Queue processors (`src/queue/processors`)

BullMQ workers (today one: `FileShareNotifyProcessor`). They exist only when Redis is enabled (`USE_REDIS=true` and `REDIS_URL` set): `QueueModule.forRoot()` adds them to the module's providers in that mode and leaves them out otherwise, so without Redis no worker is created and jobs run inline.

Each processor is a thin adapter: BullMQ delivers a job, the processor passes `job.data` to the matching handler in [`../handlers`](../handlers/README.md), and the handler does the work. If the handler throws, BullMQ retries the job (3 attempts, exponential backoff, as set in `file-queue.service.ts`).

## Files

| File | Defines | Queue | Calls |
| --- | --- | --- | --- |
| `file.processors.ts` | `FileShareNotifyProcessor` | `file-share-notify` (`QUEUE_FILE_SHARE_NOTIFY`) | `FileShareNotifyHandler.run(job.data)` |

It extends `WorkerHost` from `@nestjs/bullmq` and are decorated with `@Processor(<queue name>)`. The workers run inside the API process; there is no separate worker binary.

## Adding a processor

Write the handler first (see [../handlers/README.md](../handlers/README.md#adding-a-new-job)). Then add a class here:

```ts
@Processor(QUEUE_MY_JOB)
export class MyJobProcessor extends WorkerHost {
  constructor(private readonly handler: MyJobHandler) {
    super();
  }
  async process(job: Job<MyJobData>): Promise<void> {
    await this.handler.run(job.data);
  }
}
```

and register it in the Redis branch of `QueueModule.forRoot()` together with `BullModule.registerQueue({ name: QUEUE_MY_JOB })`. Keep logic out of the processor: anything here is skipped in inline mode.
