import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { CourseAccessService, MANAGE_ROLES, STAFF_ROLES } from '@/course/access/course-access.service';
import { isUniqueViolation } from '@/common/db-values';
import { parseCsv } from '@/grading/gradebook-import';
import { parentsFirst, parseOutcomeCsv } from './mastery.calc';
import { activitiesForAlignment, refreshOutcomeEvidence } from './outcome-evidence';
import type {
  AlignmentDto,
  ImportOutcomesDto,
  OutcomeDto,
  OutcomeSetDto,
  UpdateOutcomeDto,
  UpdateOutcomeSetDto,
} from './dto/mastery.dto';

const OUTCOME_SELECT = {
  id: true,
  set_id: true,
  course_id: true,
  parent_id: true,
  code: true,
  title: true,
  description: true,
  subject: true,
  grade_level: true,
  position: true,
  archived_at: true,
} as const;

type OutcomeRow = {
  id: string;
  set_id: string | null;
  course_id: string | null;
  parent_id: string | null;
  code: string;
  title: string;
  description: string | null;
  subject: string | null;
  grade_level: string | null;
  position: number;
  archived_at: Date | null;
};

export function toOutcome(o: OutcomeRow) {
  return {
    id: o.id,
    setId: o.set_id,
    courseId: o.course_id,
    parentId: o.parent_id,
    code: o.code,
    title: o.title,
    description: o.description,
    subject: o.subject,
    gradeLevel: o.grade_level,
    position: o.position,
    archived: !!o.archived_at,
  };
}

/** The audited fields of an outcome. */
function outcomeFields(o: OutcomeRow) {
  return {
    set_id: o.set_id,
    course_id: o.course_id,
    parent_id: o.parent_id,
    code: o.code,
    title: o.title,
    description: o.description,
    subject: o.subject,
    grade_level: o.grade_level,
    position: o.position,
    archived: !!o.archived_at,
  };
}

type SetRow = { title: string; description: string | null; source: string | null; archived_at: Date | null };
function setFields(s: SetRow) {
  return { title: s.title, description: s.description, source: s.source, archived: !!s.archived_at };
}

type AlignmentRow = {
  outcome_id: string;
  course_id: string;
  activity_id: string | null;
  criterion_id: string | null;
  question_id: string | null;
};
function alignmentFields(a: AlignmentRow) {
  return {
    outcome_id: a.outcome_id,
    course_id: a.course_id,
    activity_id: a.activity_id,
    criterion_id: a.criterion_id,
    question_id: a.question_id,
  };
}

const ORDER = [{ position: 'asc' as const }, { code: 'asc' as const }];
const trimOrNull = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);

/**
 * Outcome sets (school frameworks), outcomes, course outcomes and their
 * alignments. School-level writes are checked by the controller's
 * `school:update` and scoped here to the caller's school; course-level ones
 * by the course role (`MANAGE_ROLES` to change, `STAFF_ROLES` to read).
 * Ids of another school or course are 404s.
 */
@Injectable()
export class OutcomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  /** Write an audit entry for a mastery change, in the caller's transaction. */
  private audit(
    tx: Prisma.TransactionClient,
    schoolId: string,
    userId: string,
    entry: { entity: string; entityId: string; action: 'create' | 'update' | 'delete'; before: object | null; after: object | null },
  ) {
    return this.auditLog?.record(tx, schoolId, { id: userId }, {
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      changes: auditChanges(
        entry.before as Record<string, unknown> | null,
        entry.after as Record<string, unknown> | null,
      ),
    });
  }

  // ── school outcome sets ────────────────────────────────────────────────

  async listSets(schoolId: string, includeArchived: boolean) {
    const sets = await this.prisma.outcome_set.findMany({
      where: { school_id: schoolId, ...(includeArchived ? {} : { archived_at: null }) },
      select: {
        id: true,
        title: true,
        description: true,
        source: true,
        archived_at: true,
        created_at: true,
        _count: { select: { outcome: true } },
      },
      orderBy: { title: 'asc' },
    });
    return sets.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      source: s.source,
      archived: !!s.archived_at,
      outcomeCount: s._count?.outcome ?? 0,
      createdAt: s.created_at.toISOString(),
    }));
  }

  private async requireSet(schoolId: string, setId: string) {
    const set = await this.prisma.outcome_set.findFirst({
      where: { id: setId, school_id: schoolId },
      select: { id: true, title: true, description: true, source: true, archived_at: true },
    });
    if (!set) throw new NotFoundException('Outcome set not found');
    return set;
  }

  async getSet(schoolId: string, setId: string) {
    const set = await this.requireSet(schoolId, setId);
    const outcomes = await this.prisma.outcome.findMany({
      where: { set_id: setId, school_id: schoolId },
      select: { ...OUTCOME_SELECT, _count: { select: { outcome_evidence: true } } },
      orderBy: ORDER,
    });
    return {
      id: set.id,
      title: set.title,
      description: set.description,
      source: set.source,
      archived: !!set.archived_at,
      outcomes: outcomes.map((o) => ({ ...toOutcome(o), evidenceCount: o._count?.outcome_evidence ?? 0 })),
    };
  }

  async createSet(userId: string, schoolId: string, dto: OutcomeSetDto, source?: string) {
    try {
      const set = await this.prisma.$transaction(async (tx) => {
        const data = {
          title: dto.title.trim(),
          description: trimOrNull(dto.description) ?? null,
          source: source ?? null,
        };
        const created = await tx.outcome_set.create({
          data: { school_id: schoolId, ...data, created_by: userId },
          select: { id: true },
        });
        await this.audit(tx, schoolId, userId, {
          entity: 'outcome_set',
          entityId: created.id,
          action: 'create',
          before: null,
          after: setFields({ ...data, archived_at: null }),
        });
        return created;
      });
      return this.getSet(schoolId, set.id);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('An outcome set with this title already exists');
      throw error;
    }
  }

  async updateSet(userId: string, schoolId: string, setId: string, dto: UpdateOutcomeSetDto) {
    const before = await this.requireSet(schoolId, setId);
    try {
      await this.prisma.$transaction(async (tx) => {
        const after = await tx.outcome_set.update({
          where: { id: setId },
          data: {
            ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
            ...(dto.description !== undefined ? { description: trimOrNull(dto.description) } : {}),
            ...(dto.archived !== undefined
              ? { archived_at: dto.archived ? (before.archived_at ?? new Date()) : null }
              : {}),
            updated_at: new Date(),
          },
          select: { title: true, description: true, source: true, archived_at: true },
        });
        await this.audit(tx, schoolId, userId, {
          entity: 'outcome_set',
          entityId: setId,
          action: 'update',
          before: setFields(before),
          after: setFields(after),
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('An outcome set with this title already exists');
      throw error;
    }
    return this.getSet(schoolId, setId);
  }

  /** Delete a set; refused (409) once any of its outcomes has evidence: archive it instead. */
  async removeSet(userId: string, schoolId: string, setId: string) {
    const set = await this.requireSet(schoolId, setId);
    const evidence = await this.prisma.outcome_evidence.count({ where: { outcome: { set_id: setId } } });
    if (evidence > 0) {
      throw new ConflictException('Students have evidence on outcomes in this set. Archive it instead.');
    }
    await this.prisma.$transaction(async (tx) => {
      const outcomeCount = await tx.outcome.count({ where: { set_id: setId } });
      await tx.outcome_set.delete({ where: { id: setId } });
      await this.audit(tx, schoolId, userId, {
        entity: 'outcome_set',
        entityId: setId,
        action: 'delete',
        // The set's outcomes go with it: one entry, with how many.
        before: { ...setFields(set), outcome_count: outcomeCount ?? 0 },
        after: null,
      });
    });
  }

  // ── school outcomes ────────────────────────────────────────────────────

  private async requireSchoolOutcome(schoolId: string, setId: string, outcomeId: string) {
    const o = await this.prisma.outcome.findFirst({
      where: { id: outcomeId, set_id: setId, school_id: schoolId },
      select: OUTCOME_SELECT,
    });
    if (!o) throw new NotFoundException('Outcome not found');
    return o;
  }

  /** A parent must be in the same set or course, and never the outcome itself or one of its descendants. */
  private async checkParent(
    owner: { set_id: string | null; course_id: string | null },
    parentId: string | null | undefined,
    selfId?: string,
  ) {
    if (!parentId) return;
    if (parentId === selfId) throw new BadRequestException('An outcome cannot be its own parent');
    const parent = await this.prisma.outcome.findFirst({
      where: owner.set_id ? { id: parentId, set_id: owner.set_id } : { id: parentId, course_id: owner.course_id },
      select: { id: true },
    });
    if (!parent) throw new BadRequestException('The parent must be an outcome in the same set or course');
    if (selfId) {
      // Walk up from the parent: meeting selfId would make a loop.
      let cursor: string | null = parentId;
      for (let i = 0; cursor && i < 50; i++) {
        if (cursor === selfId) throw new BadRequestException('That would put the outcome inside itself');
        const next: { parent_id: string | null } | null = await this.prisma.outcome.findUnique({
          where: { id: cursor },
          select: { parent_id: true },
        });
        cursor = next?.parent_id ?? null;
      }
    }
  }

  async createSchoolOutcome(userId: string, schoolId: string, setId: string, dto: OutcomeDto) {
    await this.requireSet(schoolId, setId);
    await this.checkParent({ set_id: setId, course_id: null }, dto.parentId);
    return this.insertOutcome(userId, { school_id: schoolId, set_id: setId }, dto);
  }

  async updateSchoolOutcome(userId: string, schoolId: string, setId: string, outcomeId: string, dto: UpdateOutcomeDto) {
    const o = await this.requireSchoolOutcome(schoolId, setId, outcomeId);
    return this.patchOutcome(userId, schoolId, o, dto);
  }

  async removeSchoolOutcome(userId: string, schoolId: string, setId: string, outcomeId: string) {
    const o = await this.requireSchoolOutcome(schoolId, setId, outcomeId);
    await this.deleteOutcome(userId, schoolId, o);
  }

  private async insertOutcome(
    userId: string,
    owner: { school_id: string; set_id?: string; course_id?: string },
    dto: OutcomeDto,
  ) {
    try {
      const o = await this.prisma.$transaction(async (tx) => {
        const created = await tx.outcome.create({
          data: {
            ...owner,
            code: dto.code.trim(),
            title: dto.title.trim(),
            description: trimOrNull(dto.description) ?? null,
            subject: trimOrNull(dto.subject) ?? null,
            grade_level: trimOrNull(dto.gradeLevel) ?? null,
            parent_id: dto.parentId ?? null,
            position: dto.position ?? 0,
            created_by: userId,
          },
          select: OUTCOME_SELECT,
        });
        await this.audit(tx, owner.school_id, userId, {
          entity: 'outcome',
          entityId: created.id,
          action: 'create',
          before: null,
          after: outcomeFields(created),
        });
        return created;
      });
      return toOutcome(o);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(`Code ${dto.code.trim()} is already used here`);
      throw error;
    }
  }

  private async patchOutcome(userId: string, schoolId: string, o: OutcomeRow, dto: UpdateOutcomeDto) {
    if (dto.parentId !== undefined) await this.checkParent(o, dto.parentId, o.id);
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.outcome.update({
          where: { id: o.id },
          data: {
            ...(dto.code !== undefined ? { code: dto.code.trim() } : {}),
            ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
            ...(dto.description !== undefined ? { description: trimOrNull(dto.description) } : {}),
            ...(dto.subject !== undefined ? { subject: trimOrNull(dto.subject) } : {}),
            ...(dto.gradeLevel !== undefined ? { grade_level: trimOrNull(dto.gradeLevel) } : {}),
            ...(dto.parentId !== undefined ? { parent_id: dto.parentId } : {}),
            ...(dto.position !== undefined ? { position: dto.position } : {}),
            ...(dto.archived !== undefined ? { archived_at: dto.archived ? (o.archived_at ?? new Date()) : null } : {}),
            updated_at: new Date(),
          },
          select: OUTCOME_SELECT,
        });
        await this.audit(tx, schoolId, userId, {
          entity: 'outcome',
          entityId: o.id,
          action: 'update',
          before: outcomeFields(o),
          after: outcomeFields(row),
        });
        return row;
      });
      return toOutcome(updated);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(`Code ${dto.code?.trim()} is already used here`);
      throw error;
    }
  }

  /** Hard delete only without evidence; with evidence it is archived instead (409). */
  private async deleteOutcome(userId: string, schoolId: string, o: OutcomeRow) {
    const outcomeId = o.id;
    const evidence = await this.prisma.outcome_evidence.count({ where: { outcome_id: outcomeId } });
    if (evidence > 0) {
      throw new ConflictException('Students have evidence on this outcome. Archive it instead.');
    }
    await this.prisma.$transaction(async (tx) => {
      // Children move up a level rather than disappearing.
      const self = await tx.outcome.findUnique({ where: { id: outcomeId }, select: { parent_id: true } });
      await tx.outcome.updateMany({
        where: { parent_id: outcomeId },
        data: { parent_id: self?.parent_id ?? null, updated_at: new Date() },
      });
      await tx.outcome.delete({ where: { id: outcomeId } });
      await this.audit(tx, schoolId, userId, {
        entity: 'outcome',
        entityId: outcomeId,
        action: 'delete',
        before: outcomeFields(o),
        after: null,
      });
    });
  }

  // ── CSV import ─────────────────────────────────────────────────────────

  /**
   * Import outcomes from CSV into a new set (`title`) or an existing one
   * (`setId`: rows whose code exists update that outcome, others are added).
   * All or nothing: any error refuses the whole file (400 with `errors`).
   * `dryRun` reports `{ created, updated, errors }` without writing.
   */
  async importCsv(userId: string, schoolId: string, dto: ImportOutcomesDto) {
    let cells: { line: number; cells: string[] }[];
    try {
      cells = parseCsv(dto.csv);
    } catch (error) {
      throw new BadRequestException((error as Error).message || 'The file is not valid CSV');
    }
    const { rows, errors } = parseOutcomeCsv(cells);
    if (!dto.setId && !dto.title?.trim()) {
      errors.push({ line: 0, message: 'Give the new set a title, or pick a set to import into' });
    }
    const existing = dto.setId
      ? (await this.requireSet(schoolId, dto.setId),
        await this.prisma.outcome.findMany({
          where: { set_id: dto.setId },
          select: { id: true, code: true },
        }))
      : [];
    const existingByCode = new Map(existing.map((o) => [o.code, o.id]));
    const updated = rows.filter((r) => existingByCode.has(r.code)).length;
    const summary = { created: rows.length - updated, updated, errors };
    if (errors.length > 0) {
      if (dto.dryRun) return summary;
      throw new BadRequestException({ message: 'Fix the errors in the file before importing', errors });
    }
    if (dto.dryRun) return summary;

    let setId = dto.setId;
    try {
      await this.prisma.$transaction(async (tx) => {
        if (!setId) {
          const set = await tx.outcome_set.create({
            data: { school_id: schoolId, title: dto.title!.trim(), source: 'CSV import', created_by: userId },
            select: { id: true },
          });
          setId = set.id;
        }
        const idOf = new Map(existingByCode);
        const newSet = !dto.setId;
        let position = existing.length;
        for (const r of parentsFirst(rows)) {
          const data = {
            title: r.title,
            description: r.description,
            subject: r.subject,
            grade_level: r.gradeLevel,
            parent_id: r.parentCode ? (idOf.get(r.parentCode) ?? null) : null,
            updated_at: new Date(),
          };
          const id = idOf.get(r.code);
          if (id) {
            await tx.outcome.update({ where: { id }, data });
          } else {
            const created = await tx.outcome.create({
              data: {
                ...data,
                school_id: schoolId,
                set_id: setId,
                code: r.code,
                position: position++,
                created_by: userId,
              },
              select: { id: true },
            });
            idOf.set(r.code, created.id);
          }
        }
        // One entry for the whole file, with counts: not one per row.
        await this.audit(tx, schoolId, userId, {
          entity: 'outcome_set',
          entityId: setId,
          action: newSet ? 'create' : 'update',
          before: newSet ? null : { import: null },
          after: {
            ...(newSet ? { title: dto.title!.trim(), source: 'CSV import' } : {}),
            import: { created: summary.created, updated: summary.updated, source: 'CSV import' },
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('An outcome set with this title already exists');
      throw error;
    }
    return { ...summary, set: await this.getSet(schoolId, setId!) };
  }

  // ── course outcomes ────────────────────────────────────────────────────

  /**
   * The course's own outcomes and the school's outcomes it can align to
   * (from sets that are not archived), plus its alignments and what can be
   * aligned (activities, their rubric rows and quiz questions).
   */
  async courseOutcomes(userId: string, courseId: string) {
    const { course, role } = await this.access.require(userId, courseId, STAFF_ROLES);
    const [own, school, alignments, activities] = await Promise.all([
      this.prisma.outcome.findMany({ where: { course_id: courseId }, select: OUTCOME_SELECT, orderBy: ORDER }),
      this.prisma.outcome.findMany({
        where: { school_id: course.school_id, set_id: { not: null }, outcome_set: { archived_at: null } },
        select: { ...OUTCOME_SELECT, outcome_set: { select: { title: true } } },
        orderBy: [{ set_id: 'asc' }, ...ORDER],
      }),
      this.alignments(courseId),
      this.prisma.activity.findMany({
        where: { course_id: courseId },
        select: {
          id: true,
          title: true,
          kind: true,
          status: true,
          rubric: {
            select: {
              id: true,
              title: true,
              rubric_criterion: { select: { id: true, title: true }, orderBy: { position: 'asc' } },
            },
          },
          quiz_question: { select: { id: true, prompt: true, kind: true }, orderBy: { sort_order: 'asc' } },
        },
        orderBy: { created_at: 'asc' },
      }),
    ]);
    return {
      canEdit: (MANAGE_ROLES as readonly string[]).includes(role),
      own: own.map(toOutcome),
      school: school.map((o) => ({ ...toOutcome(o), setTitle: o.outcome_set?.title ?? null })),
      alignments,
      targets: activities.map((a) => ({
        id: a.id,
        title: a.title,
        kind: a.kind,
        status: a.status,
        rubric: a.rubric
          ? {
              id: a.rubric.id,
              title: a.rubric.title,
              criteria: a.rubric.rubric_criterion.map((c) => ({ id: c.id, title: c.title })),
            }
          : null,
        questions: (a.quiz_question ?? []).map((q) => ({ id: q.id, prompt: q.prompt, kind: q.kind })),
      })),
    };
  }

  private async requireCourseOutcome(courseId: string, outcomeId: string) {
    const o = await this.prisma.outcome.findFirst({
      where: { id: outcomeId, course_id: courseId },
      select: OUTCOME_SELECT,
    });
    if (!o) throw new NotFoundException('Outcome not found');
    return o;
  }

  async createCourseOutcome(userId: string, courseId: string, dto: OutcomeDto) {
    const { course } = await this.access.require(userId, courseId, MANAGE_ROLES);
    await this.checkParent({ set_id: null, course_id: courseId }, dto.parentId);
    return this.insertOutcome(userId, { school_id: course.school_id, course_id: courseId }, dto);
  }

  async updateCourseOutcome(userId: string, courseId: string, outcomeId: string, dto: UpdateOutcomeDto) {
    const { course } = await this.access.require(userId, courseId, MANAGE_ROLES);
    const o = await this.requireCourseOutcome(courseId, outcomeId);
    return this.patchOutcome(userId, course.school_id, o, dto);
  }

  async removeCourseOutcome(userId: string, courseId: string, outcomeId: string) {
    const { course } = await this.access.require(userId, courseId, MANAGE_ROLES);
    const o = await this.requireCourseOutcome(courseId, outcomeId);
    await this.deleteOutcome(userId, course.school_id, o);
  }

  // ── alignments ─────────────────────────────────────────────────────────

  async alignments(courseId: string) {
    const rows = await this.prisma.outcome_alignment.findMany({
      where: { course_id: courseId },
      select: {
        id: true,
        outcome_id: true,
        activity_id: true,
        criterion_id: true,
        question_id: true,
        activity: { select: { title: true } },
        rubric_criterion: { select: { title: true, rubric: { select: { title: true } } } },
        quiz_question: { select: { prompt: true, activity: { select: { title: true } } } },
        outcome: { select: { code: true, title: true } },
      },
      orderBy: { created_at: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      outcomeId: r.outcome_id,
      outcomeCode: r.outcome?.code ?? null,
      outcomeTitle: r.outcome?.title ?? null,
      kind: r.activity_id ? ('activity' as const) : r.criterion_id ? ('criterion' as const) : ('question' as const),
      activityId: r.activity_id,
      criterionId: r.criterion_id,
      questionId: r.question_id,
      label: r.activity_id
        ? (r.activity?.title ?? '')
        : r.criterion_id
          ? `${r.rubric_criterion?.rubric?.title ?? 'Rubric'}: ${r.rubric_criterion?.title ?? ''}`
          : `${r.quiz_question?.activity?.title ?? 'Question bank'}: ${(r.quiz_question?.prompt ?? '').slice(0, 120)}`,
    }));
  }

  /**
   * Align an outcome to one target in the course. The outcome must be the
   * course's own or a school outcome of the course's school, and not
   * archived; the target must belong to the course. Evidence for marks
   * already given is worked out at once.
   */
  async align(userId: string, courseId: string, dto: AlignmentDto) {
    const { course } = await this.access.require(userId, courseId, MANAGE_ROLES);
    const targets = [dto.activityId, dto.criterionId, dto.questionId].filter(Boolean);
    if (targets.length !== 1) {
      throw new BadRequestException('Give exactly one of activityId, criterionId or questionId');
    }
    const outcome = await this.prisma.outcome.findFirst({
      where: {
        id: dto.outcomeId,
        school_id: course.school_id,
        OR: [{ course_id: courseId }, { set_id: { not: null } }],
      },
      select: { id: true, archived_at: true, outcome_set: { select: { archived_at: true } } },
    });
    if (!outcome) throw new NotFoundException('Outcome not found');
    if (outcome.archived_at || outcome.outcome_set?.archived_at) {
      throw new BadRequestException('This outcome is archived');
    }

    if (dto.activityId) {
      const a = await this.prisma.activity.findFirst({
        where: { id: dto.activityId, course_id: courseId },
        select: { id: true },
      });
      if (!a) throw new NotFoundException('Activity not found');
    } else if (dto.criterionId) {
      const c = await this.prisma.rubric_criterion.findFirst({
        where: { id: dto.criterionId, rubric: { course_id: courseId } },
        select: { id: true },
      });
      if (!c) throw new NotFoundException('Rubric row not found');
    } else {
      const q = await this.prisma.quiz_question.findFirst({
        where: {
          id: dto.questionId,
          OR: [{ activity: { course_id: courseId } }, { question_bank: { course_id: courseId } }],
        },
        select: { id: true },
      });
      if (!q) throw new NotFoundException('Question not found');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const data = {
          outcome_id: dto.outcomeId,
          course_id: courseId,
          activity_id: dto.activityId ?? null,
          criterion_id: dto.criterionId ?? null,
          question_id: dto.questionId ?? null,
        };
        const created = await tx.outcome_alignment.create({
          data: { ...data, created_by: userId },
          select: { id: true },
        });
        await this.audit(tx, course.school_id, userId, {
          entity: 'outcome_alignment',
          entityId: created.id,
          action: 'create',
          before: null,
          after: alignmentFields(data),
        });
        // Evidence recomputation is derived data and is not audited.
        const activityIds = await activitiesForAlignment(tx, dto);
        for (const activityId of activityIds) await refreshOutcomeEvidence(tx, activityId);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('This is already aligned to that outcome');
      throw error;
    }
    return this.alignments(courseId);
  }

  /** Remove an alignment; the evidence it produced goes with it. */
  async unalign(userId: string, courseId: string, alignmentId: string) {
    const { course } = await this.access.require(userId, courseId, MANAGE_ROLES);
    const existing = await this.prisma.outcome_alignment.findFirst({
      where: { id: alignmentId, course_id: courseId },
      select: { id: true, outcome_id: true, course_id: true, activity_id: true, criterion_id: true, question_id: true },
    });
    if (!existing) throw new NotFoundException('Alignment not found');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.outcome_alignment.deleteMany({
        where: { id: alignmentId, course_id: courseId },
      });
      if (count === 0) throw new NotFoundException('Alignment not found');
      await this.audit(tx, course.school_id, userId, {
        entity: 'outcome_alignment',
        entityId: alignmentId,
        action: 'delete',
        before: alignmentFields(existing),
        after: null,
      });
    });
  }
}
