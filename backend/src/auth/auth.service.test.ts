import { describe, test, expect, beforeEach } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  createMockSupabaseService,
  createMockCacheService,
  createRoutingSupabase,
  expectRejection,
} from '@/test/mocks';

/** True if any recorded query attempted to grant admin rights. */
function grantedAdmin(calls: any[]): boolean {
  return calls.some(
    (c) =>
      c.table === 'school_management' ||
      (c.payload &&
        (Array.isArray(c.payload) ? c.payload : [c.payload]).some(
          (p: any) => p?.role === 'admin' || p?.role === 'admi-',
        )),
  );
}

describe('AuthService', () => {
  let service: AuthService;
  let mockSupabase: ReturnType<typeof createMockSupabaseService>;
  let mockCache: ReturnType<typeof createMockCacheService>;

  beforeEach(() => {
    mockSupabase = createMockSupabaseService();
    mockCache = createMockCacheService();
    service = new AuthService(mockSupabase as any, mockCache as any);
  });

  describe('sendOtp', () => {
    test('returns success message when Supabase succeeds', async () => {
      const result = await service.sendOtp('test@example.com');
      expect(result).toBe('OTP sent to email');
    });

    test('throws BadRequestException on error', () => {
      mockSupabase = createMockSupabaseService({
        authResult: { data: null, error: { message: 'rate limited' } },
      });
      service = new AuthService(mockSupabase as any, mockCache as any);

      expect(service.sendOtp('test@example.com')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('getProfile', () => {
    const userId = 'user-123';

    function makeDbProfile(overrides: Record<string, any> = {}) {
      return {
        id: userId,
        first_name: 'John',
        school_id: 's1',
        school_management: [{ role: 'admin' }],
        ...overrides,
      };
    }

    test('returns cached profile if available', async () => {
      const cached = makeDbProfile({ school_management: { role: 'admin' } });
      await mockCache.set(`profile:${userId}`, cached, 1);

      const result = await service.getProfile(userId);
      expect(result).toEqual(cached);
    });

    test('fetches from DB and caches when not cached', async () => {
      const dbProfile = makeDbProfile();
      mockSupabase = createMockSupabaseService({
        queryResult: { data: dbProfile, error: null },
      });
      service = new AuthService(mockSupabase as any, mockCache as any);

      const result = await service.getProfile(userId);
      expect(result.id).toBe(userId);

      const stored = await mockCache.get(`profile:${userId}`);
      expect(stored).toEqual(result);
    });

    test('collapses a single school_management row to a scalar', async () => {
      const dbProfile = makeDbProfile({
        school_management: [{ role: 'admin' }],
      });
      mockSupabase = createMockSupabaseService({
        queryResult: { data: dbProfile, error: null },
      });
      service = new AuthService(mockSupabase as any, mockCache as any);

      const result = await service.getProfile(userId);
      expect(result.school_management).toEqual({ role: 'admin' });
    });

    test('keeps school_management as an array when there are multiple memberships', async () => {
      const memberships = [{ role: 'admin' }, { role: 'teacher' }];
      const dbProfile = makeDbProfile({ school_management: memberships });
      mockSupabase = createMockSupabaseService({
        queryResult: { data: dbProfile, error: null },
      });
      service = new AuthService(mockSupabase as any, mockCache as any);

      const result = await service.getProfile(userId);
      expect(result.school_management).toEqual(memberships);
    });

    test('keeps school_management as an empty array when there are no memberships', async () => {
      const dbProfile = makeDbProfile({ school_management: [] });
      mockSupabase = createMockSupabaseService({
        queryResult: { data: dbProfile, error: null },
      });
      service = new AuthService(mockSupabase as any, mockCache as any);

      const result = await service.getProfile(userId);
      expect(result.school_management).toEqual([]);
    });
  });

  describe('onboard', () => {
    test('stores profile in cache after upsert', async () => {
      const userId = 'user-456';
      const profile = { id: userId, first_name: 'Jane', school_id: 's1' };

      mockSupabase = createMockSupabaseService({
        queryResult: { data: profile, error: null },
      });
      service = new AuthService(mockSupabase as any, mockCache as any);

      await service.onboard(userId, {
        firstName: 'Jane',
        lastName: 'Doe',
        schoolId: 's1',
      });

      const cached = await mockCache.get(`profile:${userId}`);
      expect(cached).toEqual(profile);
    });

    describe('joining an existing school never self-elevates to admin', () => {
      const userId = 'user-join';

      function makeService(joinRequestResult: { data: any; error: any }) {
        const supabase = createRoutingSupabase({
          tables: {
            // user has no school yet -> not the school-creator branch
            'public.user_profile': (call) =>
              call.op === 'select'
                ? { data: { school_id: null }, error: null }
                : { data: { id: userId, first_name: 'Jane' }, error: null },
            'public.school_join_request': joinRequestResult,
          },
        });
        return {
          service: new AuthService(
            supabase as any,
            createMockCacheService() as any,
          ),
          supabase,
        };
      }

      test('creates a join request and grants no admin rights', async () => {
        const { service: svc, supabase } = makeService({
          data: { id: 'req-1', school_id: 's-orphan', status: 'pending' },
          error: null,
        });

        const result: any = await svc.onboard(userId, {
          firstName: 'Jane',
          lastName: 'Doe',
          schoolId: 's-orphan',
        });

        expect(result.joinRequest).toEqual({
          id: 'req-1',
          school_id: 's-orphan',
          status: 'pending',
        });
        expect(grantedAdmin(supabase._calls)).toBe(false);
      });

      test('never queries or writes school_management at all', async () => {
        const { service: svc, supabase } = makeService({
          data: { id: 'req-1', school_id: 's1', status: 'pending' },
          error: null,
        });

        await svc.onboard(userId, {
          firstName: 'Jane',
          lastName: 'Doe',
          schoolId: 's1',
        });

        expect(
          supabase._calls.some((c: any) => c.table === 'school_management'),
        ).toBe(false);
      });

      test('surfaces a join-request failure instead of falling back to admin', async () => {
        const { service: svc } = makeService({
          data: null,
          error: { message: 'insert failed' },
        });

        expect(
          await expectRejection(
            svc.onboard(userId, {
              firstName: 'Jane',
              lastName: 'Doe',
              schoolId: 's1',
            }),
          ),
        ).toBeInstanceOf(BadRequestException);
      });
    });
  });

  describe('updateProfile', () => {
    test('updates cache with new data', async () => {
      const userId = 'user-789';
      const updated = { id: userId, first_name: 'Updated', school_id: 's2' };

      mockSupabase = createMockSupabaseService({
        queryResult: { data: updated, error: null },
      });
      service = new AuthService(mockSupabase as any, mockCache as any);

      await service.updateProfile(userId, {
        firstName: 'Updated',
        lastName: 'Name',
      });

      const cached = await mockCache.get(`profile:${userId}`);
      expect(cached).toEqual(updated);
    });
  });

  describe('deleteAccount', () => {
    test('deletes cache key', async () => {
      const userId = 'user-del';
      await mockCache.set(`profile:${userId}`, { id: userId }, 1);

      const result = await service.deleteAccount(userId);
      expect(result).toBe('Account deleted successfully');

      const cached = await mockCache.get(`profile:${userId}`);
      expect(cached).toBeNull();
    });
  });
});
