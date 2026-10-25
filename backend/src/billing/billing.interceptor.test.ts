import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { HttpException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { BillingEntitlementInterceptor, isExempt } from './billing.interceptor';

const saved = process.env.BILLING_ENABLED;
afterEach(() => {
  if (saved === undefined) delete process.env.BILLING_ENABLED;
  else process.env.BILLING_ENABLED = saved;
});

function ctx(method: string, url: string, user?: { id: string }) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ method, url, user }) }),
  } as never;
}

function setup(readOnly: boolean, schoolId: string | null = 'school-1') {
  const subscriptions = {
    schoolOfUser: mock(() => Promise.resolve(schoolId)),
    entitlement: mock(() =>
      Promise.resolve({ readOnly, status: readOnly ? 'read_only' : 'active', trialEndsAt: null }),
    ),
  };
  const interceptor = new BillingEntitlementInterceptor(subscriptions as never);
  const handler = { handle: mock(() => of('handled')) };
  const run = (c: unknown) => lastValueFrom(interceptor.intercept(c as never, handler));
  return { subscriptions, handler, run };
}

describe('BillingEntitlementInterceptor', () => {
  beforeEach(() => {
    process.env.BILLING_ENABLED = 'true';
  });

  test('billing disabled: a no-op that never looks anything up', async () => {
    delete process.env.BILLING_ENABLED;
    const { run, subscriptions } = setup(true);
    expect(await run(ctx('POST', '/api/courses', { id: 'u1' }))).toBe('handled');
    expect(subscriptions.schoolOfUser).not.toHaveBeenCalled();
    expect(subscriptions.entitlement).not.toHaveBeenCalled();
  });

  test('reads always pass, even when read-only', async () => {
    const { run, subscriptions } = setup(true);
    for (const m of ['GET', 'HEAD', 'OPTIONS']) {
      expect(await run(ctx(m, '/api/courses', { id: 'u1' }))).toBe('handled');
    }
    expect(subscriptions.entitlement).not.toHaveBeenCalled();
  });

  test('allowlisted mutations pass when read-only', async () => {
    const { run } = setup(true);
    for (const url of [
      '/api/auth/logout',
      '/api/auth/profile',
      '/api/billing/checkout',
      '/api/billing/webhooks/stripe',
      '/api/platform/invoices/x/void',
      '/api/notifications/devices',
      '/api/portal/me/notifications/read-all',
      '/api/announcements/mark-read',
      '/api/chat/conversations/c1/read?x=1',
    ]) {
      expect(await run(ctx('POST', url, { id: 'u1' }))).toBe('handled');
    }
  });

  test('a read-only school gets 402 SUBSCRIPTION_REQUIRED on mutations', async () => {
    const { run, handler } = setup(true);
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const err = await run(ctx(m, '/api/courses', { id: 'u1' })).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      const http = err as HttpException;
      expect(http.getStatus()).toBe(402);
      expect(http.getResponse()).toMatchObject({ statusCode: 402, code: 'SUBSCRIPTION_REQUIRED' });
      expect(typeof (http.getResponse() as { message: string }).message).toBe('string');
    }
    expect(handler.handle).not.toHaveBeenCalled();
  });

  test('a writable school passes', async () => {
    const { run } = setup(false);
    expect(await run(ctx('POST', '/api/courses', { id: 'u1' }))).toBe('handled');
  });

  test('requests not tied to a school pass: no user, or a user without a school', async () => {
    expect(await setup(true).run(ctx('POST', '/api/schools', undefined))).toBe('handled');
    const noSchool = setup(true, null);
    expect(await noSchool.run(ctx('POST', '/api/schools', { id: 'u1' }))).toBe('handled');
    expect(noSchool.subscriptions.entitlement).not.toHaveBeenCalled();
  });

  test('non-http contexts pass', async () => {
    const { run } = setup(true);
    expect(await run({ getType: () => 'rpc' })).toBe('handled');
  });

  test('isExempt', () => {
    expect(isExempt('get', '/api/x')).toBe(true);
    expect(isExempt('POST', '/health')).toBe(true);
    expect(isExempt('POST', '/api/courses/c1/modules')).toBe(false);
    expect(isExempt('POST', '/api/billingx')).toBe(false);
    expect(isExempt('POST', '/api/courses/read')).toBe(true);
  });
});
