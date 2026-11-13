import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import {
  CourseAccessService,
  MANAGE_ROLES,
  STAFF_ROLES,
  type CourseRole,
} from '@/course/access/course-access.service';
import { CourseNotificationService } from '@/course-notification/course-notification.service';
import { FeatureService } from '@/features/feature.service';
import { FileManagerService } from '@/file-manager/file-manager.service';
import { SubmissionEvents } from '@/grading/submission-events';
import { loadRubric } from '@/grading/rubric.service';
import { isUniqueViolation } from '@/common/db-values';
import { acquireJobLease, releaseJobLease } from '@/common/job-lease';
import { toTimestamp, ts } from '@/grading/activity.mapper';
import { roundScore } from '@/grading/round';
import {
  allocate,
  anonymousFileName,
  opensAt,
  shouldOpen,
  validateMarks,
  windowState,
  type OpenMode,
  type ReviewMark,
  type Submitter,
  type WindowInput,
} from './allocation';

const SETTING_SELECT = {
  activity_id: true,
  enabled: true,
  reviews_per_student: true,
  anonymous: true,
  open_mode: true,
  closes_at: true,
  rubric_id: true,
  quality_points: true,
  quality_activity_id: true,
  seed: true,
  started_at: true,
  ready_notified_at: true,
} satisfies Prisma.peer_review_settingSelect;

type SettingRow = Prisma.peer_review_settingGetPayload<{
  select: typeof SETTING_SELECT;
}>;

const ALLOCATION_SELECT = {
  id: true,
  activity_id: true,
  submission_id: true,
  reviewer_id: true,
  comment: true,
  rubric_marks: true,
  submitted_at: true,
  hidden: true,
  hidden_reason: true,
  hidden_at: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.peer_review_allocationSelect;

type AllocationRow = Prisma.peer_review_allocationGetPayload<{
  select: typeof ALLOCATION_SELECT;
}>;

interface ActivityRow {
  id: string;
  course_id: string;
  kind: string;
  title: string;
  instructions: string | null;
  status: string;
  due_at: Date | null;
}

const ACTIVITY_COLUMNS = {
  id: true,
  course_id: true,
  kind: true,
  title: true,
  instructions: true,
  status: true,
  due_at: true,
} as const;

function windowOf(setting: SettingRow, activity: { due_at: Date | null }): WindowInput {
  return {
    openMode: setting.open_mode as OpenMode,
    dueAt: activity.due_at,
    startedAt: setting.started_at,
    closesAt: setting.closes_at,
  };
}

function marksOf(value: Prisma.JsonValue): ReviewMark[] {
  return Array.isArray(value) ? (value as unknown as ReviewMark[]) : [];
}

function nameOf(s: { first_name: string | null; last_name: string | null } | null | undefined): string {
  return [s?.first_name, s?.last_name].filter(Boolean).join(' ').trim() || 'Student';
}

/** The settings part of every response. */
function toSettings(setting: SettingRow, activity: { due_at: Date | null }, now: Date) {
  const w = windowOf(setting, activity);
  return {
    enabled: setting.enabled,
    reviewsPerStudent: setting.reviews_per_student,
    anonymous: setting.anonymous,
    openMode: setting.open_mode as OpenMode,
    closesAt: ts(setting.closes_at) as string,
    rubricId: setting.rubric_id,
    qualityPoints:
      setting.quality_points === null ? null : roundScore(Number(setting.quality_points)),
    qualityActivityId: setting.quality_activity_id,
    startedAt: ts(setting.started_at),
    opensAt: ts(opensAt(w)),
    state: windowState(w, now),
  };
}

/**
 * Peer review on assignments (feature `peer_review`). See README.md for the
 * rules; allocation itself is the pure `allocate()` in allocation.ts.
 */
@Injectable()
export class PeerReviewService implements OnModuleInit {
  private readonly logger = new Logger(PeerReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    private readonly files: FileManagerService,
    private readonly features: FeatureService,
    @Optional() private readonly notifications?: CourseNotificationService,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly events?: SubmissionEvents,
  ) {}

  onModuleInit() {
    this.events?.onHandedIn(async (event) => {
      if (event.kind === 'assignment') await this.onHandedIn(event.activityId);
    });
  }

  // ── staff ──────────────────────────────────────────────────────────────

  private async staffActivity(
    userId: string,
    activityId: string,
    roles: readonly CourseRole[] = STAFF_ROLES,
  ) {
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: ACTIVITY_COLUMNS,
    });
    if (!activity?.course_id) throw new NotFoundException('Activity not found');
    const { course } = await this.access.require(userId, activity.course_id, roles);
    await this.features.assertEnabled(course.school_id, 'peer_review');
    return { ...activity, school_id: course.school_id } as ActivityRow & {
      school_id: string;
    };
  }

  private setting(activityId: string) {
    return this.prisma.peer_review_setting.findUnique({
      where: { activity_id: activityId },
      select: SETTING_SELECT,
    });
  }

  /** Settings, window, every allocation with its review, and the submitters. */
  async overview(userId: string, activityId: string, now = new Date()) {
    const activity = await this.staffActivity(userId, activityId);
    let setting = await this.setting(activityId);
    if (setting) setting = await this.ensureOpen(activity, setting, now);
    if (!setting) return { activityId, settings: null, reviews: [], submitters: [] };

    const [rows, submitters, rubric] = await Promise.all([
      this.prisma.peer_review_allocation.findMany({
        where: { activity_id: activityId },
        select: ALLOCATION_SELECT,
        orderBy: { created_at: 'asc' },
      }),
      this.submitters(activity),
      loadRubric(this.prisma, setting.rubric_id),
    ]);
    const subs = await this.prisma.submission.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.submission_id))] } },
      select: { id: true, student_id: true },
    });
    const authorOf = new Map(subs.map((s) => [s.id, s.student_id]));
    const names = await this.studentNames([
      ...rows.map((r) => r.reviewer_id),
      ...subs.map((s) => s.student_id),
      ...submitters.map((s) => s.studentId),
    ]);
    const person = (id: string | undefined) =>
      id ? { id, name: names.get(id) ?? 'Student' } : null;

    return {
      activityId,
      settings: toSettings(setting, activity, now),
      rubric,
      reviews: rows.map((r) => ({
        id: r.id,
        submissionId: r.submission_id,
        reviewer: person(r.reviewer_id),
        author: person(authorOf.get(r.submission_id)),
        comment: r.comment,
        marks: marksOf(r.rubric_marks),
        score: rubric ? sumMarks(marksOf(r.rubric_marks)) : null,
        submittedAt: ts(r.submitted_at),
        hidden: r.hidden,
        hiddenReason: r.hidden_reason,
        hiddenAt: ts(r.hidden_at),
        updatedAt: ts(r.updated_at),
      })),
      submitters: submitters.map((s) => ({
        studentId: s.studentId,
        submissionId: s.submissionId,
        name: names.get(s.studentId) ?? 'Student',
      })),
    };
  }

  /** Create or change the activity's peer review settings. */
  async updateSettings(
    userId: string,
    activityId: string,
    input: {
      enabled: boolean;
      reviewsPerStudent: number;
      anonymous: boolean;
      openMode: OpenMode;
      closesAt: string;
      rubricId?: string | null;
      qualityPoints?: number | null;
    },
    now = new Date(),
  ) {
    const activity = await this.staffActivity(userId, activityId, MANAGE_ROLES);
    if (activity.kind !== 'assignment') {
      throw new BadRequestException('Peer review is for assignments only');
    }
    const closesAt = toTimestamp(input.closesAt);
    if (Number.isNaN(closesAt.getTime())) {
      throw new BadRequestException('Choose a valid closing date');
    }
    if (input.openMode === 'after_due' && !activity.due_at) {
      throw new BadRequestException(
        'Set a due date first, or choose to start peer review yourself',
      );
    }
    const before = await this.setting(activityId);
    const opening = before?.started_at ?? (input.openMode === 'after_due' ? activity.due_at : null);
    if (closesAt.getTime() <= now.getTime() && closesAt.getTime() !== before?.closes_at.getTime()) {
      throw new BadRequestException('Peer review must close in the future');
    }
    if (opening && closesAt.getTime() <= opening.getTime()) {
      throw new BadRequestException(
        before?.started_at
          ? 'Peer review must close after it opened'
          : 'Peer review must close after the due date',
      );
    }
    const rubricId = input.rubricId ?? null;
    if (rubricId) {
      const rubric = await this.prisma.rubric.findUnique({
        where: { id: rubricId },
        select: { course_id: true },
      });
      if (rubric?.course_id !== activity.course_id) {
        throw new BadRequestException('Choose a rubric from this course');
      }
    }
    if (before?.started_at) {
      if (input.reviewsPerStudent < before.reviews_per_student) {
        throw new ConflictException(
          'Reviews have been assigned; the number per student can only go up',
        );
      }
      if (before.anonymous && !input.anonymous) {
        throw new ConflictException(
          'Reviews were written anonymously; they cannot be made named now',
        );
      }
      if (rubricId !== before.rubric_id) {
        const written = await this.prisma.peer_review_allocation.count({
          where: { activity_id: activityId, submitted_at: { not: null } },
        });
        if (written > 0) {
          throw new ConflictException(
            'Reviews have been handed in; the review form can no longer change',
          );
        }
      }
    }
    const qualityPoints = input.qualityPoints ?? null;

    const saved = await this.prisma.$transaction(async (tx) => {
      const qualityActivityId = await this.syncQualityColumn(
        tx,
        userId,
        activity,
        before?.quality_activity_id ?? null,
        qualityPoints,
      );
      const data = {
        enabled: input.enabled,
        reviews_per_student: input.reviewsPerStudent,
        anonymous: input.anonymous,
        open_mode: input.openMode,
        closes_at: closesAt,
        rubric_id: rubricId,
        quality_points: qualityPoints,
        quality_activity_id: qualityActivityId,
      };
      const row = await tx.peer_review_setting.upsert({
        where: { activity_id: activityId },
        create: { activity_id: activityId, ...data },
        update: {
          ...data,
          // A later close date means authors are told again when it comes.
          ...(before && closesAt.getTime() !== before.closes_at.getTime()
            ? { ready_notified_at: null }
            : {}),
          updated_at: now,
        },
        select: SETTING_SELECT,
      });
      await this.auditLog?.record(
        tx,
        activity.school_id,
        { id: userId },
        {
          entity: 'peer_review_setting',
          entityId: activityId,
          action: before ? 'update' : 'create',
          changes: auditChanges(before ? auditSetting(before) : null, auditSetting(row)),
        },
      );
      return row;
    });

    // More reviews per student, after the window opened: top up now.
    const settled = await this.ensureOpen(activity, saved, now);
    if (
      settled.started_at &&
      before &&
      settled.reviews_per_student > before.reviews_per_student &&
      windowState(windowOf(settled, activity), now) === 'open'
    ) {
      await this.allocateNow(activity, settled, now);
    }
    return this.overview(userId, activityId, now);
  }

  /**
   * The review-quality gradebook column: an offline activity in the same
   * course, published so it can be marked. Created when quality counts,
   * its points kept in step, and removed when it no longer counts (kept,
   * unlinked, if anyone has a mark in it).
   */
  private async syncQualityColumn(
    tx: Prisma.TransactionClient,
    userId: string,
    activity: ActivityRow,
    current: string | null,
    points: number | null,
  ): Promise<string | null> {
    if (points === null) {
      if (!current) return null;
      const marked = await tx.submission.count({ where: { activity_id: current } });
      if (marked === 0) {
        await tx.peer_review_setting.updateMany({
          where: { quality_activity_id: current },
          data: { quality_activity_id: null },
        });
        await tx.activity.delete({ where: { id: current } });
      }
      return null;
    }
    if (current) {
      const tooHigh = await tx.submission.count({
        where: { activity_id: current, score: { gt: points } },
      });
      if (tooHigh > 0) {
        throw new ConflictException(
          'Some review-quality marks are above the new points; change them first',
        );
      }
      await tx.activity.update({
        where: { id: current },
        data: { points, updated_at: new Date() },
      });
      return current;
    }
    const column = await tx.activity.create({
      data: {
        course_id: activity.course_id,
        kind: 'offline',
        title: `Peer review: ${activity.title}`.slice(0, 200),
        instructions: 'Your teacher marks the quality of the peer reviews you wrote.',
        points,
        status: 'published',
        published_at: new Date(),
        max_attempts: null,
        created_by: userId,
      },
      select: { id: true },
    });
    return column.id;
  }

  /** Open the window now (manual start), or allocate late joiners if open. */
  async start(userId: string, activityId: string, now = new Date()) {
    const activity = await this.staffActivity(userId, activityId, MANAGE_ROLES);
    const setting = await this.setting(activityId);
    if (!setting?.enabled) {
      throw new BadRequestException('Turn peer review on first');
    }
    if (now.getTime() >= setting.closes_at.getTime()) {
      throw new ConflictException('Peer review has closed');
    }
    await this.allocateNow(activity, setting, now);
    const auditLog = this.auditLog;
    if (auditLog) {
      await this.prisma.$transaction((tx) =>
        auditLog.record(tx, activity.school_id, { id: userId }, {
          entity: 'peer_review_setting',
          entityId: activityId,
          action: 'update',
          changes: setting.started_at
            ? { allocated: { before: null, after: now.toISOString() } }
            : { startedAt: { before: null, after: now.toISOString() } },
        }),
      );
    }
    return this.overview(userId, activityId, now);
  }

  /** A teacher gives a submission another reviewer. */
  async addAllocation(
    userId: string,
    activityId: string,
    input: { reviewerId: string; submissionId: string },
  ) {
    const activity = await this.staffActivity(userId, activityId, MANAGE_ROLES);
    const setting = await this.requireStarted(activityId);
    const submission = await this.prisma.submission.findUnique({
      where: { id: input.submissionId },
      select: { id: true, activity_id: true, student_id: true },
    });
    if (submission?.activity_id !== activityId) {
      throw new NotFoundException('Submission not found');
    }
    await this.requireReviewer(activity.course_id, input.reviewerId, submission.student_id);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.peer_review_allocation.create({
          data: {
            activity_id: activityId,
            submission_id: submission.id,
            reviewer_id: input.reviewerId,
          },
          select: { id: true },
        });
        await this.auditLog?.record(tx, activity.school_id, { id: userId }, {
          entity: 'peer_review_allocation',
          entityId: created.id,
          action: 'create',
          changes: auditChanges(null, {
            reviewerId: input.reviewerId,
            submissionId: submission.id,
          }),
        });
        return created;
      });
      void this.notifications?.peerReviewAssigned(activity.course_id, activity, [
        input.reviewerId,
      ]);
      return { id: row.id, started: !!setting.started_at };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('That student already reviews this submission');
      }
      throw err;
    }
  }

  /** Move a review not yet handed in to another student. */
  async reassign(
    userId: string,
    activityId: string,
    allocationId: string,
    reviewerId: string,
  ) {
    const activity = await this.staffActivity(userId, activityId, MANAGE_ROLES);
    const row = await this.allocationOf(activityId, allocationId);
    if (row.submitted_at) {
      throw new ConflictException('This review has been handed in; it cannot move');
    }
    const author = await this.authorOf(row.submission_id);
    await this.requireReviewer(activity.course_id, reviewerId, author);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.peer_review_allocation.update({
          where: { id: allocationId },
          data: { reviewer_id: reviewerId, comment: null, rubric_marks: [], updated_at: new Date() },
        });
        await this.auditLog?.record(tx, activity.school_id, { id: userId }, {
          entity: 'peer_review_allocation',
          entityId: allocationId,
          action: 'update',
          changes: auditChanges({ reviewerId: row.reviewer_id }, { reviewerId }),
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('That student already reviews this submission');
      }
      throw err;
    }
    void this.notifications?.peerReviewAssigned(activity.course_id, activity, [reviewerId]);
    return { id: allocationId, reviewerId };
  }

  async removeAllocation(userId: string, activityId: string, allocationId: string) {
    const activity = await this.staffActivity(userId, activityId, MANAGE_ROLES);
    const row = await this.allocationOf(activityId, allocationId);
    await this.prisma.$transaction(async (tx) => {
      await tx.peer_review_allocation.delete({ where: { id: allocationId } });
      await this.auditLog?.record(tx, activity.school_id, { id: userId }, {
        entity: 'peer_review_allocation',
        entityId: allocationId,
        action: 'delete',
        changes: auditChanges(
          { reviewerId: row.reviewer_id, submissionId: row.submission_id },
          null,
        ),
      });
    });
  }

  /** Hide an inappropriate review from its author (or show it again). Audited. */
  async setHidden(
    userId: string,
    activityId: string,
    allocationId: string,
    input: { hidden: boolean; reason?: string | null },
  ) {
    const activity = await this.staffActivity(userId, activityId);
    const row = await this.allocationOf(activityId, allocationId);
    const reason = input.hidden ? input.reason?.trim() || null : null;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.peer_review_allocation.update({
        where: { id: allocationId },
        data: {
          hidden: input.hidden,
          hidden_reason: reason,
          hidden_by: input.hidden ? userId : null,
          hidden_at: input.hidden ? now : null,
          updated_at: now,
        },
      });
      await this.auditLog?.record(tx, activity.school_id, { id: userId }, {
        entity: 'peer_review_allocation',
        entityId: allocationId,
        action: 'update',
        changes: auditChanges(
          { hidden: row.hidden, hiddenReason: row.hidden_reason },
          { hidden: input.hidden, hiddenReason: reason },
        ),
      });
    });
    return { id: allocationId, hidden: input.hidden, hiddenReason: reason };
  }

  private async requireStarted(activityId: string) {
    const setting = await this.setting(activityId);
    if (!setting?.enabled || !setting.started_at) {
      throw new ConflictException('Peer review has not started');
    }
    return setting;
  }

  private async allocationOf(activityId: string, allocationId: string) {
    const row = await this.prisma.peer_review_allocation.findUnique({
      where: { id: allocationId },
      select: ALLOCATION_SELECT,
    });
    if (row?.activity_id !== activityId) throw new NotFoundException('Review not found');
    return row;
  }

  private async authorOf(submissionId: string) {
    const s = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { student_id: true },
    });
    if (!s) throw new NotFoundException('Submission not found');
    return s.student_id;
  }

  /** A reviewer must be enrolled (not dropped) and not the author. */
  private async requireReviewer(courseId: string, reviewerId: string, authorId: string) {
    if (reviewerId === authorId) {
      throw new BadRequestException('A student cannot review their own work');
    }
    const enrolment = await this.prisma.course_student.findUnique({
      where: { course_id_student_id: { course_id: courseId, student_id: reviewerId } },
      select: { status: true },
    });
    if (!enrolment || enrolment.status === 'dropped') {
      throw new NotFoundException('That student is not enrolled in this course');
    }
  }

  // ── allocation ─────────────────────────────────────────────────────────

  /**
   * Students who handed in (not excused, still enrolled): the reviewers and
   * the reviewed alike. Students with nothing handed in are left out.
   */
  async submitters(activity: { id: string; course_id: string }): Promise<Submitter[]> {
    const rows = await this.prisma.submission.findMany({
      where: {
        activity_id: activity.id,
        excused: false,
        submitted_at: { not: null },
        status: { in: ['submitted', 'graded'] },
      },
      select: { id: true, student_id: true },
    });
    if (rows.length === 0) return [];
    const enrolled = await this.prisma.course_student.findMany({
      where: {
        course_id: activity.course_id,
        status: { not: 'dropped' },
        student_id: { in: rows.map((r) => r.student_id) },
      },
      select: { student_id: true },
    });
    const ok = new Set(enrolled.map((e) => e.student_id));
    return rows
      .filter((r) => ok.has(r.student_id))
      .map((r) => ({ studentId: r.student_id, submissionId: r.id }));
  }

  /** Open the window if it is due (allocating), returning the fresh row. */
  private async ensureOpen(activity: ActivityRow, setting: SettingRow, now: Date) {
    if (!setting.enabled || !shouldOpen(windowOf(setting, activity), now)) return setting;
    if (activity.status === 'draft') return setting;
    await this.allocateNow(activity, setting, now);
    return (await this.setting(activity.id)) ?? setting;
  }

  /**
   * Allocate (first run: the ring; later: late joiners only) under a
   * per-activity database lease, stamp started_at, and tell new reviewers.
   * Returns the reviewers given new work.
   */
  async allocateNow(
    activity: { id: string; course_id: string; title: string },
    setting: SettingRow,
    now: Date,
  ): Promise<string[]> {
    const submitters = await this.submitters(activity);
    // The lease is taken outside the transaction: a failed insert (the lease
    // row already exists) would abort a Postgres transaction, so the reclaim
    // that follows it could never run inside one.
    const key = `peer-review:activity:${activity.id}`;
    const ownerToken = await acquireJobLease(this.prisma, key, 60_000);
    if (!ownerToken) throw new ConflictException('Peer review allocation is busy');
    let added: ReturnType<typeof allocate>;
    try {
      added = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.peer_review_allocation.findMany({
          where: { activity_id: activity.id },
          select: { reviewer_id: true, submission_id: true },
        });
        const fresh = allocate(
          submitters,
          existing.map((e) => ({ reviewerId: e.reviewer_id, submissionId: e.submission_id })),
          setting.reviews_per_student,
          setting.seed,
        );
        // The service-level form of the trigger peer_review_allocation_not_self
        // (which stays as a backstop): the whole allocation fails, as the
        // trigger would fail the insert.
        if (fresh.some((a) => a.reviewerId === a.authorId)) {
          throw new Error('A student cannot review their own submission');
        }
        if (fresh.length > 0) {
          await tx.peer_review_allocation.createMany({
            data: fresh.map((a) => ({
              activity_id: activity.id,
              submission_id: a.submissionId,
              reviewer_id: a.reviewerId,
            })),
            skipDuplicates: true,
          });
        }
        if (!setting.started_at) {
          await tx.peer_review_setting.update({
            where: { activity_id: activity.id },
            data: { started_at: now, updated_at: now },
          });
        }
        return fresh;
      });
    } finally {
      await releaseJobLease(this.prisma, key, ownerToken);
    }
    const reviewers = [...new Set(added.map((a) => a.reviewerId))];
    if (reviewers.length > 0) {
      void this.notifications?.peerReviewAssigned(activity.course_id, activity, reviewers);
    }
    return reviewers;
  }

  /** A late hand-in while the window is open gets (and gives) reviews. */
  async onHandedIn(activityId: string, now = new Date()) {
    const setting = await this.setting(activityId);
    if (!setting?.enabled || !setting.started_at) return;
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: { ...ACTIVITY_COLUMNS, course: { select: { school_id: true } } },
    });
    if (!activity) return;
    if (!(await this.features.isEnabled(activity.course.school_id, 'peer_review'))) return;
    if (windowState(windowOf(setting, activity), now) !== 'open') return;
    await this.allocateNow(activity, setting, now);
  }

  /**
   * The sweep: open windows whose due date has passed, and tell authors
   * their reviews are ready once a window closes. Returns counts.
   */
  async sweep(now = new Date()) {
    let opened = 0;
    let notified = 0;
    const due = await this.prisma.peer_review_setting.findMany({
      where: {
        enabled: true,
        started_at: null,
        open_mode: 'after_due',
        closes_at: { gt: now },
        activity: { due_at: { lte: now }, status: { in: ['published', 'closed'] } },
      },
      select: {
        ...SETTING_SELECT,
        activity: { select: { ...ACTIVITY_COLUMNS, course: { select: { school_id: true } } } },
      },
      take: 200,
    });
    for (const row of due) {
      if (!(await this.features.isEnabled(row.activity.course.school_id, 'peer_review'))) continue;
      try {
        await this.allocateNow(row.activity, row, now);
        opened++;
      } catch (err) {
        this.logger.error(`Opening peer review for ${row.activity_id} failed: ${(err as Error).message}`);
      }
    }

    const closed = await this.prisma.peer_review_setting.findMany({
      where: {
        enabled: true,
        started_at: { not: null },
        ready_notified_at: null,
        closes_at: { lte: now },
      },
      select: {
        activity_id: true,
        activity: { select: { id: true, title: true, course_id: true, course: { select: { school_id: true } } } },
      },
      take: 200,
    });
    for (const row of closed) {
      await this.prisma.peer_review_setting.update({
        where: { activity_id: row.activity_id },
        data: { ready_notified_at: now },
      });
      if (!(await this.features.isEnabled(row.activity.course.school_id, 'peer_review'))) continue;
      const done = await this.prisma.peer_review_allocation.findMany({
        where: { activity_id: row.activity_id, submitted_at: { not: null }, hidden: false },
        select: { submission: { select: { student_id: true } } },
      });
      const authors = [...new Set(done.map((d) => d.submission.student_id))];
      if (authors.length > 0) {
        void this.notifications?.peerReviewsReady(row.activity.course_id, row.activity, authors);
        notified++;
      }
    }
    return { opened, notified };
  }

  // ── students ───────────────────────────────────────────────────────────

  /** The activity, for a student who can see it. */
  private async studentActivity(studentId: string, activityId: string) {
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: ACTIVITY_COLUMNS,
    });
    if (!activity?.course_id || activity.status === 'draft') {
      throw new NotFoundException('Activity not found');
    }
    await this.access.requireStudent(studentId, activity.course_id);
    return activity as ActivityRow;
  }

  /** Reviews to do in windows that are open, across the student's courses. */
  async listForStudent(studentId: string, now = new Date()) {
    const rows = await this.prisma.peer_review_allocation.findMany({
      where: {
        reviewer_id: studentId,
        activity: {
          status: { in: ['published', 'closed'] },
          peer_review_setting: {
            enabled: true,
            started_at: { not: null },
            closes_at: { gt: now },
          },
          course: { status: 'published' },
        },
      },
      select: {
        id: true,
        submitted_at: true,
        activity: {
          select: {
            id: true,
            title: true,
            course_id: true,
            course: { select: { name: true } },
            peer_review_setting: { select: { closes_at: true } },
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });
    // Enrolment still active (not dropped) in each course.
    const courseIds = [...new Set(rows.map((r) => r.activity.course_id))];
    const enrolled = await this.prisma.course_student.findMany({
      where: { student_id: studentId, course_id: { in: courseIds }, status: { not: 'dropped' } },
      select: { course_id: true },
    });
    const ok = new Set(enrolled.map((e) => e.course_id));
    const counter = new Map<string, number>();
    return rows
      .filter((r) => ok.has(r.activity.course_id))
      .map((r) => {
        const n = (counter.get(r.activity.id) ?? 0) + 1;
        counter.set(r.activity.id, n);
        return {
          id: r.id,
          number: n,
          activityId: r.activity.id,
          activityTitle: r.activity.title,
          courseId: r.activity.course_id,
          courseName: r.activity.course.name,
          closesAt: ts(r.activity.peer_review_setting?.closes_at ?? null),
          submittedAt: ts(r.submitted_at),
        };
      });
  }

  /**
   * The student's side of one activity's peer review: what they have to
   * review, and (after the window closes) the reviews of their own work.
   */
  async activityForStudent(studentId: string, activityId: string, now = new Date()) {
    const activity = await this.studentActivity(studentId, activityId);
    let setting = await this.setting(activityId);
    if (!setting?.enabled) return { enabled: false as const };
    setting = await this.ensureOpen(activity, setting, now);
    const w = windowOf(setting, activity);
    const state = windowState(w, now);
    const rubric = await loadRubric(this.prisma, setting.rubric_id);

    const assignedRows = setting.started_at
      ? await this.prisma.peer_review_allocation.findMany({
          where: { activity_id: activityId, reviewer_id: studentId },
          select: { id: true, submitted_at: true, submission: { select: { student_id: true } } },
          orderBy: { created_at: 'asc' },
        })
      : [];
    const names = setting.anonymous
      ? new Map<string, string>()
      : await this.studentNames(assignedRows.map((r) => r.submission.student_id));

    let received: ReturnType<typeof toReceived>[] | null = null;
    if (state === 'closed') {
      const own = await this.prisma.submission.findUnique({
        where: { activity_id_student_id: { activity_id: activityId, student_id: studentId } },
        select: { id: true },
      });
      const rows = own
        ? await this.prisma.peer_review_allocation.findMany({
            where: {
              submission_id: own.id,
              submitted_at: { not: null },
              hidden: false,
            },
            select: { ...ALLOCATION_SELECT },
            orderBy: { submitted_at: 'asc' },
          })
        : [];
      const reviewerNames = setting.anonymous
        ? new Map<string, string>()
        : await this.studentNames(rows.map((r) => r.reviewer_id));
      received = rows.map((r, i) =>
        toReceived(r, i, setting.anonymous ? null : (reviewerNames.get(r.reviewer_id) ?? 'Student')),
      );
    }

    return {
      enabled: true as const,
      state,
      opensAt: ts(opensAt(w)),
      closesAt: ts(setting.closes_at) as string,
      anonymous: setting.anonymous,
      reviewsPerStudent: setting.reviews_per_student,
      rubric,
      assigned: assignedRows.map((r, i) => ({
        id: r.id,
        number: i + 1,
        author: setting.anonymous ? null : (names.get(r.submission.student_id) ?? 'Student'),
        submittedAt: ts(r.submitted_at),
      })),
      received,
    };
  }

  /** One allocation of this reviewer's, with its window (404 otherwise). */
  private async reviewerAllocation(studentId: string, allocationId: string) {
    const row = await this.prisma.peer_review_allocation.findUnique({
      where: { id: allocationId },
      select: ALLOCATION_SELECT,
    });
    // Someone else's review (or a made-up id) is not found, never forbidden.
    if (!row || row.reviewer_id !== studentId) throw new NotFoundException('Review not found');
    const activity = await this.studentActivity(studentId, row.activity_id);
    const setting = await this.setting(row.activity_id);
    if (!setting?.enabled || !setting.started_at) throw new NotFoundException('Review not found');
    return { row, activity, setting };
  }

  /** The classmate's work to review, and the reviewer's own draft. */
  async reviewForStudent(studentId: string, allocationId: string, now = new Date()) {
    const { row, activity, setting } = await this.reviewerAllocation(studentId, allocationId);
    const submission = await this.prisma.submission.findUnique({
      where: { id: row.submission_id },
      select: { id: true, student_id: true, text_body: true, file_id: true },
    });
    if (!submission) throw new NotFoundException('Review not found');
    const files = await this.submissionFiles(submission);
    const state = windowState(windowOf(setting, activity), now);
    const number =
      (await this.prisma.peer_review_allocation.count({
        where: {
          activity_id: row.activity_id,
          reviewer_id: studentId,
          created_at: { lt: row.created_at },
        },
      })) + 1;
    const author = setting.anonymous
      ? null
      : ((await this.studentNames([submission.student_id])).get(submission.student_id) ?? 'Student');
    return {
      id: row.id,
      number,
      activityId: activity.id,
      activityTitle: activity.title,
      instructions: activity.instructions,
      state,
      closesAt: ts(setting.closes_at) as string,
      canEdit: state === 'open',
      anonymous: setting.anonymous,
      author,
      submission: {
        textBody: submission.text_body,
        files: files.map((f, i) => ({
          id: f.id,
          name: setting.anonymous ? anonymousFileName(f.name, i) : f.name,
          contentType: f.contentType,
        })),
      },
      rubric: await loadRubric(this.prisma, setting.rubric_id),
      review: {
        comment: row.comment,
        marks: marksOf(row.rubric_marks),
        submittedAt: ts(row.submitted_at),
      },
    };
  }

  /** Save (and optionally hand in) a review while the window is open. */
  async saveReview(
    studentId: string,
    allocationId: string,
    input: {
      comment?: string | null;
      marks?: { criterionId: string; ratingId?: string | null; points?: number | null; comment?: string | null }[];
      submit?: boolean;
    },
    now = new Date(),
  ) {
    const { row, activity, setting } = await this.reviewerAllocation(studentId, allocationId);
    const state = windowState(windowOf(setting, activity), now);
    if (state !== 'open') {
      throw new ConflictException(
        state === 'closed' ? 'Peer review has closed' : 'Peer review has not opened yet',
      );
    }
    const comment = input.comment?.trim() || null;
    const submitting = !!input.submit || !!row.submitted_at;
    const rubric = await loadRubric(this.prisma, setting.rubric_id);
    let marks: ReviewMark[] = [];
    if (rubric) {
      const result = validateMarks(rubric, input.marks ?? [], submitting);
      if ('error' in result) throw new BadRequestException(result.error);
      marks = result.marks;
    } else if (input.marks?.length) {
      throw new BadRequestException('This review has no rubric; write a comment');
    }
    if (submitting && !rubric && !comment) {
      throw new BadRequestException('Write your review before handing it in');
    }
    const updated = await this.prisma.peer_review_allocation.update({
      where: { id: allocationId },
      data: {
        comment,
        rubric_marks: marks as unknown as Prisma.InputJsonValue,
        submitted_at: row.submitted_at ?? (input.submit ? now : null),
        updated_at: now,
      },
      select: ALLOCATION_SELECT,
    });
    return {
      id: updated.id,
      comment: updated.comment,
      marks: marksOf(updated.rubric_marks),
      submittedAt: ts(updated.submitted_at),
    };
  }

  /**
   * One file of the classmate's submission, for its assigned reviewer only.
   * The controller serves it with the same sandboxing headers as staff
   * marking views; an anonymous review gets a neutral file name.
   */
  async readReviewFile(studentId: string, allocationId: string, fileId: string) {
    const { row, setting } = await this.reviewerAllocation(studentId, allocationId);
    const submission = await this.prisma.submission.findUnique({
      where: { id: row.submission_id },
      select: { id: true, file_id: true },
    });
    if (!submission) throw new NotFoundException('File not found');
    const files = await this.submissionFiles(submission);
    const index = files.findIndex((f) => f.id === fileId);
    if (index < 0) throw new NotFoundException('File not found');
    const content = await this.files.readContentForAuthorisedCaller(fileId);
    return {
      ...content,
      filename: setting.anonymous
        ? anonymousFileName(files[index].name, index)
        : content.filename,
    };
  }

  private async submissionFiles(submission: { id: string; file_id: string | null }) {
    const links = await this.prisma.submission_file.findMany({
      where: { submission_id: submission.id },
      select: { file: { select: { id: true, name: true, content_type: true } } },
      orderBy: { sort_order: 'asc' },
    });
    if (links.length > 0) {
      return links.map(({ file }) => ({
        id: file.id,
        name: file.name,
        contentType: file.content_type,
      }));
    }
    if (!submission.file_id) return [];
    const file = await this.prisma.file.findUnique({
      where: { id: submission.file_id },
      select: { id: true, name: true, content_type: true },
    });
    return file ? [{ id: file.id, name: file.name, contentType: file.content_type }] : [];
  }

  private async studentNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.student.findMany({
      where: { id: { in: unique } },
      select: { id: true, first_name: true, last_name: true },
    });
    return new Map(rows.map((r) => [r.id, nameOf(r)]));
  }
}

function toReceived(row: AllocationRow, index: number, reviewer: string | null) {
  return {
    id: row.id,
    number: index + 1,
    reviewer,
    comment: row.comment,
    marks: marksOf(row.rubric_marks),
    submittedAt: ts(row.submitted_at),
  };
}

function sumMarks(marks: ReviewMark[]): number | null {
  if (marks.length === 0) return null;
  return roundScore(marks.reduce((s, m) => s + m.points, 0));
}

function auditSetting(row: SettingRow) {
  return {
    enabled: row.enabled,
    reviewsPerStudent: row.reviews_per_student,
    anonymous: row.anonymous,
    openMode: row.open_mode,
    closesAt: row.closes_at,
    rubricId: row.rubric_id,
    qualityPoints: row.quality_points,
  };
}

