import { describe, test, expect, beforeEach } from 'bun:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SchoolService } from './school.service';
import {
  createMockSupabaseService,
  createMockCacheService,
  createRoutingSupabase,
  expectRejection,
} from '@/test/mocks';

const SCHOOL_TTL = 60 * 60 * 24 * 30;

describe('SchoolService', () => {
  let service: SchoolService;
  let mockSupabase: ReturnType<typeof createMockSupabaseService>;
  let mockCache: ReturnType<typeof createMockCacheService>;

  beforeEach(() => {
    mockSupabase = createMockSupabaseService();
    mockCache = createMockCacheService();
    service = new SchoolService(mockSupabase as any, mockCache as any);
  });

  describe('findAll', () => {
    const schools = [
      {
        id: '1',
        name: 'Alpha School',
        parish: 'Kingston',
        school_type: 'primary',
      },
      {
        id: '2',
        name: 'Beta School',
        parish: 'Portland',
        school_type: 'secondary',
      },
    ];

    test('returns cached data when available', async () => {
      await mockCache.set('schools:all', schools, SCHOOL_TTL);

      const result = await service.findAll();
      expect(result).toEqual(schools);
    });

    test('fetches from DB and caches when not cached', async () => {
      mockSupabase = createMockSupabaseService({
        queryResult: { data: schools, error: null },
      });
      service = new SchoolService(mockSupabase as any, mockCache as any);

      const result = await service.findAll();
      expect(result).toEqual(schools);

      const cached = await mockCache.get('schools:all');
      expect(cached).toEqual(schools);
    });
  });

  describe('create', () => {
    const newSchool = {
      id: '3',
      name: 'Gamma School',
      parish: 'St. Ann',
      school_type: 'primary',
    };

    test('calls cache.update to append new school to list', async () => {
      const existing = [{ id: '1', name: 'Alpha School' }];
      await mockCache.set('schools:all', existing, SCHOOL_TTL);

      mockSupabase = createMockSupabaseService({
        queryResult: { data: newSchool, error: null },
      });
      service = new SchoolService(mockSupabase as any, mockCache as any);

      await service.create(
        {
          name: 'Gamma School',
          schoolType: 'primary',
        } as any,
        'user-1',
      );

      const cached = await mockCache.get('schools:all');
      expect(cached).toBeArray();
      expect(cached).toHaveLength(2);
      expect(cached.some((s: any) => s.id === '3')).toBe(true);
    });

    test('throws on DB error', () => {
      mockSupabase = createMockSupabaseService({
        queryResult: { data: null, error: { message: 'duplicate key' } },
      });
      service = new SchoolService(mockSupabase as any, mockCache as any);

      expect(
        service.create(
          {
            name: 'Fail School',
            schoolType: 'primary',
          } as any,
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('createJoinRequest', () => {
    const userId = 'user-join';
    const school = { id: 's1', name: 'Orphan School' };

    function makeService(opts: {
      school?: any;
      existingRequest?: any;
      insertResult?: { data: any; error: any };
    }) {
      const supabase = createRoutingSupabase({
        tables: {
          'public.school': {
            data: 'school' in opts ? opts.school : school,
            error: null,
          },
          'public.school_join_request': (call) =>
            call.op === 'insert'
              ? (opts.insertResult ?? {
                  data: {
                    id: 'req-1',
                    user_id: userId,
                    school_id: 's1',
                    status: 'pending',
                  },
                  error: null,
                })
              : { data: opts.existingRequest ?? null, error: null },
        },
      });
      return {
        service: new SchoolService(
          supabase as any,
          createMockCacheService() as any,
        ),
        supabase,
      };
    }

    test('creates a join request for a school that has no admin (no auto-takeover)', async () => {
      const { service: svc, supabase } = makeService({});
      const result: any = await svc.createJoinRequest(
        userId,
        's1',
        'let me in',
      );

      expect(result.id).toBe('req-1');
      expect(result.school).toEqual(school);
      // The core regression: joining must never grant admin.
      expect(
        supabase._calls.some((c: any) => c.table === 'school_management'),
      ).toBe(false);
    });

    test('never writes a role anywhere while joining', async () => {
      const { service: svc, supabase } = makeService({});
      await svc.createJoinRequest(userId, 's1');

      const wroteRole = supabase._calls.some(
        (c: any) =>
          c.payload &&
          (Array.isArray(c.payload) ? c.payload : [c.payload]).some(
            (p: any) => 'role' in (p ?? {}),
          ),
      );
      expect(wroteRole).toBe(false);
    });

    test('throws NotFound when the school does not exist', async () => {
      const { service: svc } = makeService({ school: null });
      expect(
        await expectRejection(svc.createJoinRequest(userId, 'missing')),
      ).toBeInstanceOf(NotFoundException);
    });

    test('rejects a duplicate pending request', async () => {
      const { service: svc } = makeService({
        existingRequest: { id: 'req-old', school_id: 's1' },
      });
      expect(
        await expectRejection(svc.createJoinRequest(userId, 's1')),
      ).toBeInstanceOf(BadRequestException);
    });

    test('surfaces an insert failure', async () => {
      const { service: svc } = makeService({
        insertResult: { data: null, error: { message: 'db down' } },
      });
      expect(
        await expectRejection(svc.createJoinRequest(userId, 's1')),
      ).toBeInstanceOf(BadRequestException);
    });
  });
});
