import { describe, test, expect, beforeEach } from 'bun:test';
import { ConflictException } from '@nestjs/common';
import { EnrollmentService } from './enrollment.service';
import {
  createMockSupabaseService,
  createMockCacheService,
  createMockQueryBuilder,
} from '@/test/mocks';

const TTL = 60 * 60 * 24 * 30;

describe('EnrollmentService', () => {
  let service: EnrollmentService;
  let mockSupabase: ReturnType<typeof createMockSupabaseService>;
  let mockCache: ReturnType<typeof createMockCacheService>;

  beforeEach(() => {
    mockSupabase = createMockSupabaseService();
    mockCache = createMockCacheService();
    service = new EnrollmentService(mockSupabase as any, mockCache as any);
  });

  describe('enroll', () => {
    test('throws ConflictException on duplicate (error code 23505)', () => {
      const builder = createMockQueryBuilder({
        data: null,
        error: { code: '23505', message: 'duplicate' },
      });
      mockSupabase._client.schema = () => ({ from: () => builder });
      service = new EnrollmentService(mockSupabase as any, mockCache as any);

      expect(service.enroll('c1', { studentId: 's1' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    test('uses deleteByPrefix for enrolled cache', async () => {
      const enrolled = { id: 'e1', student_id: 's1' };
      mockSupabase = createMockSupabaseService({
        queryResult: { data: enrolled, error: null },
      });
      mockCache = createMockCacheService();
      service = new EnrollmentService(mockSupabase as any, mockCache as any);

      await mockCache.set('enrolled:c1:all:all', [{ id: 'old' }], TTL);
      await mockCache.set('enrolled:c1:u1:all', [{ id: 'old' }], TTL);

      await service.enroll('c1', { studentId: 's1' });

      expect(await mockCache.get('enrolled:c1:all:all')).toBeNull();
      expect(await mockCache.get('enrolled:c1:u1:all')).toBeNull();
    });
  });

  describe('bulkEnroll', () => {
    test('throws ConflictException on duplicate', () => {
      const builder = createMockQueryBuilder({
        data: null,
        error: { code: '23505', message: 'duplicate' },
      });
      mockSupabase._client.schema = () => ({ from: () => builder });
      service = new EnrollmentService(mockSupabase as any, mockCache as any);

      expect(
        service.bulkEnroll('c1', { studentIds: ['s1', 's2'] }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    test('uses deleteByPrefix', async () => {
      const rows = [{ id: 'e1' }, { id: 'e2' }];
      mockSupabase = createMockSupabaseService({
        queryResult: { data: rows, error: null },
      });
      mockCache = createMockCacheService();
      service = new EnrollmentService(mockSupabase as any, mockCache as any);

      await mockCache.set('enrolled:c1:all:all', [{ id: 'old' }], TTL);

      await service.bulkEnroll('c1', { studentIds: ['s1', 's2'] });

      expect(await mockCache.get('enrolled:c1:all:all')).toBeNull();
    });
  });

  describe('unenroll', () => {
    test('deletes both enrolled prefix and student-subjects key', async () => {
      const builder = createMockQueryBuilder({
        data: { academic_year_id: 'ay1' },
        error: null,
      });
      mockSupabase = createMockSupabaseService();
      mockSupabase._client.from = () => builder;
      mockSupabase._client.schema = () => ({ from: () => builder });
      mockCache = createMockCacheService();
      service = new EnrollmentService(mockSupabase as any, mockCache as any);

      await mockCache.set('enrolled:c1:all:all', [{ id: 'e1' }], TTL);
      await mockCache.set('student-subjects:c1:s1', [{ id: 'sp1' }], TTL);

      await service.unenroll('c1', 's1');

      expect(await mockCache.get('enrolled:c1:all:all')).toBeNull();
      expect(await mockCache.get('student-subjects:c1:s1')).toBeNull();
    });
  });

  describe('assignSubjects', () => {
    test('throws ConflictException on duplicate', () => {
      const okBuilder = createMockQueryBuilder({
        data: { academic_year_id: 'ay1' },
        error: null,
      });
      const errorBuilder = createMockQueryBuilder({
        data: null,
        error: { code: '23505', message: 'duplicate' },
      });

      mockSupabase._client.from = () => okBuilder;
      mockSupabase._client.schema = () => ({
        from: () => errorBuilder,
      });
      service = new EnrollmentService(mockSupabase as any, mockCache as any);

      expect(
        service.assignSubjects('c1', { studentId: 's1', subjectIds: ['sub1'] }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    test('uses deleteByPrefix and delete', async () => {
      const builder = createMockQueryBuilder({
        data: [{ id: 'sp1' }],
        error: null,
      });
      const groupBuilder = createMockQueryBuilder({
        data: { academic_year_id: 'ay1' },
        error: null,
      });

      mockSupabase._client.from = () => groupBuilder;
      mockSupabase._client.schema = () => ({ from: () => builder });
      mockCache = createMockCacheService();
      service = new EnrollmentService(mockSupabase as any, mockCache as any);

      await mockCache.set('enrolled:c1:all:all', [{ id: 'e1' }], TTL);
      await mockCache.set('student-subjects:c1:s1', [{ id: 'old' }], TTL);

      await service.assignSubjects('c1', {
        studentId: 's1',
        subjectIds: ['sub1'],
      });

      expect(await mockCache.get('enrolled:c1:all:all')).toBeNull();
      expect(await mockCache.get('student-subjects:c1:s1')).toBeNull();
    });
  });

  describe('bulkAssignSubjects', () => {
    test('uses deleteByPrefix and deletes per-student keys', async () => {
      const builder = createMockQueryBuilder({
        data: [{ id: 'sp1' }, { id: 'sp2' }],
        error: null,
      });
      const groupBuilder = createMockQueryBuilder({
        data: { academic_year_id: 'ay1' },
        error: null,
      });

      mockSupabase._client.from = () => groupBuilder;
      mockSupabase._client.schema = () => ({ from: () => builder });
      mockCache = createMockCacheService();
      service = new EnrollmentService(mockSupabase as any, mockCache as any);

      await mockCache.set('enrolled:c1:all:all', [{ id: 'e1' }], TTL);
      await mockCache.set('student-subjects:c1:s1', [{ id: 'x' }], TTL);
      await mockCache.set('student-subjects:c1:s2', [{ id: 'y' }], TTL);

      await service.bulkAssignSubjects('c1', {
        studentIds: ['s1', 's2'],
        subjectIds: ['sub1'],
      });

      expect(await mockCache.get('enrolled:c1:all:all')).toBeNull();
      expect(await mockCache.get('student-subjects:c1:s1')).toBeNull();
      expect(await mockCache.get('student-subjects:c1:s2')).toBeNull();
    });
  });

  describe('removeSubject', () => {
    test('throws ConflictException on FK violation (23503)', () => {
      const okBuilder = createMockQueryBuilder({
        data: { academic_year_id: 'ay1' },
        error: null,
      });
      const errorBuilder = createMockQueryBuilder({
        data: null,
        error: { code: '23503', message: 'fk violation' },
      });

      mockSupabase._client.from = () => okBuilder;
      mockSupabase._client.schema = () => ({ from: () => errorBuilder });
      service = new EnrollmentService(mockSupabase as any, mockCache as any);

      expect(service.removeSubject('c1', 's1', 'sub1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('getStudentSubjects', () => {
    test('returns cached data on hit', async () => {
      const cached = [{ id: 'sp1', subject: { id: 'sub1', name: 'Math' } }];
      await mockCache.set('student-subjects:c1:s1', cached, TTL);

      const result = await service.getStudentSubjects('c1', 's1');

      expect(result).toEqual(cached);
    });
  });
});
