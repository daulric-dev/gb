import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { CourseAccessService, STAFF_ROLES } from '@/course/access/course-access.service';
import { csvCell } from '@/grading/gradebook.service';
import {
  type MasteryResult,
  type MasteryScale,
  calculateMastery,
  defaultBands,
  evidenceLevel,
  scaleFromRow,
  validateScale,
} from './mastery.calc';
import type { MasterySettingsDto } from './dto/mastery.dto';

/** Enrolments shown in the grid (dropped students are left out). */
const ROSTER = ['active', 'completed'] as const;
/** Courses a student sees. */
const VISIBLE_COURSES = ['published', 'archived'] as const;

export interface EvidenceRow {
  id: string;
  outcome_id: string;
  student_id: string;
  course_id: string;
  activity_id: string;
  source: string;
  ratio: number;
  rating_rank: number | null;
  rating_count: number | null;
  assessed_at: Date;
}

/** The scale as the apps receive it. */
export function toWireScale(scale: MasteryScale) {
  return {
    levels: scale.levels.map((label, i) => ({ value: i + 1, label })),
    masteryThreshold: scale.masteryThreshold,
    calculation: scale.calculation,
    decayWeight: scale.decayWeight,
    minEvidence: scale.minEvidence,
    scoreBands: scale.scoreBands,
    reportCardSection: scale.reportCardSection,
  };
}

/** Mastery per outcome from evidence rows (any students), keyed `${studentId}:${outcomeId}`. */
export function masteryByStudentOutcome(rows: EvidenceRow[], scale: MasteryScale): Map<string, MasteryResult> {
  const groups = new Map<string, { level: number; at: Date }[]>();
  for (const r of rows) {
    const key = `${r.student_id}:${r.outcome_id}`;
    const list = groups.get(key) ?? [];
    list.push({
      level: evidenceLevel({ ratio: r.ratio, ratingRank: r.rating_rank, ratingCount: r.rating_count }, scale),
      at: new Date(r.assessed_at),
    });
    groups.set(key, list);
  }
  const out = new Map<string, MasteryResult>();
  for (const [key, items] of groups) out.set(key, calculateMastery(items, scale));
  return out;
}

/** The audited fields of a school's scale, named as the columns. */
function settingFields(scale: MasteryScale) {
  return {
    levels: scale.levels,
    mastery_threshold: scale.masteryThreshold,
    calculation: scale.calculation,
    decay_weight: scale.decayWeight,
    min_evidence: scale.minEvidence,
    score_bands: scale.scoreBands,
    report_card_section: scale.reportCardSection,
  };
}

const EMPTY: MasteryResult = {
  score: null,
  level: null,
  label: null,
  status: 'no_evidence',
  mastered: false,
  evidenceCount: 0,
};

const EVIDENCE_SELECT = {
  id: true,
  outcome_id: true,
  student_id: true,
  course_id: true,
  activity_id: true,
  source: true,
  ratio: true,
  rating_rank: true,
  rating_count: true,
  assessed_at: true,
} as const;

const OUTCOME_COLUMN_SELECT = {
  id: true,
  code: true,
  title: true,
  description: true,
  set_id: true,
  course_id: true,
  parent_id: true,
  archived_at: true,
  position: true,
  outcome_set: { select: { title: true } },
} as const;

/**
 * The school's proficiency scale and the mastery views: the teacher's
 * course grid, one student's detail with the evidence timeline, the CSV
 * export, and the student's (and, through the parent portal, a parent's)
 * outcomes. Mastery sits alongside the points gradebook and never changes
 * it.
 */
@Injectable()
export class MasteryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  // ── scale ──────────────────────────────────────────────────────────────

  async scale(schoolId: string): Promise<MasteryScale> {
    const row = await this.prisma.mastery_setting.findUnique({ where: { school_id: schoolId } });
    return scaleFromRow(row);
  }

  async settings(schoolId: string) {
    return toWireScale(await this.scale(schoolId));
  }

  /**
   * Change the scale. Labels can be renamed and levels added or removed;
   * when the number of levels changes without new score bands, bands are
   * spread evenly, and a threshold above the new top level is a 400.
   * Evidence keeps its raw percent and rubric rank, so a new scale applies
   * to all past evidence at once.
   */
  async updateSettings(userId: string, schoolId: string, dto: MasterySettingsDto) {
    const current = await this.scale(schoolId);
    const levels = dto.levels?.map((l) => l.trim()) ?? current.levels;
    const countChanged = levels.length !== current.levels.length;
    const next: MasteryScale = {
      levels,
      masteryThreshold: dto.masteryThreshold ?? current.masteryThreshold,
      calculation: dto.calculation ?? current.calculation,
      decayWeight: dto.decayWeight ?? current.decayWeight,
      minEvidence: dto.minEvidence ?? current.minEvidence,
      scoreBands:
        dto.scoreBands?.map((b) => ({ minPercent: b.minPercent, level: b.level })) ??
        (countChanged ? defaultBands(levels.length) : current.scoreBands),
      reportCardSection: dto.reportCardSection ?? current.reportCardSection,
    };
    const error = validateScale(next);
    if (error) throw new BadRequestException(error);
    const data = {
      levels: next.levels,
      mastery_threshold: next.masteryThreshold,
      calculation: next.calculation,
      decay_weight: next.decayWeight,
      min_evidence: next.minEvidence,
      score_bands: next.scoreBands as unknown as object,
      report_card_section: next.reportCardSection,
      updated_by: userId,
      updated_at: new Date(),
    };
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.mastery_setting.findUnique({ where: { school_id: schoolId } });
      await tx.mastery_setting.upsert({
        where: { school_id: schoolId },
        create: { school_id: schoolId, ...data },
        update: data,
      });
      await this.auditLog?.record(tx, schoolId, { id: userId }, {
        entity: 'mastery_setting',
        // One row per school, keyed by the school.
        entityId: schoolId,
        action: before ? 'update' : 'create',
        changes: auditChanges(before ? settingFields(scaleFromRow(before)) : null, settingFields(next)),
      });
    });
    return toWireScale(next);
  }

  // ── course views ───────────────────────────────────────────────────────

  /**
   * The outcomes a course tracks: its own (archived ones only while they
   * have evidence here) and school outcomes it aligns to or has evidence
   * on. Ordered: course outcomes first, then by set, position and code.
   */
  async courseOutcomeColumns(courseId: string) {
    const [own, aligned, evidenced] = await Promise.all([
      this.prisma.outcome.findMany({ where: { course_id: courseId }, select: OUTCOME_COLUMN_SELECT }),
      this.prisma.outcome_alignment.findMany({
        where: { course_id: courseId },
        select: { outcome_id: true },
        distinct: ['outcome_id'],
      }),
      this.prisma.outcome_evidence.findMany({
        where: { course_id: courseId },
        select: { outcome_id: true },
        distinct: ['outcome_id'],
      }),
    ]);
    const withEvidence = new Set((evidenced ?? []).map((e) => e.outcome_id));
    const wanted = new Set([...(aligned ?? []).map((a) => a.outcome_id), ...withEvidence]);
    const ownIds = new Set(own.map((o) => o.id));
    const schoolIds = [...wanted].filter((id) => !ownIds.has(id));
    const school = schoolIds.length
      ? await this.prisma.outcome.findMany({ where: { id: { in: schoolIds } }, select: OUTCOME_COLUMN_SELECT })
      : [];
    const columns = [
      ...own.filter((o) => !o.archived_at || withEvidence.has(o.id)),
      ...(school ?? []),
    ];
    columns.sort(
      (a, b) =>
        Number(!!a.set_id) - Number(!!b.set_id) ||
        (a.outcome_set?.title ?? '').localeCompare(b.outcome_set?.title ?? '') ||
        a.position - b.position ||
        a.code.localeCompare(b.code),
    );
    return columns.map((o) => ({
      id: o.id,
      code: o.code,
      title: o.title,
      description: o.description,
      parentId: o.parent_id,
      setTitle: o.outcome_set?.title ?? null,
      scope: o.course_id ? ('course' as const) : ('school' as const),
      archived: !!o.archived_at,
    }));
  }

  /** Students × outcomes for a course's staff. */
  async grid(userId: string, courseId: string) {
    const { course } = await this.access.require(userId, courseId, STAFF_ROLES);
    const [scale, outcomes, roster] = await Promise.all([
      this.scale(course.school_id),
      this.courseOutcomeColumns(courseId),
      this.prisma.course_student.findMany({
        where: { course_id: courseId, status: { in: [...ROSTER] } },
        select: {
          student: { select: { id: true, first_name: true, last_name: true, student_number: true } },
        },
      }),
    ]);
    const students = roster
      .map((r) => r.student)
      .filter((s): s is NonNullable<typeof s> => !!s)
      .sort(
        (a, b) =>
          (a.last_name ?? '').localeCompare(b.last_name ?? '') ||
          (a.first_name ?? '').localeCompare(b.first_name ?? ''),
      );
    const evidence = students.length
      ? await this.prisma.outcome_evidence.findMany({
          where: { course_id: courseId, student_id: { in: students.map((s) => s.id) } },
          select: EVIDENCE_SELECT,
        })
      : [];
    const results = masteryByStudentOutcome(evidence, scale);
    return {
      course: { id: course.id, name: course.name, code: course.code ?? null },
      scale: toWireScale(scale),
      outcomes,
      students: students.map((s) => {
        const cells = outcomes.map((o) => ({ outcomeId: o.id, ...(results.get(`${s.id}:${o.id}`) ?? EMPTY) }));
        return {
          id: s.id,
          firstName: s.first_name,
          lastName: s.last_name,
          studentNumber: s.student_number,
          masteredCount: cells.filter((c) => c.mastered).length,
          cells,
        };
      }),
    };
  }

  /** CSV of the grid: one row per student, one column per outcome ("Proficient (3.2)"). */
  async exportCsv(userId: string, courseId: string) {
    const grid = await this.grid(userId, courseId);
    const header = [
      'Last name',
      'First name',
      'Student ID',
      ...grid.outcomes.map((o) => `${o.code} ${o.title}`),
      'Outcomes mastered',
    ];
    const lines = [header.map(csvCell).join(',')];
    for (const s of grid.students) {
      lines.push(
        [
          s.lastName ?? '',
          s.firstName ?? '',
          s.studentNumber ?? '',
          ...s.cells.map((c) =>
            c.label === null
              ? ''
              : `${c.label} (${c.score})${c.mastered ? ' mastered' : c.status === 'needs_more_evidence' ? ' needs more evidence' : ''}`,
          ),
          String(s.masteredCount),
        ]
          .map(csvCell)
          .join(','),
      );
    }
    const base = (grid.course.code || grid.course.name || 'course').replace(/[^\w.-]+/g, '-');
    return { csv: `${lines.join('\r\n')}\r\n`, filename: `${base}-mastery.csv` };
  }

  /** One student in one course: every tracked outcome with its evidence timeline. */
  async studentDetail(userId: string, courseId: string, studentId: string) {
    const { course } = await this.access.require(userId, courseId, STAFF_ROLES);
    const enrolled = await this.prisma.course_student.findUnique({
      where: { course_id_student_id: { course_id: courseId, student_id: studentId } },
      select: { student: { select: { id: true, first_name: true, last_name: true } } },
    });
    if (!enrolled?.student) throw new NotFoundException('Student not found');
    const scale = await this.scale(course.school_id);
    const outcomes = await this.courseOutcomeColumns(courseId);
    const courses = await this.outcomesFor(scale, [{ id: courseId, outcomes }], studentId);
    return {
      student: { id: enrolled.student.id, firstName: enrolled.student.first_name, lastName: enrolled.student.last_name },
      scale: toWireScale(scale),
      outcomes: courses[0]?.outcomes ?? [],
    };
  }

  /**
   * Per course, each outcome's mastery and evidence timeline (newest first)
   * for one student. Evidence shows the activity and what was assessed
   * (rubric row or question), the level and the percent; never feedback,
   * answers or anything about other students.
   */
  private async outcomesFor(
    scale: MasteryScale,
    courses: { id: string; outcomes: Awaited<ReturnType<MasteryService['courseOutcomeColumns']>> }[],
    studentId: string,
  ) {
    const courseIds = courses.map((c) => c.id);
    if (courseIds.length === 0) return [];
    const evidence = await this.prisma.outcome_evidence.findMany({
      where: { student_id: studentId, course_id: { in: courseIds } },
      select: {
        ...EVIDENCE_SELECT,
        activity: { select: { title: true, kind: true } },
        outcome_alignment: {
          select: {
            rubric_criterion: { select: { title: true } },
            quiz_question: { select: { prompt: true } },
          },
        },
      },
      orderBy: { assessed_at: 'desc' },
    });
    return courses.map((c) => {
      const mine = (evidence ?? []).filter((e) => e.course_id === c.id);
      const results = masteryByStudentOutcome(mine, scale);
      return {
        courseId: c.id,
        outcomes: c.outcomes.map((o) => ({
          ...o,
          mastery: results.get(`${studentId}:${o.id}`) ?? EMPTY,
          evidence: mine
            .filter((e) => e.outcome_id === o.id)
            .map((e) => {
              const level = evidenceLevel(
                { ratio: e.ratio, ratingRank: e.rating_rank, ratingCount: e.rating_count },
                scale,
              );
              return {
                id: e.id,
                activityId: e.activity_id,
                activityTitle: e.activity?.title ?? '',
                source: e.source as 'activity' | 'rubric' | 'question',
                detail:
                  e.source === 'rubric'
                    ? (e.outcome_alignment?.rubric_criterion?.title ?? null)
                    : e.source === 'question'
                      ? (e.outcome_alignment?.quiz_question?.prompt ?? '').slice(0, 160) || null
                      : null,
                level,
                label: scale.levels[level - 1] ?? null,
                percent: Math.round(e.ratio * 1000) / 10,
                assessedAt: new Date(e.assessed_at).toISOString(),
              };
            }),
        })),
      };
    });
  }

  // ── student / parent ───────────────────────────────────────────────────

  /**
   * A student's outcomes across the courses they see (enrolled, not
   * dropped; published or archived; not templates). Used by the student
   * portal and, behind its own checks, the parent portal.
   */
  async studentOutcomes(studentId: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { school_id: true },
    });
    if (!student?.school_id) throw new NotFoundException('Student not found');
    const enrolments = await this.prisma.course_student.findMany({
      where: {
        student_id: studentId,
        status: { not: 'dropped' },
        course: { status: { in: [...VISIBLE_COURSES] }, is_template: false, school_id: student.school_id },
      },
      select: { course: { select: { id: true, name: true, code: true } } },
    });
    const courses = enrolments
      .map((e) => e.course)
      .filter((c): c is NonNullable<typeof c> => !!c)
      .sort((a, b) => a.name.localeCompare(b.name));
    const scale = await this.scale(student.school_id);
    const columns = await Promise.all(
      courses.map(async (c) => ({ id: c.id, outcomes: await this.courseOutcomeColumns(c.id) })),
    );
    const withOutcomes = columns.filter((c) => c.outcomes.length > 0);
    const results = await this.outcomesFor(scale, withOutcomes, studentId);
    const nameOf = new Map(courses.map((c) => [c.id, c]));
    return {
      scale: toWireScale(scale),
      courses: results.map((r) => ({
        courseId: r.courseId,
        courseName: nameOf.get(r.courseId)?.name ?? '',
        courseCode: nameOf.get(r.courseId)?.code ?? null,
        outcomes: r.outcomes,
      })),
    };
  }
}
