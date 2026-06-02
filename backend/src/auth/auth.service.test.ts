import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
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

  describe('verifyOtp', () => {
    const userId = 'user-otp';
    const email = 'new@example.com';

    function makeService(
      userProfileRoute: (call: any) => { data: any; error: any },
    ) {
      const supabase = createRoutingSupabase({
        verifyOtpResult: {
          data: { session: { user: { id: userId, email } } },
          error: null,
        },
        tables: { 'public.user_profile': userProfileRoute },
      });
      return {
        service: new AuthService(
          supabase as any,
          createMockCacheService() as any,
        ),
        supabase,
      };
    }

    test('persists the email when creating a new profile', async () => {
      const { service: svc, supabase } = makeService((call) =>
        call.op === 'select'
          ? { data: null, error: null } // no existing profile
          : { data: { id: userId, email: call.payload.email }, error: null },
      );

      const result: any = await svc.verifyOtp(
        email,
        '123456',
        {} as any,
        {} as any,
      );

      expect(result.profile.email).toBe(email);
      const insert = supabase._calls.find(
        (c: any) => c.table === 'user_profile' && c.op === 'insert',
      );
      expect(insert?.payload).toMatchObject({ id: userId, email });
    });

    test('backfills the email of an existing profile that has none', async () => {
      const { service: svc, supabase } = makeService((call) =>
        call.op === 'select'
          ? { data: { id: userId, email: null }, error: null }
          : { data: { id: userId, email: call.payload.email }, error: null },
      );

      const result: any = await svc.verifyOtp(
        email,
        '123456',
        {} as any,
        {} as any,
      );

      expect(result.profile.email).toBe(email);
      const update = supabase._calls.find(
        (c: any) => c.table === 'user_profile' && c.op === 'update',
      );
      expect(update?.payload).toMatchObject({ email });
    });

    test('leaves an existing profile that already has an email untouched', async () => {
      const { service: svc, supabase } = makeService((call) =>
        call.op === 'select'
          ? { data: { id: userId, email: 'old@example.com' }, error: null }
          : { data: null, error: null },
      );

      await svc.verifyOtp(email, '123456', {} as any, {} as any);

      expect(
        supabase._calls.some(
          (c: any) =>
            c.table === 'user_profile' &&
            (c.op === 'insert' || c.op === 'update'),
        ),
      ).toBe(false);
    });
  });

  describe('getProfile', () => {
    const userId = 'user-123';

    function makeDbProfile(overrides: Record<string, any> = {}) {
      return {
        id: userId,
        first_name: 'John',
        email: 'john@example.com',
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

    test('ignores a cached profile with no email and re-fetches to backfill', async () => {
      // A profile cached before the email column existed must not short-circuit.
      await mockCache.set(
        `profile:${userId}`,
        makeDbProfile({ email: null, school_management: { role: 'admin' } }),
        1,
      );

      const supabase = createRoutingSupabase({
        getUserByIdResult: {
          data: { user: { id: userId, email: 'backfilled@example.com' } },
          error: null,
        },
        tables: {
          'public.user_profile': (call) =>
            call.op === 'select'
              ? {
                  data: { id: userId, email: null, school_management: [] },
                  error: null,
                }
              : { data: null, error: null },
        },
      });
      service = new AuthService(supabase as any, mockCache as any);

      const result = await service.getProfile(userId);

      expect(result.email).toBe('backfilled@example.com');
      // re-fetched from the DB rather than returning the stale cache
      expect(supabase._calls.some((c: any) => c.table === 'user_profile')).toBe(
        true,
      );
    });

    test('backfills a null email from the auth user and persists it', async () => {
      const supabase = createRoutingSupabase({
        getUserByIdResult: {
          data: { user: { id: userId, email: 'backfilled@example.com' } },
          error: null,
        },
        tables: {
          'public.user_profile': (call) =>
            call.op === 'select'
              ? {
                  data: { id: userId, email: null, school_management: [] },
                  error: null,
                }
              : { data: null, error: null },
        },
      });
      service = new AuthService(supabase as any, mockCache as any);

      const result = await service.getProfile(userId);

      expect(result.email).toBe('backfilled@example.com');

      // the email was written back to user_profile
      const update = supabase._calls.find(
        (c: any) => c.table === 'user_profile' && c.op === 'update',
      );
      expect(update?.payload).toMatchObject({ email: 'backfilled@example.com' });

      // and the backfilled profile is cached
      const cached = await mockCache.get(`profile:${userId}`);
      expect(cached.email).toBe('backfilled@example.com');
    });

    test('returns the profile even when the auth lookup yields no email', async () => {
      const supabase = createRoutingSupabase({
        getUserByIdResult: { data: null, error: { message: 'not found' } },
        tables: {
          'public.user_profile': (call) =>
            call.op === 'select'
              ? {
                  data: { id: userId, email: null, school_management: [] },
                  error: null,
                }
              : { data: null, error: null },
        },
      });
      service = new AuthService(supabase as any, mockCache as any);

      const result = await service.getProfile(userId);

      expect(result.id).toBe(userId);
      expect(result.email).toBeNull();
      // no write attempted when there is no email to persist
      expect(
        supabase._calls.some(
          (c: any) => c.table === 'user_profile' && c.op === 'update',
        ),
      ).toBe(false);
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

    describe('dedicated deployment auto-joins the single school', () => {
      const userId = 'user-dedicated';
      let prevEnv: string | undefined;

      beforeEach(() => {
        prevEnv = process.env.DEDICATED_DEPLOYMENT;
        process.env.DEDICATED_DEPLOYMENT = 'true';
      });

      afterEach(() => {
        if (prevEnv === undefined) delete process.env.DEDICATED_DEPLOYMENT;
        else process.env.DEDICATED_DEPLOYMENT = prevEnv;
      });

      function makeService(membership: { data: any; error: any }) {
        const supabase = createRoutingSupabase({
          tables: {
            'public.school': { data: { id: 's1' }, error: null },
            'public.school_management': (call) =>
              call.op === 'select' ? membership : { data: null, error: null },
            'public.user_profile': (call) => ({
              data: { id: userId, ...call.payload, school_id: 's1' },
              error: null,
            }),
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

      test('new user gets a teacher membership and profile role', async () => {
        const { service: svc, supabase } = makeService({
          data: null,
          error: null,
        });

        const result: any = await svc.onboard(userId, {
          firstName: 'Jane',
          lastName: 'Doe',
        });

        // user_profile mirrors the teacher role
        expect(result.role).toBe('teacher');

        // a canonical school_management row was inserted as teacher
        const insert = supabase._calls.find(
          (c: any) => c.table === 'school_management' && c.op === 'insert',
        );
        expect(insert?.payload).toMatchObject({
          user_id: userId,
          school_id: 's1',
          role: 'teacher',
        });
      });

      test('preserves the school creator admin role and does not re-insert membership', async () => {
        const { service: svc, supabase } = makeService({
          data: { role: 'admin' },
          error: null,
        });

        const result: any = await svc.onboard(userId, {
          firstName: 'Admin',
          lastName: 'User',
        });

        expect(result.role).toBe('admin');
        expect(
          supabase._calls.some(
            (c: any) => c.table === 'school_management' && c.op === 'insert',
          ),
        ).toBe(false);
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
