import { describe, expect, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { pdfText } from '@/test/pdf-text';
import { ReportDataService, type TermCourse, type TermContext } from '@/report-card/report-data.service';
import { renderReportCard } from '@/report-card/report-pdf';
import { loadReportOutcomes } from './mastery-report';

/** The optional outcomes section of a report card. */

const SETTING = {
  school_id: 'school-1',
  levels: ['Beginning', 'Developing', 'Proficient', 'Exceeding'],
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
  report_card_section: true,
};

const EVIDENCE = [
  { course_id: 'c1', outcome_id: 'o2', ratio: 0.95, rating_rank: null, rating_count: null, assessed_at: new Date('2026-10-01'), outcome: { code: 'B', title: 'Second', position: 1, course_id: null } },
  { course_id: 'c1', outcome_id: 'o1', ratio: 0.55, rating_rank: null, rating_count: null, assessed_at: new Date('2026-10-02'), outcome: { code: 'A', title: 'First', position: 0, course_id: null } },
];

describe('loadReportOutcomes', () => {
  test('nothing when the school has the section off (or no settings)', async () => {
    const prisma = createMockPrisma();
    expect((await loadReportOutcomes(prisma as any, 'school-1', 'stu-1', ['c1'], null)).size).toBe(0);
    prisma.mastery_setting.findUnique.mockResolvedValue({ ...SETTING, report_card_section: false });
    expect((await loadReportOutcomes(prisma as any, 'school-1', 'stu-1', ['c1'], null)).size).toBe(0);
    expect(prisma.outcome_evidence.findMany).not.toHaveBeenCalled();
  });

  test('per course, each outcome with evidence: its level and whether mastered', async () => {
    const prisma = createMockPrisma();
    prisma.mastery_setting.findUnique.mockResolvedValue(SETTING);
    prisma.outcome_evidence.findMany.mockResolvedValue(EVIDENCE);
    const until = new Date('2026-12-15T23:59:59.999Z');
    const out = await loadReportOutcomes(prisma as any, 'school-1', 'stu-1', ['c1'], until);
    expect(out.get('c1')).toEqual([
      { code: 'A', title: 'First', label: 'Developing', mastered: false },
      { code: 'B', title: 'Second', label: 'Exceeding', mastered: true },
    ]);
    expect(prisma.outcome_evidence.findMany.mock.calls[0][0].where).toEqual({
      student_id: 'stu-1',
      course_id: { in: ['c1'] },
      assessed_at: { lte: until },
    });
  });
});

describe('ReportDataService.reportOutcomes', () => {
  const term: TermContext = {
    id: 't1',
    name: 'Autumn',
    academic_year_id: 'y1',
    yearName: '2026-27',
    start_date: new Date('2026-09-01'),
    end_date: new Date('2026-12-15'),
    sort_order: 0,
    schoolId: 'school-1',
  };
  const course = (id: string, mode: 'term' | 'year'): TermCourse => ({
    id, name: id, code: null, school_id: 'school-1', term_id: null, academic_year_id: 'y1', grade_scale_id: null, mode, teachers: [],
  });

  function build(mastery: boolean) {
    const prisma = createMockPrisma();
    prisma.mastery_setting.findUnique.mockResolvedValue(SETTING);
    prisma.outcome_evidence.findMany.mockResolvedValue(EVIDENCE);
    const features = { isEnabled: async (_s: string, key: string) => (key === 'mastery' ? mastery : true) };
    return { prisma, data: new ReportDataService(prisma as any, {} as any, features as any) };
  }

  test('off with the mastery feature off', async () => {
    const { prisma, data } = build(false);
    expect((await data.reportOutcomes(term, 'stu-1', [course('c1', 'term')])).size).toBe(0);
    expect(prisma.outcome_evidence.findMany).not.toHaveBeenCalled();
  });

  test('without a feature service (older wiring) there is no section', async () => {
    const prisma = createMockPrisma();
    const data = new ReportDataService(prisma as any, {} as any);
    expect((await data.reportOutcomes(term, 'stu-1', [course('c1', 'term')])).size).toBe(0);
  });

  test('a year-long course counts evidence up to the term\'s last day; a term course all of it', async () => {
    const { prisma, data } = build(true);
    const out = await data.reportOutcomes(term, 'stu-1', [course('c1', 'term'), course('c2', 'year')]);
    expect(out.get('c1')?.length).toBe(2);
    const wheres = prisma.outcome_evidence.findMany.mock.calls.map((c: any) => c[0].where);
    expect(wheres.find((w: any) => w.course_id.in.includes('c1')).assessed_at).toBeUndefined();
    expect(wheres.find((w: any) => w.course_id.in.includes('c2')).assessed_at).toEqual({
      lte: new Date('2026-12-15T23:59:59.999Z'),
    });
  });
});

describe('report card PDF outcomes section', () => {
  test('lists each outcome with its level and "mastered"; absent when not given', async () => {
    const base = {
      school: { name: 'Hillside Academy', logo: null },
      student: { name: 'Ada Lovelace' },
      term: { name: 'Autumn', yearName: null, startDate: null, endDate: null },
      attendance: { present: 0, late: 0, absent: 0, excused: 0, total: 0 },
      headComment: null,
      issuedAt: new Date('2026-12-18T10:00:00Z'),
    };
    const course = { name: 'Mathematics', code: null, teachers: '', percent: 80, letter: 'B', comment: null };
    const withSection = await pdfText(
      await renderReportCard({
        ...base,
        courses: [
          {
            ...course,
            outcomes: [
              { code: 'MA.1', title: 'Fractions', label: 'Proficient', mastered: true },
              { code: 'MA.2', title: 'Decimals', label: 'Developing', mastered: false },
            ],
          },
        ],
      }),
    );
    expect(withSection).toContain('Outcomes');
    expect(withSection).toContain('MA.1 Fractions');
    expect(withSection).toContain('Proficient (mastered)');
    expect(withSection).toContain('Developing');
    const without = await pdfText(await renderReportCard({ ...base, courses: [course] }));
    expect(without).not.toContain('Outcomes');
  });
});
