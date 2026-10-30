import { describe, test, expect } from 'bun:test';
import {
  ByteBudget,
  ByteBudgetTimeoutError,
  DEFAULT_UPLOAD_VERIFY_MEMORY_MB,
  uploadVerifyBudgetBytes,
} from './byte-budget';

describe('ByteBudget', () => {
  test('grants requests that fit and frees them on release', async () => {
    const budget = new ByteBudget(10);
    const a = await budget.acquire(4, 100);
    const b = await budget.acquire(6, 100);
    expect(budget.inUse).toBe(10);
    a();
    a(); // releasing twice is harmless
    expect(budget.inUse).toBe(6);
    b();
    expect(budget.inUse).toBe(0);
  });

  test('a waiter is granted once enough is released', async () => {
    const budget = new ByteBudget(10);
    const a = await budget.acquire(8, 100);
    let granted = false;
    const pending = budget.acquire(5, 1000).then((release) => {
      granted = true;
      return release;
    });
    await Promise.resolve();
    expect(granted).toBe(false);
    a();
    const release = await pending;
    expect(granted).toBe(true);
    expect(budget.inUse).toBe(5);
    release();
  });

  test('times out when nothing is released', async () => {
    const budget = new ByteBudget(10);
    const hold = await budget.acquire(10, 100);
    const err = await budget.acquire(1, 20).catch((e) => e);
    expect(err).toBeInstanceOf(ByteBudgetTimeoutError);
    expect(budget.inUse).toBe(10);
    hold();
    expect(budget.inUse).toBe(0);
  });

  test('a request larger than the budget runs alone', async () => {
    const budget = new ByteBudget(10);
    const small = await budget.acquire(2, 100);
    const big = budget.acquire(50, 1000);
    small();
    const release = await big;
    expect(budget.inUse).toBe(10);
    release();
    expect(budget.inUse).toBe(0);
  });

  test('requests are served in arrival order', async () => {
    const budget = new ByteBudget(10);
    const hold = await budget.acquire(6, 100);
    const order: string[] = [];
    const big = budget.acquire(8, 1000).then((r) => (order.push('big'), r));
    const small = budget.acquire(2, 1000).then((r) => (order.push('small'), r));
    await Promise.resolve();
    // `small` would fit now, but `big` is ahead of it.
    expect(order).toEqual([]);
    hold();
    (await big)();
    (await small)();
    expect(order).toEqual(['big', 'small']);
  });
});

describe('uploadVerifyBudgetBytes', () => {
  test('reads megabytes from the environment value', () => {
    expect(uploadVerifyBudgetBytes('64')).toBe(64 * 1024 * 1024);
  });

  test('falls back to the default when unset or invalid', () => {
    const fallback = DEFAULT_UPLOAD_VERIFY_MEMORY_MB * 1024 * 1024;
    expect(uploadVerifyBudgetBytes(undefined)).toBe(fallback);
    expect(uploadVerifyBudgetBytes('nope')).toBe(fallback);
    expect(uploadVerifyBudgetBytes('0')).toBe(fallback);
  });
});
