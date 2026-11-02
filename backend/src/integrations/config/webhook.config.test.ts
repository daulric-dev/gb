import { afterEach, describe, expect, test } from 'bun:test';
import {
  BACKOFF_MS,
  backoffMs,
  deliveryRetentionDays,
  maxAttempts,
  maxConsecutiveFailures,
} from './webhook.config';

const ENV = ['WEBHOOK_MAX_ATTEMPTS', 'WEBHOOK_MAX_CONSECUTIVE_FAILURES', 'WEBHOOK_DELIVERY_RETENTION_DAYS'];
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

describe('webhook retry schedule', () => {
  test('defaults: 8 attempts, auto-disable after 50 failures, 30 days of deliveries', () => {
    expect(maxAttempts()).toBe(8);
    expect(maxConsecutiveFailures()).toBe(50);
    expect(deliveryRetentionDays()).toBe(30);
    process.env.WEBHOOK_MAX_ATTEMPTS = '3';
    process.env.WEBHOOK_MAX_CONSECUTIVE_FAILURES = '5';
    process.env.WEBHOOK_DELIVERY_RETENTION_DAYS = '7';
    expect([maxAttempts(), maxConsecutiveFailures(), deliveryRetentionDays()]).toEqual([3, 5, 7]);
  });

  test('exponential backoff over about a day for the default attempts', () => {
    const mid = () => 0.5; // no jitter
    const waits = Array.from({ length: maxAttempts() - 1 }, (_, i) => backoffMs(i + 1, mid));
    expect(waits).toEqual([...BACKOFF_MS]);
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThanOrEqual(waits[i - 1]);
    const total = waits.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(20 * 3_600_000);
    expect(total).toBeLessThan(28 * 3_600_000);
  });

  test('jitter stays within ±20%, and later attempts reuse the last wait', () => {
    expect(backoffMs(1, () => 0)).toBe(48_000);
    expect(backoffMs(1, () => 1)).toBe(72_000);
    expect(backoffMs(99, () => 0.5)).toBe(BACKOFF_MS[BACKOFF_MS.length - 1]);
  });
});
