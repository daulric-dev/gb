import type { PrismaService } from '@/prisma/prisma.service';

/**
 * What a push shows on the lock screen and hands to Expo (and through it to
 * Apple and Google):
 *
 * - `full`: the notice's own title and text (course name, work title, a
 *   child's name and what happened).
 * - `generic`: GENERIC_TITLE / GENERIC_BODY, and `data` reduced to the
 *   notice type and ids, so the app can open the right screen and load the
 *   details from GradeBook after the phone is unlocked.
 *
 * Set by the organisation (`organisation.push_content`) and overridden per
 * school (`school.push_content`). Unset on both, notices about children
 * (parent notices, attendance, grades, discussion replies naming a
 * classmate) are generic and course news (new work, announcements) is full.
 */
export type PushContent = 'full' | 'generic';

export const PUSH_CONTENT_VALUES: readonly PushContent[] = ['full', 'generic'];
export const GENERIC_TITLE = 'GradeBook';
export const GENERIC_BODY = 'You have a new update';

export function isPushContent(value: unknown): value is PushContent {
  return value === 'full' || value === 'generic';
}

/** Whether a push is sent generic, given the effective setting (null = unset). */
export function isGeneric(setting: PushContent | null, sensitive: boolean): boolean {
  if (setting === 'generic') return true;
  if (setting === 'full') return false;
  return sensitive;
}

/** Keys that may stay in a generic push's data: the type, ids and a route. */
const KEEP_KEY = /^(type|route|id|[A-Za-z]+Id)$/;

/** A generic push's data: only the type, ids and route; nothing readable. */
export function genericData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (!KEEP_KEY.test(key)) continue;
    if (typeof value === 'string' || typeof value === 'number') out[key] = value;
  }
  out.generic = true;
  return out;
}

/**
 * The effective setting for each school (null key = users without a school):
 * the school's own, else the organisation's, else null (unset).
 */
export async function pushContentFor(
  prisma: PrismaService,
  schoolIds: (string | null)[],
): Promise<Map<string | null, PushContent | null>> {
  const ids = [...new Set(schoolIds.filter((s): s is string => !!s))];
  const [organisation, schools] = await Promise.all([
    prisma.organisation.findFirst({ select: { push_content: true } }),
    ids.length > 0
      ? prisma.school.findMany({ where: { id: { in: ids } }, select: { id: true, push_content: true } })
      : Promise.resolve([] as { id: string; push_content: string | null }[]),
  ]);
  const orgValue = isPushContent(organisation?.push_content) ? organisation.push_content : null;
  const out = new Map<string | null, PushContent | null>([[null, orgValue]]);
  for (const id of ids) out.set(id, orgValue);
  for (const s of schools ?? []) {
    if (isPushContent(s.push_content)) out.set(s.id, s.push_content);
  }
  return out;
}
