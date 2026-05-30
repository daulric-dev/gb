import { describe, test, expect } from 'bun:test';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { createMockQueryBuilder, expectRejection } from '@/test/mocks';

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

function makeSupabase(opts: {
  user?: any;
  getUserThrows?: Error;
  profile?: { data: any; error: any };
}) {
  const builder = createMockQueryBuilder(
    opts.profile ?? { data: null, error: null },
  );
  return {
    getUser: () => {
      if (opts.getUserThrows) return Promise.reject(opts.getUserThrows);
      return Promise.resolve(opts.user ?? null);
    },
    getServiceClient: () => ({ from: () => builder }),
  };
}

const activeUser = { id: 'user-1', email: 'a@b.com' };

describe('AuthGuard', () => {
  test('allows an active user and attaches id + email to the request', async () => {
    const sb = makeSupabase({
      user: activeUser,
      profile: { data: { is_active: true }, error: null },
    });
    const guard = new AuthGuard(sb as any);
    const { context, request } = makeContext();

    expect(await guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual({ id: 'user-1', email: 'a@b.com' });
  });

  test('rejects a deactivated user even with a valid session', async () => {
    const sb = makeSupabase({
      user: activeUser,
      profile: { data: { is_active: false }, error: null },
    });
    const guard = new AuthGuard(sb as any);
    const { context, request } = makeContext();

    expect(await expectRejection(guard.canActivate(context))).toBeInstanceOf(
      UnauthorizedException,
    );
    expect(request.user).toBeUndefined();
  });

  test('allows a brand-new user with no profile row yet (mid-onboarding)', async () => {
    // maybeSingle returns null data: must NOT lock the user out.
    const sb = makeSupabase({
      user: activeUser,
      profile: { data: null, error: null },
    });
    const guard = new AuthGuard(sb as any);
    const { context } = makeContext();

    expect(await guard.canActivate(context)).toBe(true);
  });

  test('allows when is_active is absent on the row (only explicit false blocks)', async () => {
    const sb = makeSupabase({
      user: activeUser,
      profile: { data: { id: 'user-1' }, error: null },
    });
    const guard = new AuthGuard(sb as any);
    const { context } = makeContext();

    expect(await guard.canActivate(context)).toBe(true);
  });

  test('rejects when there is no valid session', async () => {
    const sb = makeSupabase({ user: null });
    const guard = new AuthGuard(sb as any);
    const { context } = makeContext();

    expect(await expectRejection(guard.canActivate(context))).toBeInstanceOf(
      UnauthorizedException,
    );
  });

  test('maps an unexpected getUser failure to UnauthorizedException', async () => {
    const sb = makeSupabase({ getUserThrows: new Error('network down') });
    const guard = new AuthGuard(sb as any);
    const { context } = makeContext();

    expect(await expectRejection(guard.canActivate(context))).toBeInstanceOf(
      UnauthorizedException,
    );
  });

  test('re-throws an UnauthorizedException from getUser as-is', async () => {
    const sb = makeSupabase({
      getUserThrows: new UnauthorizedException('expired'),
    });
    const guard = new AuthGuard(sb as any);
    const { context } = makeContext();

    expect(await expectRejection(guard.canActivate(context))).toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
