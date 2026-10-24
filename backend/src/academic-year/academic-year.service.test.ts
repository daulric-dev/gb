import { describe, test, expect, beforeEach } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { AcademicYearService } from './academic-year.service';
import { createMockCacheService } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const YEAR_TTL = 60 * 60 * 24 * 30;
const SCHOOL_ID = 'school-abc';
const USER_ID = 'user-123';

/** A row as Prisma returns it. */
function dbYear(overrides: Record<string, any> = {}) {
  return {
    id: 'y1',
    school_id: SCHOOL_ID,
    name: '2025-2026',
    start_date: new Date('2025-09-01T00:00:00Z'),
    end_date: new Date('2026-06-30T00:00:00Z'),
    is_active: false,
    ...overrides,
  };
}

/** The same row as the API sends it. */
function apiYear(overrides: Record<string, any> = {}) {
  return {
    ...dbYear(),
    start_date: '2025-09-01',
    end_date: '2026-06-30',
    ...overrides,
  };
}

function setup(): MockPrisma {
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL_ID });
  return prisma;
}

describe('AcademicYearService', () => {
  let service: AcademicYearService;
  let prisma: MockPrisma;
  let mockCache: ReturnType<typeof createMockCacheService>;

  beforeEach(() => {
    mockCache = createMockCacheService();
    prisma = setup();
    service = new AcademicYearService(prisma as any, mockCache as any);
  });

  describe('create', () => {
    test('validates start_date before end_date', () => {
      expect(
        service.create(USER_ID, {
          name: '2025-2026',
          startDate: '2026-09-01',
          endDate: '2025-06-30',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    test('stores calendar dates and returns them as YYYY-MM-DD', async () => {
      prisma.academic_year.create.mockImplementation(async ({ data }) => ({
        id: 'y9',
        ...data,
      }));

      const result: any = await service.create(USER_ID, {
        name: '2025-2026',
        startDate: '2025-09-01',
        endDate: '2026-06-30',
      });

      const data = prisma.academic_year.create.mock.calls[0][0].data;
      expect(data.start_date.toISOString()).toBe('2025-09-01T00:00:00.000Z');
      expect(data.is_active).toBe(false);
      expect(result.start_date).toBe('2025-09-01');
      expect(data).not.toHaveProperty('grading_model');
    });
  });

  describe('findAll', () => {
    const rows = [
      dbYear({ id: 'y1' }),
      dbYear({ id: 'y2', name: '2024-2025' }),
    ];
    const years = [
      apiYear({ id: 'y1' }),
      apiYear({ id: 'y2', name: '2024-2025' }),
    ];

    test('returns cached data when available', async () => {
      await mockCache.set(`academic-years:${SCHOOL_ID}`, years, YEAR_TTL);

      const result = await service.findAll(USER_ID);
      expect(result).toEqual(years);
      expect(prisma.academic_year.findMany).not.toHaveBeenCalled();
    });

    test('fetches and caches on miss', async () => {
      prisma.academic_year.findMany.mockResolvedValue(rows);

      const result = await service.findAll(USER_ID);
      expect(result).toEqual(years);

      const cached = await mockCache.get(`academic-years:${SCHOOL_ID}`);
      expect(cached).toEqual(years);
    });
  });

  describe('findActive', () => {
    test('returns null when no active year', async () => {
      const result = await service.findActive(USER_ID);
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    test('calls cache.update on both list and active caches', async () => {
      const yearId = 'y1';
      prisma.academic_year.update.mockResolvedValue(
        dbYear({ id: yearId, name: 'Renamed' }),
      );
      const updatedYear = apiYear({ id: yearId, name: 'Renamed' });

      const existingList = [
        apiYear({ id: yearId, name: 'Old Name' }),
        apiYear({ id: 'y2', name: '2024-2025' }),
      ];
      const activeYear = apiYear({
        id: yearId,
        name: 'Old Name',
        is_active: true,
      });

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

      await service.update(USER_ID, yearId, { name: 'Renamed' });

      expect(prisma.academic_year.update.mock.calls[0][0].where).toEqual({
        id: yearId,
        school_id: SCHOOL_ID,
      });

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
      prisma.academic_year.update.mockResolvedValue(
        dbYear({ id: yearId, is_active: true }),
      );
      const activated = apiYear({ id: yearId, is_active: true });

      await mockCache.set(`academic-years:${SCHOOL_ID}`, [activated], YEAR_TTL);
      await mockCache.set(
        `academic-year-active:${SCHOOL_ID}`,
        activated,
        YEAR_TTL,
      );

      const result = await service.setActive(USER_ID, yearId);
      expect(result).toEqual(activated);

      // Every other year in the school is switched off in the same transaction.
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.academic_year.updateMany.mock.calls[0][0]).toEqual({
        where: { school_id: SCHOOL_ID },
        data: { is_active: false },
      });

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
      prisma.academic_year.update.mockResolvedValue(
        dbYear({ id: yearId, is_active: false }),
      );

      await mockCache.set(
        `academic-years:${SCHOOL_ID}`,
        [apiYear({ id: yearId })],
        YEAR_TTL,
      );
      await mockCache.set(
        `academic-year-active:${SCHOOL_ID}`,
        { id: yearId },
        YEAR_TTL,
      );

      await service.deactivate(USER_ID, yearId);

      const listCache = await mockCache.get(`academic-years:${SCHOOL_ID}`);
      const activeCache = await mockCache.get(
        `academic-year-active:${SCHOOL_ID}`,
      );
      expect(listCache).toBeNull();
      expect(activeCache).toBeNull();
    });
  });
});
