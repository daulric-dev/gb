import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EXTRA_ACTIONS } from './permission.catalog';

const MIGRATIONS = join(__dirname, '../../prisma/migrations');

/** The action list of the newest permission_catalog_action_check definition. */
function allowedActions(): string[] {
  const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  let latest: string | null = null;
  for (const dir of dirs) {
    const sql = readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
    const defs = [
      ...sql.matchAll(/permission_catalog_action_check\s+CHECK\s*\(\(action = ANY \(ARRAY\[([^\]]*)\]/g),
    ];
    if (defs.length > 0) latest = defs[defs.length - 1][1];
  }
  if (!latest) throw new Error('permission_catalog_action_check not found in any migration');
  return [...latest.matchAll(/'([a-z-]+)'::text/g)].map((m) => m[1]);
}

describe('permission_catalog action CHECK', () => {
  test('allows every action the catalog uses, so migrations and the boot sync can insert them', () => {
    const allowed = allowedActions();
    for (const action of ['create', 'read', 'update', 'delete', ...EXTRA_ACTIONS]) {
      expect(allowed).toContain(action);
    }
  });
});
