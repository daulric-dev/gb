import { describe, test, expect } from 'bun:test';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
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

/** The session lookup (still Supabase auth) and the profile row (Prisma). */
function makeGuard(opts: {
  user?: any;
  getUserThrows?: Error;
  profile?: any;
}) {
  const auth = {
    getUser: () => {
      if (opts.getUserThrows) return Promise.reject(opts.getUserThrows);
      return Promise.resolve(opts.user ?? null);
    },
  };
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue(opts.profile ?? null);
  return new AuthGuard(auth as any, prisma as any);
}

const activeUser = { id: 'user-1', email: 'a@b.com' };

describe('AuthGuard', () => {
  test('allows an active user and attaches id + email to the request', async () => {
    const guard = makeGuard({
      user: activeUser,
      profile: { is_active: true },
    });
    const { context, request } = makeContext();

    expect(await guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual({ id: 'user-1', email: 'a@b.com' });
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

  test('maps an unexpected getUser failure to UnauthorizedException', async () => {
    const guard = makeGuard({ getUserThrows: new Error('network down') });
    const { context } = makeContext();

    expect(await expectRejection(guard.canActivate(context))).toBeInstanceOf(
      UnauthorizedException,
    );
  });

  test('re-throws an UnauthorizedException from getUser as-is', async () => {
    const guard = makeGuard({
      getUserThrows: new UnauthorizedException('expired'),
    });
    const { context } = makeContext();

    expect(await expectRejection(guard.canActivate(context))).toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
