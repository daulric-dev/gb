import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@/generated/prisma/client';
import type { CacheService } from '@/cache/cache.service';
import type { PrismaService } from '@/prisma/prisma.service';
import { userSchoolId } from '@/common/user-school';
import { loadEffectivePermissions } from '@/permission/permission.effective';

/**
 * Who is asking, in their active school, and which pastoral keys they hold.
 * Students, parents and anyone without a staff membership never get here.
 */
export interface PastoralCaller {
  userId: string;
  schoolId: string;
  read: boolean;
  create: boolean;
  update: boolean;
  safeguarding: boolean;
  /** school:update - manages categories and the retention setting. */
  admin: boolean;
  /** student:export - answers subject access requests (may withhold notes). */
  exporter?: boolean;
}

export async function pastoralCaller(
  prisma: PrismaService,
  cache: CacheService,
  userId: string,
): Promise<PastoralCaller> {
  const schoolId = await userSchoolId(prisma, userId);
  if (!schoolId) throw new ForbiddenException('You are not assigned to a school');
  const effective = await loadEffectivePermissions(prisma, cache, userId, schoolId);
  if (!effective.member) {
    throw new ForbiddenException('Pastoral notes are for school staff');
  }
  const keys = new Set<string>(effective.keys);
  return {
    userId,
    schoolId,
    read: keys.has('pastoral-note:read'),
    create: keys.has('pastoral-note:create'),
    update: keys.has('pastoral-note:update'),
    safeguarding: keys.has('pastoral-note:safeguarding'),
    admin: keys.has('school:update'),
    exporter: keys.has('student:export'),
  };
}

/** Holds at least one pastoral key (or wrote notes: the author rule). */
export function hasAnyPastoralKey(c: PastoralCaller) {
  return c.read || c.create || c.update || c.safeguarding;
}

/**
 * The notes a caller may see, as a query filter: their own notes always;
 * with `read` every non-safeguarding note of the school; with `read` and
 * `safeguarding` every note.
 */
export function visibleNotes(c: PastoralCaller): Prisma.pastoral_noteWhereInput {
  const or: Prisma.pastoral_noteWhereInput[] = [{ author_id: c.userId }];
  if (c.read) or.push(c.safeguarding ? { school_id: c.schoolId } : { is_safeguarding: false });
  return { school_id: c.schoolId, OR: or };
}

/** The same rule for one note already loaded. */
export function canSeeNote(
  c: PastoralCaller,
  note: { school_id: string; author_id: string | null; is_safeguarding: boolean },
): boolean {
  if (note.school_id !== c.schoolId) return false;
  if (note.author_id === c.userId) return true;
  return c.read && (!note.is_safeguarding || c.safeguarding);
}

/**
 * May change (edit, resolve, delete) a note: `update` on a note they can
 * see, or the author holding `create`. A safeguarding note always needs
 * `safeguarding` too.
 */
export function canChangeNote(
  c: PastoralCaller,
  note: { school_id: string; author_id: string | null; is_safeguarding: boolean },
): boolean {
  if (!canSeeNote(c, note)) return false;
  if (note.is_safeguarding && !c.safeguarding) return false;
  return c.update || (note.author_id === c.userId && c.create);
}

/** May write a note in this category. */
export function canWriteIn(c: PastoralCaller, category: { is_safeguarding: boolean }) {
  return c.create && (!category.is_safeguarding || c.safeguarding);
}
