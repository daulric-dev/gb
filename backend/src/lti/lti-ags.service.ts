import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { FeatureService } from '@/features/feature.service';
import {
  CourseAccessService,
  MANAGE_ROLES,
  STAFF_ROLES,
  type CourseRole,
} from '@/course/access/course-access.service';
import { ActivityService } from '@/grading/activity.service';
import { SubmissionService } from '@/grading/submission.service';
import { SCOPE, lineItemUrl } from './lti.constants';
import { scaleScore } from './lti-values';
import type { AgsCaller } from './lti-token.service';

const ACTIVITY_PROGRESS = ['Initialized', 'Started', 'InProgress', 'Submitted', 'Completed'] as const;
const GRADING_PROGRESS = ['FullyGraded', 'Pending', 'PendingManual', 'Failed', 'NotReady'] as const;

export interface ScoreInput {
  userId: string;
  scoreGiven?: number;
  scoreMaximum?: number;
  comment?: string;
  timestamp: Date;
  activityProgress: (typeof ACTIVITY_PROGRESS)[number];
  gradingProgress: (typeof GRADING_PROGRESS)[number];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Validate an AGS score body (application/vnd.ims.lis.v1.score+json). */
export function parseScore(body: unknown): ScoreInput {
  if (!isObject(body)) throw new BadRequestException('The score must be a JSON object');
  const { userId, scoreGiven, scoreMaximum, comment, timestamp, activityProgress, gradingProgress } = body;
  if (typeof userId !== 'string' || !userId || userId.length > 255) throw new BadRequestException('userId is required');
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    throw new BadRequestException('timestamp must be an ISO 8601 date-time');
  }
  if (!ACTIVITY_PROGRESS.includes(activityProgress as never)) {
    throw new BadRequestException(`activityProgress must be one of ${ACTIVITY_PROGRESS.join(', ')}`);
  }
  if (!GRADING_PROGRESS.includes(gradingProgress as never)) {
    throw new BadRequestException(`gradingProgress must be one of ${GRADING_PROGRESS.join(', ')}`);
  }
  if (scoreGiven !== undefined && scoreGiven !== null) {
    if (typeof scoreGiven !== 'number' || !Number.isFinite(scoreGiven) || scoreGiven < 0) {
      throw new BadRequestException('scoreGiven must be a number of at least 0');
    }
    if (typeof scoreMaximum !== 'number' || !Number.isFinite(scoreMaximum) || scoreMaximum <= 0) {
      throw new BadRequestException('scoreMaximum must be a number above 0 when scoreGiven is sent');
    }
  }
  if (comment !== undefined && comment !== null && typeof comment !== 'string') {
    throw new BadRequestException('comment must be text');
  }
  return {
    userId,
    scoreGiven: typeof scoreGiven === 'number' ? scoreGiven : undefined,
    scoreMaximum: typeof scoreMaximum === 'number' ? scoreMaximum : undefined,
    comment: typeof comment === 'string' ? comment : undefined,
    timestamp: new Date(timestamp),
    activityProgress: activityProgress as ScoreInput['activityProgress'],
    gradingProgress: gradingProgress as ScoreInput['gradingProgress'],
  };
}

const LINE_ITEM_SELECT = {
  id: true,
  tool_id: true,
  course_id: true,
  activity_id: true,
  resource_link_id: true,
  tag: true,
  resource_id: true,
  activity: { select: { id: true, title: true, points: true, due_at: true, status: true } },
  resource_link: { select: { created_by: true } },
} as const;

/**
 * Assignment and Grade Services for tools. Every call is scoped to the
 * calling tool: it only sees line items it owns, in courses of schools it
 * is deployed to (and where `lti` is on). Scores are written through
 * SubmissionService.grade, the same path as a teacher's mark: the
 * submission is the mark, and the grade is audited and emitted as usual.
 */
@Injectable()
export class LtiAgsService {
  private readonly logger = new Logger(LtiAgsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureService,
    private readonly access: CourseAccessService,
    private readonly activities: ActivityService,
    private readonly submissions: SubmissionService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  requireScope(caller: AgsCaller, ...anyOf: string[]) {
    if (!anyOf.some((s) => caller.scopes.includes(s))) {
      throw new ForbiddenException('The access token does not carry the scope this needs');
    }
  }

  /** The course, if the tool is deployed to its school and `lti` is on there. */
  async requireCourse(caller: AgsCaller, courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, school_id: true, is_template: true },
    });
    if (!course || course.is_template) throw new NotFoundException('Context not found');
    const deployed = await this.prisma.lti_deployment.count({
      where: { tool_id: caller.toolId, OR: [{ school_id: course.school_id }, { school_id: null }] },
    });
    if (deployed === 0) throw new NotFoundException('Context not found');
    if (!(await this.features.isEnabled(course.school_id, 'lti'))) throw new FeatureDisabledException('lti');
    return course;
  }

  private async loadLineItem(caller: AgsCaller, courseId: string, lineItemId: string) {
    const row = await this.prisma.lti_line_item.findFirst({
      where: { id: lineItemId, tool_id: caller.toolId, course_id: courseId },
      select: LINE_ITEM_SELECT,
    });
    if (!row) throw new NotFoundException('Line item not found');
    return row;
  }

  private shape(row: { id: string; course_id: string; resource_link_id: string | null; tag: string | null; resource_id: string | null; activity: { title: string; points: unknown; due_at: Date | null } }) {
    return {
      id: lineItemUrl(row.course_id, row.id),
      label: row.activity.title,
      scoreMaximum: Number(row.activity.points),
      ...(row.resource_link_id ? { resourceLinkId: row.resource_link_id } : {}),
      ...(row.tag ? { tag: row.tag } : {}),
      ...(row.resource_id ? { resourceId: row.resource_id } : {}),
      ...(row.activity.due_at ? { endDateTime: row.activity.due_at.toISOString() } : {}),
    };
  }

  async listLineItems(
    caller: AgsCaller,
    courseId: string,
    filter: { resourceLinkId?: string; tag?: string; resourceId?: string; limit?: number },
  ) {
    this.requireScope(caller, SCOPE.lineItem, SCOPE.lineItemReadonly);
    await this.requireCourse(caller, courseId);
    const rows = await this.prisma.lti_line_item.findMany({
      where: {
        tool_id: caller.toolId,
        course_id: courseId,
        ...(filter.resourceLinkId ? { resource_link_id: filter.resourceLinkId } : {}),
        ...(filter.tag ? { tag: filter.tag } : {}),
        ...(filter.resourceId ? { resource_id: filter.resourceId } : {}),
      },
      orderBy: { created_at: 'asc' },
      take: Math.min(Math.max(filter.limit ?? 100, 1), 100),
      select: LINE_ITEM_SELECT,
    });
    return rows.map((r) => this.shape(r));
  }

  async getLineItem(caller: AgsCaller, courseId: string, lineItemId: string) {
    this.requireScope(caller, SCOPE.lineItem, SCOPE.lineItemReadonly);
    await this.requireCourse(caller, courseId);
    return this.shape(await this.loadLineItem(caller, courseId, lineItemId));
  }

  /**
   * A staff member the write is attributed to (SubmissionService and
   * ActivityService act for a user): whoever added the tool to the course
   * when they still have the role, else the longest-serving teacher.
   */
  async delegate(courseId: string, preferred: string | null, allowed: readonly CourseRole[]) {
    const teachers = await this.prisma.course_staff.findMany({
      where: { course_id: courseId, role: 'teacher' },
      orderBy: { created_at: 'asc' },
      select: { user_profile_id: true },
    });
    const candidates = [...new Set([preferred, ...teachers.map((t) => t.user_profile_id)].filter(Boolean))] as string[];
    for (const id of candidates) {
      try {
        await this.access.require(id, courseId, allowed);
        return id;
      } catch {
        // not (or no longer) staff here
      }
    }
    throw new ConflictException('No teacher in this course can be credited with this change');
  }

  async createLineItem(caller: AgsCaller, courseId: string, body: unknown) {
    this.requireScope(caller, SCOPE.lineItem);
    const course = await this.requireCourse(caller, courseId);
    if (!isObject(body)) throw new BadRequestException('The line item must be a JSON object');
    const { scoreMaximum, label, resourceLinkId, tag, resourceId } = body;
    if (typeof scoreMaximum !== 'number' || !Number.isFinite(scoreMaximum) || scoreMaximum <= 0 || scoreMaximum > 100000) {
      throw new BadRequestException('scoreMaximum must be a number above 0');
    }
    if (typeof label !== 'string' || !label.trim() || label.length > 200) {
      throw new BadRequestException('label is required (at most 200 characters)');
    }
    for (const [name, v] of Object.entries({ tag, resourceId })) {
      if (v !== undefined && (typeof v !== 'string' || v.length > 256)) {
        throw new BadRequestException(`${name} must be text of at most 256 characters`);
      }
    }
    let preferred: string | null = null;
    if (resourceLinkId !== undefined) {
      if (typeof resourceLinkId !== 'string') throw new BadRequestException('resourceLinkId must be text');
      const link = await this.prisma.lti_resource_link.findFirst({
        where: { id: resourceLinkId, tool_id: caller.toolId, course_id: courseId },
        select: { created_by: true },
      });
      if (!link) throw new BadRequestException('Unknown resourceLinkId');
      preferred = link.created_by;
    }
    const actor = await this.delegate(courseId, preferred, MANAGE_ROLES);
    // Marks have at most two decimals; so do points.
    const points = Math.round(scoreMaximum * 100) / 100;
    const activity = await this.activities.create(actor, courseId, { kind: 'offline', title: label.trim(), points });
    const activityId = activity.id;
    await this.activities.publish(actor, activityId);
    const row = await this.prisma.lti_line_item.create({
      data: {
        tool_id: caller.toolId,
        course_id: courseId,
        activity_id: activityId,
        resource_link_id: (resourceLinkId) ?? null,
        tag: (tag as string | undefined) ?? null,
        resource_id: (resourceId as string | undefined) ?? null,
      },
      select: LINE_ITEM_SELECT,
    });
    await this.prisma.$transaction(async (tx) => {
      await this.auditLog?.record(tx, course.school_id, { id: actor }, {
        entity: 'lti_line_item',
        entityId: row.id,
        action: 'create',
        changes: auditChanges(null, { tool_id: caller.toolId, activity_id: activityId, label: label.trim(), points }),
      });
    });
    return this.shape(row);
  }

  /**
   * Record a score. Only `FullyGraded` with a `scoreGiven` writes a mark:
   * scoreGiven / scoreMaximum scaled to the activity's points, rounded to
   * two decimals and kept within 0..points. Anything else (in progress,
   * pending manual marking, failed) is recorded but leaves the gradebook as
   * it is. A score older than (or as old as) the last one for that user and
   * line item is refused with 409, as AGS requires.
   */
  async postScore(caller: AgsCaller, courseId: string, lineItemId: string, body: unknown) {
    this.requireScope(caller, SCOPE.score);
    const course = await this.requireCourse(caller, courseId);
    const input = parseScore(body);
    const line = await this.loadLineItem(caller, courseId, lineItemId);

    const subject = await this.prisma.lti_subject.findFirst({
      where: { id: input.userId, tool_id: caller.toolId },
      select: { id: true, user_profile_id: true },
    });
    if (!subject) throw new BadRequestException('Unknown userId');
    const student = await this.prisma.student.findFirst({
      where: { user_profile_id: subject.user_profile_id },
      select: { id: true },
    });
    const enrolled = student
      ? await this.prisma.course_student.findFirst({
          where: { course_id: courseId, student_id: student.id },
          select: { student_id: true },
        })
      : null;
    if (!student || !enrolled) throw new BadRequestException('That user is not a student in this course');

    const previous = await this.prisma.lti_score.findUnique({
      where: { line_item_id_subject_id: { line_item_id: line.id, subject_id: subject.id } },
      select: { timestamp: true },
    });
    if (previous && input.timestamp.getTime() <= previous.timestamp.getTime()) {
      throw new ConflictException('A newer score was already received for this user');
    }

    const write = input.gradingProgress === 'FullyGraded' && input.scoreGiven !== undefined;
    let score: number | null = null;
    let actor: string | null = null;
    if (write) {
      const points = Number(line.activity.points);
      score = scaleScore(input.scoreGiven!, input.scoreMaximum!, points);
      actor = await this.delegate(courseId, line.resource_link?.created_by ?? null, STAFF_ROLES);
      // The grading service's public marking API: same checks, audit and
      // events as a teacher's mark (it may also apply the activity's own
      // rules, such as late handling, as it does for any mark).
      await this.submissions.grade(actor, line.activity_id, student.id, {
        score,
        ...(input.comment !== undefined ? { feedback: input.comment.slice(0, 2000) } : {}),
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.lti_score.upsert({
        where: { line_item_id_subject_id: { line_item_id: line.id, subject_id: subject.id } },
        create: {
          line_item_id: line.id,
          subject_id: subject.id,
          timestamp: input.timestamp,
          activity_progress: input.activityProgress,
          grading_progress: input.gradingProgress,
          score_given: input.scoreGiven ?? null,
          score_maximum: input.scoreMaximum ?? null,
          written: write,
        },
        update: {
          timestamp: input.timestamp,
          activity_progress: input.activityProgress,
          grading_progress: input.gradingProgress,
          score_given: input.scoreGiven ?? null,
          score_maximum: input.scoreMaximum ?? null,
          written: write,
          updated_at: new Date(),
        },
      });
      if (write && actor) {
        await this.auditLog?.record(tx, course.school_id, { id: actor }, {
          entity: 'lti_score',
          entityId: line.id,
          action: 'update',
          changes: auditChanges(null, {
            via: 'lti',
            tool_id: caller.toolId,
            activity_id: line.activity_id,
            student_id: student.id,
            score_given: input.scoreGiven,
            score_maximum: input.scoreMaximum,
            score,
          }),
        });
      }
    });
    return { written: write, score };
  }

  async results(caller: AgsCaller, courseId: string, lineItemId: string, filter: { userId?: string; limit?: number }) {
    this.requireScope(caller, SCOPE.resultReadonly);
    await this.requireCourse(caller, courseId);
    const line = await this.loadLineItem(caller, courseId, lineItemId);
    const subjects = await this.prisma.lti_subject.findMany({
      where: { tool_id: caller.toolId, ...(filter.userId ? { id: filter.userId } : {}) },
      select: { id: true, user_profile_id: true },
      take: filter.userId ? 1 : 5000,
    });
    if (subjects.length === 0) return [];
    const subjectByUser = new Map(subjects.map((s) => [s.user_profile_id, s.id]));
    const rows = await this.prisma.submission.findMany({
      where: {
        activity_id: line.activity_id,
        score: { not: null },
        student: { user_profile_id: { in: [...subjectByUser.keys()] } },
      },
      take: Math.min(Math.max(filter.limit ?? 1000, 1), 1000),
      select: { score: true, feedback: true, student: { select: { user_profile_id: true } } },
    });
    const url = lineItemUrl(courseId, line.id);
    const points = Number(line.activity.points);
    return rows.flatMap((r) => {
      const sub = r.student.user_profile_id ? subjectByUser.get(r.student.user_profile_id) : undefined;
      if (!sub) return [];
      return [
        {
          id: `${url}/results/${sub}`,
          scoreOf: url,
          userId: sub,
          resultScore: Number(r.score),
          resultMaximum: points,
          ...(r.feedback ? { comment: r.feedback } : {}),
        },
      ];
    });
  }
}
