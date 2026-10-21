import { describe, test, expect, beforeEach } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { StudentService } from './student.service';
import { createMockCacheService } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const STUDENT_TTL = 60 * 60 * 24 * 30;
const USER_ID = 'user-1';
const SCHOOL_ID = 'school-1';

/** A student as the API sends it (and as Prisma returns it, dates aside). */
function makeStudent(overrides: Record<string, any> = {}) {
  return {
    id: 'student-1',
    school_id: SCHOOL_ID,
    first_name: 'John',
    last_name: 'Doe',
    gender: 'male',
    date_of_birth: null,
    enrollment_date: null,
    is_active: true,
    user_profile_id: null,
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
  let prisma: MockPrisma;
  let mockCache: ReturnType<typeof createMockCacheService>;

  beforeEach(() => {
    mockCache = createMockCacheService();
    prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL_ID });
    service = new StudentService(prisma as any, mockCache as any);
  });

  describe('create', () => {
    test('throws ConflictException if student with same name exists', () => {
      prisma.student.findFirst.mockResolvedValue({ id: 'existing-1' });

      expect(service.create(USER_ID, makeDto() as any)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    test('400 when the caller has no school', () => {
      prisma.user_profile.findUnique.mockResolvedValue({ school_id: null });
      expect(service.create(USER_ID, makeDto() as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    test('uses cache.update to append and sort', async () => {
      prisma.student.create.mockResolvedValue(
        makeStudent({ date_of_birth: new Date('2012-03-04T00:00:00Z') }),
      );

      const existing = [
        makeStudent({
          id: 'student-0',
          first_name: 'Alice',
          last_name: 'Adams',
        }),
      ];
      await mockCache.set(`students:${SCHOOL_ID}`, existing, STUDENT_TTL);

      const created = await service.create(
        USER_ID,
        makeDto({ dateOfBirth: '2012-03-04' }) as any,
      );
      expect(created.date_of_birth).toBe('2012-03-04');

      const cached = await mockCache.get(`students:${SCHOOL_ID}`);
      expect(cached).toHaveLength(2);
      expect(cached[0].last_name).toBe('Adams');
      expect(cached[1].last_name).toBe('Doe');
    });
  });

  describe('findAll', () => {
    test('returns cached data on hit (no search)', async () => {
      const students = [makeStudent()];
      await mockCache.set(`students:${SCHOOL_ID}`, students, STUDENT_TTL);

      const result = await service.findAll(USER_ID);
      expect(result).toEqual(students);
      expect(prisma.student.findMany).not.toHaveBeenCalled();
    });

    test('skips cache when search is provided', async () => {
      const students = [makeStudent()];
      prisma.student.findMany.mockResolvedValue(students);

      await mockCache.set(
        `students:${SCHOOL_ID}`,
        [makeStudent({ id: 'old' })],
        STUDENT_TTL,
      );

      const result = await service.findAll(USER_ID, 'Jo%h_n');
      expect(result).toEqual(students);
      // Wildcards are stripped from the search term.
      expect(prisma.student.findMany.mock.calls[0][0].where).toEqual({
        school_id: SCHOOL_ID,
        OR: [
          { first_name: { contains: 'John', mode: 'insensitive' } },
          { last_name: { contains: 'John', mode: 'insensitive' } },
        ],
      });

      const cached = await mockCache.get(`students:${SCHOOL_ID}`);
      expect(cached[0].id).toBe('old');
    });
  });

  describe('findAllPaginated', () => {
    test('offset mode returns the page with totals', async () => {
      prisma.student.findMany.mockResolvedValue([makeStudent()]);
      prisma.student.count.mockResolvedValue(21);

      const result = await service.findAllPaginated(USER_ID, {
        page: 2,
        pageSize: 10,
      });
      expect(prisma.student.findMany.mock.calls[0][0].skip).toBe(10);
      expect(result.meta).toEqual({
        total: 21,
        page: 2,
        pageSize: 10,
        pageCount: 3,
        nextCursor: null,
        hasMore: true,
      });
    });

    test('cursor mode fetches one extra row to detect more', async () => {
      prisma.student.findMany.mockResolvedValue([
        makeStudent({ id: 'a' }),
        makeStudent({ id: 'b' }),
      ]);
      prisma.student.count.mockResolvedValue(5);

      const result = await service.findAllPaginated(USER_ID, {
        cursor: '',
        pageSize: 1,
      });
      expect(prisma.student.findMany.mock.calls[0][0].take).toBe(2);
      expect(result.data).toHaveLength(1);
      expect(result.meta.nextCursor).toBe('a');
      expect(result.meta.hasMore).toBe(true);
    });
  });

  describe('update', () => {
    test('uses cache.update to replace record in list', async () => {
      const original = makeStudent();
      prisma.student.update.mockResolvedValue(
        makeStudent({ first_name: 'Jane' }),
      );

      await mockCache.set(`students:${SCHOOL_ID}`, [original], STUDENT_TTL);

      await service.update(USER_ID, 'student-1', { firstName: 'Jane' });

      expect(prisma.student.update.mock.calls[0][0].where).toEqual({
        id: 'student-1',
        school_id: SCHOOL_ID,
      });
      const cached = await mockCache.get(`students:${SCHOOL_ID}`);
      expect(cached[0].first_name).toBe('Jane');
    });

    test('throws NotFoundException when student not found', () => {
      prisma.student.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('No record', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      expect(
        service.update(USER_ID, 'nonexistent', { firstName: 'Jane' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('profile', () => {
    test('joins courses, account and guardians', async () => {
      prisma.student.findFirst.mockResolvedValue(
        makeStudent({ user_profile_id: 'acct-1' }),
      );
      prisma.course_student.findMany.mockResolvedValue([
        {
          status: 'completed',
          enrolled_at: new Date('2025-01-01T00:00:00Z'),
          course: { id: 'c2', name: 'Art', code: null, status: 'archived', term_id: null, academic_year_id: null },
        },
        {
          status: 'active',
          enrolled_at: new Date('2026-01-01T00:00:00Z'),
          course: { id: 'c1', name: 'Maths', code: 'M1', status: 'published', term_id: 't1', academic_year_id: 'y1' },
        },
      ]);
      prisma.user_profile.findUnique.mockImplementation(async ({ where }) =>
        where.id === 'acct-1'
          ? { id: 'acct-1', email: 'j@x', first_name: 'John', last_name: 'Doe', is_active: true, account_type: 'student' }
          : { school_id: SCHOOL_ID },
      );
      prisma.parent_student_link.findMany.mockResolvedValue([
        {
          user_profile_id: 'g1',
          relationship: 'mother',
          user_profile: { id: 'g1', first_name: 'Mary', last_name: 'Doe', email: 'm@x' },
        },
      ]);

      const result = await service.profile(USER_ID, 'student-1');
      expect(result.courses.map((c) => c.id)).toEqual(['c1', 'c2']);
      expect(result.courses[0].enrolledAt).toBe('2026-01-01T00:00:00.000Z');
      expect(result.account).toEqual({
        id: 'acct-1',
        email: 'j@x',
        name: 'John Doe',
        isActive: true,
        accountType: 'student',
      });
      expect(result.guardians).toEqual([
        { id: 'g1', name: 'Mary Doe', email: 'm@x', relationship: 'mother' },
      ]);
    });
  });
});
