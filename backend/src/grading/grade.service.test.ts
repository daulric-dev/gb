import { describe, test, expect, beforeEach } from 'bun:test';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { GradeService } from './grade.service';
import {
  createMockSupabaseService,
  createMockCacheService,
  createMockQueryBuilder,
} from '@/test/mocks';

describe('GradeService', () => {
  let service: GradeService;
  let mockSupabase: ReturnType<typeof createMockSupabaseService>;
  let mockCache: ReturnType<typeof createMockCacheService>;

  const userId = 'user-1';
  const req = { cookies: {} } as any;
  const reply = { setCookie: () => undefined } as any;

  beforeEach(() => {
    mockSupabase = createMockSupabaseService({
      queryResult: { data: { id: 'g1', score: 85 }, error: null },
    });
    mockCache = createMockCacheService();
    service = new GradeService(mockSupabase as any, mockCache as any);
  });

  test('create invalidates calc caches', async () => {
    await mockCache.set('calc:a', 'b', 300);

    await service.create(
      userId,
      {
        assessmentId: 'a1',
        studentId: 's1',
        score: 85,
      },
      req,
      reply,
    );

    expect(await mockCache.get('calc:a')).toBeNull();
  });

  test('create throws ConflictException on duplicate (23505)', () => {
    const builder = createMockQueryBuilder({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    mockSupabase.createUserClient = () =>
      ({ from: () => builder, schema: () => ({ from: () => builder }) }) as any;

    expect(
      service.create(
        userId,
        {
          assessmentId: 'a1',
          studentId: 's1',
          score: 85,
        } as any,
        req,
        reply,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  test('create throws ForbiddenException on RLS error', () => {
    const builder = createMockQueryBuilder({
      data: null,
      error: { code: '42501', message: 'row-level security' },
    });
    mockSupabase.createUserClient = () =>
      ({ from: () => builder, schema: () => ({ from: () => builder }) }) as any;

    expect(
      service.create(
        userId,
        {
          assessmentId: 'a1',
          studentId: 's1',
          score: 85,
        } as any,
        req,
        reply,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  test('bulkCreate invalidates calc caches', async () => {
    const builder = createMockQueryBuilder({ data: null, error: null });
    mockSupabase.createUserClient = () =>
      ({ from: () => builder, schema: () => ({ from: () => builder }) }) as any;

    await mockCache.set('calc:bulk', 'val', 300);

    const result = await service.bulkCreate(
      userId,
      {
        assessmentId: 'a1',
        grades: [
          { studentId: 's1', score: 90 },
          { studentId: 's2', score: 80 },
        ],
      },
      req,
      reply,
    );

    expect(result.graded).toBe(2);
    expect(await mockCache.get('calc:bulk')).toBeNull();
  });

  test('update invalidates calc caches', async () => {
    await mockCache.set('calc:u', 'v', 300);

    await service.update('g1', userId, { score: 90 }, req, reply);

    expect(await mockCache.get('calc:u')).toBeNull();
  });

  test('exclude invalidates calc caches', async () => {
    await mockCache.set('calc:e', 'f', 300);

    await service.exclude(
      'g1',
      userId,
      { isExcluded: true, exclusionReason: 'cheating' },
      req,
      reply,
    );

    expect(await mockCache.get('calc:e')).toBeNull();
  });
});
