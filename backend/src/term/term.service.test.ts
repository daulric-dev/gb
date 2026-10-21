import { describe, test, expect, beforeEach } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TermService } from './term.service';
import { createMockCacheService } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const TERM_TTL = 60 * 60 * 24 * 30;
const YEAR_ID = 'year-1';
const USER_ID = 'user-1';

/** A term as Prisma returns it. */
function dbTerm(overrides: Record<string, any> = {}) {
  return {
    id: 'term-1',
    academic_year_id: YEAR_ID,
    name: 'michaelmas',
    start_date: new Date('2025-09-01T00:00:00Z'),
    end_date: new Date('2025-12-15T00:00:00Z'),
    is_ministry_reporting: false,
    exam_weight: 60,
    coursework_weight: 40,
    sort_order: 1,
    ...overrides,
  };
}

/** The same term as the API sends it. */
function makeTerm(overrides: Record<string, any> = {}) {
  return {
    ...dbTerm(),
    start_date: '2025-09-01',
    end_date: '2025-12-15',
    ...overrides,
  };
}

function makeDto(overrides: Record<string, any> = {}) {
  return {
    academicYearId: YEAR_ID,
    name: 'michaelmas' as const,
    startDate: '2025-09-01',
    endDate: '2025-12-15',
    examWeight: 60,
    courseworkWeight: 40,
    ...overrides,
  };
}

describe('TermService', () => {
  let service: TermService;
  let prisma: MockPrisma;
  let mockCache: ReturnType<typeof createMockCacheService>;

  beforeEach(() => {
    mockCache = createMockCacheService();
    prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
    prisma.academic_year.findFirst.mockResolvedValue({ id: YEAR_ID });
    service = new TermService(prisma as any, mockCache as any);
  });

  describe('create', () => {
    test('validates weights sum to 100', () => {
      const dto = makeDto({ examWeight: 50, courseworkWeight: 30 });
      expect(service.create(USER_ID, dto as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    test('validates start_date before end_date', () => {
      const dto = makeDto({ startDate: '2025-12-15', endDate: '2025-09-01' });
      expect(service.create(USER_ID, dto as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    test('rejects a year outside the caller school', async () => {
      prisma.academic_year.findFirst.mockResolvedValue(null);
      expect(service.create(USER_ID, makeDto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    test('maps a duplicate name to 409', async () => {
      prisma.term.create.mockRejectedValue(
        Object.assign(new Error('dup'), { code: '23505' }),
      );
      expect(service.create(USER_ID, makeDto())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    test('uses cache.update to append to term list', async () => {
      prisma.term.create.mockResolvedValue(dbTerm());

      const existing = [makeTerm({ id: 'term-0', sort_order: 0 })];
      await mockCache.set(`terms:${YEAR_ID}`, existing, TERM_TTL);

      const created = await service.create(USER_ID, makeDto());
      expect(created).toEqual(makeTerm());
      // Legacy names keep their fixed slot.
      expect(prisma.term.create.mock.calls[0][0].data.sort_order).toBe(1);

      const cached = await mockCache.get(`terms:${YEAR_ID}`);
      expect(cached).toHaveLength(2);
      expect(cached[1].id).toBe('term-1');
    });

    test('puts a custom-named term after the year existing terms', async () => {
      prisma.term.findFirst.mockResolvedValue({ sort_order: 4 });
      prisma.term.create.mockResolvedValue(dbTerm({ name: 'Summer' }));

      await service.create(USER_ID, makeDto({ name: 'Summer' }));
      expect(prisma.term.create.mock.calls[0][0].data.sort_order).toBe(5);
    });
  });

  describe('findByYear', () => {
    test('returns cached data on hit', async () => {
      const terms = [makeTerm()];
      await mockCache.set(`terms:${YEAR_ID}`, terms, TERM_TTL);

      const result = await service.findByYear(USER_ID, YEAR_ID);
      expect(result).toEqual(terms);
      expect(prisma.term.findMany).not.toHaveBeenCalled();
    });

    test('fetches and caches on miss', async () => {
      prisma.term.findMany.mockResolvedValue([dbTerm()]);
      const terms = [makeTerm()];

      const result = await service.findByYear(USER_ID, YEAR_ID);
      expect(result).toEqual(terms);

      const cached = await mockCache.get(`terms:${YEAR_ID}`);
      expect(cached).toEqual(terms);
    });
  });

  describe('findOne', () => {
    test('scopes the lookup to the caller school', async () => {
      prisma.term.findFirst.mockResolvedValue(dbTerm());
      expect(await service.findOne(USER_ID, 'term-1')).toEqual(makeTerm());
      expect(prisma.term.findFirst.mock.calls[0][0].where).toEqual({
        id: 'term-1',
        academic_year: { school_id: 'school-1' },
      });
    });

    test('is 404 when not found', async () => {
      expect(service.findOne(USER_ID, 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    test('uses cache.update to replace record in list', async () => {
      const original = makeTerm();
      prisma.term.findFirst.mockResolvedValue(dbTerm());
      prisma.term.update.mockResolvedValue(
        dbTerm({ exam_weight: 70, coursework_weight: 30 }),
      );

      await mockCache.set(`terms:${YEAR_ID}`, [original], TERM_TTL);

      await service.update(USER_ID, 'term-1', {
        examWeight: 70,
        courseworkWeight: 30,
      });

      const cached = await mockCache.get(`terms:${YEAR_ID}`);
      expect(cached[0].exam_weight).toBe(70);
    });

    test('checks weights against the stored values', async () => {
      prisma.term.findFirst.mockResolvedValue(dbTerm());
      expect(
        service.update(USER_ID, 'term-1', { examWeight: 70 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('delete', () => {
    test('invalidates the year cache only', async () => {
      const term = makeTerm();
      prisma.term.findFirst.mockResolvedValue(dbTerm());

      await mockCache.set(`terms:${YEAR_ID}`, [term], TERM_TTL);
      await mockCache.set('terms:year-2', [makeTerm()], TERM_TTL);

      await service.delete(USER_ID, 'term-1');

      expect(await mockCache.get(`terms:${YEAR_ID}`)).toBeNull();
      expect(await mockCache.get('terms:year-2')).not.toBeNull();
    });

    test('maps a foreign-key block to 409', async () => {
      prisma.term.findFirst.mockResolvedValue(dbTerm());
      prisma.term.deleteMany.mockRejectedValue(
        Object.assign(new Error('fk'), { code: '23503' }),
      );
      expect(service.delete(USER_ID, 'term-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
