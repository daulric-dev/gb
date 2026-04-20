import { describe, test, expect, beforeEach } from 'bun:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { TermService } from './term.service';
import { createMockSupabaseService, createMockCacheService, createMockQueryBuilder } from '@/test/mocks';

const TERM_TTL = 60 * 60 * 24 * 30;
const YEAR_ID = 'year-1';
const USER_ID = 'user-1';

function makeTerm(overrides: Record<string, any> = {}) {
  return {
    id: 'term-1',
    academic_year_id: YEAR_ID,
    name: 'michaelmas',
    start_date: '2025-09-01',
    end_date: '2025-12-15',
    exam_weight: 60,
    coursework_weight: 40,
    sort_order: 1,
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
  let mockSupabase: ReturnType<typeof createMockSupabaseService>;
  let mockCache: ReturnType<typeof createMockCacheService>;

  beforeEach(() => {
    mockCache = createMockCacheService();
  });

  describe('create', () => {
    test('validates weights sum to 100', async () => {
      mockSupabase = createMockSupabaseService();
      service = new TermService(mockSupabase as any, mockCache as any);

      const dto = makeDto({ examWeight: 50, courseworkWeight: 30 });
      expect(service.create(USER_ID, dto as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    test('validates start_date before end_date', async () => {
      mockSupabase = createMockSupabaseService();
      service = new TermService(mockSupabase as any, mockCache as any);

      const dto = makeDto({ startDate: '2025-12-15', endDate: '2025-09-01' });
      expect(service.create(USER_ID, dto as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    test('uses cache.update to append to term list', async () => {
      const term = makeTerm();
      mockSupabase = createMockSupabaseService({
        queryResult: { data: term, error: null },
      });
      service = new TermService(mockSupabase as any, mockCache as any);

      const existing = [makeTerm({ id: 'term-0', sort_order: 0 })];
      await mockCache.set(`terms:${YEAR_ID}`, existing, TERM_TTL);

      await service.create(USER_ID, makeDto() as any);

      const cached = await mockCache.get(`terms:${YEAR_ID}`);
      expect(cached).toHaveLength(2);
      expect(cached[1].id).toBe('term-1');
    });
  });

  describe('findByYear', () => {
    test('returns cached data on hit', async () => {
      mockSupabase = createMockSupabaseService();
      service = new TermService(mockSupabase as any, mockCache as any);

      const terms = [makeTerm()];
      await mockCache.set(`terms:${YEAR_ID}`, terms, TERM_TTL);

      const result = await service.findByYear(YEAR_ID);
      expect(result).toEqual(terms);
    });

    test('fetches and caches on miss', async () => {
      const terms = [makeTerm()];
      mockSupabase = createMockSupabaseService({
        queryResult: { data: terms, error: null },
      });
      service = new TermService(mockSupabase as any, mockCache as any);

      const result = await service.findByYear(YEAR_ID);
      expect(result).toEqual(terms);

      const cached = await mockCache.get(`terms:${YEAR_ID}`);
      expect(cached).toEqual(terms);
    });
  });

  describe('update', () => {
    test('uses cache.update to replace record in list', async () => {
      const original = makeTerm();
      const updated = makeTerm({ exam_weight: 70, coursework_weight: 30 });

      const findOneBuilder = createMockQueryBuilder({
        data: original,
        error: null,
      });
      const updateBuilder = createMockQueryBuilder({
        data: updated,
        error: null,
      });

      let callCount = 0;
      const baseClient = createMockSupabaseService()._client;
      const client = {
        ...baseClient,
        from: () => {
          callCount++;
          return callCount === 1 ? findOneBuilder : updateBuilder;
        },
      };
      mockSupabase = {
        getServiceClient: () => client,
        createUserClient: () => client,
        _client: client,
        _builder: updateBuilder,
      };
      service = new TermService(mockSupabase as any, mockCache as any);

      await mockCache.set(
        `terms:${YEAR_ID}`,
        [original],
        TERM_TTL,
      );

      await service.update('term-1', {
        examWeight: 70,
        courseworkWeight: 30,
      } as any);

      const cached = await mockCache.get(`terms:${YEAR_ID}`);
      expect(cached[0].exam_weight).toBe(70);
    });
  });

  describe('delete', () => {
    test('uses deleteByPrefix', async () => {
      mockSupabase = createMockSupabaseService({
        queryResult: { data: null, error: null },
      });
      service = new TermService(mockSupabase as any, mockCache as any);

      await mockCache.set(`terms:${YEAR_ID}`, [makeTerm()], TERM_TTL);
      await mockCache.set('terms:year-2', [makeTerm()], TERM_TTL);

      await service.delete('term-1');

      expect(await mockCache.get(`terms:${YEAR_ID}`)).toBeNull();
      expect(await mockCache.get('terms:year-2')).toBeNull();
    });
  });
});
