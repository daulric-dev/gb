import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@/prisma/prisma.service';
import type { CacheService } from '@/cache/cache.service';
import type { FeatureService } from '@/features/feature.service';
import { loadEffectivePermissions } from '@/permission/permission.effective';
import { excludedByAge, parseParentSettings } from '@/parent-portal/parent-settings';
import type { ExportSubject } from './data-export.types';
import { STUDENT_EXPORT } from './data-export.constants';

/**
 * Who may export whose data. Every check runs again when the job runs, so
 * access removed between the request and the build stops the export.
 */

/** Anyone signed in: their own account and the student records linked to it. */
export async function resolveSelf(prisma: PrismaService, userId: string): Promise<ExportSubject> {
  const profile = await prisma.user_profile.findUnique({ where: { id: userId }, select: { id: true } });
  if (!profile) throw new NotFoundException('Account not found');
  const students = await prisma.student.findMany({ where: { user_profile_id: userId }, select: { id: true } });
  return {
    scope: 'self',
    userId,
    studentIds: students.map((s) => s.id),
    schoolId: null,
    exporterId: userId,
    accountData: true,
  };
}

/**
 * Staff: `student:export` in the student's school. Not a member of that
 * school: 404, so student ids cannot be probed.
 */
export async function resolveStaff(
  prisma: PrismaService,
  cache: CacheService,
  features: Pick<FeatureService, 'isEnabled'>,
  exporterId: string,
  studentId: string,
): Promise<ExportSubject> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, school_id: true, user_profile_id: true, user_profile: { select: { account_type: true } } },
  });
  if (!student?.school_id) throw new NotFoundException('Student not found');
  const effective = await loadEffectivePermissions(prisma, cache, exporterId, student.school_id);
  if (!effective.member) throw new NotFoundException('Student not found');
  const keys = new Set<string>(effective.keys);
  if (!keys.has(STUDENT_EXPORT)) throw new ForbiddenException(`Missing permission: ${STUDENT_EXPORT}`);
  // The student's own account comes too; any other kind of account linked
  // to a student row (it should not happen) is left out.
  const linked = student.user_profile?.account_type === 'student' ? student.user_profile_id : null;
  return {
    scope: 'staff',
    userId: linked,
    studentIds: [student.id],
    schoolId: student.school_id,
    exporterId,
    accountData: !!linked,
    sensitive: keys.has('student:sensitive'),
    pastoral: {
      read: keys.has('pastoral-note:read'),
      safeguarding: keys.has('pastoral-note:safeguarding'),
      enabled: await features.isEnabled(student.school_id, 'pastoral_notes'),
    },
  };
}

/**
 * Parents: a linked child the parent portal shows them (the ParentGuard
 * rules: active child and school, not left out by the age limit, parent
 * portal on). Anything else is a 404.
 */
export async function resolveParent(
  prisma: PrismaService,
  features: Pick<FeatureService, 'isEnabled'>,
  parentId: string,
  studentId: string,
  now = new Date(),
): Promise<ExportSubject> {
  const profile = await prisma.user_profile.findUnique({
    where: { id: parentId },
    select: { account_type: true, is_active: true },
  });
  if (profile?.account_type !== 'parent' || profile.is_active === false) {
    throw new ForbiddenException('This is for parent accounts');
  }
  const link = await prisma.parent_student_link.findFirst({
    where: { user_profile_id: parentId, student_id: studentId },
    select: {
      student: {
        select: {
          id: true,
          school_id: true,
          is_active: true,
          date_of_birth: true,
          school: { select: { parent_settings: true, is_active: true } },
        },
      },
    },
  });
  const student = link?.student;
  const notFound = () => new NotFoundException('Child not found');
  if (!student?.school_id || student.is_active === false || student.school?.is_active === false) throw notFound();
  const settings = parseParentSettings(student.school?.parent_settings);
  if (excludedByAge(settings, student.date_of_birth, now)) throw notFound();
  if (!(await features.isEnabled(student.school_id, 'parent_portal'))) throw notFound();
  return {
    scope: 'parent',
    userId: null,
    studentIds: [student.id],
    schoolId: student.school_id,
    exporterId: parentId,
    accountData: false,
    parentSettings: settings,
  };
}
