import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { createFakeStorage } from '@/test/erasure-mocks';
import { expectRejection } from '@/test/mocks';
import {
  ErasureLogService,
  objectKeyFor,
  signEntry,
  toEntry,
  verifyEntry,
  type ErasureInput,
} from './erasure-log.service';
import { OCCURRED_AT, plan } from './erasure-plan';
import { erasureLogPrefix, erasureLogRetentionDays } from './erasure.config';

const USER = '11111111-1111-4111-8111-111111111111';
const FILE = '22222222-2222-4222-8222-222222222222';
const SCHOOL = '33333333-3333-4333-8333-333333333333';

const input = (over: Partial<ErasureInput> = {}): ErasureInput => ({
  kind: 'file',
  subjectTable: 'file_manager.file',
  subjectIds: [FILE],
  schoolId: SCHOOL,
  actor: USER,
  reason: 'user_request',
  replay: plan.of(plan.update('file_manager.file', { id: [FILE] }, { deleted_at: OCCURRED_AT })),
  ...over,
});

const row = (id: string, at: string, over: Record<string, unknown> = {}) => ({
  id,
  occurred_at: new Date(at),
  kind: 'file',
  subject_table: 'file_manager.file',
  subject_ids: [FILE],
  school_id: SCHOOL,
  actor: USER,
  reason: 'user_request',
  replay: plan.of(plan.del('file_manager.file', { id: [FILE] }, true)),
  exported_at: null,
  ...over,
});

const ENV = ['ERASURE_LOG_S3_PREFIX', 'ERASURE_LOG_RETENTION_DAYS'];
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

describe('ErasureLogService.record', () => {
  let prisma: MockPrisma;
  let tx: MockPrisma;
  let service: ErasureLogService;

  beforeEach(() => {
    prisma = createMockPrisma();
    tx = createMockPrisma();
    tx.erasure_log.create.mockResolvedValue({ id: 'new-id' });
    service = new ErasureLogService(prisma as any, createFakeStorage() as any);
  });

  test('writes with the client it is given (the caller transaction), ids only', async () => {
    expect(await service.record(tx as any, input())).toBe('new-id');
    expect(prisma.erasure_log.create).not.toHaveBeenCalled();
    const { data } = tx.erasure_log.create.mock.calls[0][0];
    expect(Object.keys(data).sort()).toEqual(
      ['actor', 'kind', 'reason', 'replay', 'school_id', 'subject_ids', 'subject_table'].sort(),
    );
    expect(data).toMatchObject({
      kind: 'file',
      subject_table: 'file_manager.file',
      subject_ids: [FILE],
      school_id: SCHOOL,
      actor: USER,
      reason: 'user_request',
    });
  });

  test('de-duplicates subject ids and accepts the system actor', async () => {
    await service.record(tx as any, input({ subjectIds: [FILE, FILE], actor: 'system', reason: 'retention_purge' }));
    expect(tx.erasure_log.create.mock.calls[0][0].data.subject_ids).toEqual([FILE]);
    expect(tx.erasure_log.create.mock.calls[0][0].data.actor).toBe('system');
  });

  test('refuses anything that is not an id, so no personal data can be logged', async () => {
    for (const bad of [
      input({ actor: 'jane@example.com' }),
      input({ subjectIds: ['Jane Doe'] }),
      input({ schoolId: 'Riverside Academy' }),
      input({ kind: 'grade' as any }),
      input({ reason: 'because' as any }),
      input({ subjectTable: 'public.school' }),
      input({ replay: plan.of(plan.update('chat.message', { id: [FILE] }, { body: 'secret' })) }),
    ]) {
      await expectRejection(service.record(tx as any, bad));
    }
    expect(tx.erasure_log.create).not.toHaveBeenCalled();
  });

  test('a failing insert rejects, so the caller transaction rolls back', async () => {
    tx.erasure_log.create.mockRejectedValue(new Error('db down'));
    expect(((await expectRejection(service.record(tx as any, input()))) as Error).message).toBe('db down');
  });
});

describe('storage copy', () => {
  test('exports unexported rows as signed JSON objects and stamps them', async () => {
    const prisma = createMockPrisma();
    const storage = createFakeStorage();
    const service = new ErasureLogService(prisma as any, storage as any);
    const r = row('44444444-4444-4444-8444-444444444444', '2026-10-25T10:00:00.000Z');
    prisma.erasure_log.findMany.mockResolvedValueOnce([r]).mockResolvedValue([]);

    expect(await service.exportPending()).toBe(1);
    const key = 'erasure-log/2026/10/25/20261025T100000.000Z-44444444-4444-4444-8444-444444444444.json';
    expect([...storage.objects.keys()]).toEqual([key]);
    const stored = JSON.parse(storage.objects.get(key)!.toString());
    expect(verifyEntry(stored)).toBe(true);
    expect(prisma.erasure_log.updateMany.mock.calls[0][0].where).toEqual({ id: r.id, exported_at: null });
  });

  test('a storage failure leaves the row unexported for the next try', async () => {
    const prisma = createMockPrisma();
    const storage = createFakeStorage();
    storage.failPut = true;
    const service = new ErasureLogService(prisma as any, storage as any);
    prisma.erasure_log.findMany.mockResolvedValue([row(FILE, '2026-10-25T10:00:00Z')]);
    expect(await service.exportPending()).toBe(0);
    expect(prisma.erasure_log.updateMany).not.toHaveBeenCalled();
  });

  test('ERASURE_LOG_S3_PREFIX=off turns the copy off', async () => {
    process.env.ERASURE_LOG_S3_PREFIX = 'off';
    expect(erasureLogPrefix()).toBeNull();
    const prisma = createMockPrisma();
    const service = new ErasureLogService(prisma as any, createFakeStorage() as any);
    expect(await service.exportPending()).toBe(0);
    expect(prisma.erasure_log.findMany).not.toHaveBeenCalled();
  });

  test('signatures catch tampering', () => {
    const entry = toEntry(row(FILE, '2026-10-25T10:00:00Z'));
    const signed = { ...entry, sig: signEntry(entry) };
    expect(verifyEntry(signed)).toBe(true);
    expect(verifyEntry({ ...signed, subject_ids: [USER] })).toBe(false);
    expect(verifyEntry(entry)).toBe(false);
  });

  test('keys sort by time', () => {
    const a = objectKeyFor('p', { id: FILE, occurred_at: '2026-09-30T23:59:59Z' });
    const b = objectKeyFor('p', { id: USER, occurred_at: '2026-10-01T00:00:00Z' });
    expect(a < b).toBe(true);
  });
});

describe('retention of the log itself', () => {
  test('defaults to 400 days and prunes rows and objects older than that', async () => {
    expect(erasureLogRetentionDays()).toBe(400);
    const prisma = createMockPrisma();
    prisma.erasure_log.deleteMany.mockResolvedValue({ count: 3 });
    const storage = createFakeStorage({
      'erasure-log/2025/09/01/x.json': '{}',
      'erasure-log/2025/09/24/y.json': '{}',
      'erasure-log/2025/09/25/z.json': '{}',
      'erasure-log/2026/10/25/w.json': '{}',
    });
    const service = new ErasureLogService(prisma as any, storage as any);
    const now = new Date('2026-10-30T00:00:00Z'); // cutoff 2025-09-25

    expect(await service.prune(now)).toEqual({ rows: 3, objects: 2 });
    expect(prisma.erasure_log.deleteMany.mock.calls[0][0].where.occurred_at.lt.toISOString()).toBe(
      '2025-09-25T00:00:00.000Z',
    );
    expect([...storage.objects.keys()].sort()).toEqual([
      'erasure-log/2025/09/25/z.json',
      'erasure-log/2026/10/25/w.json',
    ]);
  });

  test('a dry run only counts', async () => {
    process.env.ERASURE_LOG_RETENTION_DAYS = '30';
    const prisma = createMockPrisma();
    prisma.erasure_log.count.mockResolvedValue(5);
    const storage = createFakeStorage({ 'erasure-log/2020/01/01/x.json': '{}' });
    const service = new ErasureLogService(prisma as any, storage as any);
    expect(await service.prune(new Date('2026-10-30T00:00:00Z'), true)).toEqual({ rows: 5, objects: 1 });
    expect(prisma.erasure_log.deleteMany).not.toHaveBeenCalled();
    expect(storage.objects.size).toBe(1);
  });
});
