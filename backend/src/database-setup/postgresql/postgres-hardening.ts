import { emptyReport, type DatabaseHardening, type HardeningDb, type HardeningReport, type ObjectResult } from '../types';
import { POSTGRES_CHECKS } from './checks';
import { runLegacyBridge, type BridgeMigration } from './legacy-bridge';
import {
  POSTGRES_EXPRESSION_INDEXES,
  POSTGRES_FUNCTIONS,
  POSTGRES_TRIGGERS,
  TRIGRAM_EXTENSION,
  type FunctionSpec,
  type IndexSpec,
  type TriggerSpec,
} from './objects';

/** `schema.table` -> [schema, table]. Names here are fixed identifiers, never input. */
const split = (qualified: string): [string, string] => {
  const [schema, table] = qualified.split('.');
  return [schema, table];
};

/** Whitespace-insensitive comparison of SQL printed by PostgreSQL. */
export const sameSql = (a: string, b: string): boolean =>
  a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/**
 * Every statement the PostgreSQL hardening issues. Catalogue reads take
 * parameters; DDL is built only from the constant specs in objects.ts and
 * checks.ts. Each DDL statement is idempotent on its own (OR REPLACE,
 * IF NOT EXISTS, IF EXISTS), and `apply` also reads the catalogue first so
 * an object already in place is not touched at all.
 */
export const PG = {
  functionBody: `SELECT p.prosrc AS body FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1 AND p.proname = $2 AND p.pronargs = 0`,
  createFunction: (f: FunctionSpec) =>
    `CREATE OR REPLACE FUNCTION ${f.schema}.${f.name}() RETURNS trigger LANGUAGE plpgsql${f.options ? ` ${f.options}` : ''} AS $function$${f.body}$function$`,

  triggerDef: `SELECT pg_get_triggerdef(t.oid) AS def FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname = $1 AND c.relname = $2 AND t.tgname = $3`,
  dropTrigger: (t: TriggerSpec) => `DROP TRIGGER IF EXISTS ${t.name} ON ${t.table}`,
  createTrigger: (t: TriggerSpec) => t.definition,

  indexDef: `SELECT pg_get_indexdef(i.oid) AS def FROM pg_class i JOIN pg_namespace n ON n.oid = i.relnamespace WHERE i.relkind = 'i' AND n.nspname = $1 AND i.relname = $2`,
  dropIndex: (i: IndexSpec) => `DROP INDEX IF EXISTS ${i.schema}.${i.name}`,
  createIndex: (i: IndexSpec) => i.definition.replace(/^CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS '),

  tableExists: `SELECT to_regclass($1) IS NOT NULL AS present`,
  checkDef: `SELECT pg_get_constraintdef(con.oid) AS def, con.convalidated AS validated FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE con.contype = 'c' AND n.nspname = $1 AND c.relname = $2 AND con.conname = $3`,
  dropCheck: (table: string, name: string) => `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`,
  // NOT VALID: new and updated rows are checked at once; existing rows by
  // the VALIDATE that follows, which may fail without undoing the ADD.
  addCheck: (table: string, name: string, def: string) => `ALTER TABLE ${table} ADD CONSTRAINT ${name} ${def} NOT VALID`,
  validateCheck: (table: string, name: string) => `ALTER TABLE ${table} VALIDATE CONSTRAINT ${name}`,

  extension: `SELECT extnamespace::regnamespace::text AS schema FROM pg_extension WHERE extname = $1`,
  extensionAvailable: `SELECT 1 AS ok FROM pg_available_extensions WHERE name = $1`,
  createExtension: (name: string) => `CREATE EXTENSION IF NOT EXISTS ${name}`,
} as const;

const TX = { maxWait: 60_000, timeout: 10 * 60_000 };

async function inTransaction(db: HardeningDb, statements: string[]): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const s of statements) await tx.$executeRawUnsafe(s);
  }, TX);
}

const message = (err: unknown) => (err as Error)?.message ?? String(err);

async function ensureFunction(db: HardeningDb, f: FunctionSpec): Promise<ObjectResult> {
  const name = `${f.schema}.${f.name}()`;
  const [row] = await db.$queryRawUnsafe<{ body: string }[]>(PG.functionBody, f.schema, f.name);
  if (row && sameSql(row.body, f.body)) return { kind: 'function', name, outcome: 'unchanged' };
  await db.$executeRawUnsafe(PG.createFunction(f));
  return { kind: 'function', name, outcome: row ? 'replaced' : 'created' };
}

async function ensureTrigger(db: HardeningDb, t: TriggerSpec): Promise<ObjectResult> {
  const [schema, table] = split(t.table);
  const [row] = await db.$queryRawUnsafe<{ def: string }[]>(PG.triggerDef, schema, table, t.name);
  if (row && sameSql(row.def, t.definition)) return { kind: 'trigger', name: t.name, outcome: 'unchanged' };
  await inTransaction(db, [PG.dropTrigger(t), PG.createTrigger(t)]);
  return { kind: 'trigger', name: t.name, outcome: row ? 'replaced' : 'created' };
}

async function ensureIndex(db: HardeningDb, i: IndexSpec): Promise<ObjectResult> {
  const [row] = await db.$queryRawUnsafe<{ def: string }[]>(PG.indexDef, i.schema, i.name);
  if (row && sameSql(row.def, i.definition)) return { kind: 'index', name: i.name, outcome: 'unchanged' };
  // Replacing inside one transaction keeps the old index if the new one
  // cannot be built (duplicate rows).
  await inTransaction(db, row ? [PG.dropIndex(i), PG.createIndex(i)] : [PG.createIndex(i)]);
  return { kind: 'index', name: i.name, outcome: row ? 'replaced' : 'created' };
}

async function ensureCheck(db: HardeningDb, table: string, name: string, def: string): Promise<ObjectResult> {
  const [schema, relname] = split(table);
  const [exists] = await db.$queryRawUnsafe<{ present: boolean }[]>(PG.tableExists, table);
  if (!exists?.present) {
    return { kind: 'check', name: `${table}.${name}`, outcome: 'failed', detail: 'table not found (run prisma db push first)' };
  }
  const [row] = await db.$queryRawUnsafe<{ def: string; validated: boolean }[]>(PG.checkDef, schema, relname, name);
  const current = row?.def.replace(/\s+NOT VALID$/, '');
  let outcome: ObjectResult['outcome'] = 'unchanged';
  if (!row) {
    await db.$executeRawUnsafe(PG.addCheck(table, name, def));
    outcome = 'created';
  } else if (!sameSql(current, def)) {
    await inTransaction(db, [PG.dropCheck(table, name), PG.addCheck(table, name, def)]);
    outcome = 'replaced';
  } else if (row.validated) {
    return { kind: 'check', name: `${table}.${name}`, outcome };
  }
  try {
    await db.$executeRawUnsafe(PG.validateCheck(table, name));
  } catch (err) {
    return {
      kind: 'check',
      name: `${table}.${name}`,
      outcome: 'partial',
      detail: `enforced for new writes; existing rows violate it: ${message(err)}`,
    };
  }
  return outcome === 'unchanged'
    ? { kind: 'check', name: `${table}.${name}`, outcome: 'replaced', detail: 'was NOT VALID; existing rows now validated' }
    : { kind: 'check', name: `${table}.${name}`, outcome };
}

async function attempt(kind: string, name: string, work: () => Promise<ObjectResult>): Promise<ObjectResult> {
  try {
    return await work();
  } catch (err) {
    return { kind, name, outcome: 'failed', detail: message(err) };
  }
}

/** pg_trgm must exist before `db push` builds the schema's trigram GIN indexes. */
async function ensureTrigram(db: HardeningDb): Promise<ObjectResult> {
  const name = TRIGRAM_EXTENSION;
  const [row] = await db.$queryRawUnsafe<{ schema: string }[]>(PG.extension, name);
  if (row) return { kind: 'extension', name, outcome: 'unchanged', detail: `in schema ${row.schema}` };
  const available = await db.$queryRawUnsafe<{ ok: number }[]>(PG.extensionAvailable, name);
  if (available.length === 0) {
    return {
      kind: 'extension',
      name,
      outcome: 'failed',
      detail:
        'pg_trgm is not installed on this PostgreSQL server (it ships with the contrib package). ' +
        'The schema declares trigram GIN indexes on student names, so `prisma db push` needs it.',
    };
  }
  try {
    await db.$executeRawUnsafe(PG.createExtension(name));
  } catch (err) {
    return {
      kind: 'extension',
      name,
      outcome: 'failed',
      detail: `CREATE EXTENSION pg_trgm failed (${message(err)}); ask the database owner to run it once.`,
    };
  }
  return { kind: 'extension', name, outcome: 'created' };
}

export class PostgresHardening implements DatabaseHardening {
  readonly provider = 'postgresql' as const;

  constructor(private readonly bridge?: BridgeMigration[]) {}

  async prepare(db: HardeningDb): Promise<HardeningReport> {
    const report = emptyReport(this.provider, true);
    report.results.push(await attempt('extension', TRIGRAM_EXTENSION, () => ensureTrigram(db)));
    try {
      report.results.push(...(await runLegacyBridge(db, this.bridge)));
    } catch (err) {
      report.results.push({ kind: 'legacy-bridge', name: 'check', outcome: 'failed', detail: message(err) });
    }
    return report;
  }

  async apply(db: HardeningDb): Promise<HardeningReport> {
    const report = emptyReport(this.provider, true);
    for (const f of POSTGRES_FUNCTIONS) {
      report.results.push(await attempt('function', `${f.schema}.${f.name}()`, () => ensureFunction(db, f)));
    }
    for (const t of POSTGRES_TRIGGERS) {
      report.results.push(await attempt('trigger', t.name, () => ensureTrigger(db, t)));
    }
    for (const i of POSTGRES_EXPRESSION_INDEXES) {
      report.results.push(await attempt('index', i.name, () => ensureIndex(db, i)));
    }
    for (const [table, name, def] of POSTGRES_CHECKS) {
      report.results.push(await attempt('check', `${table}.${name}`, () => ensureCheck(db, table, name, def)));
    }
    for (const r of report.results) {
      if (r.outcome === 'partial') report.warnings.push(`${r.kind} ${r.name}: ${r.detail}`);
    }
    return report;
  }
}
