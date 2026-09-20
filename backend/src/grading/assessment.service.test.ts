import { describe, test, expect, beforeEach } from 'bun:test';
import { AssessmentService } from './assessment.service';
import {
  createMockSupabaseService,
  createMockCacheService,
} from '@/test/mocks';

/**
 * Assessments are read-only here now: they are created by publishing work, and
 * the activity endpoints own the rest of their lifecycle.
 */
describe('AssessmentService', () => {
  let service: AssessmentService;
  let mockSupabase: ReturnType<typeof createMockSupabaseService>;

  const req = { cookies: {} } as any;
  const reply = { setCookie: () => undefined } as any;

  beforeEach(() => {
    mockSupabase = createMockSupabaseService({
      queryResult: { data: [{ id: 'a1', title: 'Quiz 1' }], error: null },
    });
    service = new AssessmentService(
      mockSupabase as any,
      createMockCacheService() as any,
    );
  });

  test('findByTermAndSubject returns assessments from DB', async () => {
    const result = await service.findByTermAndSubject('t1', 's1', req, reply);
    expect(result).toEqual([{ id: 'a1', title: 'Quiz 1' }]);
  });

  test('nothing on this service writes an assessment', () => {
    for (const method of ['create', 'update', 'delete', 'exclude']) {
      expect(
        (service as unknown as Record<string, unknown>)[method],
      ).toBeUndefined();
    }
  });
});
