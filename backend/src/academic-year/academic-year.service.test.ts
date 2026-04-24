import { describe, test, expect, beforeEach } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { AcademicYearService } from './academic-year.service';
import {
  createMockSupabaseService,
  createMockCacheService,
} from '@/test/mocks';

const YEAR_TTL = 60 * 60 * 24 * 30;
const SCHOOL_ID = 'school-abc';
const USER_ID = 'user-123';

function setupWithSchoolId(overrides: Record<string, any> = {}) {
  const profileResult = { data: { school_id: SCHOOL_ID }, error: null };
  const mockSupabase = createMockSupabaseService({
    queryResult: overrides.queryResult ?? profileResult,
  });

  if (overrides.queryResult) {
    let callCount = 0;
    const originalSingle = mockSupabase._builder.single;
    mockSupabase._builder.single = () => {
      callCount++;
      if (callCount === 1) return Promise.resolve(profileResult);
      return originalSingle();
    };
  }

  return mockSupabase;
}

describe('AcademicYearService', () => {
  let service: AcademicYearService;
  let mockSupabase: ReturnType<typeof createMockSupabaseService>;
  let mockCache: ReturnType<typeof createMockCacheService>;

  beforeEach(() => {
    mockCache = createMockCacheService();
  });

  describe('create', () => {
    test('validates year_based weights must sum to 100', () => {
      mockSupabase = createMockSupabaseService();
      service = new AcademicYearService(mockSupabase as any, mockCache as any);

      expect(
        service.create(USER_ID, {
          name: '2025-2026',
          startDate: '2025-09-01',
          endDate: '2026-06-30',
          gradingModel: 'year_based',
          yearExamWeight: 40,
          yearCourseworkWeight: 40,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    test('validates start_date before end_date', () => {
      mockSupabase = createMockSupabaseService();
      service = new AcademicYearService(mockSupabase as any, mockCache as any);

      expect(
        service.create(USER_ID, {
          name: '2025-2026',
          startDate: '2026-09-01',
          endDate: '2025-06-30',
          gradingModel: 'term_based',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findAll', () => {
    const years = [
      { id: 'y1', name: '2025-2026', school_id: SCHOOL_ID },
      { id: 'y2', name: '2024-2025', school_id: SCHOOL_ID },
    ];

    test('returns cached data when available', async () => {
      mockSupabase = createMockSupabaseService({
        queryResult: { data: { school_id: SCHOOL_ID }, error: null },
      });
      service = new AcademicYearService(mockSupabase as any, mockCache as any);

      await mockCache.set(`academic-years:${SCHOOL_ID}`, years, YEAR_TTL);

      const result = await service.findAll(USER_ID);
      expect(result).toEqual(years);
    });

    test('fetches and caches on miss', async () => {
      mockSupabase = setupWithSchoolId({
        queryResult: { data: years, error: null },
      });
      service = new AcademicYearService(mockSupabase as any, mockCache as any);

      const result = await service.findAll(USER_ID);
      expect(result).toEqual(years);

      const cached = await mockCache.get(`academic-years:${SCHOOL_ID}`);
      expect(cached).toEqual(years);
    });
  });

  describe('findActive', () => {
    test('returns null when no active year', async () => {
      mockSupabase = createMockSupabaseService({
        queryResult: { data: { school_id: SCHOOL_ID }, error: null },
      });
      mockSupabase._builder.maybeSingle = () =>
        Promise.resolve({ data: null, error: null });
      service = new AcademicYearService(mockSupabase as any, mockCache as any);

      const result = await service.findActive(USER_ID);
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    test('calls cache.update on both list and active caches', async () => {
      const yearId = 'y1';
      const updatedYear = { id: yearId, name: 'Renamed', school_id: SCHOOL_ID };

      mockSupabase = createMockSupabaseService({
        queryResult: { data: updatedYear, error: null },
      });
      service = new AcademicYearService(mockSupabase as any, mockCache as any);

      const existingList = [
        { id: yearId, name: 'Old Name', school_id: SCHOOL_ID },
        { id: 'y2', name: '2024-2025', school_id: SCHOOL_ID },
      ];
      const activeYear = {
        id: yearId,
        name: 'Old Name',
        school_id: SCHOOL_ID,
        is_active: true,
      };

      await mockCache.set(
        `academic-years:${SCHOOL_ID}`,
        existingList,
        YEAR_TTL,
      );
      await mockCache.set(
        `academic-year-active:${SCHOOL_ID}`,
        activeYear,
        YEAR_TTL,
      );

      await service.update(yearId, { name: 'Renamed' });

      const cachedList = await mockCache.get(`academic-years:${SCHOOL_ID}`);
      expect(cachedList[0]).toEqual(updatedYear);

      const cachedActive = await mockCache.get(
        `academic-year-active:${SCHOOL_ID}`,
      );
      expect(cachedActive).toEqual(updatedYear);
    });
  });

  describe('setActive', () => {
    test('calls deleteByPrefix to invalidate all academic-year caches', async () => {
      const yearId = 'y1';
      const activated = {
        id: yearId,
        name: '2025-2026',
        school_id: SCHOOL_ID,
        is_active: true,
      };

      mockSupabase = setupWithSchoolId({
        queryResult: { data: activated, error: null },
      });
      service = new AcademicYearService(mockSupabase as any, mockCache as any);

      await mockCache.set(`academic-years:${SCHOOL_ID}`, [activated], YEAR_TTL);
      await mockCache.set(
        `academic-year-active:${SCHOOL_ID}`,
        activated,
        YEAR_TTL,
      );

      await service.setActive(USER_ID, yearId);

      const listCache = await mockCache.get(`academic-years:${SCHOOL_ID}`);
      const activeCache = await mockCache.get(
        `academic-year-active:${SCHOOL_ID}`,
      );
      expect(listCache).toBeNull();
      expect(activeCache).toBeNull();
    });
  });

  describe('deactivate', () => {
    test('calls deleteByPrefix to invalidate all academic-year caches', async () => {
      const yearId = 'y1';
      const deactivated = {
        id: yearId,
        name: '2025-2026',
        school_id: SCHOOL_ID,
        is_active: false,
      };

      mockSupabase = createMockSupabaseService({
        queryResult: { data: deactivated, error: null },
      });
      service = new AcademicYearService(mockSupabase as any, mockCache as any);

      await mockCache.set(
        `academic-years:${SCHOOL_ID}`,
        [deactivated],
        YEAR_TTL,
      );
      await mockCache.set(
        `academic-year-active:${SCHOOL_ID}`,
        { id: yearId },
        YEAR_TTL,
      );

      await service.deactivate(yearId);

      const listCache = await mockCache.get(`academic-years:${SCHOOL_ID}`);
      const activeCache = await mockCache.get(
        `academic-year-active:${SCHOOL_ID}`,
      );
      expect(listCache).toBeNull();
      expect(activeCache).toBeNull();
    });
  });
});
