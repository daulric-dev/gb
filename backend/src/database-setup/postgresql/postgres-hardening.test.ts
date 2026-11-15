import { describe, expect, test } from 'bun:test';
import { POSTGRES_CHECKS } from './checks';
import { POSTGRES_EXPRESSION_INDEXES, POSTGRES_FUNCTIONS, POSTGRES_TRIGGERS } from './objects';
import { PG, PostgresHardening, sameSql } from './postgres-hardening';

/**
 * A tiny stand-in for the PostgreSQL catalogue: it answers the hardening's
 * catalogue reads and applies its DDL, so tests can run `apply` twice and
 * see what a real database would end up with.
 */
class FakeCatalogue {
  functions = new Map<string, string>();
  triggers = new Map<string, string>();
  indexes = new Map<string, string>();
  checks = new Map<string, { def: string; validated: boolean }>();
  extensions = new Map<string, string>();
  available = new Set(['pg_trgm']);
  /** Checks whose VALIDATE fails (existing rows violate them). */
  violating = new Set<string>();
  ddl: string[] = [];

  $queryRawUnsafe = async (sql: string, ...p: any[]): Promise<any[]> => {
    if (sql === PG.functionBody) {
      const body = this.functions.get(`${p[0]}.${p[1]}`);
      return body === undefined ? [] : [{ body }];
    }
    if (sql === PG.triggerDef) {
      const def = this.triggers.get(`${p[0]}.${p[1]}.${p[2]}`);
      return def === undefined ? [] : [{ def }];
    }
    if (sql === PG.indexDef) {
      const def = this.indexes.get(`${p[0]}.${p[1]}`);
      return def === undefined ? [] : [{ def }];
    }
    if (sql === PG.tableExists) return [{ present: true }];
    if (sql === PG.checkDef) {
      const c = this.checks.get(`${p[0]}.${p[1]}.${p[2]}`);
      return c ? [{ def: c.validated ? c.def : `${c.def} NOT VALID`, validated: c.validated }] : [];
    }
    if (sql === PG.extension) {
      const schema = this.extensions.get(p[0]);
      return schema ? [{ schema }] : [];
    }
    if (sql === PG.extensionAvailable) return this.available.has(p[0]) ? [{ ok: 1 }] : [];
    throw new Error(`unexpected query: ${sql}`);
  };

  $executeRawUnsafe = async (sql: string): Promise<number> => {
    this.ddl.push(sql);
    let m: RegExpExecArray | null;
    if ((m = /^CREATE OR REPLACE FUNCTION (\w+)\.(\w+)\(\)[\s\S]*?AS \$function\$([\s\S]*)\$function\$$/.exec(sql))) {
      this.functions.set(`${m[1]}.${m[2]}`, m[3]);
    } else if ((m = /^DROP TRIGGER IF EXISTS (\w+) ON (\w+)\.(\w+)$/.exec(sql))) {
      this.triggers.delete(`${m[2]}.${m[3]}.${m[1]}`);
    } else if ((m = /^CREATE TRIGGER (\w+) .* ON (\w+)\.(\w+) FOR EACH/.exec(sql))) {
      const key = `${m[2]}.${m[3]}.${m[1]}`;
      if (this.triggers.has(key)) throw new Error(`trigger ${m[1]} already exists`);
      this.triggers.set(key, sql);
    } else if ((m = /^CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+) ON (\w+)\./.exec(sql))) {
      const key = `${m[3]}.${m[2]}`;
      if (!this.indexes.has(key)) this.indexes.set(key, sql.replace(' IF NOT EXISTS', ''));
    } else if ((m = /^DROP INDEX IF EXISTS (\w+)\.(\w+)$/.exec(sql))) {
      this.indexes.delete(`${m[1]}.${m[2]}`);
    } else if ((m = /^ALTER TABLE (\w+)\.(\w+) ADD CONSTRAINT (\w+) ([\s\S]*) NOT VALID$/.exec(sql))) {
      const key = `${m[1]}.${m[2]}.${m[3]}`;
      if (this.checks.has(key)) throw new Error(`constraint ${m[3]} already exists`);
      this.checks.set(key, { def: m[4], validated: false });
    } else if ((m = /^ALTER TABLE (\w+)\.(\w+) VALIDATE CONSTRAINT (\w+)$/.exec(sql))) {
      const key = `${m[1]}.${m[2]}.${m[3]}`;
      if (this.violating.has(key)) throw new Error('check constraint is violated by some row');
      this.checks.get(key)!.validated = true;
    } else if ((m = /^ALTER TABLE (\w+)\.(\w+) DROP CONSTRAINT IF EXISTS (\w+)$/.exec(sql))) {
      this.checks.delete(`${m[1]}.${m[2]}.${m[3]}`);
    } else if ((m = /^CREATE EXTENSION IF NOT EXISTS (\w+)$/.exec(sql))) {
      this.extensions.set(m[1], 'public');
    } else {
      throw new Error(`unexpected statement: ${sql}`);
    }
    return 0;
  };

  $transaction = async (fn: (tx: this) => Promise<unknown>) => fn(this);

  /** The catalogue of a database built by the old migrations: everything in place. */
  static complete(): FakeCatalogue {
    const db = new FakeCatalogue();
    for (const f of POSTGRES_FUNCTIONS) db.functions.set(`${f.schema}.${f.name}`, f.body);
    for (const t of POSTGRES_TRIGGERS) db.triggers.set(`${t.table}.${t.name}`, t.definition);
    for (const i of POSTGRES_EXPRESSION_INDEXES) db.indexes.set(`${i.schema}.${i.name}`, i.definition);
    for (const [table, name, def] of POSTGRES_CHECKS) db.checks.set(`${table}.${name}`, { def, validated: true });
    db.extensions.set('pg_trgm', 'extensions');
    return db;
  }
}

const TOTAL =
  POSTGRES_FUNCTIONS.length + POSTGRES_TRIGGERS.length + POSTGRES_EXPRESSION_INDEXES.length + POSTGRES_CHECKS.length;

describe('PostgreSQL hardening', () => {
  test('on a database that already has everything (built by the old migrations) it changes nothing', async () => {
    const db = FakeCatalogue.complete();
    const report = await new PostgresHardening().apply(db as any);
    expect(report.results).toHaveLength(TOTAL);
    expect(report.results.filter((r) => r.outcome !== 'unchanged')).toEqual([]);
    expect(db.ddl).toEqual([]);
  });

  test('on a fresh database it creates everything, and a second run is a no-op', async () => {
    const db = new FakeCatalogue();
    const first = await new PostgresHardening().apply(db as any);
    expect(first.results.filter((r) => r.outcome !== 'created')).toEqual([]);
    expect(db.triggers.size).toBe(POSTGRES_TRIGGERS.length);
    expect([...db.checks.values()].every((c) => c.validated)).toBe(true);

    db.ddl = [];
    const second = await new PostgresHardening().apply(db as any);
    expect(second.results.every((r) => r.outcome === 'unchanged')).toBe(true);
    expect(db.ddl).toEqual([]);
  });

  test('a changed definition is replaced, inside a transaction for triggers, indexes and checks', async () => {
    const db = FakeCatalogue.complete();
    const [table, name] = POSTGRES_CHECKS.find(([t]) => t === 'public.permission_catalog')!;
    db.checks.set(`${table}.${name}`, { def: "CHECK ((action = 'read'::text))", validated: true });
    db.triggers.set('student.student.student_set_left_at', 'CREATE TRIGGER student_set_left_at BEFORE UPDATE ON student.student FOR EACH ROW EXECUTE FUNCTION x()');
    db.functions.set('grading.peer_review_allocation_not_self', 'BEGIN RETURN NEW; END;');
    const report = await new PostgresHardening().apply(db as any);
    const changed = report.results.filter((r) => r.outcome !== 'unchanged');
    expect(changed.map((r) => [r.kind, r.outcome])).toEqual([
      ['function', 'replaced'],
      ['trigger', 'replaced'],
      ['check', 'replaced'],
    ]);
    expect(db.ddl).toContain(PG.dropCheck(table, name));
    expect(sameSql(db.functions.get('grading.peer_review_allocation_not_self')!, POSTGRES_FUNCTIONS[3].body)).toBe(true);
  });

  test('a CHECK that existing rows violate is still added (NOT VALID) and reported, not fatal', async () => {
    const db = FakeCatalogue.complete();
    const [table, name] = POSTGRES_CHECKS[0];
    db.checks.delete(`${table}.${name}`);
    db.violating.add(`${table}.${name}`);
    const report = await new PostgresHardening().apply(db as any);
    const r = report.results.find((x) => x.name === `${table}.${name}`)!;
    expect(r.outcome).toBe('partial');
    expect(report.warnings[0]).toContain(name);
    expect(db.checks.get(`${table}.${name}`)!.validated).toBe(false);
    // Next run: tries VALIDATE again, nothing else.
    db.ddl = [];
    await new PostgresHardening().apply(db as any);
    expect(db.ddl).toEqual([PG.validateCheck(table, name)]);
  });

  test('one failing object does not stop the others', async () => {
    const db = new FakeCatalogue();
    const real = db.$executeRawUnsafe;
    db.$executeRawUnsafe = async (sql: string) => {
      if (sql.includes('assignment_group_course_name_key')) throw new Error('could not create unique index');
      return real(sql);
    };
    const report = await new PostgresHardening().apply(db as any);
    expect(report.results.filter((r) => r.outcome === 'failed').map((r) => r.name)).toEqual([
      'assignment_group_course_name_key',
    ]);
    expect(report.results.filter((r) => r.outcome === 'created')).toHaveLength(TOTAL - 1);
  });

  test('every DDL statement is safe to repeat on its own or is guarded by a catalogue read', () => {
    for (const f of POSTGRES_FUNCTIONS) expect(PG.createFunction(f)).toStartWith('CREATE OR REPLACE FUNCTION ');
    for (const t of POSTGRES_TRIGGERS) expect(PG.dropTrigger(t)).toStartWith('DROP TRIGGER IF EXISTS ');
    for (const i of POSTGRES_EXPRESSION_INDEXES) {
      expect(PG.createIndex(i)).toMatch(/^CREATE (UNIQUE )?INDEX IF NOT EXISTS /);
      expect(PG.dropIndex(i)).toStartWith('DROP INDEX IF EXISTS ');
    }
    expect(PG.dropCheck('public.x', 'y')).toBe('ALTER TABLE public.x DROP CONSTRAINT IF EXISTS y');
    expect(PG.createExtension('pg_trgm')).toBe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  });

  test('the object lists are well-formed: unique names, qualified tables, printed CHECK form', () => {
    const checkKeys = POSTGRES_CHECKS.map(([t, n]) => `${t}.${n}`);
    expect(new Set(checkKeys).size).toBe(checkKeys.length);
    for (const [table, name, def] of POSTGRES_CHECKS) {
      expect(table).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(name).toMatch(/^[a-z0-9_]+$/);
      expect(def).toStartWith('CHECK (');
    }
    // The audit triggers cover all three audit tables, both ways.
    for (const t of ['audit_log', 'sso_audit_log', 'integration_audit_log']) {
      expect(POSTGRES_TRIGGERS.map((x) => x.name)).toEqual(expect.arrayContaining([`${t}_append_only`, `${t}_no_truncate`]));
    }
    // Expression indexes only: plain partial indexes belong to the Prisma schema.
    for (const i of POSTGRES_EXPRESSION_INDEXES) expect(i.definition).toMatch(/\(true\)|lower\(|upper\(|COALESCE\(/);
  });
});

describe('PostgreSQL prepare (before db push)', () => {
  const noBridge = { bridge: [] as never[] };

  test('creates pg_trgm when missing, leaves it alone when present', async () => {
    const fresh = new FakeCatalogue();
    const q = fresh.$queryRawUnsafe;
    fresh.$queryRawUnsafe = async (sql: string, ...p: any[]) => (/_prisma_migrations/.test(sql) ? [{ present: false }] : q(sql, ...p));
    const report = await new PostgresHardening(noBridge.bridge).prepare(fresh as any);
    expect(report.results[0]).toMatchObject({ kind: 'extension', outcome: 'created' });
    expect(report.results[1]).toMatchObject({ kind: 'legacy-bridge', outcome: 'skipped' });

    fresh.ddl = [];
    const again = await new PostgresHardening(noBridge.bridge).prepare(fresh as any);
    expect(again.results[0].outcome).toBe('unchanged');
    expect(fresh.ddl).toEqual([]);
  });

  test('fails clearly when pg_trgm is not installed on the server', async () => {
    const db = new FakeCatalogue();
    db.available.clear();
    const q = db.$queryRawUnsafe;
    db.$queryRawUnsafe = async (sql: string, ...p: any[]) => (/_prisma_migrations/.test(sql) ? [{ present: false }] : q(sql, ...p));
    const report = await new PostgresHardening([]).prepare(db as any);
    expect(report.results[0]).toMatchObject({ outcome: 'failed' });
    expect(report.results[0].detail).toContain('contrib');
  });
});
