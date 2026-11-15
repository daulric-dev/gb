import type { Collector } from '../data-export.types';
import { courseNames, day, fullName, inSchool, schoolNames, studentIn, stringId } from './helpers';

export const membershipsCollector: Collector = {
  id: 'memberships',
  title: 'Schools, roles and classes',
  description:
    'Schools the account belongs to and its roles there, requests to join a school, organisation administrator and owner roles, the courses taught or studied (with enrolment status), and parent-child links.',
  covers: [
    'public.school_management.user_id',
    'public.school_join_request.user_id',
    'public.organisation_admin.user_id',
    'public.organisation.owner_id',
    'public.school.owner_id',
    'course.course_staff.user_profile_id',
    'course.course_student.student_id',
    'student.parent_student_link.user_profile_id',
    'student.parent_student_link.student_id',
  ],
  scopes: ['self', 'staff', 'parent'],
  async collect(ctx) {
    const { prisma, subject } = ctx;
    const userId = subject.scope === 'parent' ? null : subject.userId;
    const school = inSchool(ctx);

    const [memberships, joinRequests, orgAdmin, ownedOrgs, ownedSchools, courseStaff, courseStudents, linksAsParent, linksAsChild] =
      await Promise.all([
        userId
          ? prisma.school_management.findMany({
              where: { user_id: userId, ...school },
              select: {
                school_id: true,
                role: true,
                created_at: true,
                school_management_role: { select: { school_role: { select: { name: true } } } },
              },
            })
          : Promise.resolve([] as never[]),
        userId
          ? prisma.school_join_request.findMany({
              where: { user_id: userId, ...school },
              select: { school_id: true, status: true, message: true, requested_at: true, reviewed_at: true },
            })
          : Promise.resolve([] as never[]),
        userId && !subject.schoolId
          ? prisma.organisation_admin.findUnique({ where: { user_id: userId }, select: { created_at: true } })
          : null,
        userId && !subject.schoolId
          ? prisma.organisation.findMany({ where: { owner_id: userId }, select: { name: true } })
          : Promise.resolve([] as never[]),
        userId
          ? prisma.school.findMany({ where: { owner_id: userId, ...(subject.schoolId ? { id: subject.schoolId } : {}) }, select: { name: true } })
          : Promise.resolve([] as never[]),
        userId
          ? prisma.course_staff.findMany({
              where: { user_profile_id: userId, ...(subject.schoolId ? { course: { school_id: subject.schoolId } } : {}) },
              select: { course_id: true, role: true, created_at: true },
            })
          : Promise.resolve([] as never[]),
        subject.studentIds.length
          ? prisma.course_student.findMany({
              where: { student_id: studentIn(ctx) },
              select: { course_id: true, status: true, enrolled_at: true },
            })
          : Promise.resolve([] as never[]),
        userId
          ? prisma.parent_student_link.findMany({
              where: { user_profile_id: userId },
              select: {
                relationship: true,
                relationship_label: true,
                created_at: true,
                student: { select: { first_name: true, last_name: true, school_id: true } },
              },
            })
          : Promise.resolve([] as never[]),
        subject.studentIds.length && subject.scope !== 'parent'
          ? prisma.parent_student_link.findMany({
              where: { student_id: studentIn(ctx) },
              select: {
                relationship: true,
                relationship_label: true,
                created_at: true,
                user_profile: { select: { first_name: true, last_name: true } },
              },
            })
          : Promise.resolve([] as never[]),
      ]);

    const courses = await courseNames(ctx, [...courseStaff, ...courseStudents].map((c) => c.course_id));
    const schools = await schoolNames(ctx, [
      ...memberships.map((m) => m.school_id),
      ...joinRequests.map((j) => j.school_id),
      ...linksAsParent.map((l) => l.student?.school_id ?? null),
    ]);

    const data = {
      schools: memberships.map((m) => ({
        school: schools.get(stringId(m.school_id)) ?? null,
        role: m.role,
        customRoles: m.school_management_role.map((r) => r.school_role.name),
        since: m.created_at,
      })),
      joinRequests: joinRequests.map((j) => ({
        school: schools.get(stringId(j.school_id)) ?? null,
        status: j.status,
        message: j.message,
        requestedAt: j.requested_at,
        reviewedAt: j.reviewed_at,
      })),
      organisationAdministrator: orgAdmin ? { since: orgAdmin.created_at } : null,
      owns: {
        organisations: ownedOrgs.map((o) => o.name),
        schools: ownedSchools.map((s) => s.name),
      },
      coursesTaught: courseStaff.map((c) => ({ course: courses.get(stringId(c.course_id)) ?? null, role: c.role, since: c.created_at })),
      coursesStudied: courseStudents.map((c) => ({
        course: courses.get(stringId(c.course_id)) ?? null,
        status: c.status,
        enrolledAt: c.enrolled_at,
      })),
      childrenLinked: linksAsParent.map((l) => ({
        child: fullName(l.student),
        school: schools.get(stringId(l.student?.school_id)) ?? null,
        relationship: l.relationship_label ?? l.relationship,
        linkedAt: l.created_at,
      })),
      // Self exports of a student show the relationship, not the parent's
      // name (that is the parent's own data); staff exports show both.
      parentsLinked: linksAsChild.map((l) => ({
        ...(subject.scope === 'staff' ? { parent: fullName(l.user_profile) } : {}),
        relationship: l.relationship_label ?? l.relationship,
        linkedAt: day(l.created_at),
      })),
    };
    const count =
      data.schools.length +
      data.joinRequests.length +
      (orgAdmin ? 1 : 0) +
      ownedOrgs.length +
      ownedSchools.length +
      data.coursesTaught.length +
      data.coursesStudied.length +
      data.childrenLinked.length +
      data.parentsLinked.length;
    return { data, count };
  },
};
