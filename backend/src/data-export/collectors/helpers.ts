import type { ExportContext } from '../data-export.types';

/** Full name from first/last, or null. */
export const fullName = (value: unknown) => {
  if (!value || typeof value !== 'object') return null;
  const person = value as { first_name?: unknown; last_name?: unknown };
  const parts = [person.first_name, person.last_name].filter((part): part is string => typeof part === 'string' && part.length > 0);
  return parts.join(' ').trim() || null;
};

/** A date column as YYYY-MM-DD. */
export const day = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : null);

/** Values read from the generated client are checked before using them as lookup keys. */
export const stringId = (value: unknown): string => (typeof value === 'string' ? value : '');

export const unique = <T>(xs: (T | null | undefined)[]): T[] => [...new Set(xs.filter((x): x is T => x != null))];

/** Rows only of this school when the export is limited to one. */
export function inSchool(ctx: ExportContext): { school_id?: string } {
  return ctx.subject.schoolId ? { school_id: ctx.subject.schoolId } : {};
}

/** `{ in: studentIds }`, for the student_id columns. */
export const studentIn = (ctx: ExportContext) => ({ in: ctx.subject.studentIds });

/** Lookups by id: `id -> name` for courses. */
export async function courseNames(ctx: ExportContext, ids: readonly unknown[]): Promise<Map<string, string>> {
  const safeIds = ids.filter((id): id is string => typeof id === 'string');
  if (safeIds.length === 0) return new Map();
  const rows = await ctx.prisma.course.findMany({
    where: { id: { in: unique(safeIds) } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function schoolNames(ctx: ExportContext, ids: readonly unknown[]): Promise<Map<string, string | null>> {
  const list = unique(ids.filter((id): id is string | null => id === null || typeof id === 'string'));
  if (list.length === 0) return new Map();
  const rows = await ctx.prisma.school.findMany({
    where: { id: { in: list } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function personNames(ctx: ExportContext, ids: readonly unknown[]): Promise<Map<string, string | null>> {
  const list = unique(ids.filter((id): id is string | null => id === null || typeof id === 'string'));
  if (list.length === 0) return new Map();
  const rows = await ctx.prisma.user_profile.findMany({
    where: { id: { in: list } },
    select: { id: true, first_name: true, last_name: true },
  });
  return new Map(rows.map((r) => [r.id, fullName(r)]));
}

/** A safe file name for a path inside the ZIP. */
export function safeName(name: string | null | undefined, fallback = 'file'): string {
  const cleaned = (name ?? '')
    .split('')
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}
