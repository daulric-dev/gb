import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockPrisma } from '@/test/prisma-mock';
import { createFakeStorage } from '@/test/erasure-mocks';
import { expectRejection } from '@/test/mocks';
import { objectKeyFor, signEntry, type ErasureEntry } from './erasure-log.service';
import { ErasureReplayService, mergeEntries } from './erasure-replay.service';
import { OCCURRED_AT, plan, type ReplayPlan } from './erasure-plan';

const U = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const SCHOOL = U(900);

function entry(id: string, at: string, replay: ReplayPlan, kind = 'file'): ErasureEntry {
  return {
    v: 1,
    id,
    occurred_at: at,
    kind,
    subject_table: 'file_manager.file',
    subject_ids: [U(1)],
    school_id: SCHOOL,
    actor: 'system',
    reason: 'retention_purge',
    replay,
  };
}
const signed = (e: ErasureEntry): ErasureEntry => ({ ...e, sig: signEntry(e) });

/**
 * A tiny stand-in for the database the replay talks to with raw SQL: tables
 * of rows keyed by id. It understands exactly the statements compileStep
 * writes for an `id = ANY(...)` filter, which is enough to see real
 * idempotency - the second run deletes nothing and updates nothing.
 */
function fakeDb(tables: Record<string, Record<string, Record<string, unknown>>>) {
  const prisma = createMockPrisma();
  const log = new Set<string>();
  const tableOf = (sql: string) => sql.match(/"(\w+)"\."(\w+)"/)!.slice(1).join('.');
  const exec = async (sql: string, ...params: unknown[]) => {
    const rows = (tables[tableOf(sql)] ??= {});
    const ids = (params[0] as string[]).filter((id) => id in rows);
    if (sql.startsWith('DELETE')) {
      for (const id of ids) delete rows[id];
      return ids.length;
    }
    if (sql.startsWith('UPDATE')) {
      // Only the deleted_at COALESCE / body-null shapes used below.
      let n = 0;
      for (const id of ids) {
        const r = rows[id];
        const changes = sql.includes('"deleted_at" IS NULL') && r.deleted_at == null;
        const blank = sql.includes('"body" IS NOT NULL') && r.body != null;
        if (changes || blank) {
          if (sql.includes('"deleted_at" = COALESCE')) r.deleted_at ??= params[1];
          if (sql.includes('"body" = NULL')) r.body = null;
          n++;
        }
      }
      return n;
    }
    throw new Error(`unexpected SQL ${sql}`);
  };
  prisma.$executeRawUnsafe.mockImplementation(exec);
  prisma.$queryRawUnsafe.mockImplementation(async (sql: string, ...params: unknown[]) => {
    const rows = tables[tableOf(sql)] ?? {};
    const ids = (params[0] as string[]).filter((id) => id in rows);
    if (sql.startsWith('SELECT "bucket"')) return ids.map((id) => rows[id]);
    return [{ n: ids.length }];
  });
  prisma.erasure_log.createMany.mockImplementation(async ({ data }: any) => {
    const fresh = data.filter((d: any) => !log.has(d.id));
    for (const d of fresh) log.add(d.id);
    return { count: fresh.length };
  });
  prisma.erasure_log.count.mockImplementation(async ({ where }: any) => (log.has(where.id) ? 1 : 0));
  return { prisma, tables, log };
}

describe('mergeEntries', () => {
  test('union of the sources, one per id, oldest first (ties by id)', () => {
    const p = plan.of(plan.del('chat.message', { id: [U(1)] }));
    const a = entry(U(3), '2026-10-25T10:00:00Z', p);
    const b = entry(U(2), '2026-10-25T09:00:00Z', p);
    const c = entry(U(1), '2026-10-25T10:00:00Z', p);
    const merged = mergeEntries([a, b], [b, c, a]);
    expect(merged.map((e) => e.id)).toEqual([U(2), U(1), U(3)]);
  });
});

describe('ErasureReplayService', () => {
  test('re-applies a restored soft delete and purge, then a second run changes nothing', async () => {
    const fileId = U(10);
    const msgId = U(11);
    const { prisma, tables } = fakeDb({
      'file_manager.file': { [fileId]: { id: fileId, bucket: 'file-manager', storage_path: `${SCHOOL}/x/${fileId}-a.pdf`, deleted_at: null } },
      'chat.message': { [msgId]: { id: msgId, body: 'ciphertext', deleted_at: null } },
    });
    const storage = createFakeStorage({ [`file-manager/${SCHOOL}/x/${fileId}-a.pdf`]: 'bytes' });
    const replay = new ErasureReplayService(prisma as any, storage as any);
    const entries = [
      entry(U(1), '2026-10-25T10:00:00Z', plan.of(plan.update('file_manager.file', { id: [fileId] }, { deleted_at: OCCURRED_AT }))),
      entry(U(2), '2026-10-25T10:01:00Z', plan.of(plan.update('chat.message', { id: [msgId] }, { body: null, deleted_at: OCCURRED_AT })), 'chat_message'),
      entry(U(3), '2026-11-25T10:00:00Z', plan.of(plan.del('file_manager.file', { id: [fileId] }, true))),
    ];

    const first = await replay.replay(entries);
    expect(first).toMatchObject({ entries: 3, applied: 3, unchanged: 0, failed: 0, objects: 1 });
    expect(tables['file_manager.file'][fileId]).toBeUndefined();
    expect(tables['chat.message'][msgId]).toMatchObject({ body: null, deleted_at: new Date('2026-10-25T10:01:00Z') });
    expect(storage.objects.size).toBe(0);

    const second = await replay.replay(entries);
    expect(second).toMatchObject({ applied: 0, unchanged: 3, failed: 0, rows: 0, objects: 0 });
  });

  test('applies in time order even when the sources are out of order', async () => {
    const { prisma } = fakeDb({});
    const replay = new ErasureReplayService(prisma as any, createFakeStorage() as any);
    const p = plan.of(plan.del('chat.message', { id: [U(1)] }));
    const summary = await replay.replay([entry(U(2), '2026-10-26T00:00:00Z', p), entry(U(1), '2026-10-25T00:00:00Z', p)]);
    expect(summary.results.map((r) => r.id)).toEqual([U(1), U(2)]);
  });

  test('storage goes before rows: a storage failure leaves the rows for a retry', async () => {
    const fileId = U(10);
    const { prisma, tables } = fakeDb({
      'file_manager.file': { [fileId]: { id: fileId, bucket: 'file-manager', storage_path: 'k' } },
    });
    const storage = createFakeStorage({ 'file-manager/k': 'bytes' });
    storage.failDelete = true;
    const replay = new ErasureReplayService(prisma as any, storage as any);
    const e = entry(U(1), '2026-10-25T00:00:00Z', plan.of(plan.del('file_manager.file', { id: [fileId] }, true)));

    const failed = await replay.replay([e]);
    expect(failed.failed).toBe(1);
    expect(failed.results[0].error).toBe('storage down');
    expect(tables['file_manager.file'][fileId]).toBeDefined();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    storage.failDelete = false;
    const retried = await replay.replay([e]);
    expect(retried.failed).toBe(0);
    expect(tables['file_manager.file'][fileId]).toBeUndefined();
    expect(storage.objects.size).toBe(0);
  });

  test('a dry run reports what would change and changes nothing', async () => {
    const fileId = U(10);
    const { prisma, tables } = fakeDb({
      'file_manager.file': { [fileId]: { id: fileId, bucket: 'file-manager', storage_path: 'k' } },
    });
    const storage = createFakeStorage({ 'file-manager/k': 'bytes' });
    const replay = new ErasureReplayService(prisma as any, storage as any);
    const e = entry(U(1), '2026-10-25T00:00:00Z', plan.of(plan.del('file_manager.file', { id: [fileId] }, true)));

    const summary = await replay.replay([e], { dryRun: true });
    expect(summary.results[0]).toMatchObject({ rows: 1, objects: 1, restoredLogRow: true });
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(tables['file_manager.file'][fileId]).toBeDefined();
  });

  test('entries missing from the restored log are written back once', async () => {
    const { prisma, log } = fakeDb({});
    const replay = new ErasureReplayService(prisma as any, createFakeStorage() as any);
    const e = signed(entry(U(1), '2026-10-25T00:00:00Z', plan.of(plan.del('chat.message', { id: [U(5)] }))));
    expect((await replay.replay([e])).results[0].restoredLogRow).toBe(true);
    expect(log.has(U(1))).toBe(true);
    expect(prisma.erasure_log.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
    expect((await replay.replay([e])).results[0].restoredLogRow).toBe(false);
  });

  test('an invalid plan fails that entry only', async () => {
    const { prisma } = fakeDb({});
    const replay = new ErasureReplayService(prisma as any, createFakeStorage() as any);
    const bad = entry(U(1), '2026-10-25T00:00:00Z', { v: 1, steps: [{ op: 'delete', table: 'public.school', where: { id: [U(2)] } }] } as any);
    const good = entry(U(2), '2026-10-25T00:00:01Z', plan.of(plan.del('chat.message', { id: [U(5)] })));
    const summary = await replay.replay([bad, good]);
    expect(summary.failed).toBe(1);
    expect(summary.results[1].error).toBeUndefined();
  });
});

describe('sources', () => {
  test('database and storage copies are unioned and de-duplicated by id', async () => {
    const prisma = createMockPrisma();
    const p = plan.of(plan.del('chat.message', { id: [U(5)] }));
    const inBoth = entry(U(1), '2026-10-25T10:00:00.000Z', p);
    const onlyStored = entry(U(2), '2026-10-26T10:00:00.000Z', p);
    const tooOld = entry(U(3), '2026-10-20T10:00:00.000Z', p);
    prisma.erasure_log.findMany.mockResolvedValue([
      { ...inBoth, occurred_at: new Date(inBoth.occurred_at), replay: inBoth.replay },
    ]);
    const storage = createFakeStorage(
      Object.fromEntries(
        [inBoth, onlyStored, tooOld].map((e) => [objectKeyFor('erasure-log', e), JSON.stringify(signed(e))]),
      ),
    );
    const replay = new ErasureReplayService(prisma as any, storage as any);
    const since = new Date('2026-10-25T00:00:00Z');

    const db = await replay.fromDb(since);
    const stored = await replay.fromStorage(since);
    expect(stored.map((e) => e.id)).toEqual([U(1), U(2)]);
    expect(mergeEntries(db, stored).map((e) => e.id)).toEqual([U(1), U(2)]);
  });

  test('a tampered storage entry is refused unless --allow-unsigned', async () => {
    const e = entry(U(1), '2026-10-25T10:00:00.000Z', plan.of(plan.del('chat.message', { id: [U(5)] })));
    const forged = { ...signed(e), subject_ids: [U(9)] };
    const storage = createFakeStorage({ [objectKeyFor('erasure-log', e)]: JSON.stringify(forged) });
    const replay = new ErasureReplayService(createMockPrisma() as any, storage as any);
    const since = new Date('2026-10-25T00:00:00Z');
    expect(((await expectRejection(replay.fromStorage(since))) as Error).message).toContain('signature');
    expect(await replay.fromStorage(since, { allowUnsigned: true })).toHaveLength(1);
  });

  test('reads a JSON Lines file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'erasure-'));
    const path = join(dir, 'log.jsonl');
    const p = plan.of(plan.del('chat.message', { id: [U(5)] }));
    writeFileSync(path, [signed(entry(U(1), '2026-10-25T10:00:00Z', p)), signed(entry(U(2), '2026-10-01T10:00:00Z', p))].map((e) => JSON.stringify(e)).join('\n') + '\n');
    const replay = new ErasureReplayService(createMockPrisma() as any, createFakeStorage() as any);
    const got = await replay.fromFile(path, new Date('2026-10-20T00:00:00Z'));
    expect(got.map((e) => e.id)).toEqual([U(1)]);
  });
});

test('retryStorage re-runs only the prefix steps of recent account erasures', async () => {
  const prisma = createMockPrisma();
  const user = U(7);
  prisma.erasure_log.findMany.mockResolvedValue([
    { replay: plan.of(plan.prefixes([`images/avatars/${user}.`]), plan.del('account.app_user', { id: [user] })) },
  ]);
  const storage = createFakeStorage({ [`images/avatars/${user}.png`]: 'x', [`images/avatars/${U(8)}.png`]: 'y' });
  const replay = new ErasureReplayService(prisma as any, storage as any);
  expect(await replay.retryStorage('account', new Date(0))).toBe(1);
  expect([...storage.objects.keys()]).toEqual([`images/avatars/${U(8)}.png`]);
  expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
});
