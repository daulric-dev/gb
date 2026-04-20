import { describe, test, expect, beforeEach } from 'bun:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { StudentService } from './student.service';
import { createMockSupabaseService, createMockCacheService, createMockQueryBuilder } from '@/test/mocks';

const STUDENT_TTL = 60 * 60 * 24 * 30;
const USER_ID = 'user-1';
const SCHOOL_ID = 'school-1';

const PROFILE = { school_id: SCHOOL_ID };

const AUTH_STUB = {
  signInWithOtp: async () => ({ data: null, error: null }),
  verifyOtp: async () => ({ data: null, error: null }),
  refreshSession: async () => ({ data: null, error: null }),
  admin: {
    deleteUser: async () => ({ data: null, error: null }),
    signOut: async () => ({ data: null, error: null }),
  },
};
const STORAGE_STUB = {
  from: () => ({
    upload: async () => ({ data: null, error: null }),
    download: async () => ({ data: null, error: null }),
  }),
};

function makeStudent(overrides: Record<string, any> = {}) {
  return {
    id: 'student-1',
    school_id: SCHOOL_ID,
    first_name: 'John',
    last_name: 'Doe',
    gender: 'male',
    date_of_birth: null,
    enrollement_date: null,
    ...overrides,
  };
}

function makeDto(overrides: Record<string, any> = {}) {
  return {
    firstName: 'John',
    lastName: 'Doe',
    gender: 'male',
    ...overrides,
  };
}

describe('StudentService', () => {
  let service: StudentService;
  let mockSupabase: ReturnType<typeof createMockSupabaseService>;
  let mockCache: ReturnType<typeof createMockCacheService>;

  beforeEach(() => {
    mockCache = createMockCacheService();
  });

  describe('create', () => {
    test('throws ConflictException if student with same name exists', async () => {
      const profileBuilder = createMockQueryBuilder({
        data: PROFILE,
        error: null,
      });
      const existingBuilder = createMockQueryBuilder({
        data: { id: 'existing-1' },
        error: null,
      });

      let callCount = 0;
      const client = {
        from: () => {
          callCount++;
          return profileBuilder;
        },
        schema: () => ({
          from: () => {
            return existingBuilder;
          },
        }),
        auth: AUTH_STUB,
        storage: STORAGE_STUB,
      };
      mockSupabase = {
        getServiceClient: () => client,
        createUserClient: () => client,
        _client: client,
        _builder: existingBuilder,
      };
      service = new StudentService(mockSupabase as any, mockCache as any);

      expect(service.create(USER_ID, makeDto() as any)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    test('uses cache.update to append and sort', async () => {
      const student = makeStudent();
      const profileBuilder = createMockQueryBuilder({
        data: PROFILE,
        error: null,
      });
      const nullBuilder = createMockQueryBuilder({
        data: null,
        error: null,
      });
      const insertBuilder = createMockQueryBuilder({
        data: student,
        error: null,
      });

      let schemaCallCount = 0;
      const client = {
        from: () => profileBuilder,
        schema: () => ({
          from: () => {
            schemaCallCount++;
            return schemaCallCount === 1 ? nullBuilder : insertBuilder;
          },
        }),
        auth: AUTH_STUB,
        storage: STORAGE_STUB,
      };
      mockSupabase = {
        getServiceClient: () => client,
        createUserClient: () => client,
        _client: client,
        _builder: insertBuilder,
      };
      service = new StudentService(mockSupabase as any, mockCache as any);

      const existing = [makeStudent({ id: 'student-0', first_name: 'Alice', last_name: 'Adams' })];
      await mockCache.set(`students:${SCHOOL_ID}`, existing, STUDENT_TTL);

      await service.create(USER_ID, makeDto() as any);

      const cached = await mockCache.get(`students:${SCHOOL_ID}`);
      expect(cached).toHaveLength(2);
      expect(cached[0].last_name).toBe('Adams');
      expect(cached[1].last_name).toBe('Doe');
    });
  });

  describe('findAll', () => {
    test('returns cached data on hit (no search)', async () => {
      mockSupabase = createMockSupabaseService({
        queryResult: { data: PROFILE, error: null },
      });
      service = new StudentService(mockSupabase as any, mockCache as any);

      const students = [makeStudent()];
      await mockCache.set(`students:${SCHOOL_ID}`, students, STUDENT_TTL);

      const result = await service.findAll(USER_ID);
      expect(result).toEqual(students);
    });

    test('skips cache when search is provided', async () => {
      const students = [makeStudent()];

      const profileBuilder = createMockQueryBuilder({
        data: PROFILE,
        error: null,
      });
      const searchBuilder = createMockQueryBuilder({
        data: students,
        error: null,
      });

      const client = {
        from: () => profileBuilder,
        schema: () => ({
          from: () => searchBuilder,
        }),
        auth: AUTH_STUB,
        storage: STORAGE_STUB,
      };
      mockSupabase = {
        getServiceClient: () => client,
        createUserClient: () => client,
        _client: client,
        _builder: searchBuilder,
      };
      service = new StudentService(mockSupabase as any, mockCache as any);

      await mockCache.set(`students:${SCHOOL_ID}`, [makeStudent({ id: 'old' })], STUDENT_TTL);

      const result = await service.findAll(USER_ID, 'John');
      expect(result).toEqual(students);

      const cached = await mockCache.get(`students:${SCHOOL_ID}`);
      expect(cached[0].id).toBe('old');
    });
  });

  describe('update', () => {
    test('uses cache.update to replace record in list', async () => {
      const original = makeStudent();
      const updated = makeStudent({ first_name: 'Jane' });

      mockSupabase = createMockSupabaseService({
        queryResult: { data: updated, error: null },
      });
      service = new StudentService(mockSupabase as any, mockCache as any);

      await mockCache.set(`students:${SCHOOL_ID}`, [original], STUDENT_TTL);

      await service.update('student-1', { firstName: 'Jane' } as any);

      const cached = await mockCache.get(`students:${SCHOOL_ID}`);
      expect(cached[0].first_name).toBe('Jane');
    });

    test('throws NotFoundException when student not found', async () => {
      mockSupabase = createMockSupabaseService({
        queryResult: { data: null, error: null },
      });
      service = new StudentService(mockSupabase as any, mockCache as any);

      expect(
        service.update('nonexistent', { firstName: 'Jane' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
