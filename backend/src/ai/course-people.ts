import type { PrismaService } from '@/prisma/prisma.service';
import type { PersonNames } from './redact';

/**
 * The people connected to a course whose names must not reach an AI
 * provider: its students (any enrolment status), its staff, and the
 * students' linked parents / guardians. Passed to `redact()` as `others`.
 *
 * `fullNamesOnly`: only "First Last" is matched, not a first or last name on
 * its own. For teacher-written course material (the course builder), where
 * a roster of a few hundred first names would otherwise blank out ordinary
 * words ("Mark", "Will", "Grace"); a pasted class list is still caught.
 */
export async function coursePeople(
  prisma: PrismaService,
  courseId: string,
  opts: { fullNamesOnly?: boolean } = {},
): Promise<PersonNames[]> {
  const [students, staff, guardians] = await Promise.all([
    prisma.course_student.findMany({
      where: { course_id: courseId },
      select: { student_id: true, student: { select: { first_name: true, last_name: true } } },
    }),
    prisma.course_staff.findMany({
      where: { course_id: courseId },
      select: { user_profile: { select: { first_name: true, last_name: true } } },
    }),
    prisma.parent_student_link.findMany({
      where: { student: { course_student: { some: { course_id: courseId } } } },
      select: { user_profile: { select: { first_name: true, last_name: true } } },
    }),
  ]);

  const people: PersonNames[] = [
    ...(students ?? []).flatMap((r) => (r.student ? [r.student as PersonNames] : [])),
    ...(staff ?? []).flatMap((r) => (r.user_profile ? [r.user_profile as PersonNames] : [])),
    ...(guardians ?? []).flatMap((r) => (r.user_profile ? [r.user_profile as PersonNames] : [])),
  ];
  if (!opts.fullNamesOnly) return people;
  return people.flatMap((p) => {
    const first = p.first_name?.trim();
    const last = p.last_name?.trim();
    return first && last ? [{ first_name: `${first} ${last}` }] : [];
  });
}
