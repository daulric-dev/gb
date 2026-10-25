import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { createFakeStorage } from '@/test/erasure-mocks';
import { ErasureLogService } from '@/erasure/erasure-log.service';
import { RetentionService } from './retention.service';
import { softDeleteRetentionDays } from './retention.config';

const U = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const SCHOOL = U(900);
const NOW = new Date('2026-10-25T03:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const ENV = [
  'SOFT_DELETE_RETENTION_DAYS',
  'SOFT_DELETE_RETENTION_DAYS_FILES',
  'SOFT_DELETE_RETENTION_DAYS_CHAT_MESSAGES',
  'RETENTION_PURGE_BATCH_SIZE',
  'RETENTION_PURGE_MAX_MINUTES',
];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/**
 * Prisma with a separate transaction client, and file rows that disappear
 * once deleted so the batch loop ends.
 */
function setup(files: { id: string }[] = []) {
  const prisma = createMockPrisma();
  const tx = createMockPrisma();
  prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
  tx.erasure_log.create.mockResolvedValue({ id: 'log' });
  let live = files.map((f) => ({ school_id: SCHOOL, bucket: 'file-manager', storage_path: `${SCHOOL}/u/${f.id}`, ...f }));
  prisma.file.findMany.mockImplementation(async (args: any) => live.slice(0, args?.take ?? live.length));
  tx.file.deleteMany.mockImplementation(async ({ where }: any) => {
    const before = live.length;
    live = live.filter((f) => !where.id.in.includes(f.id));
    return { count: before - live.length };
  });
  const storage = createFakeStorage(Object.fromEntries(live.map((f) => [`file-manager/${f.storage_path}`, 'bytes'])));
  const erasure = new ErasureLogService(prisma as any, storage as any);
  const replay = { retryStorage: mock(async () => 0) };
  const service = new RetentionService(prisma as any, storage as any, erasure, replay as any);
  return { prisma, tx, storage, service, replay, remaining: () => live };
}

const cutoffOf = (m: MockPrisma['file']['findMany']) => m.mock.calls[0][0].where.deleted_at.lt as Date;

describe('which rows are purged', () => {
  test('only rows soft-deleted longer ago than the retention (default 30 days)', async () => {
    const { prisma, service } = setup();
    await service.purge({ now: NOW });
    expect(cutoffOf(prisma.file.findMany).getTime()).toBe(NOW.getTime() - 30 * DAY);
    expect(prisma.message.findMany.mock.calls[0][0].where.deleted_at.lt.getTime()).toBe(NOW.getTime() - 30 * DAY);
    expect(prisma.folder.findMany.mock.calls[0][0].where.deleted_at.lt.getTime()).toBe(NOW.getTime() - 30 * DAY);
  });

  test('SOFT_DELETE_RETENTION_DAYS and per-kind overrides', async () => {
    process.env.SOFT_DELETE_RETENTION_DAYS = '60';
    process.env.SOFT_DELETE_RETENTION_DAYS_FILES = '7';
    expect(softDeleteRetentionDays('files')).toBe(7);
    expect(softDeleteRetentionDays('chat_messages')).toBe(60);
    const { prisma, service } = setup();
    await service.purge({ now: NOW });
    expect(cutoffOf(prisma.file.findMany).getTime()).toBe(NOW.getTime() - 7 * DAY);
    expect(prisma.message.findMany.mock.calls[0][0].where.deleted_at.lt.getTime()).toBe(NOW.getTime() - 60 * DAY);
  });

  test('files still attached to a submission are kept', async () => {
    const { prisma, service } = setup();
    await service.purge({ now: NOW });
    expect(prisma.file.findMany.mock.calls[0][0].where.submission).toEqual({ none: {} });
  });

  test('--only narrows every kind to those ids and skips the global clean-ups', async () => {
    const { prisma, service } = setup();
    await service.purge({ now: NOW, retentionDays: 0, only: [U(1)] });
    expect(cutoffOf(prisma.file.findMany).getTime()).toBe(NOW.getTime());
    expect(prisma.file.findMany.mock.calls[0][0].where.id).toEqual({ in: [U(1)] });
    expect(prisma.message.findMany.mock.calls[0][0].where.id).toEqual({ in: [U(1)] });
    expect(prisma.session.findMany).not.toHaveBeenCalled();
    expect(prisma.erasure_log.deleteMany).not.toHaveBeenCalled();
  });
});

describe('files', () => {
  test('objects first, then rows with a retention_purge log entry in the same transaction', async () => {
    const { prisma, tx, storage, service, remaining } = setup([{ id: U(1) }, { id: U(2) }]);
    const order: string[] = [];
    storage.delete.mockImplementation(async (keys: any) => {
      order.push('storage');
      for (const k of keys) storage.objects.delete(k);
    });
    tx.file.deleteMany.mockImplementationOnce(async () => {
      order.push('rows');
      return { count: 2 };
    });
    prisma.file.findMany.mockResolvedValueOnce(remaining()).mockResolvedValue([]);

    const report = await service.purge({ now: NOW });
    expect(order).toEqual(['storage', 'rows']);
    expect(report).toMatchObject({ files: 2, fileObjects: 2, errors: [] });
    expect(storage.objects.size).toBe(0);
    const log = tx.erasure_log.create.mock.calls[0][0].data;
    expect(log).toMatchObject({ kind: 'file', reason: 'retention_purge', actor: 'system', school_id: SCHOOL, subject_ids: [U(1), U(2)] });
    expect(log.replay.steps[0]).toMatchObject({ op: 'delete', table: 'file_manager.file', objects: true });
  });

  test('a storage failure deletes no rows; the next run finishes the job', async () => {
    const { tx, storage, service, remaining } = setup([{ id: U(1) }]);
    storage.failDelete = true;
    const failed = await service.purge({ now: NOW });
    expect(failed.files).toBe(0);
    expect(failed.errors[0]).toContain('files: storage down');
    expect(tx.file.deleteMany).not.toHaveBeenCalled();
    expect(remaining()).toHaveLength(1);

    storage.failDelete = false;
    const retried = await service.purge({ now: NOW });
    expect(retried.files).toBe(1);
    expect(remaining()).toHaveLength(0);
    expect(storage.objects.size).toBe(0);
  });

  test('a failed row delete after the objects went is retried idempotently', async () => {
    const { tx, storage, service, remaining } = setup([{ id: U(1) }]);
    tx.erasure_log.create.mockRejectedValueOnce(new Error('log down'));
    tx.file.deleteMany.mockImplementationOnce(async () => ({ count: 1 })); // rolled back with the log failure
    const first = await service.purge({ now: NOW });
    expect(first.errors[0]).toContain('log down');
    expect(storage.objects.size).toBe(0);
    expect(remaining()).toHaveLength(1);

    const second = await service.purge({ now: NOW });
    expect(second.files).toBe(1);
    expect(remaining()).toHaveLength(0);
  });

  test('works in batches of RETENTION_PURGE_BATCH_SIZE', async () => {
    process.env.RETENTION_PURGE_BATCH_SIZE = '2';
    const { prisma, tx, service, remaining } = setup([{ id: U(1) }, { id: U(2) }, { id: U(3) }]);
    const report = await service.purge({ now: NOW });
    expect(report.files).toBe(3);
    expect(remaining()).toHaveLength(0);
    expect(prisma.file.findMany.mock.calls[0][0].take).toBe(2);
    expect(tx.file.deleteMany.mock.calls.map((c: any) => c[0].where.id.in.length)).toEqual([2, 1]);
  });
});

describe('other kinds', () => {
  test('chat message tombstones are deleted and logged', async () => {
    const { prisma, tx, service } = setup();
    prisma.message.findMany.mockResolvedValueOnce([{ id: U(1), school_id: SCHOOL }]).mockResolvedValue([]);
    tx.message.deleteMany.mockResolvedValue({ count: 1 });
    const report = await service.purge({ now: NOW });
    expect(report.chatMessages).toBe(1);
    expect(tx.erasure_log.create.mock.calls[0][0].data).toMatchObject({ kind: 'chat_message', subject_ids: [U(1)] });
  });

  test('discussion replies: unanswered ones deleted, answered placeholders lose their author', async () => {
    const { prisma, tx, service } = setup();
    const row = (id: string) => ({ id, course: { school_id: SCHOOL } });
    prisma.discussion_reply.findMany
      .mockResolvedValueOnce([row(U(1))]) // leaves
      .mockResolvedValueOnce([]) // no more leaves
      .mockResolvedValueOnce([row(U(2))]) // placeholders
      .mockResolvedValue([]);
    tx.discussion_reply.deleteMany.mockResolvedValue({ count: 1 });
    tx.discussion_reply.updateMany.mockResolvedValue({ count: 1 });
    const report = await service.purge({ now: NOW });
    expect(report).toMatchObject({ discussionRepliesDeleted: 1, discussionRepliesScrubbed: 1 });
    expect(prisma.discussion_reply.findMany.mock.calls[0][0].where.children).toEqual({ none: {} });
    expect(tx.discussion_reply.updateMany.mock.calls[0][0].data).toEqual({ author_user_profile_id: null, body: '' });
    const kinds = tx.erasure_log.create.mock.calls.map((c: any) => c[0].data.replay.steps[0].op);
    expect(kinds).toEqual(['delete', 'update']);
  });

  test('expired sessions and old sign-in codes are cleared (not logged)', async () => {
    const { prisma, service } = setup();
    prisma.session.findMany.mockResolvedValueOnce([{ id: U(1) }]).mockResolvedValue([]);
    prisma.session.deleteMany.mockResolvedValue({ count: 1 });
    prisma.email_code.findMany.mockResolvedValueOnce([{ id: U(2) }, { id: U(3) }]).mockResolvedValue([]);
    prisma.email_code.deleteMany.mockResolvedValue({ count: 2 });
    const report = await service.purge({ now: NOW });
    expect(report).toMatchObject({ sessions: 1, emailCodes: 2 });
    const before = new Date(NOW.getTime() - DAY);
    expect(prisma.session.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ expires_at: { lt: before } }, { revoked_at: { lt: before } }],
    });
  });

  test('prunes the erasure log and retries account storage clean-up', async () => {
    const { prisma, service, replay } = setup();
    prisma.erasure_log.deleteMany.mockResolvedValue({ count: 4 });
    const report = await service.purge({ now: NOW });
    expect(report.erasureLogRows).toBe(4);
    expect(prisma.erasure_log.deleteMany.mock.calls[0][0].where.occurred_at.lt.getTime()).toBe(NOW.getTime() - 400 * DAY);
    expect(replay.retryStorage).toHaveBeenCalledWith('account', new Date(NOW.getTime() - 7 * DAY));
  });
});

describe('dry run', () => {
  test('counts and changes nothing', async () => {
    const { prisma, tx, storage, service, replay } = setup([{ id: U(1) }]);
    prisma.file.count.mockResolvedValue(1);
    prisma.message.count.mockResolvedValue(3);
    prisma.session.count.mockResolvedValue(5);
    prisma.erasure_log.count.mockResolvedValue(2);
    const report = await service.purge({ now: NOW, dryRun: true });
    expect(report).toMatchObject({ dryRun: true, files: 1, fileObjects: 1, chatMessages: 3, sessions: 5, erasureLogRows: 2 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
    for (const m of ['file', 'folder', 'message', 'discussion_reply', 'session', 'email_code', 'erasure_log']) {
      expect(prisma[m].deleteMany).not.toHaveBeenCalled();
      expect(tx[m].deleteMany).not.toHaveBeenCalled();
    }
    expect(replay.retryStorage).not.toHaveBeenCalled();
  });
});

describe('bounded and safe', () => {
  test('one failing kind does not stop the others, and nothing throws', async () => {
    const { prisma, service } = setup();
    prisma.file.findMany.mockRejectedValue(new Error('db hiccup'));
    prisma.message.findMany.mockResolvedValueOnce([{ id: U(1), school_id: SCHOOL }]).mockResolvedValue([]);
    const report = await service.purge({ now: NOW });
    expect(report.errors).toEqual(['files: db hiccup']);
    expect(prisma.message.findMany).toHaveBeenCalled();
  });

  test('stops when the time budget is used up', async () => {
    process.env.RETENTION_PURGE_MAX_MINUTES = '1';
    const { prisma, service } = setup();
    const realNow = Date.now;
    let calls = 0;
    Date.now = () => realNow() + (calls++ > 1 ? 2 * 60_000 : 0);
    try {
      prisma.file.findMany.mockResolvedValue([]);
      const report = await service.purge({ now: NOW });
      expect(report.timedOut).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });
});
