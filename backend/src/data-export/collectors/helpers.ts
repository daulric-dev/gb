import type { ExportContext } from '../data-export.types';

/** Full name from first/last, or null. */
export const fullName = (p: { first_name?: string | null; last_name?: string | null } | null | undefined) =>
  p ? [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || null : null;

/** A date column as YYYY-MM-DD. */
export const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export const unique = <T>(xs: (T | null | undefined)[]): T[] => [...new Set(xs.filter((x): x is T => x != null))];

/** Rows only of this school when the export is limited to one. */
export function inSchool(ctx: ExportContext): { school_id?: string } {
  return ctx.subject.schoolId ? { school_id: ctx.subject.schoolId } : {};
}

/** `{ in: studentIds }`, for the student_id columns. */
export const studentIn = (ctx: ExportContext) => ({ in: ctx.subject.studentIds });

/** Lookups by id: `id -> name` for courses. */
export async function courseNames(ctx: ExportContext, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await ctx.prisma.course.findMany({
    where: { id: { in: unique(ids) } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function schoolNames(ctx: ExportContext, ids: (string | null)[]): Promise<Map<string, string | null>> {
  const list = unique(ids);
  if (list.length === 0) return new Map();
  const rows = await ctx.prisma.school.findMany({
    where: { id: { in: list } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function personNames(ctx: ExportContext, ids: (string | null)[]): Promise<Map<string, string | null>> {
  const list = unique(ids);
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
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}
