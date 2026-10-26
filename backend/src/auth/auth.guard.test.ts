import { describe, test, expect, mock } from 'bun:test';
import {
  ExecutionContext,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { expectRejection } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';

function makeContext() {
  const request: any = {};
  const reply: any = {};
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply,
    }),
  } as unknown as ExecutionContext;
  return { context, request };
}

let lastSessions: { revoke: ReturnType<typeof mock> };

/** The session lookup and the profile row (Prisma). */
function makeGuard(opts: { user?: any; getUserThrows?: Error; profile?: any }) {
  const sessions = {
    resolve: () => {
      if (opts.getUserThrows) return Promise.reject(opts.getUserThrows);
      const u = opts.user;
      return Promise.resolve(
        u ? { sessionId: 's1', userId: u.id, email: u.email } : null,
      );
    },
    revoke: mock(async () => {}),
  };
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue(opts.profile ?? null);
  lastSessions = sessions;
  return new AuthGuard(sessions as any, prisma as any);
}

const activeUser = { id: 'user-1', email: 'a@b.com' };

describe('AuthGuard', () => {
  test('allows an active user and attaches id, email and session to the request', async () => {
    const guard = makeGuard({
      user: activeUser,
      profile: { is_active: true },
    });
    const { context, request } = makeContext();

    expect(await guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual({
      id: 'user-1',
      email: 'a@b.com',
      sessionId: 's1',
    });
  });

  test('rejects a deactivated user even with a valid session', async () => {
    const guard = makeGuard({
      user: activeUser,
      profile: { is_active: false },
    });
    const { context, request } = makeContext();

    expect(await expectRejection(guard.canActivate(context))).toBeInstanceOf(
      UnauthorizedException,
    );
    expect(request.user).toBeUndefined();
    // The session ends with it, clearing the cookie.
    expect(lastSessions.revoke).toHaveBeenCalled();
  });

  test('allows a brand-new user with no profile row yet (mid-onboarding)', async () => {
    // No row: must NOT lock the user out.
    const guard = makeGuard({
      user: activeUser,
      profile: null,
    });
    const { context } = makeContext();

    expect(await guard.canActivate(context)).toBe(true);
  });

  test('allows when is_active is absent on the row (only explicit false blocks)', async () => {
    const guard = makeGuard({
      user: activeUser,
      profile: { id: 'user-1' },
    });
    const { context } = makeContext();

    expect(await guard.canActivate(context)).toBe(true);
  });

  test('rejects when there is no valid session', async () => {
    const guard = makeGuard({ user: null });
    const { context } = makeContext();

    expect(await expectRejection(guard.canActivate(context))).toBeInstanceOf(
      UnauthorizedException,
    );
  });

  test('a database or cache outage is a 503, never a 401 that signs people out', async () => {
    const guard = makeGuard({ getUserThrows: new Error('network down') });
    const { context } = makeContext();

    const err = await expectRejection(guard.canActivate(context));
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err).not.toBeInstanceOf(UnauthorizedException);
  });

  test('re-throws an UnauthorizedException from the session lookup as-is', async () => {
    const guard = makeGuard({
      getUserThrows: new UnauthorizedException('expired'),
    });
    const { context } = makeContext();

    expect(await expectRejection(guard.canActivate(context))).toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
