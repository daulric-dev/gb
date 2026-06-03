import { describe, test, expect } from 'bun:test';
import { ReportFilesService } from './report-files.service';
import { createMockSupabaseService } from '@/test/mocks';
import type {
  StudentTermResult,
  StudentYearResult,
} from '@/calculation/interfaces/calculation.interfaces';

const isPdf = (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-';
const isZip = (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b;

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
  subjects: [subj('m', 'Math', 80)],
  overallAverage: 80,
  position: 1,
};

const yearResult: StudentYearResult = {
  studentId: 's1',
  firstName: 'Alice',
  lastName: 'Smith',
  academicYearId: 'ay1',
  gradingModel: 'weighted_continuous',
  terms: [
    {
      termId: 't1',
      termName: 'michaelmas',
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
        termGrades: [
          { termId: 't1', termName: 'michaelmas', termComposite: 80 },
        ],
      },
    ],
    overallAverage: 80,
  },
  position: 1,
};

// One row that satisfies the student_group / term / academic_year lookups.
const contextRow = {
  name: '5A',
  coursework_weight: 60,
  exam_weight: 40,
  academic_year_id: 'ay1',
  grading_model: 'weighted_continuous',
  year_coursework_weight: 40,
  year_exam_weight: 60,
};

function makeService(overrides: Partial<Record<string, any>> = {}) {
  const supabase = createMockSupabaseService({
    queryResult: { data: contextRow, error: null },
  });
  const calc = {
    calculateStudentTermResult: async () => termResult,
    calculateStudentYearResult: async () => yearResult,
    calculateClassTermResults: async () => [termResult],
    calculateClassYearResults: async () => [yearResult],
    ...overrides.calc,
  };
  const uploads: any[] = [];
  const reportService = {
    uploadClassSummaryFile: async (
      _g: string,
      _t: string,
      rt: string,
      fileType: string,
    ) => {
      const row = {
        id: `${fileType}-id`,
        file_type: fileType,
        report_type: rt,
      };
      uploads.push(row);
      return row;
    },
  };
  const service = new ReportFilesService(
    supabase as any,
    calc,
    reportService as any,
  );
  return { service, uploads };
}

describe('ReportFilesService', () => {
  test('getStudentTermPdf returns a named PDF', async () => {
    const { service } = makeService();
    const file = await service.getStudentTermPdf('s1', 't1', 'g1');
    expect(file.contentType).toBe('application/pdf');
    expect(file.filename).toBe('Alice_Smith_report.pdf');
    expect(isPdf(file.buffer)).toBe(true);
  });

  test('getStudentYearPdf returns a year PDF', async () => {
    const { service } = makeService();
    const file = await service.getStudentYearPdf('s1', 'ay1', 'g1');
    expect(file.filename).toBe('Alice_Smith_year_report.pdf');
    expect(isPdf(file.buffer)).toBe(true);
  });

  test('class summary term: pdf/csv/xlsx', async () => {
    const { service } = makeService();
    const pdf = await service.getClassSummaryFile('g1', 't1', 'term', 'pdf');
    expect(pdf.filename).toBe('5A_summary.pdf');
    expect(isPdf(pdf.buffer)).toBe(true);

    const csv = await service.getClassSummaryFile('g1', 't1', 'term', 'csv');
    expect(csv.filename).toBe('5A_summary.csv');
    expect(csv.buffer.toString('utf-8')).toContain('Class Summary Report');

    const xlsx = await service.getClassSummaryFile('g1', 't1', 'term', 'xlsx');
    expect(xlsx.contentType).toContain('spreadsheetml');
    expect(isZip(xlsx.buffer)).toBe(true);
  });

  test('class summary year_end uses year naming', async () => {
    const { service } = makeService();
    const pdf = await service.getClassSummaryFile(
      'g1',
      't1',
      'year_end',
      'pdf',
    );
    expect(pdf.filename).toBe('5A_year_summary.pdf');
    expect(isPdf(pdf.buffer)).toBe(true);
  });

  test('persist generates and uploads all three formats', async () => {
    const { service, uploads } = makeService();
    const rows = await service.generateAndPersistClassSummary(
      'g1',
      't1',
      'term',
      'user-1',
    );
    expect(rows.length).toBe(3);
    expect(uploads.map((u) => u.file_type).sort()).toEqual([
      'csv',
      'pdf',
      'xlsx',
    ]);
  });
});
