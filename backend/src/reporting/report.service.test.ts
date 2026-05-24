import { describe, test, expect, beforeEach } from 'bun:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReportService } from './report.service';
import {
  createMockSupabaseService,
  createMockQueryBuilder,
} from '@/test/mocks';

const mockCalc = {
  calculateStudentTermResult: () =>
    Promise.resolve({
      studentId: '1',
      firstName: 'A',
      lastName: 'B',
      termId: 't1',
      subjects: [],
      overallAverage: null,
    }),
  calculateStudentYearResult: () =>
    Promise.resolve({
      studentId: '1',
      firstName: 'A',
      lastName: 'B',
      academicYearId: 'y1',
      gradingModel: 'weighted_continuous',
      terms: [],
      yearEnd: { subjects: [], overallAverage: null },
    }),
  calculateClassTermResults: () => Promise.resolve([]),
  calculateClassYearResults: () => Promise.resolve([]),
};

describe('ReportService', () => {
  let service: ReportService;
  let mockSupabase: ReturnType<typeof createMockSupabaseService>;

  beforeEach(() => {
    mockSupabase = createMockSupabaseService();
    service = new ReportService(mockSupabase as any, mockCalc as any);
  });

  test('generateTermReports returns { generated: 0 } for empty enrollment', async () => {
    const groupResult = { data: { academic_year_id: 'ay1' }, error: null };
    const enrollmentResult = { data: [], error: null };

    let callIndex = 0;
    const sequence = [groupResult, enrollmentResult];
    const builder = createMockQueryBuilder(sequence[0]);

    builder.maybeSingle = () => {
      const r = sequence[callIndex];
      callIndex++;
      return Promise.resolve(r);
    };
    builder.single = () => {
      const r = sequence[callIndex];
      callIndex++;
      return Promise.resolve(r);
    };
    builder.then = (resolve: Function) => {
      const r = sequence[callIndex];
      callIndex++;
      return resolve(r);
    };

    mockSupabase.getServiceClient = () =>
      ({ from: () => builder, schema: () => ({ from: () => builder }) }) as any;

    const result = await service.generateTermReports('user1', {
      termId: 't1',
      studentGroupId: 'sg1',
      reportType: 'term',
    } as any);

    expect(result.generated).toBe(0);
  });

  test('findOne throws NotFoundException for missing report', () => {
    const builder = createMockQueryBuilder({ data: null, error: null });
    mockSupabase.createUserClient = () =>
      ({ from: () => builder, schema: () => ({ from: () => builder }) }) as any;

    const req = { cookies: {} } as any;
    const reply = { setCookie: () => undefined } as any;
    expect(service.findOne('nonexistent', req, reply)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  function wireSchoolCheck(then: { data: any; error: any }[]) {
    const schoolCheckResult = {
      data: { academic_year: { school_id: 'school-1' } },
      error: null,
    };
    const sequence = [schoolCheckResult, ...then];
    const builder = createMockQueryBuilder(schoolCheckResult);

    let i = 0;
    builder.maybeSingle = () =>
      Promise.resolve(sequence[i++] ?? sequence.at(-1));
    builder.single = () => Promise.resolve(sequence[i++] ?? sequence.at(-1));
    builder.then = (resolve: Function) =>
      resolve(sequence[i++] ?? sequence.at(-1));

    mockSupabase.getServiceClient = () =>
      ({ from: () => builder, schema: () => ({ from: () => builder }) }) as any;
  }

  test('publish throws BadRequestException if already published', () => {
    wireSchoolCheck([{ data: { status: 'published' }, error: null }]);

    expect(service.publish('user1', 'r1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  test('sendToMinistry throws BadRequestException if still draft', () => {
    wireSchoolCheck([{ data: { status: 'draft' }, error: null }]);

    expect(service.sendToMinistry('user1', 'r1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  test('updateReport returns updated data', async () => {
    const updated = { id: 'r1', class_teacher_remark: 'Good', conduct: 'A' };
    wireSchoolCheck([{ data: updated, error: null }]);

    const result = await service.updateReport('user1', 'r1', {
      classTeacherRemark: 'Good',
      conduct: 'A',
    });

    expect(result).toEqual(updated);
  });

  test('updateReport rejects cross-school mutation', () => {
    // School check returns a different school than the caller's.
    const schoolCheckResult = {
      data: { academic_year: { school_id: 'school-2' } },
      error: null,
    };
    const builder = createMockQueryBuilder(schoolCheckResult);
    builder.maybeSingle = () => Promise.resolve(schoolCheckResult);

    mockSupabase.getServiceClient = () =>
      ({ from: () => builder, schema: () => ({ from: () => builder }) }) as any;

    expect(
      service.updateReport('user1', 'r1', { classTeacherRemark: 'x' }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
