import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockErasureLog } from '@/test/erasure-mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

/** No school in these tests requires single sign-on. */
const noSso = { ssoRequirement: async () => null } as any;

function emailCodeStub() {
  return {
    send: mock(async (_email: string) => {}),
    issue: mock(async (_email: string) => '12345678'),
    verify: mock(async (email: string, _code: string) => email.trim().toLowerCase()),
  };
}

function sessionStub() {
  return {
    create: mock(async () => 'token'),
    revoke: mock(async () => {}),
    revokeAll: mock(async (_userId: string) => {}),
  };
}

/** A profile row as Prisma returns it with its school relation. */
function dbProfile(overrides: Record<string, any> = {}) {
  return {
    id: 'user-1',
    school_id: null,
    first_name: null,
    email: null,
    school_user_profile_school_idToschool: null,
    ...overrides,
  };
}

/** True if any write tried to grant admin or touched school_management. */
function grantedAdmin(prisma: MockPrisma): boolean {
  const managementTouched = Object.values(prisma.school_management).some(
    (fn) => fn.mock.calls.length > 0,
  );
  const profileWrites = [
    ...prisma.user_profile.upsert.mock.calls.flatMap((c) => [
      c[0].create,
      c[0].update,
    ]),
    ...prisma.user_profile.update.mock.calls.map((c) => c[0].data),
  ];
  return managementTouched || profileWrites.some((d) => d?.role === 'admin');
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: MockPrisma;
  let mockCache: ReturnType<typeof createMockCacheService>;
  let emailCodes: ReturnType<typeof emailCodeStub>;
  let sessions: ReturnType<typeof sessionStub>;
  let accounts: { userForVerifiedEmail: ReturnType<typeof mock> };
  let erasure: ReturnType<typeof createMockErasureLog>;

  function build() {
    service = new AuthService(
      prisma as any,
      mockCache as any,
      noSso,
      emailCodes as any,
      accounts as any,
      sessions as any,
      erasure as any,
    );
  }

  beforeEach(() => {
    prisma = createMockPrisma();
    mockCache = createMockCacheService();
    emailCodes = emailCodeStub();
    sessions = sessionStub();
    erasure = createMockErasureLog();
    accounts = {
      userForVerifiedEmail: mock(async (email: string) => ({ id: 'user-otp', email })),
    };
    build();
  });

  describe('sendOtp', () => {
    test('sends a code and returns the success message', async () => {
      const result = await service.sendOtp('test@example.com', '1.2.3.4');
      expect(result).toBe('OTP sent to email');
      // The client address goes along: sends are capped per (address, client).
      expect(emailCodes.send).toHaveBeenCalledWith('test@example.com', '1.2.3.4');
    });

    test('a mail failure is a BadRequestException with the usual message', async () => {
      emailCodes.send.mockRejectedValue(new BadRequestException('smtp down'));
      const err = await expectRejection(service.sendOtp('test@example.com'));
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toBe('Failed to send OTP');
    });

    test('a rate limit keeps its 429', async () => {
      emailCodes.send.mockRejectedValue(
        new HttpException('Too many codes requested.', HttpStatus.TOO_MANY_REQUESTS),
      );
      const err: any = await expectRejection(service.sendOtp('test@example.com'));
      expect(err.getStatus()).toBe(429);
    });

    test('refuses when the school requires single sign-on', async () => {
      service = new AuthService(
        prisma as any,
        mockCache as any,
        { ssoRequirement: async () => ({ label: 'Google' }) } as any,
        emailCodes as any,
        accounts as any,
        sessions as any,
        erasure as any,
      );
      const err = await expectRejection(service.sendOtp('a@school.edu'));
      expect((err as Error).message).toContain('Continue with Google');
      expect(emailCodes.send).not.toHaveBeenCalled();
    });
  });

  describe('devCode', () => {
    const prev = { node: process.env.NODE_ENV, allow: process.env.ALLOW_DEV_LOGIN };
    afterEach(() => {
      process.env.NODE_ENV = prev.node;
      if (prev.allow === undefined) delete process.env.ALLOW_DEV_LOGIN;
      else process.env.ALLOW_DEV_LOGIN = prev.allow;
    });

    test('returns a code without mailing it when allowed', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ALLOW_DEV_LOGIN = 'true';
      expect(await service.devCode('a@b.com')).toEqual({ code: '12345678' });
      expect(emailCodes.send).not.toHaveBeenCalled();
    });

    test('is a 404 unless explicitly allowed, and always in production', async () => {
      for (const [node, allow] of [
        ['development', undefined],
        ['development', 'false'],
        ['production', 'true'],
      ] as const) {
        process.env.NODE_ENV = node;
        if (allow === undefined) delete process.env.ALLOW_DEV_LOGIN;
        else process.env.ALLOW_DEV_LOGIN = allow;
        expect(await expectRejection(service.devCode('a@b.com'))).toBeInstanceOf(
          NotFoundException,
        );
      }
      expect(emailCodes.issue).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    const userId = 'user-otp';
    const email = 'new@example.com';

    test('starts a session for the account and returns the usual shape', async () => {
      prisma.user_profile.findUnique.mockResolvedValue(
        dbProfile({ id: userId, email }),
      );
      const req = { ip: '1.2.3.4' } as any;
      const reply = {} as any;

      const result: any = await service.verifyOtp(email, '12345678', req, reply);

      // Wrong guesses are counted per (code, client address).
      expect(emailCodes.verify).toHaveBeenCalledWith(email, '12345678', '1.2.3.4');

      expect(accounts.userForVerifiedEmail).toHaveBeenCalledWith(email);
      expect(sessions.create).toHaveBeenCalledWith(reply, req, userId, 'email-code');
      expect(result.user).toEqual({ id: userId, email });
      expect(result.session.expires_in).toBeGreaterThan(0);
      expect(result.session.access_token).toBe('');
    });

    test('a wrong code is the usual 401 and starts no session', async () => {
      emailCodes.verify.mockRejectedValue(new UnauthorizedException('Invalid or expired code'));
      const err = await expectRejection(
        service.verifyOtp(email, '00000000', {} as any, {} as any),
      );
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect((err as Error).message).toBe('Invalid or expired OTP');
      expect(sessions.create).not.toHaveBeenCalled();
      expect(accounts.userForVerifiedEmail).not.toHaveBeenCalled();
    });

    test('persists the email when creating a new profile', async () => {
      prisma.user_profile.create.mockImplementation(async ({ data }) =>
        dbProfile(data),
      );

      const result: any = await service.verifyOtp(
        email,
        '123456',
        {} as any,
        {} as any,
      );

      expect(result.profile.email).toBe(email);
      expect(result.profile.school).toBeNull();
      expect(prisma.user_profile.create.mock.calls[0][0].data).toMatchObject({
        id: userId,
        email,
      });
    });

    test('backfills the email of an existing profile that has none', async () => {
      prisma.user_profile.findUnique.mockResolvedValue(
        dbProfile({ id: userId, email: null }),
      );
      prisma.user_profile.update.mockImplementation(async ({ data }) =>
        dbProfile({ id: userId, ...data }),
      );

      const result: any = await service.verifyOtp(
        email,
        '123456',
        {} as any,
        {} as any,
      );

      expect(result.profile.email).toBe(email);
      expect(prisma.user_profile.update.mock.calls[0][0].data).toMatchObject({
        email,
      });
    });

    test('leaves an existing profile that already has an email untouched', async () => {
      prisma.user_profile.findUnique.mockResolvedValue(
        dbProfile({ id: userId, email: 'old@example.com' }),
      );

      await service.verifyOtp(email, '123456', {} as any, {} as any);

      expect(prisma.user_profile.create).not.toHaveBeenCalled();
      expect(prisma.user_profile.update).not.toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    const userId = 'user-123';

    function makeDbProfile(overrides: Record<string, any> = {}) {
      return dbProfile({
        id: userId,
        first_name: 'John',
        email: 'john@example.com',
        school_id: 's1',
        school_user_profile_school_idToschool: { id: 's1', name: 'Demo' },
        school_management: [{ role: 'admin' }],
        ...overrides,
      });
    }

    test('returns cached profile if available', async () => {
      const cached = {
        id: userId,
        email: 'john@example.com',
        school_management: { role: 'admin' },
      };
      await mockCache.set(`profile:${userId}`, cached, 1);

      const result = await service.getProfile(userId);
      expect(result).toEqual(cached);
      expect(prisma.user_profile.findUnique).not.toHaveBeenCalled();
    });

    test('fetches from DB and caches when not cached', async () => {
      prisma.user_profile.findUnique.mockResolvedValue(makeDbProfile());

      const result = await service.getProfile(userId);
      expect(result.id).toBe(userId);
      // The school is embedded under `school`, as before.
      expect(result.school).toEqual({ id: 's1', name: 'Demo' });
      expect('school_user_profile_school_idToschool' in result).toBe(false);

      const stored = await mockCache.get(`profile:${userId}`);
      expect(stored).toEqual(result);
    });

    test('collapses a single school_management row to a scalar', async () => {
      prisma.user_profile.findUnique.mockResolvedValue(
        makeDbProfile({ school_management: [{ role: 'admin' }] }),
      );

      const result = await service.getProfile(userId);
      expect(result.school_management).toEqual({ role: 'admin' });
    });

    test('keeps school_management as an array when there are multiple memberships', async () => {
      const memberships = [{ role: 'admin' }, { role: 'teacher' }];
      prisma.user_profile.findUnique.mockResolvedValue(
        makeDbProfile({ school_management: memberships }),
      );

      const result = await service.getProfile(userId);
      expect(result.school_management).toEqual(memberships);
    });

    test('keeps school_management as an empty array when there are no memberships', async () => {
      prisma.user_profile.findUnique.mockResolvedValue(
        makeDbProfile({ school_management: [] }),
      );

      const result = await service.getProfile(userId);
      expect(result.school_management).toEqual([]);
    });

    test('ignores a cached profile with no email and re-fetches to backfill', async () => {
      // A profile cached before the email column existed must not short-circuit.
      await mockCache.set(
        `profile:${userId}`,
        { id: userId, email: null, school_management: { role: 'admin' } },
        1,
      );
      prisma.app_user.findUnique.mockResolvedValue({ email: 'backfilled@example.com' });
      prisma.user_profile.findUnique.mockResolvedValue(
        makeDbProfile({ email: null, school_management: [] }),
      );

      const result = await service.getProfile(userId);

      expect(result.email).toBe('backfilled@example.com');
      // re-fetched from the DB rather than returning the stale cache
      expect(prisma.user_profile.findUnique).toHaveBeenCalled();
    });

    test('backfills a null email from the auth user and persists it', async () => {
      prisma.app_user.findUnique.mockResolvedValue({ email: 'backfilled@example.com' });
      prisma.user_profile.findUnique.mockResolvedValue(
        makeDbProfile({ email: null, school_management: [] }),
      );

      const result = await service.getProfile(userId);

      expect(result.email).toBe('backfilled@example.com');

      // the email was written back to user_profile
      expect(prisma.user_profile.update.mock.calls[0][0]).toEqual({
        where: { id: userId },
        data: { email: 'backfilled@example.com' },
      });

      // and the backfilled profile is cached
      const cached = await mockCache.get(`profile:${userId}`);
      expect(cached.email).toBe('backfilled@example.com');
    });

    test('returns the profile even when the auth lookup yields no email', async () => {
      prisma.app_user.findUnique.mockResolvedValue(null);
      prisma.user_profile.findUnique.mockResolvedValue(
        makeDbProfile({ email: null, school_management: [] }),
      );

      const result = await service.getProfile(userId);

      expect(result.id).toBe(userId);
      expect(result.email).toBeNull();
      // no write attempted when there is no email to persist
      expect(prisma.user_profile.update).not.toHaveBeenCalled();
    });
  });

  describe('onboard', () => {
    test('stores profile in cache after upsert', async () => {
      const userId = 'user-456';
      prisma.user_profile.findUnique.mockResolvedValue({ school_id: 's1' });
      prisma.user_profile.upsert.mockResolvedValue(
        dbProfile({ id: userId, first_name: 'Jane', school_id: 's1' }),
      );

      await service.onboard(userId, {
        firstName: 'Jane',
        lastName: 'Doe',
        schoolId: 's1',
      });

      const cached = await mockCache.get(`profile:${userId}`);
      expect(cached).toEqual({
        id: userId,
        school_id: 's1',
        first_name: 'Jane',
        email: null,
        school: null,
      });
    });

    describe('joining an existing school never self-elevates to admin', () => {
      const userId = 'user-join';

      function setupJoin(joinRequest: any | Error) {
        // user has no school yet -> not the school-creator branch
        prisma.user_profile.findUnique.mockResolvedValue({ school_id: null });
        prisma.user_profile.upsert.mockResolvedValue(
          dbProfile({ id: userId, first_name: 'Jane' }),
        );
        if (joinRequest instanceof Error) {
          prisma.school_join_request.create.mockRejectedValue(joinRequest);
        } else {
          prisma.school_join_request.create.mockResolvedValue(joinRequest);
        }
      }

      test('creates a join request and grants no admin rights', async () => {
        setupJoin({ id: 'req-1', school_id: 's-orphan', status: 'pending' });

        const result: any = await service.onboard(userId, {
          firstName: 'Jane',
          lastName: 'Doe',
          schoolId: 's-orphan',
        });

        expect(result.joinRequest).toEqual({
          id: 'req-1',
          school_id: 's-orphan',
          status: 'pending',
        });
        expect(grantedAdmin(prisma)).toBe(false);
      });

      test('never queries or writes school_management at all', async () => {
        setupJoin({ id: 'req-1', school_id: 's1', status: 'pending' });

        await service.onboard(userId, {
          firstName: 'Jane',
          lastName: 'Doe',
          schoolId: 's1',
        });

        for (const fn of Object.values(prisma.school_management)) {
          expect(fn).not.toHaveBeenCalled();
        }
      });

      test('surfaces a join-request failure instead of falling back to admin', async () => {
        setupJoin(new Error('insert failed'));

        expect(
          await expectRejection(
            service.onboard(userId, {
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
        prisma.school.findFirst.mockResolvedValue({ id: 's1' });
        prisma.user_profile.upsert.mockImplementation(async ({ create }) =>
          dbProfile({ ...create, school_id: 's1' }),
        );
      });

      afterEach(() => {
        if (prevEnv === undefined) delete process.env.DEDICATED_DEPLOYMENT;
        else process.env.DEDICATED_DEPLOYMENT = prevEnv;
      });

      test('new user gets a teacher membership and profile role', async () => {
        const result: any = await service.onboard(userId, {
          firstName: 'Jane',
          lastName: 'Doe',
        });

        // user_profile mirrors the teacher role
        expect(result.role).toBe('teacher');

        // a canonical school_management row was inserted as teacher
        expect(
          prisma.school_management.create.mock.calls[0][0].data,
        ).toMatchObject({
          user_id: userId,
          school_id: 's1',
          role: 'teacher',
        });
      });

      test('preserves the school creator admin role and does not re-insert membership', async () => {
        prisma.school_management.findFirst.mockResolvedValue({ role: 'admin' });

        const result: any = await service.onboard(userId, {
          firstName: 'Admin',
          lastName: 'User',
        });

        expect(result.role).toBe('admin');
        expect(prisma.school_management.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('updateProfile', () => {
    test('updates cache with new data', async () => {
      const userId = 'user-789';
      prisma.user_profile.update.mockResolvedValue(
        dbProfile({ id: userId, first_name: 'Updated', school_id: 's2' }),
      );

      await service.updateProfile(userId, {
        firstName: 'Updated',
        lastName: 'Name',
      });

      const cached = await mockCache.get(`profile:${userId}`);
      expect(cached).toEqual({
        id: userId,
        school_id: 's2',
        first_name: 'Updated',
        email: null,
        school: null,
      });
    });
  });

  describe('deleteAccount', () => {
    test('deletes the profile, signs out everywhere and deletes the account', async () => {
      const userId = 'user-del';
      await service.deleteAccount(userId);
      expect(sessions.revokeAll).toHaveBeenCalledWith(userId, 'account_deleted');
      expect(prisma.app_user.deleteMany.mock.calls[0][0]).toEqual({ where: { id: userId } });
    });

    test('a failed profile cleanup leaves the account alone', async () => {
      prisma.user_profile.deleteMany.mockRejectedValue(new Error('fk'));
      expect(await expectRejection(service.deleteAccount('u'))).toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.app_user.deleteMany).not.toHaveBeenCalled();
    });

    test('deletes cache key', async () => {
      const userId = 'user-del';
      await mockCache.set(`profile:${userId}`, { id: userId }, 1);

      const result = await service.deleteAccount(userId);
      expect(result).toBe('Account deleted successfully');
      expect(prisma.user_profile.deleteMany.mock.calls[0][0]).toEqual({
        where: { id: userId },
      });

      const cached = await mockCache.get(`profile:${userId}`);
      expect(cached).toBeNull();
    });
  });
});
