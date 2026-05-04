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
      gradingModel: 'term_based',
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

  test('publish throws BadRequestException if already published', () => {
    const fetchResult = { data: { status: 'published' }, error: null };
    const builder = createMockQueryBuilder(fetchResult);
    builder.maybeSingle = () => Promise.resolve(fetchResult);
    mockSupabase.getServiceClient = () =>
      ({ from: () => builder, schema: () => ({ from: () => builder }) }) as any;

    expect(service.publish('r1')).rejects.toBeInstanceOf(BadRequestException);
  });

  test('sendToMinistry throws BadRequestException if still draft', () => {
    const fetchResult = { data: { status: 'draft' }, error: null };
    const builder = createMockQueryBuilder(fetchResult);
    builder.maybeSingle = () => Promise.resolve(fetchResult);
    mockSupabase.getServiceClient = () =>
      ({ from: () => builder, schema: () => ({ from: () => builder }) }) as any;

    expect(service.sendToMinistry('r1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  test('updateReport returns updated data', async () => {
    const updated = { id: 'r1', class_teacher_remark: 'Good', conduct: 'A' };
    const builder = createMockQueryBuilder({ data: updated, error: null });
    mockSupabase.getServiceClient = () =>
      ({ from: () => builder, schema: () => ({ from: () => builder }) }) as any;

    const result = await service.updateReport('r1', {
      classTeacherRemark: 'Good',
      conduct: 'A',
    });

    expect(result).toEqual(updated);
  });
});
