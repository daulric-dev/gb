import { describe, test, expect, beforeEach } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import { ClassService } from './class.service';
import {
  createMockSupabaseService,
  createMockCacheService,
  createMockQueryBuilder,
} from '@/test/mocks';

const TTL = 60 * 60 * 24 * 30;

describe('ClassService', () => {
  let service: ClassService;
  let mockSupabase: ReturnType<typeof createMockSupabaseService>;
  let mockCache: ReturnType<typeof createMockCacheService>;

  beforeEach(() => {
    mockSupabase = createMockSupabaseService();
    mockCache = createMockCacheService();
    service = new ClassService(mockSupabase as any, mockCache as any);
  });

  describe('getMyClasses', () => {
    test('returns cached data on hit', async () => {
      const cached = [{ id: 'c1', name: 'Class A' }];
      await mockCache.set('my-classes:user1', cached, TTL);

      const result = await service.getMyClasses('user1');

      expect(result).toEqual(cached);
    });

    test('with academicYearId uses different cache key', async () => {
      const cached = [{ id: 'c2', name: 'Class B' }];
      await mockCache.set('my-classes:user1:ay1', cached, TTL);

      const result = await service.getMyClasses('user1', 'ay1');

      expect(result).toEqual(cached);
      expect(await mockCache.get('my-classes:user1')).toBeNull();
    });
  });

  describe('createClass', () => {
    test('uses cache.update to append to both my-classes keys', async () => {
      const group = { id: 'g1', name: 'New Class', created_at: '2024-01-01' };
      mockSupabase = createMockSupabaseService({
        queryResult: { data: group, error: null },
      });
      mockCache = createMockCacheService();
      service = new ClassService(mockSupabase as any, mockCache as any);

      const existing = [{ id: 'old', name: 'Old' }];
      await mockCache.set('my-classes:user1', existing, TTL);
      await mockCache.set('my-classes:user1:ay1', existing, TTL);

      await service.createClass('user1', {
        name: 'New Class',
        academicYearId: 'ay1',
      });

      const allClasses = await mockCache.get('my-classes:user1');
      const yearClasses = await mockCache.get('my-classes:user1:ay1');

      expect(allClasses).toHaveLength(2);
      expect(allClasses[1]).toMatchObject({ id: 'g1', name: 'New Class' });
      expect(yearClasses).toHaveLength(2);
    });
  });

  describe('updateClass', () => {
    test('deletes class-teachers cache key', async () => {
      const updated = { id: 'c1', name: 'Updated' };
      mockSupabase = createMockSupabaseService({
        queryResult: { data: updated, error: null },
      });
      mockCache = createMockCacheService();
      service = new ClassService(mockSupabase as any, mockCache as any);

      await mockCache.set('class-teachers:c1', [{ teacherId: 't1' }], TTL);
      await service.updateClass('c1', { name: 'Updated' });

      expect(await mockCache.get('class-teachers:c1')).toBeNull();
    });
  });

  describe('deleteClass', () => {
    test('deletes class-teachers cache key', async () => {
      mockSupabase = createMockSupabaseService({
        queryResult: { data: null, error: null },
      });
      mockCache = createMockCacheService();
      service = new ClassService(mockSupabase as any, mockCache as any);

      await mockCache.set('class-teachers:c1', [{ teacherId: 't1' }], TTL);
      await service.deleteClass('c1');

      expect(await mockCache.get('class-teachers:c1')).toBeNull();
    });
  });

  describe('getTeachers', () => {
    test('returns cached data on hit', async () => {
      const cached = [{ teacherId: 't1', firstName: 'John' }];
      await mockCache.set('class-teachers:c1', cached, TTL);

      const result = await service.getTeachers('c1');

      expect(result).toEqual(cached);
    });
  });

  describe('getSchoolTeachers', () => {
    test('returns cached data on hit', async () => {
      const builder = createMockQueryBuilder({
        data: { school_id: 's1' },
        error: null,
      });
      mockSupabase = createMockSupabaseService();
      mockSupabase._client.from = () => builder;
      mockCache = createMockCacheService();
      service = new ClassService(mockSupabase as any, mockCache as any);

      const cached = [{ id: 't1', first_name: 'Jane' }];
      await mockCache.set('school-teachers:s1', cached, TTL);

      const result = await service.getSchoolTeachers('user1');

      expect(result).toEqual(cached);
    });
  });

  describe('removeTeacher', () => {
    test('throws ForbiddenException for class teacher', () => {
      const builder = createMockQueryBuilder({
        data: { is_class_teacher: true },
        error: null,
      });
      mockSupabase = createMockSupabaseService();
      mockSupabase._client.schema = () => ({ from: () => builder });
      service = new ClassService(mockSupabase as any, mockCache as any);

      expect(service.removeTeacher('c1', 't1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
