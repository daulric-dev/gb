import type { Prisma } from '@/generated/prisma/client';
import type { EffectivePermissions } from './permission.effective';

/**
 * Which students a staff member may see, beyond the `student:read` gate.
 *
 * - `student:read-all` (admins by default; office, pastoral and similar
 *   roles when a school grants it): every student of the school.
 * - `student:read` alone (teachers by default): their own students only:
 *   students enrolled (any status) in a course of the school where they hold
 *   a course role (`course.course_staff`, teacher or TA), and students whose
 *   form tutor they are. A holder of `course:update` runs every course, so
 *   they see every student enrolled in any course of the school.
 *
 * Everything else reads as "not found", so ids reveal nothing.
 */
export type StudentScope =
  | { all: true }
  | { all: false; where: Prisma.studentWhereInput };

export function studentScope(
  effective: Pick<EffectivePermissions, 'keys'>,
  userId: string,
  schoolId: string,
): StudentScope {
  const keys = new Set(effective.keys);
  if (keys.has('student:read-all')) return { all: true };
  const courseFilter: Prisma.courseWhereInput = keys.has('course:update')
    ? { school_id: schoolId }
    : { school_id: schoolId, course_staff: { some: { user_profile_id: userId } } };
  return {
    all: false,
    where: {
      OR: [
        { course_student: { some: { course: courseFilter } } },
        { form_tutor_id: userId },
      ],
    },
  };
}

/** The school filter narrowed to the caller's scope. */
export function scopedStudentWhere(
  scope: StudentScope,
  where: Prisma.studentWhereInput,
): Prisma.studentWhereInput {
  return scope.all ? where : { AND: [where, scope.where] };
}

/** Guardian contacts and accommodation reasons need `student:sensitive`. */
export function canSeeSensitive(
  effective: Pick<EffectivePermissions, 'keys'>,
): boolean {
  return effective.keys.includes('student:sensitive');
}
