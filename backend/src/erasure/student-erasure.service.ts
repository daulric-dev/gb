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
 * answers, rubric assessments, similarity fingerprints, peer-review
 * allocations), attendance records and alerts, extensions and
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

    const [docs, enrolments, outcome] = await Promise.all([
      this.prisma.report_document.findMany({
        where: { student_id: studentId },
        select: { school_id: true, term_id: true, storage_key: true },
      }),
      this.prisma.course_student.findMany({
        where: { student_id: studentId },
        select: { id: true },
      }),
      this.linkedAccountOutcome(userId, schoolId),
    ]);

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
      const { count } = await tx.student.deleteMany({ where: { id: studentId, school_id: schoolId } });
      if (count === 0) throw new NotFoundException('Student not found');

      const steps: ReplayStep[] = [];
      if (replayReportKeys.length > 0) steps.push(plan.prefixes(replayReportKeys));
      steps.push(
        plan.del('public.roster_link', { target_id: rosterTargets }),
        plan.del('student.student', { id: [studentId] }),
      );

      if (outcome === 'unlinked' && userId) {
        // Their own account stays; it just stops being in this school.
        await tx.school_management.deleteMany({ where: { user_id: userId, school_id: schoolId } });
        await tx.user_profile.updateMany({
          where: { id: userId, school_id: schoolId },
          data: { school_id: null, role: null },
        });
        await tx.conversation_member.deleteMany({
          where: { user_id: userId, conversation: { school_id: schoolId } },
        });
        await tx.course_notification.deleteMany({
          where: { user_profile_id: userId, course: { school_id: schoolId } },
        });
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

    await this.erasure.removeObjects([...reportKeys]);
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
