import { describe, test, expect, beforeEach } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { SchoolService } from './school.service';
import { createMockSupabaseService, createMockCacheService } from '@/test/mocks';

const SCHOOL_TTL = 60 * 60 * 24 * 30;

describe('SchoolService', () => {
  let service: SchoolService;
  let mockSupabase: ReturnType<typeof createMockSupabaseService>;
  let mockCache: ReturnType<typeof createMockCacheService>;

  beforeEach(() => {
    mockSupabase = createMockSupabaseService();
    mockCache = createMockCacheService();
    service = new SchoolService(mockSupabase as any, mockCache as any);
  });

  describe('findAll', () => {
    const schools = [
      { id: '1', name: 'Alpha School', parish: 'Kingston', school_type: 'primary' },
      { id: '2', name: 'Beta School', parish: 'Portland', school_type: 'secondary' },
    ];

    test('returns cached data when available', async () => {
      await mockCache.set('schools:all', schools, SCHOOL_TTL);

      const result = await service.findAll();
      expect(result).toEqual(schools);
    });

    test('fetches from DB and caches when not cached', async () => {
      mockSupabase = createMockSupabaseService({
        queryResult: { data: schools, error: null },
      });
      service = new SchoolService(mockSupabase as any, mockCache as any);

      const result = await service.findAll();
      expect(result).toEqual(schools);

      const cached = await mockCache.get('schools:all');
      expect(cached).toEqual(schools);
    });
  });

  describe('create', () => {
    const newSchool = { id: '3', name: 'Gamma School', parish: 'St. Ann', school_type: 'primary' };

    test('calls cache.update to append new school to list', async () => {
      const existing = [{ id: '1', name: 'Alpha School' }];
      await mockCache.set('schools:all', existing, SCHOOL_TTL);

      mockSupabase = createMockSupabaseService({
        queryResult: { data: newSchool, error: null },
      });
      service = new SchoolService(mockSupabase as any, mockCache as any);

      await service.create({
        name: 'Gamma School',
        schoolType: 'primary',
        parish: 'St. Ann',
      } as any);

      const cached = await mockCache.get('schools:all');
      expect(cached).toBeArray();
      expect(cached).toHaveLength(2);
      expect(cached.some((s: any) => s.id === '3')).toBe(true);
    });

    test('throws on DB error', async () => {
      mockSupabase = createMockSupabaseService({
        queryResult: { data: null, error: { message: 'duplicate key' } },
      });
      service = new SchoolService(mockSupabase as any, mockCache as any);

      expect(
        service.create({
          name: 'Fail School',
          schoolType: 'primary',
          parish: 'Kingston',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
