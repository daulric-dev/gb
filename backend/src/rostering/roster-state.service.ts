import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { RosterSettings } from './roster-settings';
import type { RosterEntity, RosterSnapshot } from './roster-types';
import type { AccountRow, RosterState } from './roster-plan';

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const lower = (s: string | null | undefined) => (s ? s.trim().toLowerCase() : null);

/**
 * Loads what GradeBook has that a dry run compares against: the source's
 * links, and the mapped schools' academic years, terms, students, staff
 * accounts, open staff invites, and the linked courses with their
 * enrolments and course staff.
 */
@Injectable()
export class RosterStateService {
  constructor(private readonly prisma: PrismaService) {}

  async load(sourceId: string, snap: RosterSnapshot, settings: RosterSettings): Promise<RosterState> {
    const [schools, linkRows] = await Promise.all([
      this.prisma.school.findMany({ select: { id: true } }),
      this.prisma.roster_link.findMany({
        where: { source_id: sourceId },
        select: { entity: true, sourced_id: true, target_id: true, school_id: true, email: true, disabled_at: true, data: true },
      }),
    ]);
    const schoolIds = [
      ...new Set(
        [...Object.values(settings.orgMap), ...linkRows.map((l) => l.school_id)].filter(
          (s): s is string => typeof s === 'string',
        ),
      ),
    ];
    const targets = (entity: RosterEntity) => linkRows.filter((l) => l.entity === entity).map((l) => l.target_id);
    const courseIds = targets('course');

    const staffEmails = new Set<string>();
    for (const u of snap.users) if (u.kind === 'staff' && u.email) staffEmails.add(u.email);
    for (const l of linkRows) if (l.entity === 'staff' && l.email) staffEmails.add(l.email);

    const [years, students, appUsers, invites, enrolments, courseStaff, courses] = await Promise.all([
      this.prisma.academic_year.findMany({
        where: { school_id: { in: schoolIds } },
        select: { id: true, school_id: true, name: true, start_date: true, end_date: true },
      }),
      this.prisma.student.findMany({
        where: { school_id: { in: schoolIds } },
        select: {
          id: true,
          school_id: true,
          first_name: true,
          last_name: true,
          date_of_birth: true,
          student_number: true,
          is_active: true,
          user_profile: { select: { email: true, app_user: { select: { email: true } } } },
        },
      }),
      this.prisma.app_user.findMany({
        where: { OR: [{ email: { in: [...staffEmails] } }, { id: { in: targets('staff') } }] },
        select: {
          id: true,
          email: true,
          user_profile: {
            select: { account_type: true, school_management: { select: { school_id: true, role: true } } },
          },
        },
      }),
      this.prisma.organisation_invite.findMany({
        where: { kind: 'school_staff', school_id: { in: schoolIds }, accepted_at: null, revoked_at: null },
        select: { id: true, school_id: true, email: true },
      }),
      this.prisma.course_student.findMany({
        where: { course_id: { in: courseIds } },
        select: { id: true, course_id: true, student_id: true, status: true },
      }),
      this.prisma.course_staff.findMany({
        where: { course_id: { in: courseIds } },
        select: { id: true, course_id: true, user_profile_id: true, role: true },
      }),
      this.prisma.course.findMany({
        where: { id: { in: courseIds } },
        select: { id: true, school_id: true, name: true, code: true, term_id: true, academic_year_id: true, status: true },
      }),
    ]);
    const terms = await this.prisma.term.findMany({
      where: { academic_year_id: { in: years.map((y) => y.id) } },
      select: { id: true, academic_year_id: true, name: true, start_date: true, end_date: true },
    });

    const accounts: AccountRow[] = appUsers.map((a) => ({
      userId: a.id,
      email: a.email,
      accountType: (a.user_profile?.account_type ?? 'staff'),
      memberships: (a.user_profile?.school_management ?? []).map((m) => ({ schoolId: m.school_id, role: m.role })),
    }));

    return {
      schools: new Set(schools.map((s) => s.id)),
      links: linkRows.map((l) => ({
        entity: l.entity as RosterEntity,
        sourcedId: l.sourced_id,
        targetId: l.target_id,
        schoolId: l.school_id,
        email: l.email,
        disabled: l.disabled_at !== null,
        data: (l.data && typeof l.data === 'object' && !Array.isArray(l.data) ? l.data : {}),
      })),
      years: years.map((y) => ({
        id: y.id,
        schoolId: y.school_id ?? '',
        name: y.name ?? '',
        startDate: day(y.start_date),
        endDate: day(y.end_date),
      })),
      terms: terms.map((t) => ({
        id: t.id,
        academicYearId: t.academic_year_id ?? '',
        name: t.name ?? '',
        startDate: day(t.start_date),
        endDate: day(t.end_date),
      })),
      courses: courses.map((c) => ({
        id: c.id,
        schoolId: c.school_id,
        name: c.name,
        code: c.code,
        termId: c.term_id,
        academicYearId: c.academic_year_id,
        status: c.status,
      })),
      students: students.map((s) => ({
        id: s.id,
        schoolId: s.school_id ?? '',
        firstName: s.first_name,
        lastName: s.last_name,
        dateOfBirth: day(s.date_of_birth),
        studentNumber: s.student_number,
        isActive: s.is_active !== false,
        accountEmail: lower(s.user_profile?.app_user?.email ?? s.user_profile?.email),
      })),
      accounts,
      invites: invites.map((i) => ({ id: i.id, schoolId: i.school_id ?? '', email: i.email })),
      enrolments: enrolments.map((e) => ({ id: e.id, courseId: e.course_id, studentId: e.student_id, status: e.status })),
      courseStaff: courseStaff.map((e) => ({ id: e.id, courseId: e.course_id, userProfileId: e.user_profile_id, role: e.role })),
    };
  }
}
