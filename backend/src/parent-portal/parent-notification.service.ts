import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { FeatureService } from '@/features/feature.service';
import { MailService } from '@/mail/mail.service';
import { PushService } from '@/notifications/push.service';
import { SubmissionService } from '@/grading/submission.service';
import { primaryOrigin } from '@/config/origins';
import { formatDueDate } from '@/grading/due-date';
import { NOTICE_KINDS, type NoticeKind, type ParentNotificationPrefsDto } from './dto/parent.dto';
import { excludedByAge, parseParentSettings, type ParentSettings } from './parent-settings';
import { workState } from './parent-portal.mapper';
import { parentNoticeEmail } from './parent-emails';
import { describeAlert } from '@/attendance-alerts/rates';

/** How far back each sweep looks; the sent table keeps it to one notice per event. */
export const LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** More notices than this for one parent in one sweep go out as one email. */
const DIGEST_AFTER = 3;
export const PARENT_PUSH_CHANNEL = 'parent';

export interface Notice {
  parentId: string;
  studentId: string;
  childName: string;
  kind: NoticeKind;
  /** The row the notice is about (dedupe key with parent and kind). */
  refId: string;
  title: string;
  body: string;
}

interface Pref {
  user_profile_id: string;
  email_enabled: boolean;
  push_enabled: boolean;
  kinds: string[];
}

interface Child {
  studentId: string;
  schoolId: string;
  name: string;
  settings: ParentSettings;
  features: { attendance: boolean; announcements: boolean; push: boolean; attendanceAlerts: boolean };
  parents: string[];
}

/** A stable uuid for (activity, student), so missing work dedupes per child. */
export function pairId(a: string, b: string): string {
  const h = createHash('sha256').update(`${a}:${b}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Parent notices: missing work, an absence, a new grade, an announcement
 * (a course post, or a school post meant for everyone). Each parent opts in to email and push separately and picks
 * the kinds. A notice goes out only while both `parent_portal` and
 * `parent_notifications` are effective for the child's school, never about
 * something the school hides from parents (grades, work, attendance,
 * announcements), and push only while `push_notifications` is on too.
 *
 * Sent by a sweep (ParentNotificationScheduler, every 15 minutes) rather than
 * from the grading, attendance and announcement write paths, so none of
 * those change; `parent_notification_sent` keeps each event to one notice.
 */
@Injectable()
export class ParentNotificationService {
  private readonly logger = new Logger(ParentNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureService,
    private readonly mail: MailService,
    private readonly push: PushService,
    private readonly submissions: SubmissionService,
  ) {}

  // ── preferences ──────────────────────────────────────────────────────────

  async getPrefs(userId: string) {
    const row = await this.prisma.parent_notification_pref.findUnique({
      where: { user_profile_id: userId },
    });
    return {
      emailEnabled: row?.email_enabled ?? false,
      pushEnabled: row?.push_enabled ?? false,
      kinds: (row?.kinds ?? [...NOTICE_KINDS]).filter((k): k is NoticeKind =>
        (NOTICE_KINDS as readonly string[]).includes(k),
      ),
    };
  }

  async setPrefs(userId: string, dto: ParentNotificationPrefsDto) {
    const data = {
      ...(dto.emailEnabled !== undefined ? { email_enabled: dto.emailEnabled } : {}),
      ...(dto.pushEnabled !== undefined ? { push_enabled: dto.pushEnabled } : {}),
      ...(dto.kinds !== undefined ? { kinds: [...new Set(dto.kinds)] } : {}),
      updated_at: new Date(),
    };
    await this.prisma.parent_notification_pref.upsert({
      where: { user_profile_id: userId },
      create: { user_profile_id: userId, ...data },
      update: data,
    });
    return this.getPrefs(userId);
  }

  // ── sweep ────────────────────────────────────────────────────────────────

  /** Find, record and send everything new since the lookback. */
  async sweep(now: Date = new Date()): Promise<number> {
    const notices = await this.collect(now);
    if (notices.length === 0) return 0;

    // Record first; only rows inserted now are sent (another instance or an
    // earlier sweep already sent the rest).
    const fresh = await this.prisma.parent_notification_sent.createManyAndReturn({
      data: notices.map((n) => ({ user_profile_id: n.parentId, kind: n.kind, ref_id: n.refId })),
      skipDuplicates: true,
      select: { user_profile_id: true, kind: true, ref_id: true },
    });
    const key = (p: string, k: string, r: string) => `${p}|${k}|${r}`;
    const isFresh = new Set(fresh.map((f) => key(f.user_profile_id, f.kind, f.ref_id)));
    const toSend = notices.filter((n) => isFresh.has(key(n.parentId, n.kind, n.refId)));
    await this.deliver(toSend);
    return toSend.length;
  }

  /** The notices due now, before deduplication. Reads only. */
  async collect(now: Date): Promise<Notice[]> {
    const prefs: Pref[] = await this.prisma.parent_notification_pref.findMany({
      where: { OR: [{ email_enabled: true }, { push_enabled: true }] },
      select: { user_profile_id: true, email_enabled: true, push_enabled: true, kinds: true },
    });
    if (prefs.length === 0) return [];
    const prefOf = new Map(prefs.map((p) => [p.user_profile_id, p]));

    const children = await this.childrenOf([...prefOf.keys()]);
    if (children.length === 0) return [];

    const since = new Date(now.getTime() - LOOKBACK_MS);
    const notices: Notice[] = [];
    const wants = (parentId: string, kind: NoticeKind) =>
      prefOf.get(parentId)?.kinds.includes(kind) ?? false;
    const emit = (c: Child, kind: NoticeKind, refId: string, title: string, body: string) => {
      for (const parentId of c.parents) {
        if (wants(parentId, kind)) {
          notices.push({ parentId, studentId: c.studentId, childName: c.name, kind, refId, title, body });
        }
      }
    };

    const parentAlertsOf = new Map<string, boolean>();
    const schoolPostsOf = new Map<
      string,
      { id: string; title: string; school: { name: string | null } | null }[]
    >();
    for (const c of children) {
      const anyWants = (kind: NoticeKind) => c.parents.some((p) => wants(p, kind));

      if (c.settings.showGrades && anyWants('new_grade')) {
        const graded = await this.prisma.submission.findMany({
          where: {
            student_id: c.studentId,
            status: 'graded',
            graded_at: { gte: since, lte: now },
            activity: { status: { in: ['published', 'closed'] } },
          },
          select: {
            id: true,
            activity: { select: { title: true, course: { select: { name: true } } } },
          },
        });
        for (const g of graded) {
          emit(c, 'new_grade', g.id, `New grade for ${c.name}`,
            `${g.activity.title} in ${g.activity.course?.name ?? 'a course'} has been marked.`);
        }
      }

      if (c.settings.showAttendance && c.features.attendance && anyWants('absence')) {
        const absent = await this.prisma.course_attendance_record.findMany({
          where: { student_id: c.studentId, status: 'absent', updated_at: { gte: since, lte: now } },
          select: {
            id: true,
            course: { select: { name: true } },
            attendance_session: { select: { opened_at: true } },
          },
        });
        for (const a of absent) {
          emit(c, 'absence', a.id, `${c.name} was marked absent`,
            `${c.name} was marked absent in ${a.course?.name ?? 'a class'} (${formatDueDate(a.attendance_session.opened_at)}).`);
        }
      }

      // Attendance alerts (src/attendance-alerts): one notice per alert row,
      // so a parent hears again only after the child recovered and fell
      // below the threshold again. Needs the attendance_alerts feature, the
      // school's notify_parents setting and showAttendance.
      if (
        c.settings.showAttendance &&
        c.features.attendance &&
        c.features.attendanceAlerts &&
        anyWants('attendance_alert')
      ) {
        let notifyParents = parentAlertsOf.get(c.schoolId);
        if (notifyParents === undefined) {
          const setting = await this.prisma.attendance_alert_setting.findUnique({
            where: { school_id: c.schoolId },
            select: { notify_parents: true },
          });
          notifyParents = setting?.notify_parents ?? false;
          parentAlertsOf.set(c.schoolId, notifyParents);
        }
        if (notifyParents) {
          const alerts = await this.prisma.attendance_alert.findMany({
            where: {
              student_id: c.studentId,
              school_id: c.schoolId,
              resolved_at: null,
              opened_at: { gte: since, lte: now },
            },
            select: { id: true, kind: true, value: true, threshold: true, window_days: true },
          });
          for (const a of alerts) {
            emit(c, 'attendance_alert', a.id, `Attendance alert for ${c.name}`,
              `${c.name}: ${describeAlert({ kind: a.kind, value: a.value, threshold: a.threshold, windowDays: a.window_days })}`);
          }
        }
      }

      if (c.settings.showWork && anyWants('missing_work')) {
        const items = await this.submissions.listForStudent(c.studentId).catch(() => []);
        for (const i of items) {
          const due = i.effectiveDueAt ? Date.parse(i.effectiveDueAt) : null;
          if (due === null || due < since.getTime() || due > now.getTime()) continue;
          if (workState(i, now.getTime()) !== 'missing') continue;
          emit(c, 'missing_work', pairId(i.id, c.studentId), `Missing work for ${c.name}`,
            `${i.title} in ${i.courseName ?? 'a course'} was due ${formatDueDate(i.effectiveDueAt)} and has not been handed in.`);
        }
      }

      if (c.settings.showAnnouncements && c.features.announcements && anyWants('announcement')) {
        const enrolments = await this.prisma.course_student.findMany({
          where: { student_id: c.studentId, status: { not: 'dropped' } },
          select: { course_id: true },
        });
        if (enrolments.length > 0) {
          const posts = await this.prisma.announcement.findMany({
            where: {
              course_id: { in: enrolments.map((e) => e.course_id) },
              created_at: { gte: since, lte: now },
              course: { status: { in: ['published', 'archived'] }, is_template: false },
            },
            select: { id: true, title: true, course: { select: { name: true } } },
          });
          for (const p of posts) {
            emit(c, 'announcement', p.id, `New announcement in ${p.course?.name ?? 'a course'}`, p.title);
          }
        }
        // The child's school's posts meant for everyone (never staff-only).
        let schoolPosts = schoolPostsOf.get(c.schoolId);
        if (!schoolPosts) {
          schoolPosts = await this.prisma.announcement.findMany({
            where: {
              school_id: c.schoolId,
              course_id: null,
              audience: 'everyone',
              created_at: { gte: since, lte: now },
            },
            select: { id: true, title: true, school: { select: { name: true } } },
          });
          schoolPostsOf.set(c.schoolId, schoolPosts);
        }
        for (const p of schoolPosts) {
          emit(c, 'announcement', p.id, `New announcement from ${p.school?.name ?? 'the school'}`, p.title);
        }
      }
    }
    // Siblings share a school (and courses): one notice per parent and post.
    const seen = new Set<string>();
    return notices.filter((n) => {
      const k = `${n.parentId}|${n.kind}|${n.refId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** Linked children of these parents where parent notices are allowed. */
  private async childrenOf(parentIds: string[]): Promise<Child[]> {
    const links = await this.prisma.parent_student_link.findMany({
      where: { user_profile_id: { in: parentIds } },
      select: {
        user_profile_id: true,
        student: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            is_active: true,
            date_of_birth: true,
            school_id: true,
            school: { select: { parent_settings: true, is_active: true } },
          },
        },
      },
    });

    const effective = new Map<string, Awaited<ReturnType<FeatureService['effective']>>>();
    const byStudent = new Map<string, Child>();
    for (const l of links) {
      const s = l.student;
      if (!s?.school_id || s.is_active === false || s.school?.is_active === false) continue;
      let f = effective.get(s.school_id);
      if (!f) {
        f = await this.features.effective(s.school_id);
        effective.set(s.school_id, f);
      }
      // parent_notifications requires parent_portal, so both are on here.
      if (!f.parent_portal || !f.parent_notifications) continue;
      const settings = parseParentSettings(s.school?.parent_settings);
      if (excludedByAge(settings, s.date_of_birth)) continue;

      const existing = byStudent.get(s.id);
      if (existing) {
        existing.parents.push(l.user_profile_id);
        continue;
      }
      byStudent.set(s.id, {
        studentId: s.id,
        schoolId: s.school_id,
        name: [s.first_name, s.last_name].filter(Boolean).join(' ') || 'Your child',
        settings,
        features: {
          attendance: f.attendance,
          attendanceAlerts: f.attendance_alerts,
          announcements: f.announcements,
          push: f.push_notifications,
        },
        parents: [l.user_profile_id],
      });
    }
    return [...byStudent.values()];
  }

  private async deliver(notices: Notice[]) {
    if (notices.length === 0) return;
    const parentIds = [...new Set(notices.map((n) => n.parentId))];
    const [prefs, profiles] = await Promise.all([
      this.prisma.parent_notification_pref.findMany({
        where: { user_profile_id: { in: parentIds } },
        select: { user_profile_id: true, email_enabled: true, push_enabled: true, kinds: true },
      }),
      this.prisma.user_profile.findMany({
        where: { id: { in: parentIds }, account_type: 'parent', is_active: { not: false } },
        select: { id: true, email: true },
      }),
    ]);
    const prefOf = new Map(prefs.map((p) => [p.user_profile_id, p]));
    const emailOf = new Map(profiles.map((p) => [p.id, p.email]));
    const pushAllowed = await this.pushAllowedBySchool(notices);
    const url = `${primaryOrigin()}/parent`;

    for (const parentId of parentIds) {
      const pref = prefOf.get(parentId);
      if (!pref || !emailOf.has(parentId)) continue;
      const mine = notices.filter((n) => n.parentId === parentId);

      if (pref.push_enabled) {
        for (const n of mine) {
          if (!pushAllowed.has(n.studentId)) continue;
          // A child's name and news: generic on the lock screen unless the
          // child's school (or the organisation) chose full push content.
          await this.push.sendToUsers([parentId], {
            title: n.title,
            body: n.body,
            data: { type: `parent.${n.kind}`, studentId: n.studentId },
            channelId: PARENT_PUSH_CHANNEL,
            category: 'parent',
            sensitive: true,
            schoolId: pushAllowed.get(n.studentId) ?? null,
          });
        }
      }

      const email = emailOf.get(parentId);
      if (pref.email_enabled && email) {
        const messages =
          mine.length > DIGEST_AFTER
            ? [{
                title: `${mine.length} updates from GradeBook`,
                body: mine.map((n) => `${n.title}: ${n.body}`).join('\n'),
                childName: [...new Set(mine.map((n) => n.childName))].join(', '),
              }]
            : mine.map((n) => ({ title: n.title, body: n.body, childName: n.childName }));
        for (const m of messages) {
          await this.mail
            .send({ to: email, ...parentNoticeEmail({ ...m, url }) })
            .catch((err: Error) => this.logger.warn(`Parent notice email failed: ${err.message}`));
        }
      }
    }
  }

  /** Children whose school has push_notifications on, with that school. */
  private async pushAllowedBySchool(notices: Notice[]): Promise<Map<string, string>> {
    const students = [...new Set(notices.map((n) => n.studentId))];
    const rows = await this.prisma.student.findMany({
      where: { id: { in: students } },
      select: { id: true, school_id: true },
    });
    const allowed = new Map<string, string>();
    const cache = new Map<string, boolean>();
    for (const r of rows) {
      if (!r.school_id) continue;
      let on = cache.get(r.school_id);
      if (on === undefined) {
        on = await this.features.isEnabled(r.school_id, 'push_notifications');
        cache.set(r.school_id, on);
      }
      if (on) allowed.set(r.id, r.school_id);
    }
    return allowed;
  }
}
