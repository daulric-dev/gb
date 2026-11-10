import { describe, expect, mock, test } from 'bun:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { MasteryService } from './mastery.service';
import { OutcomeService } from './outcome.service';

/** Mastery staff writes go in the audit log, in the same transaction. */

function stubAccess(schoolId = 'school-1') {
  return {
    require: async (_u: string, courseId: string) => ({
      course: { id: courseId, school_id: schoolId, name: 'Maths', code: 'MA1' },
      role: 'teacher',
    }),
  };
}

function setup(configure: (p: MockPrisma) => void = () => {}) {
  const prisma = createMockPrisma();
  configure(prisma);
  const auditLog = { record: mock(async (..._args: any[]) => {}) };
  return {
    prisma,
    auditLog,
    outcomes: new OutcomeService(prisma as any, stubAccess() as any, auditLog as any),
    mastery: new MasteryService(prisma as any, stubAccess() as any, auditLog as any),
    /** [schoolId, actor, entry] of each audit call. */
    entries: () => auditLog.record.mock.calls.map((c: any[]) => ({ schoolId: c[1], actor: c[2], ...c[3] })),
  };
}

const OUTCOME = {
  id: 'out-1',
  set_id: 'set-1',
  course_id: null,
  parent_id: null,
  code: 'A.1',
  title: 'Fractions',
  description: null,
  subject: null,
  grade_level: null,
  position: 0,
  archived_at: null,
};
const COURSE_OUTCOME = { ...OUTCOME, id: 'out-c', set_id: null, course_id: 'course-1', code: 'C.1' };
const SET = { id: 'set-1', title: 'Maths', description: null, source: null, archived_at: null };

describe('mastery settings audit', () => {
  test('first save is a create with the whole scale', async () => {
    const t = setup();
    await t.mastery.updateSettings('admin', 'school-1', { masteryThreshold: 2, reportCardSection: true });
    const [e] = t.entries();
    expect(t.entries()).toHaveLength(1);
    expect(e).toMatchObject({ schoolId: 'school-1', actor: { id: 'admin' }, entity: 'mastery_setting', entityId: 'school-1', action: 'create' });
    expect(e.changes.mastery_threshold).toEqual({ before: null, after: 2 });
    expect(e.changes.report_card_section).toEqual({ before: null, after: true });
    expect(e.changes.levels.after).toBeArray();
    expect(e.changes.score_bands.after).toBeArray();
  });

  test('a later save is an update with only the changed fields', async () => {
    const row = {
      school_id: 'school-1',
      levels: ['Beginning', 'Developing', 'Proficient', 'Extending'],
      mastery_threshold: 3,
      calculation: 'decaying_average',
      decay_weight: 0.65,
      min_evidence: 1,
      score_bands: [
        { minPercent: 0, level: 1 },
        { minPercent: 50, level: 2 },
        { minPercent: 70, level: 3 },
        { minPercent: 90, level: 4 },
      ],
      report_card_section: false,
    };
    const t = setup((p) => p.mastery_setting.findUnique.mockResolvedValue(row));
    await t.mastery.updateSettings('admin', 'school-1', { calculation: 'most_recent', reportCardSection: true });
    const [e] = t.entries();
    expect(e).toMatchObject({ entity: 'mastery_setting', action: 'update', entityId: 'school-1' });
    expect(e.changes).toEqual({
      calculation: { before: 'decaying_average', after: 'most_recent' },
      report_card_section: { before: false, after: true },
    });
  });
});

describe('outcome set audit', () => {
  test('create', async () => {
    const t = setup((p) => {
      p.outcome_set.create.mockResolvedValue({ id: 'set-1' });
      p.outcome_set.findFirst.mockResolvedValue(SET);
    });
    await t.outcomes.createSet('admin', 'school-1', { title: ' Maths ' });
    expect(t.entries()).toEqual([
      expect.objectContaining({
        schoolId: 'school-1',
        entity: 'outcome_set',
        entityId: 'set-1',
        action: 'create',
        changes: { title: { before: null, after: 'Maths' }, archived: { before: null, after: false } },
      }),
    ]);
  });

  test('update and archive record before/after', async () => {
    const t = setup((p) => {
      p.outcome_set.findFirst.mockResolvedValue(SET);
      p.outcome_set.update.mockImplementation(async ({ data }: any) => ({ ...SET, ...data }));
    });
    await t.outcomes.updateSet('admin', 'school-1', 'set-1', { title: 'Mathematics', archived: true });
    const [e] = t.entries();
    expect(e).toMatchObject({ entity: 'outcome_set', entityId: 'set-1', action: 'update', schoolId: 'school-1' });
    expect(e.changes).toEqual({
      title: { before: 'Maths', after: 'Mathematics' },
      archived: { before: false, after: true },
    });
  });

  test('delete records the set and how many outcomes went with it; refused delete writes nothing', async () => {
    const t = setup((p) => {
      p.outcome_set.findFirst.mockResolvedValue(SET);
      p.outcome.count.mockResolvedValue(4);
    });
    await t.outcomes.removeSet('admin', 'school-1', 'set-1');
    const [e] = t.entries();
    expect(e).toMatchObject({ entity: 'outcome_set', entityId: 'set-1', action: 'delete' });
    expect(e.changes.title).toEqual({ before: 'Maths', after: null });
    expect(e.changes.outcome_count).toEqual({ before: 4, after: null });

    const refused = setup((p) => {
      p.outcome_set.findFirst.mockResolvedValue(SET);
      p.outcome_evidence.count.mockResolvedValue(2);
    });
    expect(await expectRejection(refused.outcomes.removeSet('admin', 'school-1', 'set-1'))).toBeInstanceOf(ConflictException);
    expect(refused.auditLog.record).not.toHaveBeenCalled();
  });

  test('CSV import into a new set is ONE create entry with counts, not one per row', async () => {
    const t = setup((p) => {
      p.outcome_set.create.mockResolvedValue({ id: 'set-new' });
      p.outcome_set.findFirst.mockResolvedValue({ ...SET, id: 'set-new', source: 'CSV import' });
      let n = 0;
      p.outcome.create.mockImplementation(async () => ({ id: `o${++n}` }));
    });
    await t.outcomes.importCsv('admin', 'school-1', {
      csv: 'code,title,parent_code\nM.1,Root,\nM.1.a,Child,M.1\nM.2,Other,\n',
      title: 'Maths',
    });
    expect(t.entries()).toHaveLength(1);
    const [e] = t.entries();
    expect(e).toMatchObject({ schoolId: 'school-1', entity: 'outcome_set', entityId: 'set-new', action: 'create' });
    expect(e.changes).toEqual({
      title: { before: null, after: 'Maths' },
      source: { before: null, after: 'CSV import' },
      import: { before: null, after: { created: 3, updated: 0, source: 'CSV import' } },
    });
  });

  test('CSV import into an existing set is ONE update entry; a dry run writes none', async () => {
    const t = setup((p) => {
      p.outcome_set.findFirst.mockResolvedValue(SET);
      p.outcome.findMany.mockResolvedValue([{ id: 'out-1', code: 'M.1' }]);
      p.outcome.create.mockResolvedValue({ id: 'o-new' });
    });
    const csv = 'code,title\nM.1,Root renamed\nM.2,New\n';
    await t.outcomes.importCsv('admin', 'school-1', { csv, setId: 'set-1', dryRun: true });
    expect(t.auditLog.record).not.toHaveBeenCalled();
    await t.outcomes.importCsv('admin', 'school-1', { csv, setId: 'set-1' });
    expect(t.entries()).toHaveLength(1);
    const [e] = t.entries();
    expect(e).toMatchObject({ entity: 'outcome_set', entityId: 'set-1', action: 'update' });
    expect(e.changes).toEqual({
      import: { before: null, after: { created: 1, updated: 1, source: 'CSV import' } },
    });
  });
});

describe('outcome audit', () => {
  test('school outcome create, edit, archive and delete', async () => {
    const t = setup((p) => {
      p.outcome_set.findFirst.mockResolvedValue(SET);
      p.outcome.create.mockImplementation(async ({ data }: any) => ({ ...OUTCOME, ...data, id: 'out-1' }));
      p.outcome.findFirst.mockResolvedValue(OUTCOME);
      p.outcome.update.mockImplementation(async ({ data }: any) => ({ ...OUTCOME, ...data }));
    });
    await t.outcomes.createSchoolOutcome('admin', 'school-1', 'set-1', { code: 'A.1', title: 'Fractions' });
    await t.outcomes.updateSchoolOutcome('admin', 'school-1', 'set-1', 'out-1', { title: 'Fractions and decimals' });
    await t.outcomes.updateSchoolOutcome('admin', 'school-1', 'set-1', 'out-1', { archived: true });
    await t.outcomes.removeSchoolOutcome('admin', 'school-1', 'set-1', 'out-1');
    const [created, edited, archived, deleted] = t.entries();
    expect(created).toMatchObject({ schoolId: 'school-1', entity: 'outcome', entityId: 'out-1', action: 'create' });
    expect(created.changes.set_id).toEqual({ before: null, after: 'set-1' });
    expect(created.changes.code).toEqual({ before: null, after: 'A.1' });
    expect(edited).toMatchObject({ entity: 'outcome', action: 'update' });
    expect(edited.changes).toEqual({ title: { before: 'Fractions', after: 'Fractions and decimals' } });
    expect(archived.changes).toEqual({ archived: { before: false, after: true } });
    expect(deleted).toMatchObject({ entity: 'outcome', entityId: 'out-1', action: 'delete' });
    expect(deleted.changes.set_id).toEqual({ before: 'set-1', after: null });
  });

  test('course outcome create, edit and delete are scoped to the course\'s school', async () => {
    const t = setup((p) => {
      p.outcome.create.mockImplementation(async ({ data }: any) => ({ ...COURSE_OUTCOME, ...data }));
      p.outcome.findFirst.mockResolvedValue(COURSE_OUTCOME);
      p.outcome.update.mockImplementation(async ({ data }: any) => ({ ...COURSE_OUTCOME, ...data }));
    });
    await t.outcomes.createCourseOutcome('teacher', 'course-1', { code: 'C.1', title: 'Fractions' });
    await t.outcomes.updateCourseOutcome('teacher', 'course-1', 'out-c', { code: 'C.2' });
    await t.outcomes.removeCourseOutcome('teacher', 'course-1', 'out-c');
    const [created, edited, deleted] = t.entries();
    expect(created).toMatchObject({ schoolId: 'school-1', actor: { id: 'teacher' }, entity: 'outcome', action: 'create' });
    expect(created.changes.course_id).toEqual({ before: null, after: 'course-1' });
    expect(edited.changes).toEqual({ code: { before: 'C.1', after: 'C.2' } });
    expect(deleted).toMatchObject({ entity: 'outcome', entityId: 'out-c', action: 'delete', schoolId: 'school-1' });
    expect(deleted.changes.course_id).toEqual({ before: 'course-1', after: null });
  });

  test('an outcome with evidence is not deleted and not audited', async () => {
    const t = setup((p) => {
      p.outcome.findFirst.mockResolvedValue(OUTCOME);
      p.outcome_evidence.count.mockResolvedValue(1);
    });
    expect(await expectRejection(t.outcomes.removeSchoolOutcome('a', 'school-1', 'set-1', 'out-1'))).toBeInstanceOf(
      ConflictException,
    );
    expect(t.auditLog.record).not.toHaveBeenCalled();
  });
});

describe('alignment audit', () => {
  test('link records the target; evidence recomputation is not audited', async () => {
    const t = setup((p) => {
      p.outcome.findFirst.mockResolvedValue({ id: 'out-1', archived_at: null, outcome_set: { archived_at: null } });
      p.activity.findFirst.mockResolvedValue({ id: 'act-1' });
      p.outcome_alignment.create.mockResolvedValue({ id: 'al-1' });
    });
    await t.outcomes.align('teacher', 'course-1', { outcomeId: 'out-1', activityId: 'act-1' });
    // Exactly one entry: the alignment, nothing for the evidence it produced.
    expect(t.entries()).toHaveLength(1);
    const [e] = t.entries();
    expect(e).toMatchObject({ schoolId: 'school-1', entity: 'outcome_alignment', entityId: 'al-1', action: 'create' });
    expect(e.changes).toEqual({
      outcome_id: { before: null, after: 'out-1' },
      course_id: { before: null, after: 'course-1' },
      activity_id: { before: null, after: 'act-1' },
    });
  });

  test('unlink records what was removed; a missing alignment is a 404 with no entry', async () => {
    const t = setup((p) => {
      p.outcome_alignment.findFirst.mockResolvedValue({
        id: 'al-1', outcome_id: 'out-1', course_id: 'course-1', activity_id: null, criterion_id: 'crit-1', question_id: null,
      });
      p.outcome_alignment.deleteMany.mockResolvedValue({ count: 1 });
    });
    await t.outcomes.unalign('teacher', 'course-1', 'al-1');
    const [e] = t.entries();
    expect(e).toMatchObject({ entity: 'outcome_alignment', entityId: 'al-1', action: 'delete', schoolId: 'school-1' });
    expect(e.changes).toEqual({
      outcome_id: { before: 'out-1', after: null },
      course_id: { before: 'course-1', after: null },
      criterion_id: { before: 'crit-1', after: null },
    });

    const missing = setup();
    expect(await expectRejection(missing.outcomes.unalign('teacher', 'course-1', 'al-x'))).toBeInstanceOf(NotFoundException);
    expect(missing.auditLog.record).not.toHaveBeenCalled();
  });
});

describe('without an audit log (optional dependency)', () => {
  test('writes still work', async () => {
    const prisma = createMockPrisma();
    prisma.outcome_set.create.mockResolvedValue({ id: 'set-1' });
    prisma.outcome_set.findFirst.mockResolvedValue(SET);
    const service = new OutcomeService(prisma as any, stubAccess() as any);
    const out = await service.createSet('admin', 'school-1', { title: 'Maths' });
    expect(out.id).toBe('set-1');
  });
});
