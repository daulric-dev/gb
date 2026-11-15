import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CourseAccessService, STAFF_ROLES } from '@/course/access/course-access.service';
import { FeatureService } from '@/features/feature.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { StorageService, ObjectTooLargeError } from '@/storage/storage.service';
import { objectKey } from '@/storage/keys';
import {
  AI_STUDENT_RESTRICTED,
  AI_STUDENT_RESTRICTED_MESSAGE,
  isRestricted,
  restrictedStudents,
} from '@/student-restriction/restriction';
import { AI_DRAFT_NOTE, AI_FEATURE_MAX_TOKENS, aiMaxSubmissionChars } from '../ai.constants';
import { AiService } from '../ai.service';
import { providerHost, type ProviderRow } from '../ai-provider.service';
import { redact, type PersonNames } from '../redact';
import { coursePeople } from '../course-people';
import {
  AI_BATCH_MAX_SUBMISSIONS,
  AI_DRAFT_STUCK_MS,
  AI_DRAFT_SWEEP_MS,
  AI_FILE_MAX_BYTES,
  AI_FILE_MAX_FILES,
  AI_FILE_MAX_PAGES,
  DRAFT_CODES,
  type DraftMode,
  type DraftStatus,
  type FileReport,
} from './file-grading.constants';
import { classifyFile, extractText } from './extract';
import {
  assembleWork,
  cleanRubricAnswer,
  cleanScoreAnswer,
  normaliseForMatch,
  restorer,
  rubricLines,
  userMessage,
  type GradingDraft,
  type ModelRubricAnswer,
  type ModelScoreAnswer,
  type RubricForPrompt,
  type WorkPart,
} from './draft';
import { FILE_RUBRIC_SYSTEM, FILE_SCORE_SYSTEM, fileRubricSchema, fileScoreSchema } from './file-grading.prompts';

/** How long a rate-limited batch draft waits before it is tried again (ms). */
export const RATE_LIMIT_RETRY_MS = 10 * 60 * 1000;

/** Enqueues a draft job; set by AiFileGradingQueueService (inline or BullMQ). */
export type DraftEnqueuer = (draftId: string, delayMs?: number) => Promise<void>;

interface ActivityRow {
  id: string;
  course_id: string;
  title: string;
  instructions: string | null;
  points: number;
  kind: string;
  rubric_id: string | null;
}

interface SubmissionRow {
  id: string;
  student_id: string;
  status: string;
  text_body: string | null;
  file_id: string | null;
  submitted_at: Date | null;
  score: unknown;
  excused: boolean;
}

const SUBMISSION_SELECT = {
  id: true,
  student_id: true,
  status: true,
  text_body: true,
  file_id: true,
  submitted_at: true,
  score: true,
  excused: true,
} as const;

const DRAFT_SELECT = {
  id: true,
  activity_id: true,
  student_id: true,
  submission_id: true,
  school_id: true,
  batch_id: true,
  status: true,
  mode: true,
  files: true,
  suggestions: true,
  chars_sent: true,
  truncated: true,
  provider_name: true,
  model: true,
  request_id: true,
  error_code: true,
  error: true,
  work_submitted_at: true,
  created_by: true,
  created_at: true,
  updated_at: true,
  finished_at: true,
  submission: { select: { submitted_at: true } },
} as const;

type DraftRow = Prisma.ai_grading_draftGetPayload<{ select: typeof DRAFT_SELECT }>;

const handedIn = (s: SubmissionRow | null): s is SubmissionRow => !!s && s.status !== 'draft' && !!s.submitted_at;
const ungraded = (s: SubmissionRow) => s.status !== 'graded' && (s.score === null || s.score === undefined) && !s.excused;

function forbidden(code: string, message: string): ForbiddenException {
  return new ForbiddenException({ statusCode: 403, code, message });
}

export const STUDENT_WORK_MESSAGE =
  "Your school does not allow sending students' work to the AI provider. A school admin can change this in Settings.";
export const STUDENT_FILES_MESSAGE =
  'Your school does not allow sending uploaded files to the AI provider. A school admin can change this in Settings.';

/**
 * AI grading drafts for work handed in on an assignment: the text of the
 * student's uploaded files (PDF with a text layer, Word .docx, plain text,
 * Markdown, code) and any typed text, read on the server, redacted, and
 * sent to the school's AI provider for a draft mark: a level, points,
 * comment and evidence per rubric criterion, or (no rubric) a score with a
 * requirement checklist; and overall feedback.
 *
 * Draft only: nothing is applied or shown to the student. The teacher opens
 * the draft, fills the grading form from it and saves through the normal
 * grading routes, which delete the draft. Drafts are stored
 * (`grading.ai_grading_draft`) so the teacher can come back to them; the
 * extracted text and prompts are never stored here.
 *
 * Gates, in order, before anything is read: `ai_assistance` for the
 * course's school, a staff role in the course (who may mark), an
 * assignment, the school's `allow_student_work` and `allow_student_files`,
 * the student's `no_ai` restriction, a provider. Every request is one
 * `ai_request` row (feature `ai_file_grading`).
 */
@Injectable()
export class AiFileGradingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiFileGradingService.name);
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  /** Set by the queue service at boot. */
  enqueue: DraftEnqueuer = () => Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    private readonly features: FeatureService,
    private readonly ai: AiService,
    private readonly storage: StorageService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.sweepTimer = setInterval(
      () => void this.sweepStuck().catch((e) => this.logger.warn(`AI draft sweep failed: ${e}`)),
      AI_DRAFT_SWEEP_MS,
    );
    this.sweepTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  // ── gates ─────────────────────────────────────────────────────────────

  private async activity(userId: string, activityId: string) {
    const row = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: { id: true, course_id: true, title: true, instructions: true, points: true, kind: true, rubric_id: true },
    });
    if (!row) throw new NotFoundException('Activity not found');
    const { course } = await this.access.require(userId, row.course_id, STAFF_ROLES);
    await this.features.assertEnabled(course.school_id, 'ai_assistance');
    const activity: ActivityRow = { ...row, points: Number(row.points) };
    return { activity, schoolId: course.school_id };
  }

  /** The reason AI drafts cannot run here, or null. Reads no student data. */
  private async problem(activity: ActivityRow, schoolId: string): Promise<string | null> {
    if (activity.kind !== 'assignment') return 'AI_NOT_ASSIGNMENT';
    const work = await this.ai.studentWorkSettings(schoolId);
    if (!work.allowStudentWork) return 'AI_STUDENT_WORK_NOT_ALLOWED';
    if (!work.allowStudentFiles) return DRAFT_CODES.settingOff;
    if (!(await this.ai.providerFor(schoolId))) return 'AI_NO_PROVIDER';
    return null;
  }

  private async requireReady(activity: ActivityRow, schoolId: string): Promise<ProviderRow> {
    if (activity.kind !== 'assignment') {
      throw new BadRequestException({
        statusCode: 400,
        code: 'AI_NOT_ASSIGNMENT',
        message: 'AI grading drafts are for assignments (handed-in files and text).',
      });
    }
    // The school decides whether students' work, and their files, may leave the platform.
    const work = await this.ai.studentWorkSettings(schoolId);
    if (!work.allowStudentWork) throw forbidden('AI_STUDENT_WORK_NOT_ALLOWED', STUDENT_WORK_MESSAGE);
    if (!work.allowStudentFiles) throw forbidden(DRAFT_CODES.settingOff, STUDENT_FILES_MESSAGE);
    return this.ai.requireProvider(schoolId);
  }

  // ── reading ───────────────────────────────────────────────────────────

  /** What the marking page needs: setup state, the drafts on this activity, the latest batch. */
  async overview(userId: string, activityId: string) {
    const { activity, schoolId } = await this.activity(userId, activityId);
    const [status, problem, drafts, batch] = await Promise.all([
      this.ai.statusFor(schoolId),
      this.problem(activity, schoolId),
      this.prisma.ai_grading_draft.findMany({ where: { activity_id: activityId }, select: DRAFT_SELECT }),
      this.prisma.ai_grading_batch.findFirst({
        where: { activity_id: activityId },
        orderBy: { created_at: 'desc' },
        select: BATCH_SELECT,
      }),
    ]);
    return {
      setup: {
        provider: status.provider,
        notice: status.notice,
        allowStudentWork: status.allowStudentWork,
        allowStudentFiles: status.allowStudentFiles,
        problem,
        mode: (activity.rubric_id ? 'rubric' : 'score'),
        points: activity.points,
        limits: limitsView(),
      },
      drafts: drafts.map(summaryView),
      batch: batch ? await this.batchView(batch) : null,
      note: AI_DRAFT_NOTE,
    };
  }

  async get(userId: string, activityId: string, studentId: string) {
    await this.activity(userId, activityId);
    const row = await this.prisma.ai_grading_draft.findUnique({
      where: { activity_id_student_id: { activity_id: activityId, student_id: studentId } },
      select: DRAFT_SELECT,
    });
    if (!row) throw new NotFoundException('There is no AI draft for this student');
    return draftView(row);
  }

  /** Discard a draft (the teacher's choice; nothing else changes). */
  async discard(userId: string, activityId: string, studentId: string) {
    await this.activity(userId, activityId);
    await this.prisma.ai_grading_draft.deleteMany({ where: { activity_id: activityId, student_id: studentId } });
  }

  // ── one submission ────────────────────────────────────────────────────

  /**
   * Draft one student's work now and answer with the draft. A draft that
   * finds nothing readable answers 200 with status `failed`, code
   * NOTHING_READABLE and the per-file reasons; provider errors are thrown
   * (and recorded on the draft).
   */
  async draftOne(userId: string, activityId: string, studentId: string) {
    const { activity, schoolId } = await this.activity(userId, activityId);
    const provider = await this.requireReady(activity, schoolId);
    // So may the student (or their parent): checked before the work is read.
    if (await isRestricted(this.prisma, 'no_ai', studentId)) {
      throw forbidden(AI_STUDENT_RESTRICTED, AI_STUDENT_RESTRICTED_MESSAGE);
    }
    const submission = await this.prisma.submission.findUnique({
      where: { activity_id_student_id: { activity_id: activityId, student_id: studentId } },
      select: SUBMISSION_SELECT,
    });
    if (!handedIn(submission)) {
      throw new BadRequestException({ statusCode: 400, code: DRAFT_CODES.notHandedIn, message: 'This student has not handed anything in.' });
    }
    const mode: DraftMode = activity.rubric_id ? 'rubric' : 'score';
    const now = new Date();
    const fresh = {
      submission_id: submission.id,
      school_id: schoolId,
      batch_id: null,
      status: 'running',
      mode,
      files: [],
      chars_sent: null,
      truncated: false,
      provider_name: provider.name,
      model: provider.model,
      request_id: null,
      error_code: null,
      error: null,
      work_submitted_at: submission.submitted_at,
      created_by: userId,
      updated_at: now,
      finished_at: null,
    };
    const draft = await this.prisma.ai_grading_draft.upsert({
      where: { activity_id_student_id: { activity_id: activityId, student_id: studentId } },
      create: { activity_id: activityId, student_id: studentId, ...fresh, created_at: now },
      update: { ...fresh, suggestions: Prisma.DbNull, created_at: now },
      select: { id: true },
    });
    await this.produce(draft.id, { userId, activity, schoolId, submission, provider, mode });
    const row = await this.prisma.ai_grading_draft.findUnique({ where: { id: draft.id }, select: DRAFT_SELECT });
    if (!row) throw new NotFoundException('The draft was removed');
    return draftView(row);
  }

  // ── many submissions ──────────────────────────────────────────────────

  /** The handed-in, ungraded work a batch would send, and why the rest is left out. */
  private async plan(activity: ActivityRow) {
    const submissions = (await this.prisma.submission.findMany({
      where: { activity_id: activity.id },
      select: { ...SUBMISSION_SELECT, student: { select: { first_name: true, last_name: true } } },
    })) as (SubmissionRow & { student: PersonNames | null })[];
    const candidates = submissions.filter((s) => handedIn(s) && ungraded(s));
    const ids = candidates.map((s) => s.id);
    const [restricted, existing, links, legacy] = await Promise.all([
      restrictedStudents(this.prisma, 'no_ai', candidates.map((s) => s.student_id)),
      this.prisma.ai_grading_draft.findMany({
        where: { activity_id: activity.id, student_id: { in: candidates.map((s) => s.student_id) } },
        select: { student_id: true, status: true, work_submitted_at: true },
      }),
      ids.length
        ? this.prisma.submission_file.findMany({
            where: { submission_id: { in: ids } },
            select: { submission_id: true, file: { select: { name: true, content_type: true, size_bytes: true, status: true, deleted_at: true } } },
          })
        : Promise.resolve([]),
      this.prisma.file.findMany({
        where: { id: { in: candidates.flatMap((s) => (s.file_id ? [s.file_id] : [])) } },
        select: { id: true, name: true, content_type: true, size_bytes: true, status: true, deleted_at: true },
      }),
    ]);
    const filesOf = new Map<string, { name: string; content_type: string; size_bytes: bigint | number; status: string; deleted_at: Date | null }[]>();
    for (const l of links) filesOf.set(l.submission_id, [...(filesOf.get(l.submission_id) ?? []), l.file]);
    const legacyById = new Map(legacy.map((f) => [f.id, f]));
    const current = new Map(existing.map((d) => [d.student_id, d]));
    const cap = aiMaxSubmissionChars();

    const include: { submission: SubmissionRow; files: number }[] = [];
    const skipped: { studentId: string; name: string; reason: string; code: string }[] = [];
    let files = 0;
    let maxChars = 0;
    for (const s of candidates) {
      const name = [s.student?.first_name, s.student?.last_name].filter(Boolean).join(' ') || 'Student';
      if (restricted.has(s.student_id)) {
        skipped.push({ studentId: s.student_id, name, code: AI_STUDENT_RESTRICTED, reason: "The student's record restricts AI processing" });
        continue;
      }
      const d = current.get(s.student_id);
      const sameWork = d && d.work_submitted_at?.getTime() === s.submitted_at?.getTime();
      if (d && sameWork && ['ready', 'queued', 'running'].includes(d.status)) {
        skipped.push({ studentId: s.student_id, name, code: 'ALREADY_DRAFTED', reason: 'Already has an AI draft of this work' });
        continue;
      }
      let own = filesOf.get(s.id) ?? [];
      if (own.length === 0 && s.file_id && legacyById.has(s.file_id)) own = [legacyById.get(s.file_id)!];
      const readable = own
        .slice(0, AI_FILE_MAX_FILES)
        .filter((f) => !f.deleted_at && f.status === 'ready' && Number(f.size_bytes) <= AI_FILE_MAX_BYTES && classifyFile(f.name, f.content_type).kind);
      const text = s.text_body?.trim() ?? '';
      if (readable.length === 0 && !text) {
        skipped.push({ studentId: s.student_id, name, code: DRAFT_CODES.nothingReadable, reason: 'Nothing readable was handed in (no text documents)' });
        continue;
      }
      include.push({ submission: s, files: readable.length });
      files += readable.length;
      // An upper bound: text files are about one character a byte; PDFs and .docx much less.
      maxChars += Math.min(cap, text.length + readable.reduce((sum, f) => sum + Number(f.size_bytes), 0));
    }
    return {
      include,
      skipped,
      files,
      maxChars,
      notHandedIn: submissions.length === 0 ? 0 : submissions.filter((s) => !handedIn(s)).length,
      graded: submissions.filter((s) => handedIn(s) && !ungraded(s)).length,
    };
  }

  /** The confirmation: how many submissions, files and characters (at most) would go to which provider. */
  async batchPreview(userId: string, activityId: string) {
    const { activity, schoolId } = await this.activity(userId, activityId);
    const provider = await this.requireReady(activity, schoolId);
    const plan = await this.plan(activity);
    const usage = await this.ai.hourlyUsage(userId);
    return {
      provider: { name: provider.name, model: provider.model, host: providerHost(provider.kind, provider.base_url) },
      mode: (activity.rubric_id ? 'rubric' : 'score'),
      submissions: plan.include.length,
      files: plan.files,
      maxChars: plan.maxChars,
      maxCharsPerSubmission: aiMaxSubmissionChars(),
      skipped: plan.skipped,
      alreadyGraded: plan.graded,
      tooMany: plan.include.length > AI_BATCH_MAX_SUBMISSIONS,
      maxSubmissions: AI_BATCH_MAX_SUBMISSIONS,
      hourlyLimit: usage.limit,
      usedThisHour: usage.used,
      note: AI_DRAFT_NOTE,
    };
  }

  /**
   * Queue one draft per handed-in, ungraded submission (the teacher saw
   * the preview; `expected` is the number it showed, so a change in the
   * meantime is a 409 and the dialog asks again). Restricted students and
   * work with nothing readable get a `skipped` row, so the table can say
   * why. One running batch per activity. Audited (`ai_grading_batch`).
   */
  async startBatch(userId: string, activityId: string, expected: number) {
    const { activity, schoolId } = await this.activity(userId, activityId);
    const provider = await this.requireReady(activity, schoolId);
    const running = await this.prisma.ai_grading_batch.findFirst({
      where: { activity_id: activityId, status: 'running' },
      select: { id: true },
    });
    if (running) throw new ConflictException({ statusCode: 409, code: 'AI_BATCH_RUNNING', message: 'AI drafts are already being written for this assignment.' });
    const plan = await this.plan(activity);
    if (plan.include.length !== expected) {
      throw new ConflictException({
        statusCode: 409,
        code: 'AI_BATCH_CHANGED',
        message: 'The work to draft changed since you checked. Look at the numbers again and confirm.',
      });
    }
    if (plan.include.length === 0) throw new BadRequestException('There is no ungraded, readable work to draft.');
    if (plan.include.length > AI_BATCH_MAX_SUBMISSIONS) {
      throw new BadRequestException(`At most ${AI_BATCH_MAX_SUBMISSIONS} submissions can be drafted at once.`);
    }
    const mode: DraftMode = activity.rubric_id ? 'rubric' : 'score';
    const now = new Date();
    const skippedRows = plan.skipped.filter((s) => s.code !== 'ALREADY_DRAFTED');
    const studentIds = [...plan.include.map((i) => i.submission.student_id), ...skippedRows.map((s) => s.studentId)];
    const submissionOf = new Map(
      (await this.prisma.submission.findMany({
        where: { activity_id: activityId, student_id: { in: studentIds } },
        select: { id: true, student_id: true, submitted_at: true },
      })).map((s) => [s.student_id, s]),
    );
    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ai_grading_batch.create({
        data: {
          activity_id: activityId,
          school_id: schoolId,
          status: 'running',
          provider_name: provider.name,
          model: provider.model,
          total: plan.include.length,
          files: plan.files,
          created_by: userId,
        },
        select: { id: true },
      });
      // Older drafts of these students' work are replaced.
      await tx.ai_grading_draft.deleteMany({ where: { activity_id: activityId, student_id: { in: studentIds } } });
      const base = { activity_id: activityId, school_id: schoolId, batch_id: created.id, mode, created_by: userId, created_at: now, updated_at: now };
      await tx.ai_grading_draft.createMany({
        data: [
          ...plan.include.map((i) => ({
            ...base,
            student_id: i.submission.student_id,
            submission_id: i.submission.id,
            status: 'queued',
            provider_name: provider.name,
            model: provider.model,
            work_submitted_at: i.submission.submitted_at,
          })),
          ...skippedRows.flatMap((s) => {
            const sub = submissionOf.get(s.studentId);
            return sub
              ? [{ ...base, student_id: s.studentId, submission_id: sub.id, status: 'skipped', error_code: s.code, error: s.reason, work_submitted_at: sub.submitted_at, finished_at: now }]
              : [];
          }),
        ],
      });
      await this.auditLog?.record(tx, schoolId, { id: userId }, {
        entity: 'ai_grading_batch',
        entityId: created.id,
        action: 'create',
        changes: auditChanges(null, {
          activity_id: activityId,
          course_id: activity.course_id,
          provider: provider.name,
          model: provider.model,
          submissions: plan.include.length,
          files: plan.files,
          max_chars: plan.maxChars,
          skipped: skippedRows.length,
        }),
      });
      return created;
    });
    const queued = await this.prisma.ai_grading_draft.findMany({
      where: { batch_id: batch.id, status: 'queued' },
      select: { id: true },
    });
    for (const d of queued) await this.enqueue(d.id);
    return this.batchStatus(userId, activityId, batch.id);
  }

  async batchStatus(userId: string, activityId: string, batchId: string) {
    await this.activity(userId, activityId);
    const batch = await this.prisma.ai_grading_batch.findFirst({ where: { id: batchId, activity_id: activityId }, select: BATCH_SELECT });
    if (!batch) throw new NotFoundException('Batch not found');
    return this.batchView(batch);
  }

  /** Stop a batch: drafts still queued are cancelled; one already running finishes. Audited. */
  async cancelBatch(userId: string, activityId: string, batchId: string) {
    const { schoolId } = await this.activity(userId, activityId);
    const batch = await this.prisma.ai_grading_batch.findFirst({
      where: { id: batchId, activity_id: activityId },
      select: { id: true, status: true },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    if (batch.status === 'running') {
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.ai_grading_draft.updateMany({
          where: { batch_id: batchId, status: 'queued' },
          data: { status: 'cancelled', error_code: DRAFT_CODES.cancelled, error: 'Cancelled before it ran', finished_at: now, updated_at: now },
        });
        await tx.ai_grading_batch.update({
          where: { id: batchId },
          data: { status: 'cancelled', cancelled_by: userId, cancelled_at: now, finished_at: now },
        });
        await this.auditLog?.record(tx, schoolId, { id: userId }, {
          entity: 'ai_grading_batch',
          entityId: batchId,
          action: 'update',
          changes: auditChanges({ status: 'running' }, { status: 'cancelled', cancelled_drafts: count }),
        });
      });
    }
    return this.batchStatus(userId, activityId, batchId);
  }

  private async batchView(batch: BatchRow) {
    const counts = await this.prisma.ai_grading_draft.groupBy({
      by: ['status'],
      where: { batch_id: batch.id },
      _count: { _all: true },
    });
    const by: Partial<Record<DraftStatus, number>> = {};
    for (const c of counts as { status: string; _count: { _all: number } }[]) by[c.status as DraftStatus] = c._count._all;
    return {
      id: batch.id,
      status: batch.status,
      provider: batch.provider_name,
      model: batch.model,
      total: batch.total,
      files: batch.files,
      counts: {
        queued: by.queued ?? 0,
        running: by.running ?? 0,
        ready: by.ready ?? 0,
        failed: by.failed ?? 0,
        skipped: by.skipped ?? 0,
        cancelled: by.cancelled ?? 0,
      },
      createdAt: batch.created_at,
      finishedAt: batch.finished_at,
      cancelledAt: batch.cancelled_at,
    };
  }

  // ── the job ───────────────────────────────────────────────────────────

  /**
   * Run one queued draft (a batch job). Claimed by moving it from queued to
   * running, so a cancelled or already-taken draft is a no-op. Every gate is
   * checked again: the setting, the restriction, the work still ungraded,
   * the teacher still on the course.
   */
  async process(draftId: string): Promise<void> {
    const now = new Date();
    const claimed = await this.prisma.ai_grading_draft.updateMany({
      where: { id: draftId, status: 'queued' },
      data: { status: 'running', updated_at: now },
    });
    if (claimed.count === 0) return;
    const draft = await this.prisma.ai_grading_draft.findUnique({
      where: { id: draftId },
      select: { id: true, activity_id: true, student_id: true, batch_id: true, created_by: true, batch: { select: { status: true } } },
    });
    if (!draft) return;
    try {
      if (draft.batch && draft.batch.status !== 'running') {
        await this.finish(draftId, 'cancelled', DRAFT_CODES.cancelled, 'Cancelled before it ran');
        return;
      }
      await this.runQueued(draft);
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === 429 && codeOf(err) === 'AI_RATE_LIMITED') {
        // The teacher's hourly limit: wait and try again rather than fail.
        await this.prisma.ai_grading_draft.updateMany({
          where: { id: draftId, status: 'running' },
          data: { status: 'queued', error_code: 'WAITING_FOR_LIMIT', error: messageOf(err), updated_at: new Date() },
        });
        await this.enqueue(draftId, RATE_LIMIT_RETRY_MS);
        return;
      }
      if (!(err instanceof HttpException)) this.logger.warn(`AI draft ${draftId} failed: ${(err as Error)?.message}`);
      await this.finish(draftId, 'failed', codeOf(err) ?? 'AI_ERROR', messageOf(err));
    } finally {
      if (draft.batch_id) await this.closeBatchIfDone(draft.batch_id);
    }
  }

  private async runQueued(draft: { id: string; activity_id: string; student_id: string; created_by: string | null }) {
    if (!draft.created_by) {
      await this.finish(draft.id, 'failed', 'AI_ERROR', 'The teacher who asked for this draft no longer has an account');
      return;
    }
    const userId = draft.created_by;
    const { activity, schoolId } = await this.activity(userId, draft.activity_id);
    const provider = await this.requireReady(activity, schoolId);
    if (await isRestricted(this.prisma, 'no_ai', draft.student_id)) {
      await this.finish(draft.id, 'skipped', AI_STUDENT_RESTRICTED, "The student's record restricts AI processing");
      return;
    }
    const submission = await this.prisma.submission.findUnique({
      where: { activity_id_student_id: { activity_id: draft.activity_id, student_id: draft.student_id } },
      select: SUBMISSION_SELECT,
    });
    if (!handedIn(submission)) {
      await this.finish(draft.id, 'skipped', DRAFT_CODES.notHandedIn, 'Nothing is handed in any more');
      return;
    }
    if (!ungraded(submission)) {
      await this.finish(draft.id, 'skipped', DRAFT_CODES.graded, 'Marked before the draft ran');
      return;
    }
    await this.prisma.ai_grading_draft.updateMany({
      where: { id: draft.id },
      data: { submission_id: submission.id, work_submitted_at: submission.submitted_at, provider_name: provider.name, model: provider.model },
    });
    await this.produce(draft.id, { userId, activity, schoolId, submission, provider, mode: activity.rubric_id ? 'rubric' : 'score' });
  }

  private async finish(draftId: string, status: DraftStatus, code: string | null, error: string | null) {
    const now = new Date();
    await this.prisma.ai_grading_draft.updateMany({
      where: { id: draftId },
      data: { status, error_code: code, error: error?.slice(0, 500) ?? null, finished_at: now, updated_at: now },
    });
  }

  private async closeBatchIfDone(batchId: string) {
    const open = await this.prisma.ai_grading_draft.count({ where: { batch_id: batchId, status: { in: ['queued', 'running'] } } });
    if (open > 0) return;
    await this.prisma.ai_grading_batch.updateMany({
      where: { id: batchId, status: 'running' },
      data: { status: 'done', finished_at: new Date() },
    });
  }

  /** Drafts left queued or running past AI_DRAFT_STUCK_MS (a restarted instance) are failed. */
  async sweepStuck(now = new Date()) {
    const before = new Date(now.getTime() - AI_DRAFT_STUCK_MS);
    const stuck = await this.prisma.ai_grading_draft.findMany({
      where: { status: { in: ['queued', 'running'] }, updated_at: { lt: before } },
      select: { id: true, batch_id: true },
      take: 500,
    });
    if (stuck.length === 0) return 0;
    await this.prisma.ai_grading_draft.updateMany({
      where: { id: { in: stuck.map((s) => s.id) }, status: { in: ['queued', 'running'] }, updated_at: { lt: before } },
      data: { status: 'failed', error_code: DRAFT_CODES.interrupted, error: 'Interrupted: ask for this draft again', finished_at: now, updated_at: now },
    });
    for (const b of new Set(stuck.flatMap((s) => (s.batch_id ? [s.batch_id] : [])))) await this.closeBatchIfDone(b);
    return stuck.length;
  }

  // ── reading the work and asking the provider ──────────────────────────

  /** The submission's files, in order (the attached list, else the single legacy file). */
  private async filesOf(submission: SubmissionRow) {
    const select = { id: true, name: true, content_type: true, size_bytes: true, status: true, deleted_at: true, bucket: true, storage_path: true } as const;
    const links = await this.prisma.submission_file.findMany({
      where: { submission_id: submission.id },
      orderBy: { sort_order: 'asc' },
      select: { file: { select } },
    });
    if (links.length > 0) return links.map((l) => l.file);
    if (!submission.file_id) return [];
    const legacy = await this.prisma.file.findUnique({ where: { id: submission.file_id }, select });
    return legacy ? [legacy] : [];
  }

  /** Read every file it may: status, type and size checked before the bytes are fetched. */
  private async readFiles(submission: SubmissionRow) {
    const files = await this.filesOf(submission);
    const out: { report: FileReport; text: string | null; partial: boolean }[] = [];
    for (const [i, f] of files.entries()) {
      const report: FileReport = { fileId: f.id, name: f.name, status: 'unreadable', reason: null, chars: 0, pages: null };
      const fail = (status: FileReport['status'], reason: string) => out.push({ report: { ...report, status, reason }, text: null, partial: false });
      if (i >= AI_FILE_MAX_FILES) {
        fail('skipped', `Only the first ${AI_FILE_MAX_FILES} files are read`);
        continue;
      }
      if (f.deleted_at) {
        fail('skipped', 'The file was deleted');
        continue;
      }
      if (f.status === 'infected') {
        fail('skipped', 'The file was flagged by the malware scan and is never read');
        continue;
      }
      if (f.status !== 'ready') {
        fail('skipped', f.status === 'failed' ? 'The upload did not finish' : 'The file has not finished its checks yet');
        continue;
      }
      const kind = classifyFile(f.name, f.content_type);
      if (!kind.kind) {
        fail('unreadable', kind.reason);
        continue;
      }
      if (Number(f.size_bytes) > AI_FILE_MAX_BYTES) {
        fail('unreadable', `The file is larger than ${Math.round(AI_FILE_MAX_BYTES / (1024 * 1024))} MB`);
        continue;
      }
      let buf: Buffer | null;
      try {
        buf = await this.storage.getBuffer(objectKey(f.bucket, f.storage_path), AI_FILE_MAX_BYTES);
      } catch (err) {
        fail('unreadable', err instanceof ObjectTooLargeError ? `The file is larger than ${Math.round(AI_FILE_MAX_BYTES / (1024 * 1024))} MB` : 'The file could not be fetched');
        continue;
      }
      if (!buf) {
        fail('unreadable', 'The file could not be found in storage');
        continue;
      }
      const result = await extractText(buf, { name: f.name, contentType: f.content_type });
      if (!result.ok) {
        out.push({ report: { ...report, status: 'unreadable', reason: result.reason, pages: result.pages ?? null }, text: null, partial: false });
        continue;
      }
      out.push({ report: { ...report, status: 'read', reason: result.note, pages: result.pages }, text: result.text, partial: !!result.partial });
    }
    return out;
  }

  /**
   * Read, redact, fit, send, clean and store. Writes only the draft row
   * and (through AiService.run) the request log. Provider errors are
   * recorded on the draft and rethrown.
   */
  private async produce(
    draftId: string,
    ctx: { userId: string; activity: ActivityRow; schoolId: string; submission: SubmissionRow; provider: ProviderRow; mode: DraftMode },
  ) {
    const { activity, submission, provider, mode } = ctx;
    const [files, student, people, rubric] = await Promise.all([
      this.readFiles(submission),
      this.prisma.student.findUnique({ where: { id: submission.student_id }, select: { first_name: true, last_name: true } }),
      coursePeople(this.prisma, activity.course_id),
      mode === 'rubric' && activity.rubric_id ? this.loadRubric(activity.rubric_id) : Promise.resolve(null),
    ]);
    const others = people.filter((o) => !(o.first_name === student?.first_name && o.last_name === student?.last_name));
    const scrub = (s: string) => redact(s, { student, others });

    // The parts: typed text first, then each readable file.
    const parts: WorkPart[] = [];
    const partFile: (number | null)[] = [];
    const text = submission.text_body?.trim();
    if (text) {
      parts.push({ label: 'text typed in the hand-in box', text: scrub(text) });
      partFile.push(null);
    }
    files.forEach((f, i) => {
      if (f.text === null) return;
      parts.push({ label: `file ${i + 1} (${scrub(f.report.name)})`, text: scrub(f.text) });
      partFile.push(i);
    });
    const reports = files.map((f) => f.report);
    if (parts.length === 0) {
      await this.prisma.ai_grading_draft.updateMany({
        where: { id: draftId },
        data: {
          status: 'failed',
          files: reports as unknown as Prisma.InputJsonValue,
          error_code: DRAFT_CODES.nothingReadable,
          error: 'Nothing in this hand-in could be read as text, so nothing was sent.',
          finished_at: new Date(),
          updated_at: new Date(),
        },
      });
      return;
    }
    const work = assembleWork(parts, aiMaxSubmissionChars());
    partFile.forEach((fi, p) => {
      if (fi === null) return;
      const r = reports[fi];
      r.chars = work.sent[p];
      if (work.cut[p]) {
        r.status = 'truncated';
        r.reason = work.sent[p] === 0 ? 'Not sent: the length limit was reached by earlier parts' : 'Cut short to fit the length limit';
      } else if (files[fi].partial) {
        r.status = 'truncated';
      }
    });
    const notes = files
      .filter((f) => f.text === null)
      .map((f) => `A file (${scrub(f.report.name)}) could not be read and is not included: ${f.report.reason ?? 'unreadable'}.`)
      .concat(work.truncated ? ['The work was longer than the length limit and was cut; judge only what is given.'] : []);
    const haystack = normaliseForMatch(parts.map((p, i) => p.text.slice(0, work.sent[i])).join('\n'));
    const restore = restorer(student?.first_name);

    let draft: GradingDraft;
    let requestId: string;
    let model: string;
    try {
      if (mode === 'rubric' && rubric && rubric.criteria.length > 0) {
        const { lines, refs } = rubricLines(rubric, scrub);
        const user = userMessage({ title: scrub(activity.title), instructions: activity.instructions ? scrub(activity.instructions) : null, mode, points: activity.points, rubricText: lines, work, notes });
        const out = await this.ai.run<ModelRubricAnswer>(
          { userId: ctx.userId, schoolId: ctx.schoolId, courseId: activity.course_id, feature: 'ai_file_grading' },
          provider,
          { system: FILE_RUBRIC_SYSTEM, user, schema: fileRubricSchema([...refs.criterion.keys()], [...refs.level.keys()]), name: 'file_grading_rubric', maxTokens: AI_FEATURE_MAX_TOKENS.ai_file_grading },
        );
        draft = cleanRubricAnswer(out.value, rubric, refs, haystack, restore);
        requestId = out.requestId;
        model = out.model;
      } else {
        const user = userMessage({ title: scrub(activity.title), instructions: activity.instructions ? scrub(activity.instructions) : null, mode: 'score', points: activity.points, work, notes });
        const out = await this.ai.run<ModelScoreAnswer>(
          { userId: ctx.userId, schoolId: ctx.schoolId, courseId: activity.course_id, feature: 'ai_file_grading' },
          provider,
          { system: FILE_SCORE_SYSTEM, user, schema: fileScoreSchema(activity.points), name: 'file_grading_score', maxTokens: AI_FEATURE_MAX_TOKENS.ai_file_grading },
        );
        draft = cleanScoreAnswer(out.value, activity.points, haystack, restore);
        requestId = out.requestId;
        model = out.model;
      }
    } catch (err) {
      const now = new Date();
      const waiting = err instanceof HttpException && codeOf(err) === 'AI_RATE_LIMITED';
      await this.prisma.ai_grading_draft.updateMany({
        where: { id: draftId },
        data: {
          files: reports as unknown as Prisma.InputJsonValue,
          chars_sent: work.chars,
          truncated: work.truncated || files.some((f) => f.partial),
          // A batch job re-queues on the hourly limit (process()); everything else fails here.
          ...(waiting ? {} : { status: 'failed', finished_at: now }),
          error_code: codeOf(err) ?? 'AI_ERROR',
          error: messageOf(err).slice(0, 500),
          updated_at: now,
        },
      });
      throw err;
    }
    const now = new Date();
    await this.prisma.ai_grading_draft.updateMany({
      where: { id: draftId },
      data: {
        status: 'ready',
        mode: draft.mode,
        files: reports as unknown as Prisma.InputJsonValue,
        suggestions: draft as unknown as Prisma.InputJsonValue,
        chars_sent: work.chars,
        truncated: work.truncated || files.some((f) => f.partial),
        provider_name: provider.name,
        model,
        request_id: requestId,
        error_code: null,
        error: null,
        finished_at: now,
        updated_at: now,
      },
    });
  }

  private async loadRubric(rubricId: string): Promise<RubricForPrompt | null> {
    const r = await this.prisma.rubric.findUnique({
      where: { id: rubricId },
      select: {
        title: true,
        rubric_criterion: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            title: true,
            description: true,
            points: true,
            rubric_rating: { orderBy: { position: 'asc' }, select: { id: true, label: true, description: true, points: true } },
          },
        },
      },
    });
    if (!r) return null;
    return {
      title: r.title,
      criteria: r.rubric_criterion.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        points: Number(c.points),
        ratings: c.rubric_rating.map((x) => ({ id: x.id, label: x.label, description: x.description, points: Number(x.points) })),
      })),
    };
  }
}

const BATCH_SELECT = {
  id: true,
  status: true,
  provider_name: true,
  model: true,
  total: true,
  files: true,
  created_at: true,
  finished_at: true,
  cancelled_at: true,
} as const;
type BatchRow = Prisma.ai_grading_batchGetPayload<{ select: typeof BATCH_SELECT }>;

function codeOf(err: unknown): string | null {
  if (!(err instanceof HttpException)) return null;
  const body = err.getResponse();
  return typeof body === 'object' && body && 'code' in body ? String((body).code) : null;
}

function messageOf(err: unknown): string {
  if (err instanceof HttpException) {
    const body = err.getResponse();
    if (typeof body === 'string') return body;
    const m = (body as { message?: unknown }).message;
    return typeof m === 'string' ? m : 'The AI request failed';
  }
  return 'The AI request failed';
}

function limitsView() {
  return {
    maxChars: aiMaxSubmissionChars(),
    maxFileMb: Math.round(AI_FILE_MAX_BYTES / (1024 * 1024)),
    maxFiles: AI_FILE_MAX_FILES,
    maxPages: AI_FILE_MAX_PAGES,
    maxBatch: AI_BATCH_MAX_SUBMISSIONS,
  };
}

const isStale = (row: DraftRow) =>
  !!row.work_submitted_at && !!row.submission?.submitted_at && row.work_submitted_at.getTime() !== row.submission.submitted_at.getTime();

function suggestedScore(draft: GradingDraft | null): number | null {
  if (!draft) return null;
  return draft.mode === 'score' ? draft.score : draft.suggestedTotal;
}

/** One row of the marks table's draft badges. */
export function summaryView(row: DraftRow) {
  const draft = row.status === 'ready' ? (row.suggestions as unknown as GradingDraft | null) : null;
  return {
    studentId: row.student_id,
    status: row.status as DraftStatus,
    mode: row.mode as DraftMode,
    errorCode: row.error_code,
    error: row.error,
    suggestedScore: suggestedScore(draft),
    stale: isStale(row),
    batchId: row.batch_id,
    updatedAt: row.updated_at,
  };
}

/** The whole draft for the teacher's review. */
export function draftView(row: DraftRow) {
  return {
    id: row.id,
    studentId: row.student_id,
    submissionId: row.submission_id,
    status: row.status as DraftStatus,
    mode: row.mode as DraftMode,
    files: (Array.isArray(row.files) ? row.files : []) as unknown as FileReport[],
    draft: row.status === 'ready' ? (row.suggestions as unknown as GradingDraft | null) : null,
    charsSent: row.chars_sent,
    truncated: row.truncated,
    provider: row.provider_name,
    model: row.model,
    requestId: row.request_id,
    errorCode: row.error_code,
    error: row.error,
    stale: isStale(row),
    batchId: row.batch_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    note: `${AI_DRAFT_NOTE} The suggested mark is never applied or shown to the student on its own.`,
  };
}
