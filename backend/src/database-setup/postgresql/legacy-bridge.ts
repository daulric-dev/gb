import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitSqlStatements } from '../sql-split';
import type { HardeningDb, ObjectResult } from '../types';

/**
 * One-time bridge for a PostgreSQL database built by the old SQL migrations
 * (`prisma migrate deploy`, release v1.4.0 and earlier).
 *
 * Released databases stop at `20261204100000_custom_oidc_sso`. The 26
 * migrations after it were never released; several convert PostgreSQL
 * arrays to child tables or JSON while copying the data. `prisma db push`
 * cannot do that: it would drop and re-add those columns (data loss, and it
 * refuses without `--accept-data-loss`). So, before the first push, this
 * applies those migrations, in order, each in its own transaction, and
 * records each in `_prisma_migrations` exactly as `migrate deploy` would.
 * Two of them had bugs that made them fail on every database; the copies in
 * `legacy-bridge/` carry the fixes (see the header of each file).
 *
 * Databases created by `prisma db push` have no `_prisma_migrations` table
 * and are skipped. Run again, it finds every migration recorded and does
 * nothing.
 */

/** The last migration a released version (v1.4.0) shipped. */
export const LAST_RELEASED_MIGRATION = '20261204100000_custom_oidc_sso';

export interface BridgeMigration {
  name: string;
  sql: string;
}

export const BRIDGE_DIR = join(__dirname, 'legacy-bridge');

export function loadBridgeMigrations(dir = BRIDGE_DIR): BridgeMigration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((f) => ({ name: f.replace(/\.sql$/, ''), sql: readFileSync(join(dir, f), 'utf8') }));
}

export const BRIDGE_SQL = {
  hasMigrationsTable: `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`,
  finished: `SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  markFailedDone: `UPDATE public._prisma_migrations SET finished_at = now(), checksum = $2, logs = NULL, applied_steps_count = 1 WHERE migration_name = $1 AND finished_at IS NULL AND rolled_back_at IS NULL`,
  record: `INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)`,
} as const;

/** Statements of one bridge migration, as run (transaction control left out). */
export function bridgeStatements(sql: string): string[] {
  return splitSqlStatements(sql).filter((s) => !/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s));
}

const TX = { maxWait: 60_000, timeout: 30 * 60_000 };

export async function runLegacyBridge(
  db: HardeningDb,
  migrations: BridgeMigration[] = loadBridgeMigrations(),
): Promise<ObjectResult[]> {
  const [{ present } = { present: false }] = await db.$queryRawUnsafe<{ present: boolean }[]>(
    BRIDGE_SQL.hasMigrationsTable,
  );
  if (!present) {
    return [
      {
        kind: 'legacy-bridge',
        name: '_prisma_migrations',
        outcome: 'skipped',
        detail: 'not built by the old SQL migrations; nothing to bridge',
      },
    ];
  }
  const done = new Set(
    (await db.$queryRawUnsafe<{ migration_name: string }[]>(BRIDGE_SQL.finished)).map(
      (r) => r.migration_name,
    ),
  );
  const pending = migrations.filter((m) => !done.has(m.name));
  if (pending.length === 0) {
    return [{ kind: 'legacy-bridge', name: 'all', outcome: 'unchanged' }];
  }
  if (!done.has(LAST_RELEASED_MIGRATION)) {
    return [
      {
        kind: 'legacy-bridge',
        name: LAST_RELEASED_MIGRATION,
        outcome: 'failed',
        detail:
          `this database predates ${LAST_RELEASED_MIGRATION} (release v1.4.0). Upgrade it to v1.4.0 first ` +
          '(check out v1.4.0 and run `bunx prisma migrate deploy` there), then run this release again.',
      },
    ];
  }

  const results: ObjectResult[] = [];
  for (const m of pending) {
    const checksum = createHash('sha256').update(m.sql).digest('hex');
    try {
      await db.$transaction(async (tx) => {
        for (const statement of bridgeStatements(m.sql)) await tx.$executeRawUnsafe(statement);
        const updated = await tx.$executeRawUnsafe(BRIDGE_SQL.markFailedDone, m.name, checksum);
        if (updated === 0) await tx.$executeRawUnsafe(BRIDGE_SQL.record, randomUUID(), checksum, m.name);
      }, TX);
      results.push({ kind: 'legacy-bridge', name: m.name, outcome: 'created' });
    } catch (err) {
      // Later migrations depend on earlier ones: stop at the first failure.
      results.push({ kind: 'legacy-bridge', name: m.name, outcome: 'failed', detail: (err as Error).message });
      break;
    }
  }
  return results;
}
