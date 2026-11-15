import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createMockPrisma } from '@/test/prisma-mock';
import { auditStore, auditStoreFor, type AuditTx } from './audit-store';

const CUTOFF = new Date('2024-11-14T00:00:00Z');

describe('AuditStore', () => {
  test('appends go to the right table; nothing else is touched', async () => {
    const prisma = createMockPrisma();
    const store = auditStoreFor('postgresql');
    prisma.audit_log.create.mockResolvedValue({ id: 'a1' });
    prisma.sso_audit_log.createMany.mockResolvedValue({ count: 2 });
    const tx = prisma as unknown as AuditTx;

    expect((await store.appendAuditLog(tx, { scope: 'school', entity: 'x', action: 'create', changes: {} } as any)) as unknown).toEqual({ id: 'a1' });
    expect(await store.append(tx, 'sso_audit_log', [{} as any, {} as any])).toBe(2);
    expect(await store.append(tx, 'integration_audit_log', [])).toBe(0);
    expect(prisma.integration_audit_log.createMany).not.toHaveBeenCalled();
    // An append never opens the purge path.
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  test('PostgreSQL purge: opens the transaction-local bypass, then deletes only listed, expired ids', async () => {
    const prisma = createMockPrisma();
    prisma.integration_audit_log.deleteMany.mockResolvedValue({ count: 2 });
    const n = await auditStoreFor('postgresql').purgeExpired(prisma as unknown as AuditTx, 'integration_audit_log', ['i1', 'i2'], CUTOFF);
    expect(n).toBe(2);
    expect(String(prisma.$queryRaw.mock.calls[0][0])).toContain("set_config('gradebook.audit_purge', 'on', true)");
    expect(prisma.integration_audit_log.deleteMany.mock.calls[0][0]).toEqual({
      where: { id: { in: ['i1', 'i2'] }, created_at: { lt: CUTOFF } },
    });
    expect(prisma.audit_log.deleteMany).not.toHaveBeenCalled();
  });

  test('scrubActor clears only the copied name/email of those accounts, skipping rows already clear', async () => {
    const prisma = createMockPrisma();
    prisma.audit_log.updateMany.mockResolvedValue({ count: 3 });
    expect(await auditStoreFor('postgresql').scrubActor(prisma as unknown as AuditTx, ['u1'])).toBe(3);
    expect(prisma.audit_log.updateMany.mock.calls[0][0]).toEqual({
      where: { actor_id: { in: ['u1'] }, OR: [{ actor_name: { not: null } }, { actor_email: { not: null } }] },
      data: { actor_name: null, actor_email: null },
    });
  });

  test('other providers: no PostgreSQL session setting; empty lists do nothing', async () => {
    const prisma = createMockPrisma();
    const store = auditStoreFor('mysql');
    await store.purgeExpired(prisma as unknown as AuditTx, 'audit_log', ['a1'], CUTOFF);
    await store.scrubActor(prisma as unknown as AuditTx, ['u1']);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.audit_log.deleteMany).toHaveBeenCalledTimes(1);

    const again = createMockPrisma();
    expect(await store.purgeExpired(again as unknown as AuditTx, 'audit_log', [], CUTOFF)).toBe(0);
    expect(await store.scrubActor(again as unknown as AuditTx, [])).toBe(0);
    expect(again.audit_log.deleteMany).not.toHaveBeenCalled();
    expect(again.audit_log.updateMany).not.toHaveBeenCalled();
  });

  test('auditStore() follows the client, then DATABASE_URL', () => {
    expect(auditStore({ _activeProvider: 'sqlite' }).provider).toBe('sqlite');
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://u@h/db';
    try {
      expect(auditStore().provider).toBe('postgresql');
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved;
    }
  });
});

// ── repository guard: nothing but the store changes audit rows ───────────────

const ROOT = join(__dirname, '..', '..');
/** Allowed: the store itself, and the PostgreSQL setup layer (trigger SQL, legacy bridge). */
const ALLOWED = [join('src', 'audit-log', 'audit-store.ts'), join('src', 'database-setup', 'postgresql')];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'generated' || name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|sql)$/.test(name) && !name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

const TABLES = '(?:audit_log|sso_audit_log|integration_audit_log)';
const RULES: [string, RegExp][] = [
  ['Prisma write', new RegExp(`\\.${TABLES}\\.(?:create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\\(`)],
  ['raw UPDATE/DELETE/TRUNCATE', new RegExp(`\\b(?:UPDATE|DELETE\\s+FROM|TRUNCATE(?:\\s+TABLE)?)\\s+(?:ONLY\\s+)?(?:"?public"?\\.)?"?${TABLES}\\b`, 'i')],
  ['purge bypass', /gradebook\.audit_purge/],
];

function violations(files: string[]): string[] {
  const out: string[] = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (ALLOWED.some((a) => rel === a || rel.startsWith(a + '/'))) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const [what, re] of RULES) if (re.test(line)) out.push(`${rel}:${i + 1} ${what}`);
      });
  }
  return out;
}

describe('audit tables are append-only for application code', () => {
  test('no other code updates, deletes, truncates or appends to them', () => {
    const files = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'scripts'))];
    expect(violations(files)).toEqual([]);
  });

  test('the rules catch the forms they are meant to (self-check)', () => {
    const hit = (line: string) => RULES.some(([, re]) => re.test(line));
    expect(hit('await tx.audit_log.deleteMany({ where })')).toBe(true);
    expect(hit('await tx.sso_audit_log.updateMany({})')).toBe(true);
    expect(hit("await tx.$executeRawUnsafe('DELETE FROM public.audit_log WHERE id = $1')")).toBe(true);
    expect(hit('UPDATE "public"."integration_audit_log" SET x = 1')).toBe(true);
    expect(hit("SELECT set_config('gradebook.audit_purge', 'on', true)")).toBe(true);
    expect(hit('await tx.audit_log.findMany({})')).toBe(false);
  });
});
