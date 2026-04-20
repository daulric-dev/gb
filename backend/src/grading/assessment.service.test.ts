import { describe, test, expect, beforeEach } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import { AssessmentService } from './assessment.service';
import {
  createMockSupabaseService,
  createMockCacheService,
  createMockQueryBuilder,
} from '@/test/mocks';

describe('AssessmentService', () => {
  let service: AssessmentService;
  let mockSupabase: ReturnType<typeof createMockSupabaseService>;
  let mockCache: ReturnType<typeof createMockCacheService>;

  const userId = 'user-1';
  const token = 'tok';

  beforeEach(() => {
    mockSupabase = createMockSupabaseService({
      queryResult: { data: { id: 'a1', title: 'Quiz 1' }, error: null },
    });
    mockCache = createMockCacheService();
    service = new AssessmentService(mockSupabase as any, mockCache as any);
  });

  test('create invalidates calc caches on success', async () => {
    await mockCache.set('calc:foo', 'bar', 300);
    await mockCache.set('other:key', 'keep', 300);

    await service.create(
      userId,
      {
        termId: 't1',
        subjectId: 's1',
        title: 'Quiz 1',
        assessmentType: 'coursework',
        maxScore: 100,
      } as any,
      token,
    );

    expect(await mockCache.get('calc:foo')).toBeNull();
    expect(await mockCache.get('other:key')).toBe('keep');
  });

  test('create throws ForbiddenException on RLS error (code 42501)', () => {
    const rlsBuilder = createMockQueryBuilder({
      data: null,
      error: { code: '42501', message: 'row-level security' },
    });
    mockSupabase.createUserClient = () =>
      ({
        from: () => rlsBuilder,
        schema: () => ({ from: () => rlsBuilder }),
      }) as any;

    expect(
      service.create(
        userId,
        {
          termId: 't1',
          subjectId: 's1',
          title: 'Quiz 1',
          assessmentType: 'coursework',
          maxScore: 100,
        } as any,
        token,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  test('findByTermAndSubject returns assessments from DB', async () => {
    const rows = [{ id: 'a1' }, { id: 'a2' }];
    const builder = createMockQueryBuilder({ data: rows, error: null });
    mockSupabase.createUserClient = () =>
      ({ from: () => builder, schema: () => ({ from: () => builder }) }) as any;

    const result = await service.findByTermAndSubject('t1', 's1', token);
    expect(result).toEqual(rows);
  });

  test('update invalidates calc caches', async () => {
    await mockCache.set('calc:x', 'y', 300);

    await service.update('a1', { title: 'Updated' } as any, token);

    expect(await mockCache.get('calc:x')).toBeNull();
  });

  test('delete invalidates calc caches', async () => {
    const builder = createMockQueryBuilder({ data: null, error: null });
    mockSupabase.createUserClient = () =>
      ({ from: () => builder, schema: () => ({ from: () => builder }) }) as any;

    await mockCache.set('calc:z', 'w', 300);

    await service.delete('a1', token);

    expect(await mockCache.get('calc:z')).toBeNull();
  });

  test('exclude invalidates calc caches', async () => {
    await mockCache.set('calc:m', 'n', 300);

    await service.exclude(
      'a1',
      { isExcluded: true, exclusionReason: 'test' } as any,
      token,
    );

    expect(await mockCache.get('calc:m')).toBeNull();
  });
});
