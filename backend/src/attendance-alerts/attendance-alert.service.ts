import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { FeatureService } from '@/features/feature.service';
import { MailService } from '@/mail/mail.service';
import { primaryOrigin } from '@/config/origins';
import { accountEmailHtml } from '@/account/templates/layout';
import { AttendanceReportService } from './attendance-report.service';
import {
  describeAlert,
  evaluate,
  type AlertKind,
  type AlertThresholds,
  type DatedRecord,
} from './rates';
import type { AlertSettingsDto } from './dto/attendance-alerts.dto';

const DAY_MS = 86_400_000;
/** How far back the absences-in-a-row check looks. */
export const HISTORY_DAYS = 60;

export interface AlertSettings {
  minRate: number | null;
  windowDays: number;
  minSessions: number;
  consecutiveAbsences: number | null;
  notifyTutor: boolean;
  notifyAdmins: boolean;
  notifyParents: boolean;
  emailStaff: boolean;
}

/** Off until a school sets a threshold: nothing is checked by default. */
export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  minRate: null,
  windowDays: 28,
  minSessions: 5,
  consecutiveAbsences: null,
  notifyTutor: true,
  notifyAdmins: true,
  notifyParents: true,
  emailStaff: true,
};

type SettingRow = {
  school_id: string;
  min_rate: number | null;
  window_days: number;
  min_sessions: number;
  consecutive_absences: number | null;
  notify_tutor: boolean;
  notify_admins: boolean;
  notify_parents: boolean;
  email_staff: boolean;
};

const toSettings = (r: SettingRow | null): AlertSettings =>
  r
    ? {
        minRate: r.min_rate,
        windowDays: r.window_days,
        minSessions: r.min_sessions,
        consecutiveAbsences: r.consecutive_absences,
        notifyTutor: r.notify_tutor,
        notifyAdmins: r.notify_admins,
        notifyParents: r.notify_parents,
        emailStaff: r.email_staff,
      }
    : { ...DEFAULT_ALERT_SETTINGS };

export interface OpenedAlert {
  id: string;
  school_id: string;
  student_id: string;
  kind: string;
  value: number;
  threshold: number;
  window_days: number | null;
}

/**
 * Attendance alerts: the school's thresholds, form tutors, the alert list,
 * and the sweep that opens and resolves alerts.
 *
 * Dedupe: an alert row stays open (`resolved_at` null) while its condition
 * holds, and a unique index allows one open alert per student and kind, so a
 * student below 90% is alerted once, not every sweep. The alert is resolved
 * only once the student has recovered (see `evaluate`), after which falling
 * below again opens (and notifies) a new one. Parents hear through the
 * parent notice sweep (kind `attendance_alert`, one notice per alert row).
 */
@Injectable()
export class AttendanceAlertService {
  private readonly logger = new Logger(AttendanceAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureService,
    private readonly mail: MailService,
    private readonly reports: AttendanceReportService,
  ) {}

  // ── settings ─────────────────────────────────────────────────────────────

  async settings(schoolId: string): Promise<AlertSettings> {
    return toSettings(
      await this.prisma.attendance_alert_setting.findUnique({ where: { school_id: schoolId } }),
    );
  }

  async updateSettings(userId: string, schoolId: string, dto: AlertSettingsDto) {
    const data = {
      ...(dto.minRate !== undefined ? { min_rate: dto.minRate } : {}),
      ...(dto.windowDays !== undefined ? { window_days: dto.windowDays } : {}),
      ...(dto.minSessions !== undefined ? { min_sessions: dto.minSessions } : {}),
      ...(dto.consecutiveAbsences !== undefined ? { consecutive_absences: dto.consecutiveAbsences } : {}),
      ...(dto.notifyTutor !== undefined ? { notify_tutor: dto.notifyTutor } : {}),
      ...(dto.notifyAdmins !== undefined ? { notify_admins: dto.notifyAdmins } : {}),
      ...(dto.notifyParents !== undefined ? { notify_parents: dto.notifyParents } : {}),
      ...(dto.emailStaff !== undefined ? { email_staff: dto.emailStaff } : {}),
      updated_by: userId,
      updated_at: new Date(),
    };
    await this.prisma.attendance_alert_setting.upsert({
      where: { school_id: schoolId },
      create: { school_id: schoolId, ...data },
      update: data,
    });
    return this.settings(schoolId);
  }

  // ── form tutors ──────────────────────────────────────────────────────────

  /** The school's active students with their tutor, and the staff to pick from. */
  async formTutors(schoolId: string) {
    const [students, staff] = await Promise.all([
      this.prisma.student.findMany({
        where: { school_id: schoolId, is_active: { not: false } },
        orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }],
        select: { id: true, first_name: true, last_name: true, form_tutor_id: true },
      }),
      this.staffOf(schoolId),
    ]);
    return {
      students: students.map((s) => ({
        id: s.id,
        firstName: s.first_name,
        lastName: s.last_name,
        formTutorId: s.form_tutor_id,
      })),
      staff,
    };
  }

  private async staffOf(schoolId: string) {
    const rows = await this.prisma.school_management.findMany({
      where: { school_id: schoolId, user_profile: { is_active: { not: false } } },
      select: {
        user_id: true,
        role: true,
        user_profile: { select: { first_name: true, last_name: true, email: true } },
      },
    });
    return rows
      .map((r) => ({
        id: r.user_id,
        firstName: r.user_profile.first_name,
        lastName: r.user_profile.last_name,
        email: r.user_profile.email,
        role: r.role,
      }))
      .sort((a, b) => `${a.lastName ?? ''}${a.firstName ?? ''}`.localeCompare(`${b.lastName ?? ''}${b.firstName ?? ''}`));
  }

  async setFormTutor(schoolId: string, studentIds: string[], tutorId: string | null) {
    if (tutorId) {
      const member = await this.prisma.school_management.findFirst({
        where: { school_id: schoolId, user_id: tutorId },
        select: { id: true },
      });
      if (!member) throw new BadRequestException('The form tutor must be a staff member of the school');
    }
    const ids = [...new Set(studentIds)];
    const { count } = await this.prisma.student.updateMany({
      where: { id: { in: ids }, school_id: schoolId },
      data: { form_tutor_id: tutorId },
    });
    if (count !== ids.length) throw new NotFoundException('Some students are not in this school');
    return { updated: count };
  }

  // ── alert list ───────────────────────────────────────────────────────────

  /**
   * Alerts the caller may see: every one in the school with
   * `report-card:read`, otherwise their own tutees'.
   */
  async list(userId: string, status: 'open' | 'resolved' | 'all' = 'open') {
    const { schoolId, canSeeSchool } = await this.reports.scope(userId);
    const rows = await this.prisma.attendance_alert.findMany({
      where: {
        school_id: schoolId,
        ...(status === 'open' ? { resolved_at: null } : status === 'resolved' ? { resolved_at: { not: null } } : {}),
        ...(canSeeSchool ? {} : { student: { form_tutor_id: userId } }),
      },
      orderBy: { opened_at: 'desc' },
      take: 500,
      select: {
        id: true,
        student_id: true,
        kind: true,
        value: true,
        threshold: true,
        window_days: true,
        opened_at: true,
        resolved_at: true,
        acknowledged_at: true,
        student: { select: { first_name: true, last_name: true, form_tutor_id: true } },
      },
    });
    return {
      canSeeSchool,
      alerts: rows.map((a) => ({
        id: a.id,
        studentId: a.student_id,
        firstName: a.student.first_name,
        lastName: a.student.last_name,
        mine: a.student.form_tutor_id === userId,
        kind: a.kind,
        value: a.value,
        threshold: a.threshold,
        windowDays: a.window_days,
        description: describeAlert({ kind: a.kind, value: a.value, threshold: a.threshold, windowDays: a.window_days }),
        openedAt: a.opened_at.toISOString(),
        resolvedAt: a.resolved_at?.toISOString() ?? null,
        acknowledgedAt: a.acknowledged_at?.toISOString() ?? null,
      })),
    };
  }

  /** Open, unacknowledged alerts the caller may see (the dashboard badge). */
  async count(userId: string) {
    const { schoolId, canSeeSchool } = await this.reports.scope(userId);
    const count = await this.prisma.attendance_alert.count({
      where: {
        school_id: schoolId,
        resolved_at: null,
        acknowledged_at: null,
        ...(canSeeSchool ? {} : { student: { form_tutor_id: userId } }),
      },
    });
    return { count };
  }

  async acknowledge(userId: string, alertId: string) {
    const { schoolId, canSeeSchool } = await this.reports.scope(userId);
    const { count } = await this.prisma.attendance_alert.updateMany({
      where: {
        id: alertId,
        school_id: schoolId,
        acknowledged_at: null,
        ...(canSeeSchool ? {} : { student: { form_tutor_id: userId } }),
      },
      data: { acknowledged_at: new Date(), acknowledged_by: userId },
    });
    if (count === 0) {
      const exists = await this.prisma.attendance_alert.findFirst({
        where: {
          id: alertId,
          school_id: schoolId,
          ...(canSeeSchool ? {} : { student: { form_tutor_id: userId } }),
        },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Alert not found');
    }
  }

  // ── sweep ────────────────────────────────────────────────────────────────

  /** Every school with a threshold and the feature on. Returns alerts opened. */
  async sweep(now = new Date()): Promise<number> {
    const rows = await this.prisma.attendance_alert_setting.findMany({
      where: { OR: [{ min_rate: { not: null } }, { consecutive_absences: { not: null } }] },
    });
    let opened = 0;
    for (const row of rows) {
      try {
        if (!(await this.features.isEnabled(row.school_id, 'attendance_alerts'))) continue;
        const created = await this.sweepSchool(row.school_id, toSettings(row), now);
        opened += created.length;
        if (created.length > 0) await this.notifyStaff(row.school_id, toSettings(row), created);
      } catch (err) {
        this.logger.error(`Attendance alerts for ${row.school_id} failed: ${(err as Error).message}`);
      }
    }
    return opened;
  }

  /** Open and resolve one school's alerts. Returns the alerts opened now. */
  async sweepSchool(schoolId: string, s: AlertSettings, now: Date): Promise<OpenedAlert[]> {
    const thresholds: AlertThresholds = {
      minRate: s.minRate,
      windowDays: s.windowDays,
      minSessions: s.minSessions,
      consecutiveAbsences: s.consecutiveAbsences,
    };
    const windowStart = now.getTime() - s.windowDays * DAY_MS;
    const since = new Date(now.getTime() - Math.max(s.windowDays, HISTORY_DAYS) * DAY_MS);

    const [records, open] = await Promise.all([
      this.prisma.course_attendance_record.findMany({
        where: {
          course: { school_id: schoolId, is_template: false },
          student: { school_id: schoolId, is_active: { not: false } },
          attendance_session: { opened_at: { gte: since, lte: now } },
        },
        select: { student_id: true, status: true, attendance_session: { select: { opened_at: true } } },
      }),
      this.prisma.attendance_alert.findMany({
        where: { school_id: schoolId, resolved_at: null },
        select: { id: true, student_id: true, kind: true },
      }),
    ]);

    const history = new Map<string, DatedRecord[]>();
    for (const r of records) {
      const list = history.get(r.student_id) ?? [];
      list.push({ status: r.status, at: r.attendance_session.opened_at });
      history.set(r.student_id, list);
    }
    const openKey = new Map(open.map((a) => [`${a.student_id}|${a.kind}`, a.id]));
    const students = new Set([...history.keys(), ...open.map((a) => a.student_id)]);

    const toOpen: Omit<OpenedAlert, 'id'>[] = [];
    const toResolve: string[] = [];
    for (const studentId of students) {
      const all = history.get(studentId) ?? [];
      const conditions = evaluate(
        thresholds,
        all.filter((r) => r.at.getTime() >= windowStart),
        all,
      );
      const checked = new Set<string>(conditions.map((c) => c.kind));
      for (const c of conditions) {
        const existing = openKey.get(`${studentId}|${c.kind}`);
        if (c.active && !existing) {
          toOpen.push({
            school_id: schoolId,
            student_id: studentId,
            kind: c.kind,
            value: c.value,
            threshold: c.threshold,
            window_days: c.kind === 'low_rate' ? s.windowDays : null,
          });
        } else if (existing && !c.active && c.recovered) {
          toResolve.push(existing);
        }
      }
      // A check the school switched off resolves its open alerts.
      for (const kind of ['low_rate', 'consecutive_absences'] as AlertKind[]) {
        const existing = openKey.get(`${studentId}|${kind}`);
        if (existing && !checked.has(kind)) toResolve.push(existing);
      }
    }

    if (toResolve.length > 0) {
      await this.prisma.attendance_alert.updateMany({
        where: { id: { in: toResolve }, resolved_at: null },
        data: { resolved_at: now },
      });
    }
    if (toOpen.length === 0) return [];
    // skipDuplicates: the partial unique index (one open alert per student
    // and kind) drops any another instance opened first.
    return this.prisma.attendance_alert.createManyAndReturn({
      data: toOpen.map((a) => ({ ...a, opened_at: now })),
      skipDuplicates: true,
      select: {
        id: true,
        school_id: true,
        student_id: true,
        kind: true,
        value: true,
        threshold: true,
        window_days: true,
      },
    });
  }

  /** Email the form tutor and/or the school's admins about new alerts. */
  async notifyStaff(schoolId: string, s: AlertSettings, alerts: OpenedAlert[]) {
    if (!s.emailStaff || (!s.notifyTutor && !s.notifyAdmins)) return;
    const [students, members, school] = await Promise.all([
      this.prisma.student.findMany({
        where: { id: { in: alerts.map((a) => a.student_id) } },
        select: { id: true, first_name: true, last_name: true, form_tutor_id: true },
      }),
      this.prisma.school_management.findMany({
        where: { school_id: schoolId, user_profile: { is_active: { not: false } } },
        select: { user_id: true, role: true, user_profile: { select: { email: true } } },
      }),
      this.prisma.school.findUnique({ where: { id: schoolId }, select: { name: true } }),
    ]);
    const emailOf = new Map(members.map((m) => [m.user_id, m.user_profile.email]));
    const admins = members.filter((m) => m.role === 'admin').map((m) => m.user_id);
    const studentOf = new Map(students.map((st) => [st.id, st]));

    const byRecipient = new Map<string, string[]>();
    for (const a of alerts) {
      const st = studentOf.get(a.student_id);
      if (!st) continue;
      const recipients = new Set<string>();
      // A tutor who has left the school (no membership) is skipped.
      if (s.notifyTutor && st.form_tutor_id && emailOf.has(st.form_tutor_id)) recipients.add(st.form_tutor_id);
      if (s.notifyAdmins) for (const id of admins) recipients.add(id);
      const name = [st.first_name, st.last_name].filter(Boolean).join(' ') || 'A student';
      const line = `${name}: ${describeAlert({ kind: a.kind, value: a.value, threshold: a.threshold, windowDays: a.window_days })}`;
      for (const r of recipients) byRecipient.set(r, [...(byRecipient.get(r) ?? []), line]);
    }

    const url = `${primaryOrigin()}/dashboard/attendance`;
    for (const [userId, lines] of byRecipient) {
      const to = emailOf.get(userId);
      if (!to) continue;
      await this.mail
        .send({ to, ...alertEmail({ schoolName: school?.name ?? 'Your school', lines, url }) })
        .catch((err: Error) => this.logger.warn(`Attendance alert email failed: ${err.message}`));
    }
  }
}

/** "Attendance alerts at <school>": one email per recipient per sweep. */
export function alertEmail(d: { schoolName: string; lines: string[]; url: string }) {
  const subject =
    d.lines.length === 1
      ? `Attendance alert: ${d.lines[0].split(':')[0]}`
      : `${d.lines.length} attendance alerts at ${d.schoolName}`;
  const intro = `These students at ${d.schoolName} have fallen below the school's attendance thresholds:`;
  return {
    subject,
    text: [intro, '', ...d.lines.map((l) => `- ${l}`), '', d.url].join('\n'),
    html: accountEmailHtml({
      title: subject,
      preheader: d.lines[0] ?? subject,
      heading: 'Attendance alerts',
      paragraphs: [intro, ...d.lines],
      button: { label: 'Open attendance reports', href: d.url },
      footer: "You get these as a form tutor or admin. The school's attendance alert settings decide who is told.",
    }),
  };
}
