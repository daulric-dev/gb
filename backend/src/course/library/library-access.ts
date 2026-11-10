import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@/generated/prisma/client';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { userSchoolId } from '@/common/user-school';
import { loadEffectivePermissions } from '@/permission/permission.effective';

/** A staff caller in their active school, with their effective keys. */
export interface LibraryCaller {
  userId: string;
  schoolId: string;
  keys: ReadonlySet<string>;
}

/**
 * The caller's active school and keys. Students, parents and people without
 * a school membership never reach the library (403).
 */
export async function libraryCaller(
  prisma: PrismaService,
  cache: CacheService,
  userId: string,
): Promise<LibraryCaller> {
  const schoolId = await userSchoolId(prisma, userId);
  if (!schoolId) throw new ForbiddenException('You are not assigned to a school');
  const effective = await loadEffectivePermissions(prisma, cache, userId, schoolId);
  if (!effective.member) {
    throw new ForbiddenException('The course library is for school staff');
  }
  return { userId, schoolId, keys: new Set(effective.keys) };
}

/**
 * Items the caller may browse and import: published, and either their own
 * school's or shared with the whole organisation. Another school's
 * school-only item is never matched (it reads as not found).
 */
export function visibleWhere(caller: LibraryCaller): Prisma.library_itemWhereInput {
  return {
    unpublished_at: null,
    OR: [{ school_id: caller.schoolId }, { visibility: 'organisation' }],
  };
}

/** The publisher, or an admin (course:update) of the item's own school. */
export function canManageItem(
  caller: LibraryCaller,
  item: { school_id: string; created_by: string | null },
): boolean {
  if (item.school_id !== caller.schoolId) return false;
  return item.created_by === caller.userId || caller.keys.has('course:update');
}

/** Organisation-wide sharing needs the course-library:create permission. */
export function assertMayShareWithOrganisation(caller: LibraryCaller) {
  if (!caller.keys.has('course-library:create')) {
    throw new ForbiddenException(
      'Sharing with every school needs the "Share course templates with every school" permission',
    );
  }
}

export const ITEM_NOT_FOUND = () => new NotFoundException('Library item not found');
