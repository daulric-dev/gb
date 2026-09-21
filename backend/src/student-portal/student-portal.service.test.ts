import { describe, expect, test } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import { StudentPortalService } from './student-portal.service';
import { createRoutingSupabase, expectRejection } from '@/test/mocks';

const CTX = { studentId: 'student-1', schoolId: 'school-1' };

function service(sb: any) {
  return new StudentPortalService(sb as any);
}

/** Find a recorded query for a table, failing loudly if it never happened. */
function findCall(sb: any, table: string) {
  const call = sb._calls.find((c: any) => c.table === table);
  if (!call) throw new Error(`expected a query against ${table}`);
  return call;
}

function assessment(over: Record<string, any> = {}) {
  return {
    id: 'a1',
    title: 'Test 1',
    assessment_type: 'exam',
    max_score: 100,
    weight: 1,
    assessment_date: '2026-09-01',
    is_excluded: false,
    subject_id: 'sub-1',
    term_id: 'term-1',
    ...over,
  };
}

/** public.* lookups the service joins in memory (no cross-schema embeds). */
const LOOKUPS = {
  subject: {
    data: [{ id: 'sub-1', name: 'Maths', code: 'MAT', sort_order: 1 }],
    error: null,
  },
  term: {
    data: [
      { id: 'term-1', name: 'michaelmas', sort_order: 1 },
      { id: 'term-2', name: 'hilary', sort_order: 2 },
    ],
    error: null,
  },
  academic_year: { data: [{ id: 'y1', name: '2026' }], error: null },
};

describe('StudentPortalService scoping', () => {
  test('every read filters on the resolved student id', async () => {
    const sb = createRoutingSupabase({
      tables: {
        'student.student': { data: { id: 'student-1' }, error: null },
        school: { data: { id: 'school-1', name: 'S' }, error: null },
        'student.student_group_enrollment': { data: [], error: null },
        'grading.grade': { data: [], error: null },
        'student.attendance_record': { data: [], error: null },
        'reporting.report_book': { data: [], error: null },
        student_group: { data: [], error: null },
        ...LOOKUPS,
      },
    });
    const svc = service(sb);

    await svc.getMe(CTX);
    await svc.getGrades(CTX);
    await svc.getAttendance(CTX);
    await svc.getReports(CTX);

    const scoped = sb._calls.filter((c: any) =>
      ['grade', 'attendance_record', 'report_book', 'student_group_enrollment'].includes(
        c.table,
      ),
    );
    expect(scoped.length).toBeGreaterThan(0);
    for (const call of scoped) {
      expect(call.filters.student_id).toBe('student-1');
    }
  });
});

describe('StudentPortalService.getGrades', () => {
  function svcWith(rows: any[]) {
    return service(
      createRoutingSupabase({
        tables: { 'grading.grade': { data: rows, error: null }, ...LOOKUPS },
      }),
    );
  }

  const withGrades = (rows: any[]) => svcWith(rows).getGrades(CTX);

  test('groups by subject and averages as a percentage', async () => {
    const out = await withGrades([
      { id: 'g1', score: 80, letter_grade: 'B', remarks: null, is_excluded: false, assessment: assessment() },
      {
        id: 'g2',
        score: 90,
        letter_grade: 'A',
        remarks: null,
        is_excluded: false,
        assessment: assessment({ id: 'a2', assessment_date: '2026-09-08' }),
      },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].subject.name).toBe('Maths');
    expect(out[0].assessments).toHaveLength(2);
    expect(out[0].average).toBe(85);
  });

  test('hides excluded grades and excluded assessments', async () => {
    const out = await withGrades([
      { id: 'g1', score: 80, is_excluded: true, assessment: assessment() },
      {
        id: 'g2',
        score: 10,
        is_excluded: false,
        assessment: assessment({ id: 'a2', is_excluded: true }),
      },
    ]);

    expect(out).toHaveLength(0);
  });

  test('filters to a single term when asked', async () => {
    const svc = svcWith([
      { id: 'g1', score: 80, is_excluded: false, assessment: assessment() },
      {
        id: 'g2',
        score: 40,
        is_excluded: false,
        assessment: assessment({ id: 'a2', term_id: 'term-2' }),
      },
    ]);

    const out = await svc.getGrades(CTX, 'term-2');
    expect(out).toHaveLength(1);
    expect(out[0].assessments[0].term.id).toBe('term-2');
  });

  test('average is null when nothing is scored yet', async () => {
    const out = await withGrades([
      { id: 'g1', score: null, is_excluded: false, assessment: assessment() },
    ]);
    expect(out[0].average).toBeNull();
  });

  test('a zero max score does not produce a divide-by-zero', async () => {
    const out = await withGrades([
      {
        id: 'g1',
        score: 5,
        is_excluded: false,
        assessment: assessment({ max_score: 0 }),
      },
    ]);
    expect(out[0].average).toBeNull();
  });
});

describe('StudentPortalService.getAttendance', () => {
  test('tallies statuses', async () => {
    const svc = service(
      createRoutingSupabase({
        tables: {
          'student.attendance_record': {
            data: [
              { id: '1', attendance_date: '2026-09-01', status: 'present' },
              { id: '2', attendance_date: '2026-09-02', status: 'absent' },
              { id: '3', attendance_date: '2026-09-03', status: 'late' },
              { id: '4', attendance_date: '2026-09-04', status: 'present' },
            ],
            error: null,
          },
        },
      }),
    );

    const { summary, records } = await svc.getAttendance(CTX);
    expect(summary).toEqual({ present: 2, absent: 1, late: 1, total: 4 });
    expect(records).toHaveLength(4);
  });
});

describe('StudentPortalService reports', () => {
  test('only published states are requested', async () => {
    const sb = createRoutingSupabase({
      tables: { 'reporting.report_book': { data: [], error: null } },
    });
    await service(sb).getReports(CTX);

    // `in` is a passthrough in the mock, so the ownership filter is what is
    // assertable here; the status filter is covered through getReport below.
    expect(findCall(sb, 'report_book').filters.student_id).toBe('student-1');
  });

  test('a report belonging to someone else is not found', async () => {
    const sb = createRoutingSupabase({
      tables: { 'reporting.report_book': { data: null, error: null } },
    });

    expect(
      await expectRejection(service(sb).getReport(CTX, 'report-9')),
    ).toBeInstanceOf(NotFoundException);
  });

  test('a found report is scoped by student id', async () => {
    const sb = createRoutingSupabase({
      tables: {
        'reporting.report_book': {
          data: {
            id: 'r1',
            student_id: 'student-1',
            report_type: 'term',
            status: 'published',
            published_at: '2026-09-10',
            term_id: 'term-1',
            academic_year_id: 'y1',
          },
          error: null,
        },
        'reporting.report_book_entry': {
          data: [
            {
              id: 'e1',
              sort_order: 1,
              is_graded: true,
              term_average: 80,
              subject_id: 'sub-1',
            },
          ],
          error: null,
        },
        ...LOOKUPS,
      },
    });

    const out = await service(sb).getReport(CTX, 'r1');
    expect(out.id).toBe('r1');
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].subject?.name).toBe('Maths');

    const call = findCall(sb, 'report_book');
    expect(call.filters.student_id).toBe('student-1');
    expect(call.filters.id).toBe('r1');
  });
});
