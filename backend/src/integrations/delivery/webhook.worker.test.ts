import { describe, expect, mock, test } from 'bun:test';
import { WebhookWorker } from './webhook.worker';
import { CLAIM_BATCH } from '@/integrations/config/webhook.config';

describe('WebhookWorker', () => {
  test('keeps claiming while full batches come back, and never throws', async () => {
    const rounds = [CLAIM_BATCH, CLAIM_BATCH, 3];
    const deliveries = { usesQueue: false, processDue: mock(async () => rounds.shift() ?? 0) };
    const worker = new WebhookWorker(deliveries as any);
    await worker.tick();
    expect(deliveries.processDue).toHaveBeenCalledTimes(3);

    const broken = new WebhookWorker({ usesQueue: false, processDue: async () => { throw new Error('db down'); } } as any);
    await broken.tick();
  });

  test('one round at a time; a call during a round asks for another', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: number[] = [];
    const deliveries = {
      usesQueue: false,
      processDue: mock(async () => {
        calls.push(1);
        if (calls.length === 1) await gate;
        return 0;
      }),
    };
    const worker = new WebhookWorker(deliveries as any);
    const first = worker.tick();
    await worker.tick();
    release();
    await first;
    expect(calls).toHaveLength(2);
  });
});
