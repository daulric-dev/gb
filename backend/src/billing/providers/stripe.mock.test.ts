import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { StripeProvider, stripeApiBase } from './stripe.provider';
import type { ProviderSubscriptionRef } from './payment-provider';

describe('stripeApiBase', () => {
  test('unset means the real Stripe API', () => {
    expect(stripeApiBase({})).toEqual({});
  });

  test('parses host, port and protocol', () => {
    expect(
      stripeApiBase({ STRIPE_API_BASE: 'http://127.0.0.1:12111' }),
    ).toEqual({
      host: '127.0.0.1',
      port: 12111,
      protocol: 'http',
    });
    expect(stripeApiBase({ STRIPE_API_BASE: 'https://stripe-mock' })).toEqual({
      host: 'stripe-mock',
      port: 443,
      protocol: 'https',
    });
  });

  test('refused in production, and a bad URL is an error', () => {
    expect(() =>
      stripeApiBase({
        STRIPE_API_BASE: 'http://127.0.0.1:12111',
        NODE_ENV: 'production',
      }),
    ).toThrow(/development and tests only/);
    expect(() => stripeApiBase({ STRIPE_API_BASE: 'not a url' })).toThrow(
      /not a URL/,
    );
  });
});

/**
 * The adapter against stripe-mock, Stripe's official API mock. Runs when
 * STRIPE_MOCK_URL is set (CI starts the mock as a service; locally:
 * `docker compose -f docker-compose.dev.yml up -d stripe-mock` and
 * `STRIPE_MOCK_URL=http://127.0.0.1:12111 bun test src/billing`). The mock
 * validates every request against Stripe's OpenAPI spec, so a wrong parameter
 * name or type fails here even though responses are canned fixtures.
 */
const MOCK_URL = process.env.STRIPE_MOCK_URL;

describe.skipIf(!MOCK_URL)('StripeProvider against stripe-mock', () => {
  const saved: Record<string, string | undefined> = {};
  const vars = {
    STRIPE_SECRET_KEY: 'sk_test_mock',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    STRIPE_API_BASE: MOCK_URL,
  };

  beforeAll(() => {
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const sub: ProviderSubscriptionRef = {
    providerSubscriptionId: 'sub_123',
    providerCustomerId: 'cus_123',
    plan: 'per_user',
  };

  test('creates a subscription Checkout session', async () => {
    const result = await new StripeProvider().createCheckout({
      schoolId: '11111111-1111-1111-1111-111111111111',
      schoolName: 'Mock School',
      customerEmail: 'admin@mock.test',
      providerCustomerId: null,
      price: {
        plan: 'per_user',
        unitAmountCents: 500,
        currency: 'USD',
        interval: 'month',
      },
      quantity: 12,
      successUrl: 'https://app.test/billing?checkout=success',
      cancelUrl: 'https://app.test/billing?checkout=cancel',
      idempotencyKey: `mock-${Date.now()}`,
    });
    expect(result.redirectUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(result.providerRef).toMatch(/^cs_/);
  });

  test('flat plan checkout', async () => {
    const result = await new StripeProvider().createCheckout({
      schoolId: '11111111-1111-1111-1111-111111111111',
      schoolName: 'Mock School',
      customerEmail: 'admin@mock.test',
      providerCustomerId: 'cus_123',
      price: {
        plan: 'flat',
        unitAmountCents: 30000,
        currency: 'USD',
        interval: 'month',
      },
      quantity: 1,
      successUrl: 'https://app.test/s',
      cancelUrl: 'https://app.test/c',
      idempotencyKey: `mock-flat-${Date.now()}`,
    });
    expect(result.redirectUrl).toMatch(/^https:\/\//);
  });

  test('seat change, plan change, cancel, resume and portal are valid API calls', async () => {
    const p = new StripeProvider();
    await p.updateQuantity!(sub, 15);
    await p.changePlan!(
      sub,
      {
        plan: 'flat',
        unitAmountCents: 30000,
        currency: 'USD',
        interval: 'month',
      },
      1,
    );
    await p.cancel!(sub, { atPeriodEnd: true });
    await p.resume!(sub);
    await p.cancel!(sub, { atPeriodEnd: false });
    expect(await p.portalUrl!(sub, 'https://app.test/billing')).toMatch(
      /^https:\/\//,
    );
  });
});
