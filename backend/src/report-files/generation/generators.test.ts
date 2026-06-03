import { describe, test, expect } from 'bun:test';
import {
  buildReportPdfBuffer,
  buildClassSummaryPdfBuffer,
} from './pdf.generator';
import {
  buildYearReportPdfBuffer,
  yearReportPdfFilename,
  buildYearClassSummaryPdfBuffer,
} from './year-pdf.generator';
import {
  buildClassSummaryCsvBuffer,
  buildClassSummaryXlsxBuffer,
} from './export.generator';
import {
  buildYearClassSummaryCsvBuffer,
  buildYearClassSummaryXlsxBuffer,
} from './year-export.generator';
import { termResultsToClassSummary } from './class-summary.transform';
import type {
  StudentTermResult,
  StudentYearResult,
} from '@/calculation/interfaces/calculation.interfaces';

const isPdf = (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-';
const isZip = (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b; // PK (xlsx is a zip)

function subj(id: string, name: string, term: number | null) {
  return {
    subjectId: id,
    subjectName: name,
    subjectCode: null,
    isGraded: true,
    courseworkAverage: term,
    examAverage: term,
    termComposite: term,
    gradeCount: 1,
    assessments: [],
  };
}

const termResult: StudentTermResult = {
  studentId: 's1',
  firstName: 'Alice',
  lastName: 'Smith',
  termId: 't1',
  subjects: [subj('m', 'Math', 80), subj('e', 'English', 70)],
  overallAverage: 75,
  position: 1,
};

const yearResult: StudentYearResult = {
  studentId: 's1',
  firstName: 'Alice',
  lastName: 'Smith',
  academicYearId: 'ay1',
  gradingModel: 'weighted_continuous',
  yearCourseworkWeight: 40,
  yearExamWeight: 60,
  terms: [
    {
      termId: 't1',
      termName: 'Term 1',
      subjects: [subj('m', 'Math', 80)],
      overallAverage: 80,
    },
  ],
  yearEnd: {
    subjects: [
      {
        subjectId: 'm',
        subjectName: 'Math',
        yearGrade: 80,
        termGrades: [{ termId: 't1', termName: 'Term 1', termComposite: 80 }],
      },
    ],
    overallAverage: 80,
  },
  position: 1,
};

describe('student PDF generators', () => {
  test('buildReportPdfBuffer returns a non-empty PDF', () => {
    const buf = buildReportPdfBuffer(termResult, { termName: 'Term 1' });
    expect(buf.length).toBeGreaterThan(0);
    expect(isPdf(buf)).toBe(true);
  });

  test('buildYearReportPdfBuffer returns a non-empty PDF', () => {
    const buf = buildYearReportPdfBuffer(yearResult, { className: '5A' });
    expect(isPdf(buf)).toBe(true);
  });

  test('yearReportPdfFilename builds a safe filename', () => {
    expect(yearReportPdfFilename(yearResult)).toBe(
      'Alice_Smith_year_report.pdf',
    );
  });
});

describe('class summary generators', () => {
  const summary = termResultsToClassSummary([termResult], {
    courseworkWeight: 40,
    examWeight: 60,
  });

  test('class summary PDF', () => {
    expect(
      isPdf(buildClassSummaryPdfBuffer(summary, '5A', 'term', 'Term 1')),
    ).toBe(true);
  });

  test('class summary CSV contains headers', () => {
    const csv = buildClassSummaryCsvBuffer(
      summary,
      '5A',
      'term',
      'Term 1',
    ).toString('utf-8');
    expect(csv).toContain('Class Summary Report');
    expect(csv).toContain('Math');
  });

  test('class summary XLSX is a zip container', () => {
    expect(
      isZip(buildClassSummaryXlsxBuffer(summary, '5A', 'term', 'Term 1')),
    ).toBe(true);
  });

  test('year class summary PDF/CSV/XLSX', () => {
    expect(isPdf(buildYearClassSummaryPdfBuffer([yearResult], '5A'))).toBe(
      true,
    );
    expect(
      buildYearClassSummaryCsvBuffer([yearResult], '5A').toString('utf-8'),
    ).toContain('Year-End Class Summary Report');
    expect(isZip(buildYearClassSummaryXlsxBuffer([yearResult], '5A'))).toBe(
      true,
    );
  });
});
