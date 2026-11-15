import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { SessionService } from '@/account/session.service';
import { accountDeletionCheck, isSsoProvider } from '@/auth/account-deletion';
import { REPORT_AREA, reportKey } from '@/report-card/report-keys';
import { ErasureLogService } from './erasure-log.service';
import { isUuid, plan, type ErasureReason, type ReplayStep } from './erasure-plan';
import {
  eraseAccountRows,
  finishAccountErasure,
  prepareAccountErasure,
  type AccountErasurePrep,
} from './account-erasure';

/** What happens to the account linked to an erased student record. */
export type LinkedAccountOutcome =
  /** No account was linked. */
  | 'none'
  /** A school-managed (single sign-on) account used only in this school: deleted with the record. */
  | 'deleted'
  /** The person's own account (or one used in another school): kept, removed from this school. */
  | 'unlinked';

export interface StudentErasureResult {
  studentId: string;
  account: LinkedAccountOutcome;
  /** Term report documents deleted (their PDFs are removed from storage). */
  reportFiles: number;
}

/** Rows erasing a student record would delete, per category (erasure preview). */
export interface ErasurePreviewCounts {
  enrolments: number;
  submissions: number;
  attendanceRecords: number;
  attendanceAlerts: number;
  extensions: number;
  accommodations: number;
  reportComments: number;
  reportDocuments: number;
  parentLinks: number;
  parentInvites: number;
  outcomeEvidence: number;
  dataExports: number;
}

export interface StudentErasureOptions {
  /** The school the record must belong to (404 otherwise). */
  schoolId: string;
  /** The user who asked for it, or 'system' (retention purge). */
  actor: string;
  reason: ErasureReason;
}

/**
 * Erasing a student record (Art. 17): `DELETE /students/:id` and the
 * school's retention purge (src/retention). One transaction deletes the
 * student row - which cascades to enrolments, submissions (and their quiz
 * answers, rubric assessments, similarity fingerprints, AI grading drafts,
 * peer-review allocations), attendance records and alerts, extensions and
 * accommodations, report comments and report documents, pastoral notes,
 * parent links and invites, mastery evidence and analytics rows - plus the
 * rostering links that name the student, and writes a `student_record`
 * erasure-log entry. The linked account is either deleted in the same
 * transaction (school-managed: signs in through single sign-on, and is in
 * no other school; written as its own `account` entry) or removed from the
 * school. Report PDFs and the deleted account's objects go after commit.
 *
 * Not touched: audit-log entries about the student (their retention is the
 * organisation's decision; see src/erasure/README.md), files a staff member
 * attached to a pastoral note (they stay in that staff member's file
 * manager), and discussion posts the student wrote when the account is kept.
 */
@Injectable()
export class StudentErasureService {
  private readonly logger = new Logger(StudentErasureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly erasure: ErasureLogService,
    private readonly cache: CacheService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Whether the account linked to a student would be deleted with the
   * record ('deleted') or kept and removed from the school ('unlinked').
   * Deleted only when the school manages it (single sign-on student), it
   * belongs to no other school, and nothing would block deleting it
   * (owning a school or the organisation, being its last admin).
   */
  async linkedAccountOutcome(userId: string | null, schoolId: string): Promise<LinkedAccountOutcome> {
    if (!userId) return 'none';
    const [identities, otherMemberships, profile, check] = await Promise.all([
      this.prisma.identity.findMany({ where: { user_id: userId }, select: { provider: true } }),
      this.prisma.school_management.count({
        where: { user_id: userId, school_id: { not: schoolId } },
      }),
      this.prisma.user_profile.findUnique({
        where: { id: userId },
        select: { school_id: true },
      }),
      accountDeletionCheck(this.prisma, userId),
    ]);
    const managed = (identities ?? []).some((i) => isSsoProvider(i.provider));
    const elsewhere =
      otherMemberships > 0 || (!!profile?.school_id && profile.school_id !== schoolId);
    const blocked = check.blockers.some((b) => b.code !== 'SSO_STUDENT');
    return managed && !elsewhere && !blocked ? 'deleted' : 'unlinked';
  }

  /**
   * How many rows of each kind erasing the record would delete, for the
   * confirmation. Pastoral notes are left out: whether a student has any
   * (safeguarding ones especially) is not for every holder of student:erase.
   */
  async previewCounts(studentId: string): Promise<ErasurePreviewCounts> {
    const where = { student_id: studentId };
    const [
      enrolments,
      submissions,
      attendanceRecords,
      attendanceAlerts,
      extensions,
      accommodations,
      reportComments,
      reportDocuments,
      parentLinks,
      parentInvites,
      outcomeEvidence,
      dataExports,
    ] = await Promise.all([
      this.prisma.course_student.count({ where }),
      this.prisma.submission.count({ where }),
      this.prisma.course_attendance_record.count({ where }),
      this.prisma.attendance_alert.count({ where }),
      this.prisma.activity_extension.count({ where }),
      Promise.all([
        this.prisma.activity_accommodation.count({ where }),
        this.prisma.student_accommodation.count({ where }),
      ]).then(([a, b]) => (a ?? 0) + (b ?? 0)),
      this.prisma.report_comment.count({ where }),
      this.prisma.report_document.count({ where }),
      this.prisma.parent_student_link.count({ where }),
      this.prisma.parent_invite.count({ where }),
      this.prisma.outcome_evidence.count({ where }),
      this.prisma.data_export.count({ where }),
    ]);
    const n = (v: number | undefined | null) => v ?? 0;
    return {
      enrolments: n(enrolments),
      submissions: n(submissions),
      attendanceRecords: n(attendanceRecords),
      attendanceAlerts: n(attendanceAlerts),
      extensions: n(extensions),
      accommodations: n(accommodations),
      reportComments: n(reportComments),
      reportDocuments: n(reportDocuments),
      parentLinks: n(parentLinks),
      parentInvites: n(parentInvites),
      outcomeEvidence: n(outcomeEvidence),
      dataExports: n(dataExports),
    };
  }

  async erase(studentId: string, opts: StudentErasureOptions): Promise<StudentErasureResult> {
    const { schoolId } = opts;
    const student = isUuid(studentId)
      ? await this.prisma.student.findFirst({
          where: { id: studentId, school_id: schoolId },
          select: { id: true, user_profile_id: true },
        })
      : null;
    if (!student) throw new NotFoundException('Student not found');
    const userId = student.user_profile_id;

    const [docs, enrolments, outcome, exports] = await Promise.all([
      this.prisma.report_document.findMany({
        where: { student_id: studentId },
        select: { school_id: true, term_id: true, storage_key: true },
      }),
      this.prisma.course_student.findMany({
        where: { student_id: studentId },
        select: { id: true },
      }),
      this.linkedAccountOutcome(userId, schoolId),
      // Data-export ZIPs about the student: the rows cascade with the
      // record; the objects go right after commit.
      this.prisma.data_export.findMany({
        where: { student_id: studentId, storage_key: { not: null } },
        select: { storage_key: true },
      }),
    ]);
    const exportKeys = (exports ?? []).map((e) => e.storage_key).filter((k): k is string => !!k);

    // Report PDFs: the stored key, and the deterministic one in case a
    // generation finished after the row was last updated.
    const reportKeys = new Set<string>();
    for (const d of docs ?? []) {
      reportKeys.add(reportKey(d.school_id, d.term_id, studentId));
      if (d.storage_key?.startsWith(`${REPORT_AREA}/`)) reportKeys.add(d.storage_key);
    }
    const replayReportKeys = [...reportKeys].filter((k) =>
      /^report-cards\/schools\/[0-9a-f-]{36}\/terms\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/i.test(k),
    );
    const rosterTargets = [studentId, ...(enrolments ?? []).map((e) => e.id)];

    let accountPrep: AccountErasurePrep | null = null;
    if (outcome === 'deleted' && userId) {
      accountPrep = await prepareAccountErasure(this.prisma, userId);
      await this.sessions.revokeAll(userId, 'account_deleted');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.roster_link.deleteMany({ where: { target_id: { in: rosterTargets } } });
      // AI grading drafts of the student's work (also cascade with the row).
      await tx.ai_grading_draft.deleteMany({ where: { student_id: studentId } });
      const { count } = await tx.student.deleteMany({ where: { id: studentId, school_id: schoolId } });
      if (count === 0) throw new NotFoundException('Student not found');

      const steps: ReplayStep[] = [];
      if (replayReportKeys.length > 0) steps.push(plan.prefixes(replayReportKeys));
      steps.push(
        plan.del('public.roster_link', { target_id: rosterTargets }),
        plan.del('grading.ai_grading_draft', { student_id: [studentId] }),
        plan.del('student.student', { id: [studentId] }),
      );

      if (outcome === 'unlinked' && userId) {
        // Their own account stays; it just stops being in this school.
        await tx.school_management.deleteMany({ where: { user_id: userId, school_id: schoolId } });
        await tx.user_profile.updateMany({
          where: { id: userId, school_id: schoolId },
          data: { school_id: null, role: null },
        });
        // By id, so the replay plan can name exactly what went.
        const [conversations, courses] = await Promise.all([
          tx.conversation_member.findMany({
            where: { user_id: userId, conversation: { school_id: schoolId } },
            select: { conversation_id: true },
          }),
          tx.course_notification.findMany({
            where: { user_profile_id: userId, course: { school_id: schoolId } },
            select: { course_id: true },
            distinct: ['course_id'],
          }),
        ]);
        const conversationIds = [...new Set((conversations ?? []).map((c) => c.conversation_id))];
        const courseIds = [...new Set((courses ?? []).map((c) => c.course_id))];
        await tx.conversation_member.deleteMany({
          where: { user_id: userId, conversation: { school_id: schoolId } },
        });
        await tx.course_notification.deleteMany({
          where: { user_profile_id: userId, course: { school_id: schoolId } },
        });
        if (conversationIds.length > 0) {
          steps.push(plan.del('chat.conversation_member', { user_id: [userId], conversation_id: conversationIds }));
        }
        if (courseIds.length > 0) {
          steps.push(plan.del('course.course_notification', { user_profile_id: [userId], course_id: courseIds }));
        }
        steps.push(
          plan.del('public.school_management', { user_id: [userId], school_id: [schoolId] }),
          plan.update(
            'public.user_profile',
            { id: [userId], school_id: [schoolId] },
            { school_id: null, role: null },
          ),
        );
      }

      await this.erasure.record(tx, {
        kind: 'student_record',
        subjectTable: 'student.student',
        subjectIds: [studentId],
        schoolId,
        actor: opts.actor,
        reason: opts.reason,
        replay: plan.of(...steps),
      });

      if (accountPrep) {
        await eraseAccountRows(tx, this.erasure, accountPrep, {
          actor: opts.actor,
          reason: opts.reason,
        });
      }
    });

    await this.erasure.removeObjects([...reportKeys, ...exportKeys]);
    if (accountPrep) await finishAccountErasure({ erasure: this.erasure, cache: this.cache }, accountPrep);
    await Promise.all([
      this.cache.delete(`students:${schoolId}`),
      userId ? this.cache.delete(`student-context:${userId}`) : undefined,
      userId ? this.cache.delete(`profile:${userId}`) : undefined,
    ]);
    this.logger.log(
      `Student record ${studentId} erased (${opts.reason}); linked account: ${outcome}`,
    );
    return { studentId, account: outcome, reportFiles: (docs ?? []).length };
  }
}
