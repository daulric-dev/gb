import { describe, expect, mock, test } from 'bun:test';
import { Prisma } from '@/generated/prisma/client';
import { createMockPrisma } from '@/test/prisma-mock';
import { acquireJobLease, releaseJobLease, withJobLease } from './job-lease';

const duplicate = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('job leases', () => {
  test('creates a lease when no row exists', async () => {
    const db = createMockPrisma();
    const now = new Date('2026-11-12T12:00:00Z');
    const token = await acquireJobLease(db as never, 'peer-review:sweep', 60_000, now);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(db.job_lease.create.mock.calls[0][0].data).toMatchObject({
      key: 'peer-review:sweep',
      owner_token: token,
      expires_at: new Date(now.getTime() + 60_000),
    });
    expect(db.job_lease.updateMany).not.toHaveBeenCalled();
  });

  test('reclaims only an expired lease and reports a busy lease', async () => {
    const db = createMockPrisma();
    db.job_lease.create.mockRejectedValue(duplicate());
    db.job_lease.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const now = new Date('2026-11-12T12:00:00Z');
    expect(await acquireJobLease(db as never, 'sweep', 60_000, now)).toBeNull();
    const owner = await acquireJobLease(db as never, 'sweep', 60_000, now);
    expect(owner).toMatch(/^[0-9a-f-]{36}$/);
    expect(db.job_lease.updateMany.mock.calls[0][0].where).toEqual({
      key: 'sweep',
      OR: [{ expires_at: null }, { expires_at: { lte: now } }],
    });
  });

  test('releases only the matching owner token', async () => {
    const db = createMockPrisma();
    const now = new Date('2026-11-12T12:00:00Z');
    await releaseJobLease(db as never, 'sweep', 'owner-1', now);
    expect(db.job_lease.updateMany.mock.calls[0][0]).toEqual({
      where: { key: 'sweep', owner_token: 'owner-1' },
      data: { owner_token: null, expires_at: null, updated_at: now },
    });
  });

  test('withJobLease runs work under the lease and releases it afterwards', async () => {
    const db = createMockPrisma();
    const order: string[] = [];
    db.job_lease.create.mockImplementation(async () => order.push('acquire'));
    db.job_lease.updateMany.mockImplementation(async () => {
      order.push('release');
      return { count: 1 };
    });
    const ran = await withJobLease(db as never, 'sweep', 60_000, async () => {
      order.push('work');
    });
    expect(ran).toBe(true);
    expect(order).toEqual(['acquire', 'work', 'release']);
    expect(db.job_lease.updateMany.mock.calls[0][0].where).toMatchObject({ key: 'sweep' });
  });

  test('withJobLease skips the work while another worker holds the lease', async () => {
    const db = createMockPrisma();
    db.job_lease.create.mockRejectedValue(duplicate());
    const work = mock(async () => undefined);
    expect(await withJobLease(db as never, 'sweep', 60_000, work)).toBe(false);
    expect(work).not.toHaveBeenCalled();
  });

  test('withJobLease releases the lease when the work fails and rethrows', async () => {
    const db = createMockPrisma();
    await expect(
      withJobLease(db as never, 'sweep', 60_000, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(db.job_lease.updateMany).toHaveBeenCalledTimes(1);
  });
});
