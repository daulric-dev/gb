import { describe, expect, test } from 'bun:test';
import {
  BRIDGE_SQL,
  LAST_RELEASED_MIGRATION,
  bridgeStatements,
  loadBridgeMigrations,
  runLegacyBridge,
  type BridgeMigration,
} from './legacy-bridge';

function fakeDb(opts: { table: boolean; finished: string[]; failOn?: string }) {
  const executed: string[] = [];
  const recorded: string[] = [];
  const db = {
    $queryRawUnsafe: async (sql: string) => {
      if (sql === BRIDGE_SQL.hasMigrationsTable) return [{ present: opts.table }];
      if (sql === BRIDGE_SQL.finished) return opts.finished.map((migration_name) => ({ migration_name }));
      throw new Error(`unexpected ${sql}`);
    },
    $executeRawUnsafe: async (sql: string, ...p: unknown[]) => {
      if (sql === BRIDGE_SQL.markFailedDone) return 0;
      if (sql === BRIDGE_SQL.record) {
        recorded.push(p[2] as string);
        return 1;
      }
      if (opts.failOn && sql.includes(opts.failOn)) throw new Error('boom');
      executed.push(sql);
      return 0;
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db, executed, recorded };
}

const M = (name: string, sql: string): BridgeMigration => ({ name, sql });
const MIGRATIONS = [M('20261205100000_a', 'CREATE TABLE a (x int);'), M('20261205110000_b', 'ALTER TABLE a ADD y int; ALTER TABLE a ADD z int;')];

describe('legacy bridge (database built by the old SQL migrations)', () => {
  test('a database created by db push has no _prisma_migrations: skipped', async () => {
    const { db, executed } = fakeDb({ table: false, finished: [] });
    const out = await runLegacyBridge(db as any, MIGRATIONS);
    expect(out).toEqual([expect.objectContaining({ outcome: 'skipped' })]);
    expect(executed).toEqual([]);
  });

  test('a v1.4.0 database gets the unreleased migrations, in order, each recorded once', async () => {
    const { db, executed, recorded } = fakeDb({ table: true, finished: [LAST_RELEASED_MIGRATION] });
    const out = await runLegacyBridge(db as any, MIGRATIONS);
    expect(out.map((r) => [r.name, r.outcome])).toEqual([
      ['20261205100000_a', 'created'],
      ['20261205110000_b', 'created'],
    ]);
    expect(executed).toEqual(['CREATE TABLE a (x int)', 'ALTER TABLE a ADD y int', 'ALTER TABLE a ADD z int']);
    expect(recorded).toEqual(['20261205100000_a', '20261205110000_b']);
  });

  test('already bridged (or built by the full migration chain): no-op', async () => {
    const { db, executed } = fakeDb({ table: true, finished: [LAST_RELEASED_MIGRATION, ...MIGRATIONS.map((m) => m.name)] });
    expect(await runLegacyBridge(db as any, MIGRATIONS)).toEqual([expect.objectContaining({ outcome: 'unchanged' })]);
    expect(executed).toEqual([]);
  });

  test('older than v1.4.0: refuses, changes nothing', async () => {
    const { db, executed } = fakeDb({ table: true, finished: ['20261203100000_translation'] });
    const [r] = await runLegacyBridge(db as any, MIGRATIONS);
    expect(r.outcome).toBe('failed');
    expect(r.detail).toContain('v1.4.0');
    expect(executed).toEqual([]);
  });

  test('stops at the first failing migration', async () => {
    const { db, recorded } = fakeDb({ table: true, finished: [LAST_RELEASED_MIGRATION], failOn: 'CREATE TABLE a' });
    const out = await runLegacyBridge(db as any, MIGRATIONS);
    expect(out).toEqual([expect.objectContaining({ name: '20261205100000_a', outcome: 'failed' })]);
    expect(recorded).toEqual([]);
  });

  test('the shipped bridge files: the 26 unreleased migrations, with the two broken ones fixed', () => {
    const files = loadBridgeMigrations();
    expect(files).toHaveLength(26);
    expect(files[0].name).toBe('20261205100000_data_export');
    expect(files.at(-1)!.name).toBe('20261207100000_portable_database_functions');
    expect(files.every((f) => f.name > LAST_RELEASED_MIGRATION)).toBe(true);
    for (const f of files) {
      const statements = bridgeStatements(f.sql);
      expect(statements.length).toBeGreaterThan(0);
      expect(statements.some((s) => /^(BEGIN|COMMIT)$/i.test(s))).toBe(false);
    }
    const attendance = files.find((f) => f.name === '20261206110000_portable_attendance_flags')!;
    expect(bridgeStatements(attendance.sql)[0]).toStartWith('ALTER TABLE course.attendance_record');
    const erasure = files.find((f) => f.name === '20261206140000_portable_erasure_subject_ids')!;
    expect(bridgeStatements(erasure.sql)[0]).toContain('DROP CONSTRAINT IF EXISTS erasure_log_subject_ids_check');
  });
});
