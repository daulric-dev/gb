/**
 * The `replay` plan stored with every erasure-log entry, and the code that
 * turns it into SQL.
 *
 * A plan is data, and it may be read back from object storage, so nothing in
 * it is trusted: every table and column must be in REGISTRY below, every id
 * must be a uuid, set values are limited to blanking values (null, '', {})
 * plus uuids and the entry's own timestamp, and storage prefixes must be
 * uuid-only paths. Identifiers in the generated SQL come from REGISTRY, never
 * from the plan; values are always bound parameters.
 */

export const ERASURE_KINDS = [
  'account',
  'student',
  'school_membership',
  'file',
  'folder',
  'chat_message',
  'discussion_topic',
  'discussion_reply',
  'course',
  'attendance_session',
] as const;
export type ErasureKind = (typeof ERASURE_KINDS)[number];

export const ERASURE_REASONS = [
  'user_request',
  'admin',
  'retention_purge',
  'merge',
] as const;
export type ErasureReason = (typeof ERASURE_REASONS)[number];

/** Stands for "the entry's occurred_at, unless the column already has a value". */
export const OCCURRED_AT = '$occurred_at';

type ColumnType = 'uuid' | 'text' | 'jsonb' | 'timestamptz' | 'enum';

interface TableSpec {
  /** Columns a step may filter on (all uuid). */
  where: readonly string[];
  /** Columns an update step may set, with their types. */
  set: Readonly<Record<string, ColumnType>>;
  /** Rows carry an object-storage key (bucket + storage_path). */
  objects?: boolean;
}

export const REGISTRY: Readonly<Record<string, TableSpec>> = {
  'account.app_user': { where: ['id'], set: {} },
  'public.user_profile': {
    where: ['id', 'school_id'],
    set: { school_id: 'uuid', role: 'enum' },
  },
  'public.school_management': { where: ['id', 'user_id', 'school_id'], set: {} },
  'student.student': {
    where: ['id', 'user_profile_id'],
    set: { user_profile_id: 'uuid' },
  },
  'file_manager.file': {
    where: ['id', 'owner_id', 'folder_id'],
    set: { deleted_at: 'timestamptz' },
    objects: true,
  },
  'file_manager.folder': {
    where: ['id', 'owner_id'],
    set: { deleted_at: 'timestamptz' },
  },
  'chat.message': {
    where: ['id'],
    set: {
      body: 'text',
      metadata: 'jsonb',
      action_state: 'enum',
      deleted_at: 'timestamptz',
    },
  },
  'course.discussion_topic': { where: ['id'], set: {} },
  'course.discussion_reply': {
    where: ['id'],
    set: { body: 'text', deleted_at: 'timestamptz', author_user_profile_id: 'uuid' },
  },
  'course.course': { where: ['id'], set: {} },
  'course.attendance_session': { where: ['id'], set: {} },
};

/** Column filter: `col = ANY(uuids)`, or `col IS NULL` for null. */
export type StepWhere = Record<string, string[] | null>;
export type SetValue = null | '' | Record<string, never> | string;

export type ReplayStep =
  | {
      op: 'delete';
      table: string;
      where: StepWhere;
      /** Also delete the rows' storage objects (before the rows). */
      objects?: boolean;
    }
  | { op: 'update'; table: string; where: StepWhere; set: Record<string, SetValue> }
  | { op: 'delete_storage_prefix'; prefixes: string[] };

export interface ReplayPlan {
  v: 1;
  steps: ReplayStep[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** Storage prefixes a plan may name: a user's file-manager folder, an avatar. */
const PREFIX_RES = [
  new RegExp(`^file-manager/${UUID}/${UUID}/$`, 'i'),
  new RegExp(`^images/avatars/${UUID}\\.$`, 'i'),
];

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export class InvalidPlanError extends Error {}

function fail(msg: string): never {
  throw new InvalidPlanError(msg);
}

function checkWhere(table: string, where: unknown) {
  const spec = REGISTRY[table];
  if (!where || typeof where !== 'object' || Array.isArray(where)) fail(`${table}: where must be an object`);
  const entries = Object.entries(where as Record<string, unknown>);
  if (entries.length === 0) fail(`${table}: empty where`);
  // At least one non-null filter, so a step can never match a whole table.
  if (!entries.some(([, v]) => Array.isArray(v))) fail(`${table}: where needs an id list`);
  for (const [col, v] of entries) {
    if (!spec.where.includes(col)) fail(`${table}: cannot filter on ${col}`);
    if (v === null) continue;
    if (!Array.isArray(v) || v.length === 0 || !v.every(isUuid)) {
      fail(`${table}.${col}: expected a non-empty uuid list`);
    }
  }
}

function checkSetValue(table: string, col: string, type: ColumnType, v: unknown) {
  if (v === null) return;
  const ok =
    (type === 'uuid' && isUuid(v)) ||
    (type === 'text' && v === '') ||
    (type === 'jsonb' && !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) ||
    (type === 'timestamptz' && v === OCCURRED_AT);
  if (!ok) fail(`${table}.${col}: value not allowed`);
}

/** Throws InvalidPlanError unless `plan` is a well-formed, allowed plan. */
export function validatePlan(plan: unknown): asserts plan is ReplayPlan {
  if (!plan || typeof plan !== 'object') fail('plan must be an object');
  const p = plan as { v?: unknown; steps?: unknown };
  if (p.v !== 1) fail('unknown plan version');
  if (!Array.isArray(p.steps) || p.steps.length === 0) fail('plan has no steps');
  for (const raw of p.steps as unknown[]) {
    const step = raw as Record<string, unknown>;
    if (!step || typeof step !== 'object') fail('step must be an object');
    if (step.op === 'delete_storage_prefix') {
      const prefixes = step.prefixes;
      if (!Array.isArray(prefixes) || prefixes.length === 0) fail('no prefixes');
      for (const pre of prefixes) {
        if (typeof pre !== 'string' || !PREFIX_RES.some((re) => re.test(pre))) {
          fail(`storage prefix not allowed: ${String(pre)}`);
        }
      }
      continue;
    }
    if (step.op !== 'delete' && step.op !== 'update') fail(`unknown op ${String(step.op)}`);
    const table = step.table;
    if (typeof table !== 'string' || !REGISTRY[table]) fail(`table not allowed: ${String(table)}`);
    checkWhere(table, step.where);
    if (step.op === 'delete') {
      if (step.objects !== undefined && typeof step.objects !== 'boolean') fail('objects must be boolean');
      if (step.objects && !REGISTRY[table].objects) fail(`${table} has no storage objects`);
      continue;
    }
    const set = step.set;
    if (!set || typeof set !== 'object' || Array.isArray(set)) fail(`${table}: set must be an object`);
    const cols = Object.entries(set as Record<string, unknown>);
    if (cols.length === 0) fail(`${table}: empty set`);
    for (const [col, v] of cols) {
      const type = REGISTRY[table].set[col];
      if (!type) fail(`${table}: cannot set ${col}`);
      checkSetValue(table, col, type, v);
    }
  }
}

export interface CompiledSql {
  sql: string;
  params: unknown[];
}

const quoteTable = (table: string) =>
  table
    .split('.')
    .map((part) => `"${part}"`)
    .join('.');

function compileWhere(where: StepWhere, params: unknown[]): string {
  return Object.entries(where)
    .map(([col, v]) => {
      if (v === null) return `"${col}" IS NULL`;
      params.push(v);
      return `"${col}" = ANY($${params.length}::uuid[])`;
    })
    .join(' AND ');
}

/**
 * The SQL for one validated delete/update step. Updates only touch rows that
 * would change, so the affected-row count is 0 when the step was already
 * applied - that is what makes a second replay report "nothing to do".
 */
export function compileStep(
  step: Extract<ReplayStep, { op: 'delete' | 'update' }>,
  occurredAt: Date,
  mode: 'apply' | 'count' = 'apply',
): CompiledSql {
  const spec = REGISTRY[step.table];
  const table = quoteTable(step.table);
  const params: unknown[] = [];
  const where = compileWhere(step.where, params);

  if (step.op === 'delete') {
    return mode === 'count'
      ? { sql: `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params }
      : { sql: `DELETE FROM ${table} WHERE ${where}`, params };
  }

  const assigns: string[] = [];
  const differs: string[] = [];
  for (const [col, v] of Object.entries(step.set)) {
    const type = spec.set[col];
    const c = `"${col}"`;
    if (v === OCCURRED_AT) {
      params.push(occurredAt);
      assigns.push(`${c} = COALESCE(${c}, $${params.length}::timestamptz)`);
      differs.push(`${c} IS NULL`);
    } else if (v === null) {
      assigns.push(`${c} = NULL`);
      differs.push(`${c} IS NOT NULL`);
    } else if (type === 'jsonb') {
      assigns.push(`${c} = '{}'::jsonb`);
      differs.push(`${c} IS DISTINCT FROM '{}'::jsonb`);
    } else {
      params.push(v);
      const cast = type === 'uuid' ? '::uuid' : '::text';
      assigns.push(`${c} = $${params.length}${cast}`);
      differs.push(`${c} IS DISTINCT FROM $${params.length}${cast}`);
    }
  }
  const guard = `(${differs.join(' OR ')})`;
  return mode === 'count'
    ? { sql: `SELECT count(*)::int AS n FROM ${table} WHERE ${where} AND ${guard}`, params }
    : { sql: `UPDATE ${table} SET ${assigns.join(', ')} WHERE ${where} AND ${guard}`, params };
}

/** SELECT of the storage keys of the rows a delete step with `objects` hits. */
export function compileObjectKeys(step: Extract<ReplayStep, { op: 'delete' }>): CompiledSql {
  const params: unknown[] = [];
  const where = compileWhere(step.where, params);
  return {
    sql: `SELECT "bucket", "storage_path" FROM ${quoteTable(step.table)} WHERE ${where}`,
    params,
  };
}

/** Builders for the plans the app writes, so call sites stay short. */
export const plan = {
  of: (...steps: ReplayStep[]): ReplayPlan => ({ v: 1, steps }),
  del: (table: string, where: StepWhere, objects?: boolean): ReplayStep =>
    objects ? { op: 'delete', table, where, objects } : { op: 'delete', table, where },
  update: (table: string, where: StepWhere, set: Record<string, SetValue>): ReplayStep => ({
    op: 'update',
    table,
    where,
    set,
  }),
  prefixes: (prefixes: string[]): ReplayStep => ({ op: 'delete_storage_prefix', prefixes }),
};

/** The storage prefixes holding a user's own objects (file manager per school, avatar). */
export function userStoragePrefixes(userId: string, schoolIds: Iterable<string>): string[] {
  const out = [...new Set(schoolIds)].filter(isUuid).map((s) => `file-manager/${s}/${userId}/`);
  out.push(`images/avatars/${userId}.`);
  return out;
}
