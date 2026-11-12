import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { userSchoolId } from '@/common/user-school';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { StudentErasureService } from '@/erasure/student-erasure.service';
import { RETENTION_NOTICE_DAYS } from './retention.config';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SchoolRetentionSettings {
  leaverRetentionDays: number | null;
  closedYearRetentionYears: number | null;
  /** When an admin confirmed the due list; purges run only after this. */
  confirmedAt: string | null;
  /** A rule is on and confirmed: the daily purge erases due records. */
  active: boolean;
}

export type RetentionRule = 'leaver' | 'closed_year';

export interface DueStudent {
  id: string;
  firstName: string | null;
  lastName: string | null;
  rule: RetentionRule;
  /** When the record is (or was) due for erasure. */
  dueAt: string;
}

export interface SchoolRetentionView extends SchoolRetentionSettings {
  /** Records due within `noticeDays` (and any already overdue), soonest first. */
  due: DueStudent[];
  noticeDays: number;
}

interface SettingRow {
  leaver_retention_days: number | null;
  closed_year_retention_years: number | null;
  confirmed_at: Date | null;
}

export interface SchoolPurgeReport {
  /** Student records erased (or due, in a dry run). */
  erased: number;
  errors: string[];
}

const toSettings = (row: SettingRow | null): SchoolRetentionSettings => {
  const leaver = row?.leaver_retention_days ?? null;
  const years = row?.closed_year_retention_years ?? null;
  const confirmedAt = row?.confirmed_at ? row.confirmed_at.toISOString() : null;
  return {
    leaverRetentionDays: leaver,
    closedYearRetentionYears: years,
    confirmedAt,
    active: !!confirmedAt && (leaver !== null || years !== null),
  };
};

/** `date` minus whole calendar years (UTC). */
function minusYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
}

function plusYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/**
 * A school's own retention periods for student records (off by default):
 *
 * - leavers: a student made inactive is erased `leaver_retention_days`
 *   after it (student.left_at, kept by a trigger);
 * - closed years: a student whose enrolments are all in courses of academic
 *   years that ended `closed_year_retention_years` ago is erased (a course
 *   without an academic year, or a year without an end date, keeps them).
 *
 * Nothing is erased until an admin has looked at the "due within 30 days"
 * list and confirmed; changing a period asks again. Erasure goes through
 * StudentErasureService (actor `system`, reason `retention_purge`).
 */
@Injectable()
export class SchoolRetentionService {
  private readonly logger = new Logger(SchoolRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly students: StudentErasureService,
    @Optional() private readonly audit?: AuditLogService,
  ) {}

  private async school(userId: string): Promise<string> {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) throw new BadRequestException('You are not assigned to a school');
    return schoolId;
  }

  async settingsFor(schoolId: string): Promise<SchoolRetentionSettings> {
    const row = await this.prisma.school_retention_setting.findUnique({
      where: { school_id: schoolId },
      select: { leaver_retention_days: true, closed_year_retention_years: true, confirmed_at: true },
    });
    return toSettings(row);
  }

  async view(userId: string, now = new Date()): Promise<SchoolRetentionView> {
    const schoolId = await this.school(userId);
    const settings = await this.settingsFor(schoolId);
    const due = await this.dueStudents(schoolId, settings, new Date(now.getTime() + RETENTION_NOTICE_DAYS * DAY_MS));
    return { ...settings, due, noticeDays: RETENTION_NOTICE_DAYS };
  }

  async update(
    userId: string,
    input: { leaverRetentionDays: number | null; closedYearRetentionYears: number | null },
  ): Promise<SchoolRetentionView> {
    const schoolId = await this.school(userId);
    const before = await this.settingsFor(schoolId);
    const changed =
      before.leaverRetentionDays !== input.leaverRetentionDays ||
      before.closedYearRetentionYears !== input.closedYearRetentionYears;
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.school_retention_setting.findUnique({
        where: { school_id: schoolId },
        select: { leaver_retention_days: true, closed_year_retention_years: true, confirmed_at: true },
      });
      const after = await tx.school_retention_setting.upsert({
        where: { school_id: schoolId },
        create: {
          school_id: schoolId,
          leaver_retention_days: input.leaverRetentionDays,
          closed_year_retention_years: input.closedYearRetentionYears,
          updated_by: userId,
        },
        update: {
          leaver_retention_days: input.leaverRetentionDays,
          closed_year_retention_years: input.closedYearRetentionYears,
          updated_by: userId,
          updated_at: new Date(),
          // A new period means a new list: confirm again before it runs.
          ...(changed ? { confirmed_at: null, confirmed_by: null } : {}),
        },
        select: { leaver_retention_days: true, closed_year_retention_years: true, confirmed_at: true },
      });
      await this.audit?.record(tx, schoolId, { id: userId }, {
        entity: 'school_retention_setting',
        entityId: schoolId,
        action: existing ? 'update' : 'create',
        changes: auditChanges(
          existing,
          after,
        ),
      });
    });
    return this.view(userId);
  }

  /** The admin has reviewed the due list: purges may run from now on. */
  async confirm(userId: string): Promise<SchoolRetentionView> {
    const schoolId = await this.school(userId);
    const settings = await this.settingsFor(schoolId);
    if (settings.leaverRetentionDays === null && settings.closedYearRetentionYears === null) {
      throw new BadRequestException('Set a retention period first');
    }
    await this.prisma.$transaction(async (tx) => {
      const confirmedAt = new Date();
      await tx.school_retention_setting.update({
        where: { school_id: schoolId },
        data: { confirmed_at: confirmedAt, confirmed_by: userId },
      });
      await this.audit?.record(tx, schoolId, { id: userId }, {
        entity: 'school_retention_setting',
        entityId: schoolId,
        action: 'update',
        changes: auditChanges({ confirmed_at: settings.confirmedAt }, { confirmed_at: confirmedAt }),
      });
    });
    return this.view(userId);
  }

  /** Students of the school due for erasure on or before `until`, soonest first. */
  async dueStudents(
    schoolId: string,
    settings: Pick<SchoolRetentionSettings, 'leaverRetentionDays' | 'closedYearRetentionYears'>,
    until: Date,
  ): Promise<DueStudent[]> {
    const byId = new Map<string, DueStudent>();
    const add = (s: DueStudent) => {
      const prev = byId.get(s.id);
      if (!prev || s.dueAt < prev.dueAt) byId.set(s.id, s);
    };

    if (settings.leaverRetentionDays !== null) {
      const days = settings.leaverRetentionDays;
      const rows = await this.prisma.student.findMany({
        where: {
          school_id: schoolId,
          is_active: false,
          left_at: { not: null, lte: new Date(until.getTime() - days * DAY_MS) },
        },
        select: { id: true, first_name: true, last_name: true, left_at: true },
      });
      for (const r of rows ?? []) {
        add({
          id: r.id,
          firstName: r.first_name,
          lastName: r.last_name,
          rule: 'leaver',
          dueAt: new Date(r.left_at!.getTime() + days * DAY_MS).toISOString(),
        });
      }
    }

    if (settings.closedYearRetentionYears !== null) {
      const years = settings.closedYearRetentionYears;
      const lastEndBy = minusYears(until, years);
      const rows = await this.prisma.$queryRaw<
        { id: string; first_name: string | null; last_name: string | null; last_end: Date }[]
      >`
        SELECT s.id, s.first_name, s.last_name, max(ay.end_date) AS last_end
        FROM student.student s
        JOIN course.course_student cs ON cs.student_id = s.id
        JOIN course.course c ON c.id = cs.course_id
        LEFT JOIN public.academic_year ay ON ay.id = c.academic_year_id
        WHERE s.school_id = ${schoolId}::uuid
        GROUP BY s.id, s.first_name, s.last_name
        HAVING bool_and(ay.end_date IS NOT NULL) AND max(ay.end_date) <= ${lastEndBy}::date`;
      for (const r of rows ?? []) {
        add({
          id: r.id,
          firstName: r.first_name,
          lastName: r.last_name,
          rule: 'closed_year',
          dueAt: plusYears(new Date(r.last_end), years).toISOString(),
        });
      }
    }

    return [...byId.values()].sort((a, b) => (a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0));
  }

  /**
   * Erase every due record of every school whose rules are on and
   * confirmed. Each record is its own transaction; a failure is reported
   * and the rest go on. `checkTime` throws when the run's budget is used up.
   */
  async purge(
    now: Date,
    opts: { dryRun?: boolean; checkTime?: () => void } = {},
  ): Promise<SchoolPurgeReport> {
    const report: SchoolPurgeReport = { erased: 0, errors: [] };
    const schools = await this.prisma.school_retention_setting.findMany({
      where: {
        confirmed_at: { not: null },
        OR: [{ leaver_retention_days: { not: null } }, { closed_year_retention_years: { not: null } }],
      },
      select: {
        school_id: true,
        leaver_retention_days: true,
        closed_year_retention_years: true,
        confirmed_at: true,
      },
    });
    for (const s of schools ?? []) {
      const due = await this.dueStudents(s.school_id, toSettings(s), now);
      if (opts.dryRun) {
        report.erased += due.length;
        continue;
      }
      for (const student of due) {
        opts.checkTime?.();
        try {
          await this.students.erase(student.id, {
            schoolId: s.school_id,
            actor: 'system',
            reason: 'retention_purge',
          });
          report.erased++;
        } catch (err) {
          report.errors.push(`student ${student.id}: ${(err as Error).message}`);
          this.logger.error(`Retention erasure of student ${student.id} failed: ${(err as Error).message}`);
        }
      }
    }
    return report;
  }
}
