import { describe, test, expect, beforeEach } from 'bun:test';
import { ConflictException } from '@nestjs/common';
import { SubjectService } from './subject.service';
import {
  createMockSupabaseService,
  createMockCacheService,
  createMockQueryBuilder,
} from '@/test/mocks';

const SUBJECT_TTL = 60 * 60 * 24 * 30;
const USER_ID = 'user-1';
const SCHOOL_ID = 'school-1';

const PROFILE = { school_id: SCHOOL_ID };

const CLIENT_STUBS = createMockSupabaseService()._client;

function makeSubject(overrides: Record<string, any> = {}) {
  return {
    id: 'subject-1',
    school_id: SCHOOL_ID,
    name: 'Mathematics',
    code: 'MATH',
    is_graded: true,
    sort_order: 1,
    ...overrides,
  };
}

function makeDto(overrides: Record<string, any> = {}) {
  return {
    name: 'Mathematics',
    code: 'MATH',
    isGraded: true,
    sortOrder: 1,
    ...overrides,
  };
}

describe('SubjectService', () => {
  let service: SubjectService;
  let mockSupabase: ReturnType<typeof createMockSupabaseService>;
  let mockCache: ReturnType<typeof createMockCacheService>;

  beforeEach(() => {
    mockCache = createMockCacheService();
  });

  describe('create', () => {
    test('throws ConflictException on duplicate (error code 23505)', () => {
      mockSupabase = createMockSupabaseService({
        queryResult: { data: PROFILE, error: null },
      });
      service = new SubjectService(mockSupabase as any, mockCache as any);

      const profileBuilder = createMockQueryBuilder({
        data: PROFILE,
        error: null,
      });
      const insertBuilder = createMockQueryBuilder({
        data: null,
        error: { code: '23505', message: 'duplicate' },
      });

      let callCount = 0;
      const client = {
        ...CLIENT_STUBS,
        from: () => {
          callCount++;
          return callCount === 1 ? profileBuilder : insertBuilder;
        },
      };
      mockSupabase = {
        getServiceClient: () => client,
        createUserClient: () => client,
        _client: client,
        _builder: insertBuilder,
      };
      service = new SubjectService(mockSupabase as any, mockCache as any);

      expect(service.create(USER_ID, makeDto() as any)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    test('uses cache.update to append and sort', async () => {
      const subject = makeSubject();
      const profileBuilder = createMockQueryBuilder({
        data: PROFILE,
        error: null,
      });
      const insertBuilder = createMockQueryBuilder({
        data: subject,
        error: null,
      });

      let callCount = 0;
      const client = {
        ...CLIENT_STUBS,
        from: () => {
          callCount++;
          return callCount === 1 ? profileBuilder : insertBuilder;
        },
      };
      mockSupabase = {
        getServiceClient: () => client,
        createUserClient: () => client,
        _client: client,
        _builder: insertBuilder,
      };
      service = new SubjectService(mockSupabase as any, mockCache as any);

      const existing = [
        makeSubject({ id: 'subject-0', name: 'Art', sort_order: 0 }),
      ];
      await mockCache.set(`subjects:${SCHOOL_ID}`, existing, SUBJECT_TTL);

      await service.create(USER_ID, makeDto());

      const cached = await mockCache.get(`subjects:${SCHOOL_ID}`);
      expect(cached).toHaveLength(2);
      expect(cached[0].name).toBe('Art');
      expect(cached[1].name).toBe('Mathematics');
    });
  });

  describe('findAll', () => {
    test('returns cached data on hit', async () => {
      mockSupabase = createMockSupabaseService({
        queryResult: { data: PROFILE, error: null },
      });
      service = new SubjectService(mockSupabase as any, mockCache as any);

      const subjects = [makeSubject()];
      await mockCache.set(`subjects:${SCHOOL_ID}`, subjects, SUBJECT_TTL);

      const result = await service.findAll(USER_ID);
      expect(result).toEqual(subjects);
    });

    test('fetches and caches on miss', async () => {
      const subjects = [makeSubject()];
      const profileBuilder = createMockQueryBuilder({
        data: PROFILE,
        error: null,
      });
      const queryBuilder = createMockQueryBuilder({
        data: subjects,
        error: null,
      });

      let callCount = 0;
      const client = {
        ...CLIENT_STUBS,
        from: () => {
          callCount++;
          return callCount === 1 ? profileBuilder : queryBuilder;
        },
      };
      mockSupabase = {
        getServiceClient: () => client,
        createUserClient: () => client,
        _client: client,
        _builder: queryBuilder,
      };
      service = new SubjectService(mockSupabase as any, mockCache as any);

      const result = await service.findAll(USER_ID);
      expect(result).toEqual(subjects);

      const cached = await mockCache.get(`subjects:${SCHOOL_ID}`);
      expect(cached).toEqual(subjects);
    });
  });

  describe('update', () => {
    test('uses cache.update to replace record', async () => {
      const original = makeSubject();
      const updated = makeSubject({ name: 'Maths' });

      mockSupabase = createMockSupabaseService({
        queryResult: { data: updated, error: null },
      });
      service = new SubjectService(mockSupabase as any, mockCache as any);

      await mockCache.set(`subjects:${SCHOOL_ID}`, [original], SUBJECT_TTL);

      await service.update('subject-1', { name: 'Maths' });

      const cached = await mockCache.get(`subjects:${SCHOOL_ID}`);
      expect(cached[0].name).toBe('Maths');
    });

    test('throws ConflictException on duplicate', () => {
      mockSupabase = createMockSupabaseService({
        queryResult: {
          data: null,
          error: { code: '23505', message: 'duplicate' },
        },
      });
      service = new SubjectService(mockSupabase as any, mockCache as any);

      expect(
        service.update('subject-1', { name: 'Existing' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('reorder', () => {
    test('uses deleteByPrefix', async () => {
      mockSupabase = createMockSupabaseService({
        queryResult: { data: null, error: null },
      });
      service = new SubjectService(mockSupabase as any, mockCache as any);

      await mockCache.set(
        `subjects:${SCHOOL_ID}`,
        [makeSubject()],
        SUBJECT_TTL,
      );

      await service.reorder({
        items: [{ id: 'subject-1', sortOrder: 2 }],
      });

      expect(await mockCache.get(`subjects:${SCHOOL_ID}`)).toBeNull();
    });
  });

  describe('delete', () => {
    test('uses deleteByPrefix', async () => {
      mockSupabase = createMockSupabaseService({
        queryResult: { data: null, error: null },
      });
      service = new SubjectService(mockSupabase as any, mockCache as any);

      await mockCache.set(
        `subjects:${SCHOOL_ID}`,
        [makeSubject()],
        SUBJECT_TTL,
      );
      await mockCache.set('subjects:school-2', [makeSubject()], SUBJECT_TTL);

      await service.delete('subject-1');

      expect(await mockCache.get(`subjects:${SCHOOL_ID}`)).toBeNull();
      expect(await mockCache.get('subjects:school-2')).toBeNull();
    });

    test('throws ConflictException on FK violation (error code 23503)', () => {
      mockSupabase = createMockSupabaseService({
        queryResult: {
          data: null,
          error: { code: '23503', message: 'foreign key violation' },
        },
      });
      service = new SubjectService(mockSupabase as any, mockCache as any);

      expect(service.delete('subject-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
