import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reads the Prisma schema files and lists every column that points at a
 * person: a relation to `user_profile`, `student` or `account.app_user`, or a
 * uuid column whose name says it holds a person's id (many "who did it"
 * columns have no foreign key on purpose). Used by the registry coverage
 * test, so a new table that stores someone's id cannot be added without
 * deciding whether a data export includes it.
 */

/** The models that are a person. */
export const PERSON_MODELS = new Set(['user_profile', 'student', 'app_user']);

/** uuid columns that hold a person's id even without a declared relation. */
export const PERSON_COLUMN =
  /^(user_id|user_profile_id|student_id|actor_id|author_id|author_user_profile_id|owner_id|sender_id|reviewer_id|assigned_to|form_tutor_id|principal_id|target_id|requested_by|subject_user_id|[a-z_]+_by)$/;

export interface PersonColumn {
  /** `schema.table` (the database names). */
  table: string;
  column: string;
  /** The model it points at, when the schema declares the relation. */
  references: string | null;
}

export const DEFAULT_SCHEMA_DIR = join(__dirname, '..', '..', 'prisma', 'schema');

export function scanPersonColumns(dir = DEFAULT_SCHEMA_DIR): PersonColumn[] {
  const out: PersonColumn[] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.prisma'));
  for (const file of files) {
    const src = readFileSync(join(dir, file), 'utf8');
    for (const m of src.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
      const model = m[1];
      const body = m[2];
      const schema = /@@schema\("(\w+)"\)/.exec(body)?.[1] ?? 'public';
      const tableName = /@@map\("(\w+)"\)/.exec(body)?.[1] ?? model;
      const table = `${schema}.${tableName}`;
      const relations = new Map<string, string>();
      const uuidCols = new Set<string>();
      for (const line of body.split('\n')) {
        const field = /^\s+(\w+)\s+(\w+)(\??|\[\])\s*(.*)$/.exec(line);
        if (!field) continue;
        const [, name, type, , rest] = field;
        const rel = /@relation\(([^)]*)\)/.exec(rest);
        if (rel && PERSON_MODELS.has(type)) {
          const fields = /fields:\s*\[([^\]]*)\]/.exec(rel[1]);
          for (const f of fields?.[1].split(',').map((s) => s.trim()) ?? []) {
            relations.set(f, type);
          }
        }
        if (type === 'String' && /@db\.Uuid/.test(rest)) uuidCols.add(name);
      }
      const seen = new Set<string>();
      for (const [column, references] of relations) {
        seen.add(column);
        out.push({ table, column, references });
      }
      for (const column of uuidCols) {
        if (seen.has(column) || !PERSON_COLUMN.test(column)) continue;
        out.push({ table, column, references: null });
      }
    }
  }
  return out.sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));
}
