import { describe, test, expect } from 'bun:test';
import { buildStudentReportPdfBuffer } from './student-report.generator';
import { buildEndOfYearExamPdfBuffer } from './exam-report.generator';
import { termResultsToClassSummary } from './class-summary.transform';
import type { StudentTermResult } from '@/calculation/interfaces/calculation.interfaces';

const isPdf = (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-';

const termResult: StudentTermResult = {
  studentId: 's1',
  firstName: 'Alice',
  lastName: 'Smith',
  termId: 't1',
  subjects: [
    {
      subjectId: 'm',
      subjectName: 'Math',
      subjectCode: null,
      isGraded: true,
      courseworkAverage: 70,
      examAverage: 80,
      termComposite: 75,
      gradeCount: 1,
      assessments: [],
    },
  ],
  overallAverage: 75,
  position: 1,
};

describe('react-pdf generators', () => {
  test('buildStudentReportPdfBuffer renders a PDF', async () => {
    const buf = await buildStudentReportPdfBuffer(termResult, {
      termName: 'michaelmas',
      className: '5A',
    });
    expect(buf.length).toBeGreaterThan(0);
    expect(isPdf(buf)).toBe(true);
  });

  test('buildEndOfYearExamPdfBuffer renders a PDF', async () => {
    const summary = termResultsToClassSummary([termResult], {
      courseworkWeight: 60,
      examWeight: 40,
    });
    const buf = await buildEndOfYearExamPdfBuffer(summary, {
      className: '5A',
      termName: 'michaelmas',
      scoreField: 'termComposite',
    });
    expect(isPdf(buf)).toBe(true);
  });
});
