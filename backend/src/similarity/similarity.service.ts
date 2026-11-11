import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  CourseAccessService,
  STAFF_ROLES,
} from '@/course/access/course-access.service';
import { FeatureService } from '@/features/feature.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { userSchoolId } from '@/common/user-school';
import {
  STORE_FLOOR,
  containment,
  fingerprint,
  highlight,
  sharedCount,
  type Segment,
} from './fingerprint';
import { isRestricted } from '@/student-restriction/restriction';

export type SimilarityPool = 'activity' | 'school';

export interface SimilaritySettings {
  pool: SimilarityPool;
  poolTerms: number;
  threshold: number;
}

export const DEFAULT_SETTINGS: SimilaritySettings = {
  pool: 'activity',
  poolTerms: 2,
  threshold: 40,
};

/** A text part of a submission: the assignment's text, or one essay answer. */
interface Part {
  part: string;
  text: string;
  exclude: (string | null)[];
}

/** Shown on every teacher-facing similarity response. */
export const SIMILARITY_NOTE =
  'Similarity is a prompt to look, not proof of copying. Shared quotations, common phrases and group work can all match. It never changes a grade and students never see it.';

function nameOf(s: { first_name: string | null; last_name: string | null } | null | undefined) {
  return [s?.first_name, s?.last_name].filter(Boolean).join(' ').trim() || 'Student';
}

/**
 * Similarity check on text submissions (feature `similarity_check`). Staff
 * only: nothing here is reachable from a student route. See README.md.
 */
@Injectable()
export class SimilarityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    private readonly features: FeatureService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  // ── settings ───────────────────────────────────────────────────────────

  async settingsFor(schoolId: string): Promise<SimilaritySettings> {
    const row = await this.prisma.similarity_setting.findUnique({
      where: { school_id: schoolId },
      select: { pool: true, pool_terms: true, threshold: true },
    });
    return row
      ? { pool: row.pool as SimilarityPool, poolTerms: row.pool_terms, threshold: row.threshold }
      : { ...DEFAULT_SETTINGS };
  }

  private async activeSchool(userId: string) {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) throw new BadRequestException('You are not assigned to a school');
    await this.features.assertEnabled(schoolId, 'similarity_check');
    return schoolId;
  }

  async getSchoolSettings(userId: string) {
    return this.settingsFor(await this.activeSchool(userId));
  }

  async updateSchoolSettings(userId: string, input: SimilaritySettings) {
    const schoolId = await this.activeSchool(userId);
    const before = await this.settingsFor(schoolId);
    await this.prisma.$transaction(async (tx) => {
      await tx.similarity_setting.upsert({
        where: { school_id: schoolId },
        create: {
          school_id: schoolId,
          pool: input.pool,
          pool_terms: input.poolTerms,
          threshold: input.threshold,
          updated_by: userId,
        },
        update: {
          pool: input.pool,
          pool_terms: input.poolTerms,
          threshold: input.threshold,
          updated_by: userId,
          updated_at: new Date(),
        },
      });
      await this.auditLog?.record(tx, schoolId, { id: userId }, {
        entity: 'similarity_setting',
        entityId: schoolId,
        action: 'update',
        changes: auditChanges({ ...before }, { ...input }),
      });
    });
    return this.settingsFor(schoolId);
  }

  // ── the job ────────────────────────────────────────────────────────────

  /**
   * Fingerprint every text part of a submission and record its matches.
   * Idempotent: an unchanged part (same text, same subtracted text) is left
   * as it is; a part now too short, or gone, loses its fingerprint and
   * matches. Does nothing while the feature is off for the school.
   */
  async process(submissionId: string): Promise<{ parts: number; computed: number }> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        activity_id: true,
        student_id: true,
        text_body: true,
        submitted_at: true,
        status: true,
        activity: {
          select: {
            kind: true,
            instructions: true,
            course_id: true,
            course: { select: { school_id: true, term_id: true } },
          },
        },
      },
    });
    if (!submission) return { parts: 0, computed: 0 };
    const schoolId = submission.activity.course.school_id;
    if (!(await this.features.isEnabled(schoolId, 'similarity_check'))) {
      return { parts: 0, computed: 0 };
    }
    const handedIn = submission.status !== 'draft' && !!submission.submitted_at;
    // A student restricted from the check (no_similarity): nothing is
    // fingerprinted, and any earlier fingerprints go below with their matches.
    const restricted = await isRestricted(this.prisma, 'no_similarity', submission.student_id);
    const parts = handedIn && !restricted ? await this.partsOf(submission) : [];
    const settings = await this.settingsFor(schoolId);

    let computed = 0;
    const kept: string[] = [];
    for (const part of parts) {
      const fp = fingerprint(part.text, part.exclude);
      if (!fp) continue;
      kept.push(part.part);
      const changed = await this.prisma.$transaction(
        async (tx) => {
          // One school at a time, so two hand-ins cannot miss each other.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`similarity:${schoolId}`}))`;
          const existing = await tx.similarity_fingerprint.findUnique({
            where: { submission_id_part: { submission_id: submission.id, part: part.part } },
            select: { id: true, text_hash: true },
          });
          if (existing?.text_hash === fp.textHash) return false;
          const row = await tx.similarity_fingerprint.upsert({
            where: { submission_id_part: { submission_id: submission.id, part: part.part } },
            create: {
              submission_id: submission.id,
              part: part.part,
              activity_id: submission.activity_id,
              course_id: submission.activity.course_id,
              school_id: schoolId,
              word_count: fp.wordCount,
              hashes: fp.hashes,
              text_hash: fp.textHash,
            },
            update: {
              word_count: fp.wordCount,
              hashes: fp.hashes,
              text_hash: fp.textHash,
              computed_at: new Date(),
            },
            select: { id: true },
          });
          await tx.similarity_match.deleteMany({
            where: { OR: [{ fingerprint_id: row.id }, { other_id: row.id }] },
          });
          const courseIds = await this.poolCourses(tx, schoolId, submission.activity.course_id, settings);
          const candidates = await this.candidates(tx, {
            id: row.id,
            schoolId,
            activityId: submission.activity_id,
            part: part.part,
            studentId: submission.student_id,
            hashes: fp.hashes,
            courseIds,
          });
          const data: Prisma.similarity_matchCreateManyInput[] = [];
          for (const c of candidates) {
            const shared = sharedCount(fp.hashes, c.hashes);
            if (shared === 0) continue;
            const mine = containment(fp.hashes, c.hashes);
            const theirs = containment(c.hashes, fp.hashes);
            if (mine >= STORE_FLOOR) {
              data.push({ fingerprint_id: row.id, other_id: c.id, score: mine, shared });
            }
            if (theirs >= STORE_FLOOR) {
              data.push({ fingerprint_id: c.id, other_id: row.id, score: theirs, shared });
            }
          }
          if (data.length > 0) {
            await tx.similarity_match.createMany({ data, skipDuplicates: true });
          }
          return true;
        },
        { maxWait: 10_000, timeout: 60_000 },
      );
      if (changed) computed++;
    }

    // Parts no longer there (or now too short) lose their fingerprints.
    await this.prisma.similarity_fingerprint.deleteMany({
      where: { submission_id: submission.id, part: { notIn: kept } },
    });
    return { parts: kept.length, computed };
  }

  private async partsOf(submission: {
    id: string;
    text_body: string | null;
    activity: { kind: string; instructions: string | null };
  }): Promise<Part[]> {
    if (submission.activity.kind === 'assignment') {
      return submission.text_body
        ? [{ part: '', text: submission.text_body, exclude: [submission.activity.instructions] }]
        : [];
    }
    if (submission.activity.kind !== 'quiz') return [];
    const answers = await this.prisma.quiz_answer.findMany({
      where: {
        submission_id: submission.id,
        text_answer: { not: null },
        quiz_question: { kind: 'essay' },
      },
      select: { question_id: true, text_answer: true, quiz_question: { select: { prompt: true } } },
    });
    return answers.map((a) => ({
      part: a.question_id,
      text: a.text_answer ?? '',
      exclude: [submission.activity.instructions, a.quiz_question.prompt],
    }));
  }

  /**
   * The courses in the comparison pool besides the activity itself: with
   * the school pool, the school's courses in its most recent `poolTerms`
   * terms (by start date) and courses with no term. Null: same activity only.
   */
  private async poolCourses(
    tx: Prisma.TransactionClient,
    schoolId: string,
    courseId: string,
    settings: SimilaritySettings,
  ): Promise<string[] | null> {
    if (settings.pool !== 'school') return null;
    const terms = await tx.term.findMany({
      where: { academic_year: { school_id: schoolId } },
      select: { id: true },
      orderBy: { start_date: { sort: 'desc', nulls: 'last' } },
      take: settings.poolTerms,
    });
    const courses = await tx.course.findMany({
      where: {
        school_id: schoolId,
        OR: [{ term_id: { in: terms.map((t) => t.id) } }, { term_id: null }],
      },
      select: { id: true },
    });
    return [...new Set([courseId, ...courses.map((c) => c.id)])];
  }

  /**
   * Fingerprints sharing at least one hash (the GIN index on `hashes`), in
   * the same school only, never the same student's own work. The same
   * activity and part, or (school pool) any part in the pool's courses.
   */
  private async candidates(
    tx: Prisma.TransactionClient,
    q: {
      id: string;
      schoolId: string;
      activityId: string;
      part: string;
      studentId: string;
      hashes: number[];
      courseIds: string[] | null;
    },
  ): Promise<{ id: string; hashes: number[] }[]> {
    const scope = q.courseIds
      ? Prisma.sql`(f.activity_id = ${q.activityId}::uuid AND f.part = ${q.part}) OR f.course_id = ANY(${q.courseIds}::uuid[])`
      : Prisma.sql`f.activity_id = ${q.activityId}::uuid AND f.part = ${q.part}`;
    return tx.$queryRaw<{ id: string; hashes: number[] }[]>`
      SELECT f.id, f.hashes
      FROM grading.similarity_fingerprint f
      JOIN grading.submission s ON s.id = f.submission_id
      WHERE f.school_id = ${q.schoolId}::uuid
        AND f.id <> ${q.id}::uuid
        AND s.student_id <> ${q.studentId}::uuid
        AND f.hashes && ${q.hashes}::integer[]
        AND (${scope})
      LIMIT 2000`;
  }

  // ── teachers ───────────────────────────────────────────────────────────

  private async staffActivity(userId: string, activityId: string) {
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: { id: true, course_id: true, title: true, instructions: true },
    });
    if (!activity?.course_id) throw new NotFoundException('Activity not found');
    const { course } = await this.access.require(userId, activity.course_id, STAFF_ROLES);
    await this.features.assertEnabled(course.school_id, 'similarity_check');
    return { ...activity, school_id: course.school_id };
  }

  /**
   * The roster markers: per submission, how many other submissions it is
   * similar to at or above the school's threshold, and the highest score.
   * Submissions below the threshold are not listed.
   */
  async activityFlags(userId: string, activityId: string) {
    const activity = await this.staffActivity(userId, activityId);
    const settings = await this.settingsFor(activity.school_id);
    const rows = await this.prisma.similarity_match.findMany({
      where: {
        score: { gte: settings.threshold },
        fingerprint: { activity_id: activityId, school_id: activity.school_id },
        other: { school_id: activity.school_id },
      },
      select: {
        score: true,
        other_id: true,
        fingerprint: { select: { submission_id: true, submission: { select: { student_id: true } } } },
      },
    });
    const by = new Map<string, { submissionId: string; studentId: string; others: Set<string>; maxScore: number }>();
    for (const r of rows) {
      const key = r.fingerprint.submission_id;
      const entry = by.get(key) ?? {
        submissionId: key,
        studentId: r.fingerprint.submission.student_id,
        others: new Set<string>(),
        maxScore: 0,
      };
      entry.others.add(r.other_id);
      entry.maxScore = Math.max(entry.maxScore, Number(r.score));
      by.set(key, entry);
    }
    return {
      threshold: settings.threshold,
      pool: settings.pool,
      note: SIMILARITY_NOTE,
      flags: [...by.values()].map((e) => ({
        submissionId: e.submissionId,
        studentId: e.studentId,
        count: e.others.size,
        maxScore: Math.round(e.maxScore),
      })),
    };
  }

  /** One submission's matches at or above the threshold, best first. */
  async submissionMatches(userId: string, activityId: string, submissionId: string) {
    const activity = await this.staffActivity(userId, activityId);
    const settings = await this.settingsFor(activity.school_id);
    const rows = await this.prisma.similarity_match.findMany({
      where: {
        score: { gte: settings.threshold },
        fingerprint: { submission_id: submissionId, activity_id: activityId, school_id: activity.school_id },
        other: { school_id: activity.school_id },
      },
      select: {
        score: true,
        fingerprint_id: true,
        other_id: true,
        fingerprint: { select: { part: true } },
        other: {
          select: {
            course_id: true,
            activity_id: true,
            submission: {
              select: {
                id: true,
                student: { select: { first_name: true, last_name: true } },
                activity: { select: { title: true, course: { select: { name: true } } } },
              },
            },
          },
        },
      },
      orderBy: { score: 'desc' },
    });
    const visible = await this.visibleCourses(userId, rows.map((r) => r.other.course_id));
    const questions = await this.questionPrompts(rows.map((r) => r.fingerprint.part));
    return {
      threshold: settings.threshold,
      note: SIMILARITY_NOTE,
      matches: rows.map((r) => {
        const canView = visible.has(r.other.course_id);
        return {
          fingerprintId: r.fingerprint_id,
          otherId: r.other_id,
          part: r.fingerprint.part,
          partLabel: r.fingerprint.part ? (questions.get(r.fingerprint.part) ?? 'Essay answer') : 'Text answer',
          score: Math.round(Number(r.score)),
          sameActivity: r.other.activity_id === activityId,
          other: {
            submissionId: canView ? r.other.submission.id : null,
            studentName: canView ? nameOf(r.other.submission.student) : null,
            activityTitle: r.other.submission.activity.title,
            courseName: r.other.submission.activity.course.name,
            canView,
          },
        };
      }),
    };
  }

  /**
   * Side by side: both texts with the shared passages marked. The other
   * side's name and full text are shown only to staff of its course; anyone
   * else sees just the matching passages.
   */
  async compare(userId: string, activityId: string, fingerprintId: string, otherId: string) {
    const activity = await this.staffActivity(userId, activityId);
    const match = await this.prisma.similarity_match.findUnique({
      where: { fingerprint_id_other_id: { fingerprint_id: fingerprintId, other_id: otherId } },
      select: {
        score: true,
        fingerprint: { select: { activity_id: true, school_id: true, submission_id: true, part: true } },
        other: { select: { school_id: true, submission_id: true, part: true, course_id: true } },
      },
    });
    if (
      !match ||
      match.fingerprint.activity_id !== activityId ||
      match.fingerprint.school_id !== activity.school_id ||
      match.other.school_id !== activity.school_id
    ) {
      throw new NotFoundException('Match not found');
    }
    const [left, right] = await Promise.all([
      this.partText(match.fingerprint.submission_id, match.fingerprint.part),
      this.partText(match.other.submission_id, match.other.part),
    ]);
    if (!left || !right) throw new NotFoundException('Match not found');
    const canView = (await this.visibleCourses(userId, [match.other.course_id])).has(match.other.course_id);
    const marked = highlight(left.text, right.text, [...left.exclude, ...right.exclude]);
    return {
      score: Math.round(Number(match.score)),
      note: SIMILARITY_NOTE,
      left: { studentName: left.studentName, activityTitle: left.activityTitle, segments: marked.left },
      right: {
        studentName: canView ? right.studentName : null,
        activityTitle: right.activityTitle,
        courseName: right.courseName,
        canView,
        segments: canView ? marked.right : matchingOnly(marked.right),
      },
    };
  }

  private async partText(submissionId: string, part: string) {
    const s = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        text_body: true,
        student: { select: { first_name: true, last_name: true } },
        activity: { select: { title: true, instructions: true, course: { select: { name: true } } } },
      },
    });
    if (!s) return null;
    let text = s.text_body ?? '';
    const exclude: (string | null)[] = [s.activity.instructions];
    if (part) {
      const answer = await this.prisma.quiz_answer.findUnique({
        where: { submission_id_question_id: { submission_id: submissionId, question_id: part } },
        select: { text_answer: true, quiz_question: { select: { prompt: true } } },
      });
      if (!answer) return null;
      text = answer.text_answer ?? '';
      exclude.push(answer.quiz_question.prompt);
    }
    return {
      text,
      exclude,
      studentName: nameOf(s.student),
      activityTitle: s.activity.title,
      courseName: s.activity.course.name,
    };
  }

  /** The course ids (of those given) the caller is staff in. */
  private async visibleCourses(userId: string, courseIds: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const id of new Set(courseIds)) {
      try {
        await this.access.require(userId, id, STAFF_ROLES);
        out.add(id);
      } catch {
        // Not theirs: name and full text stay hidden.
      }
    }
    return out;
  }

  private async questionPrompts(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.quiz_question.findMany({
      where: { id: { in: unique } },
      select: { id: true, prompt: true },
    });
    return new Map(
      rows.map((r) => [r.id, r.prompt.length > 80 ? `${r.prompt.slice(0, 79)}…` : r.prompt]),
    );
  }
}

/** Only the shared passages, with an ellipsis for what is left out. */
export function matchingOnly(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    if (s.match) out.push(s);
    else if (out.length === 0 || out[out.length - 1].match) out.push({ text: ' … ', match: false });
  }
  return out;
}
