import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { PAYPAL_CANCEL_AT_PERIOD_END_NOTE, PayPalProvider } from './paypal.provider';
import { WebhookVerificationError } from './payment-provider';
import type { CheckoutContext, WebhookRequest } from './payment-provider';
import { ProviderApiError } from './http';

const savedEnv = { ...process.env };
afterAll(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

beforeEach(() => {
  process.env.PAYPAL_CLIENT_ID = 'client-id';
  process.env.PAYPAL_CLIENT_SECRET = 'client-secret';
  process.env.PAYPAL_WEBHOOK_ID = 'WH-123';
  process.env.PAYPAL_ENV = 'sandbox';
  delete process.env.PAYPAL_PLAN_PER_USER;
  delete process.env.PAYPAL_PLAN_FLAT;
  delete process.env.PAYPAL_PRODUCT_ID;
});

interface Call {
  method: string;
  url: URL;
  body: any;
  rawBody: string;
  headers: Headers;
}
type Route = (c: Call) => { status?: number; body?: unknown } | undefined;

function stubFetch(routes: Route[], tokenTtl = 32400) {
  const calls: Call[] = [];
  const fetchFn = (input: string | URL | Request, init?: RequestInit) => {
    const rawBody = typeof init?.body === 'string' ? init.body : '';
    let body: any = null;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      body = null;
    }
    const call: Call = { method: init?.method ?? 'GET', url: new URL(String(input)), body, rawBody, headers: new Headers(init?.headers) };
    calls.push(call);
    if (call.url.pathname === '/v1/oauth2/token') {
      return Promise.resolve(Response.json({ access_token: `tok-${calls.length}`, token_type: 'Bearer', expires_in: tokenTtl }));
    }
    for (const r of routes) {
      const res = r(call);
      if (res) {
        return Promise.resolve(
          res.body === undefined ? new Response(null, { status: res.status ?? 204 }) : Response.json(res.body, { status: res.status ?? 200 }),
        );
      }
    }
    return Promise.resolve(Response.json({ name: 'RESOURCE_NOT_FOUND', message: 'not found' }, { status: 404 }));
  };
  return { calls, fetchFn, api: () => calls.filter((c) => c.url.pathname !== '/v1/oauth2/token') };
}

const ctx = (over: Partial<CheckoutContext> = {}): CheckoutContext => ({
  schoolId: 'school-1',
  schoolName: 'St. Rose',
  customerEmail: 'admin@school.test',
  providerCustomerId: null,
  price: { plan: 'per_user', unitAmountCents: 500, currency: 'USD', interval: 'month' },
  quantity: 42,
  successUrl: 'https://app.test/billing?checkout=success',
  cancelUrl: 'https://app.test/billing?checkout=cancel',
  idempotencyKey: 'idem-1',
  ...over,
});

const subscriptionCreated = {
  id: 'I-SUB1',
  status: 'APPROVAL_PENDING',
  links: [
    { rel: 'approve', href: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1', method: 'GET' },
    { rel: 'self', href: 'https://api-m.sandbox.paypal.com/v1/billing/subscriptions/I-SUB1', method: 'GET' },
  ],
};

describe('PayPalProvider.isConfigured', () => {
  test('requires client id, secret, webhook id and a valid env', () => {
    const p = new PayPalProvider();
    expect(p.isConfigured()).toBe(true);
    delete process.env.PAYPAL_ENV;
    expect(p.isConfigured()).toBe(true); // defaults to sandbox
    process.env.PAYPAL_ENV = 'staging';
    expect(p.isConfigured()).toBe(false);
    process.env.PAYPAL_ENV = 'live';
    delete process.env.PAYPAL_WEBHOOK_ID;
    expect(p.isConfigured()).toBe(false);
    process.env.PAYPAL_WEBHOOK_ID = 'WH-1';
    delete process.env.PAYPAL_CLIENT_SECRET;
    expect(p.isConfigured()).toBe(false);
  });
});

describe('PayPalProvider.createCheckout', () => {
  test('finds/creates product and plan, then creates the subscription', async () => {
    const { fetchFn, api, calls } = stubFetch([
      (c) => (c.method === 'GET' && c.url.pathname === '/v1/catalogs/products' ? { body: { products: [], total_pages: 0 } } : undefined),
      (c) => (c.method === 'POST' && c.url.pathname === '/v1/catalogs/products' ? { body: { id: 'PROD-1' } } : undefined),
      (c) => (c.method === 'GET' && c.url.pathname === '/v1/billing/plans'
        ? { body: { plans: [{ id: 'P-INACTIVE', name: 'GradeBook per user USD 5.00', status: 'INACTIVE' }], total_pages: 1 } }
        : undefined),
      (c) => (c.method === 'POST' && c.url.pathname === '/v1/billing/plans' ? { body: { id: 'P-PERUSER' } } : undefined),
      (c) => (c.method === 'POST' && c.url.pathname === '/v1/billing/subscriptions' ? { status: 201, body: subscriptionCreated } : undefined),
    ]);
    const p = new PayPalProvider({ fetch: fetchFn });
    const result = await p.createCheckout(ctx());

    expect(result).toEqual({
      redirectUrl: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1',
      providerRef: 'I-SUB1',
      providerCustomerId: null,
    });

    // OAuth: client credentials with basic auth against the sandbox.
    const token = calls[0];
    expect(token.url.href).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
    expect(token.rawBody).toBe('grant_type=client_credentials');
    expect(token.headers.get('authorization')).toBe(`Basic ${Buffer.from('client-id:client-secret').toString('base64')}`);

    const product = api().find((c) => c.method === 'POST' && c.url.pathname === '/v1/catalogs/products')!;
    expect(product.body).toMatchObject({ name: 'GradeBook', type: 'SERVICE', category: 'SOFTWARE' });

    const plan = api().find((c) => c.method === 'POST' && c.url.pathname === '/v1/billing/plans')!;
    expect(plan.body.product_id).toBe('PROD-1');
    expect(plan.body.quantity_supported).toBe(true);
    expect(plan.body.status).toBe('ACTIVE');
    expect(plan.body.billing_cycles[0]).toMatchObject({
      frequency: { interval_unit: 'MONTH', interval_count: 1 },
      tenure_type: 'REGULAR',
      total_cycles: 0,
      pricing_scheme: { fixed_price: { value: '5.00', currency_code: 'USD' } },
    });
    expect(plan.headers.get('paypal-request-id')).toBe('gradebook-plan-PROD-1-GradeBook-per-user-USD-5.00');

    const sub = api().find((c) => c.url.pathname === '/v1/billing/subscriptions')!;
    expect(sub.body).toEqual({
      plan_id: 'P-PERUSER',
      quantity: '42',
      custom_id: 'school-1',
      subscriber: { email_address: 'admin@school.test' },
      application_context: {
        brand_name: 'GradeBook',
        user_action: 'SUBSCRIBE_NOW',
        shipping_preference: 'NO_SHIPPING',
        return_url: 'https://app.test/billing?checkout=success',
        cancel_url: 'https://app.test/billing?checkout=cancel',
      },
    });
    expect(sub.headers.get('paypal-request-id')).toBe('idem-1');
    expect(sub.headers.get('authorization')).toBe('Bearer tok-1');

    // Second checkout: token and plan are cached.
    const before = calls.length;
    await p.createCheckout(ctx({ idempotencyKey: 'idem-2' }));
    expect(calls.length - before).toBe(1);
    expect(calls.at(-1)!.url.pathname).toBe('/v1/billing/subscriptions');
  });

  test('reuses an existing active plan found by name; flat has no quantity', async () => {
    const { fetchFn, api } = stubFetch([
      (c) => (c.method === 'GET' && c.url.pathname === '/v1/catalogs/products'
        ? { body: { products: [{ id: 'PROD-OLD', name: 'GradeBook' }], total_pages: 1 } } : undefined),
      (c) => (c.method === 'GET' && c.url.pathname === '/v1/billing/plans'
        ? { body: { plans: [{ id: 'P-FLAT', name: 'GradeBook flat USD 300.00', status: 'ACTIVE' }], total_pages: 1 } } : undefined),
      (c) => (c.url.pathname === '/v1/billing/subscriptions' ? { body: subscriptionCreated } : undefined),
    ]);
    await new PayPalProvider({ fetch: fetchFn }).createCheckout(
      ctx({ price: { plan: 'flat', unitAmountCents: 30000, currency: 'USD', interval: 'month' }, quantity: 1 }),
    );
    const planList = api().find((c) => c.url.pathname === '/v1/billing/plans')!;
    expect(planList.url.searchParams.get('product_id')).toBe('PROD-OLD');
    expect(api().some((c) => c.method === 'POST' && c.url.pathname !== '/v1/billing/subscriptions')).toBe(false);
    const sub = api().find((c) => c.url.pathname === '/v1/billing/subscriptions')!;
    expect(sub.body.plan_id).toBe('P-FLAT');
    expect(sub.body.quantity).toBeUndefined();
  });

  test('configured plan ids skip the catalog entirely; live base URL', async () => {
    process.env.PAYPAL_ENV = 'live';
    process.env.PAYPAL_PLAN_PER_USER = 'P-ENVPLAN';
    const { fetchFn, calls } = stubFetch([
      (c) => (c.url.pathname === '/v1/billing/subscriptions' ? { body: subscriptionCreated } : undefined),
    ]);
    await new PayPalProvider({ fetch: fetchFn }).createCheckout(ctx());
    expect(calls.map((c) => c.url.origin + c.url.pathname)).toEqual([
      'https://api-m.paypal.com/v1/oauth2/token',
      'https://api-m.paypal.com/v1/billing/subscriptions',
    ]);
    expect(calls[1].body.plan_id).toBe('P-ENVPLAN');
  });

  test('API errors include PayPal’s message, not credentials', async () => {
    process.env.PAYPAL_PLAN_PER_USER = 'P-ENVPLAN';
    const { fetchFn } = stubFetch([
      (c) => (c.url.pathname === '/v1/billing/subscriptions'
        ? { status: 422, body: { name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed.', details: [{ issue: 'SUBSCRIPTION_STATUS_INVALID', description: 'Invalid subscription status' }], debug_id: 'abc' } }
        : undefined),
    ]);
    const err = await new PayPalProvider({ fetch: fetchFn }).createCheckout(ctx()).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderApiError);
    expect(err.message).toContain('SUBSCRIPTION_STATUS_INVALID');
    expect(err.message).toContain('debug_id abc');
    expect(err.message).not.toContain('client-secret');
  });

  test('token failure is reported', async () => {
    const fetchFn = () => Promise.resolve(Response.json({ error: 'invalid_client', error_description: 'Client Authentication failed' }, { status: 401 }));
    const err = await new PayPalProvider({ fetch: fetchFn }).createCheckout(ctx()).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderApiError);
    expect(err.message).toContain('Client Authentication failed');
  });

  test('network timeouts become ProviderApiError', async () => {
    const fetchFn = () => Promise.reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
    const err = await new PayPalProvider({ fetch: fetchFn }).createCheckout(ctx()).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderApiError);
    expect(err.message).toContain('timed out');
  });
});

describe('PayPalProvider token cache', () => {
  test('reuses the token until it expires, then fetches a new one', async () => {
    process.env.PAYPAL_PLAN_PER_USER = 'P-ENVPLAN';
    // expires_in 30s is inside the 60s safety margin: never cached.
    const short = stubFetch([(c) => (c.url.pathname === '/v1/billing/subscriptions' ? { body: subscriptionCreated } : undefined)], 30);
    const p1 = new PayPalProvider({ fetch: short.fetchFn });
    await p1.createCheckout(ctx());
    await p1.createCheckout(ctx());
    expect(short.calls.filter((c) => c.url.pathname === '/v1/oauth2/token').length).toBe(2);

    const long = stubFetch([(c) => (c.url.pathname === '/v1/billing/subscriptions' ? { body: subscriptionCreated } : undefined)]);
    const p2 = new PayPalProvider({ fetch: long.fetchFn });
    await p2.createCheckout(ctx());
    await p2.createCheckout(ctx());
    await p2.createCheckout(ctx());
    expect(long.calls.filter((c) => c.url.pathname === '/v1/oauth2/token').length).toBe(1);

    // A different client id invalidates the cache.
    process.env.PAYPAL_CLIENT_ID = 'other-client';
    await p2.createCheckout(ctx());
    expect(long.calls.filter((c) => c.url.pathname === '/v1/oauth2/token').length).toBe(2);
  });

  test('a 401 drops the cached token', async () => {
    process.env.PAYPAL_PLAN_PER_USER = 'P-ENVPLAN';
    let first = true;
    const { fetchFn, calls } = stubFetch([
      (c) => {
        if (c.url.pathname !== '/v1/billing/subscriptions') return undefined;
        if (first) {
          first = false;
          return { status: 401, body: { name: 'AUTHENTICATION_FAILURE', message: 'expired' } };
        }
        return { body: subscriptionCreated };
      },
    ]);
    const p = new PayPalProvider({ fetch: fetchFn });
    await expect(p.createCheckout(ctx())).rejects.toBeInstanceOf(ProviderApiError);
    await p.createCheckout(ctx());
    expect(calls.filter((c) => c.url.pathname === '/v1/oauth2/token').length).toBe(2);
  });
});

describe('PayPalProvider subscription changes', () => {
  const ref = { providerSubscriptionId: 'I-SUB1', providerCustomerId: null, plan: 'per_user' as const };
  const routes: Route[] = [
    (c) => (c.url.pathname.endsWith('/revise') ? { body: { plan_id: 'P-X', links: [] } } : undefined),
    (c) => (/\/(suspend|cancel|activate)$/.test(c.url.pathname) ? { status: 204 } : undefined),
  ];

  test('updateQuantity revises the quantity', async () => {
    const { fetchFn, api } = stubFetch(routes);
    await new PayPalProvider({ fetch: fetchFn }).updateQuantity(ref, 57);
    expect(api()[0].url.pathname).toBe('/v1/billing/subscriptions/I-SUB1/revise');
    expect(api()[0].body).toEqual({ quantity: '57' });
  });

  test('updateQuantity still succeeds when PayPal asks for approval', async () => {
    const { fetchFn } = stubFetch([
      (c) => (c.url.pathname.endsWith('/revise') ? { body: { links: [{ rel: 'approve', href: 'https://paypal.test/approve' }] } } : undefined),
    ]);
    await expect(new PayPalProvider({ fetch: fetchFn }).updateQuantity(ref, 3)).resolves.toBeUndefined();
  });

  test('changePlan revises plan_id (and quantity for per-user)', async () => {
    process.env.PAYPAL_PLAN_FLAT = 'P-FLAT';
    process.env.PAYPAL_PLAN_PER_USER = 'P-SEAT';
    const { fetchFn, api } = stubFetch(routes);
    const p = new PayPalProvider({ fetch: fetchFn });
    await p.changePlan(ref, { plan: 'flat', unitAmountCents: 30000, currency: 'USD', interval: 'month' }, 80);
    expect(api()[0].body).toEqual({ plan_id: 'P-FLAT' });
    await p.changePlan({ ...ref, plan: 'flat' }, { plan: 'per_user', unitAmountCents: 500, currency: 'USD', interval: 'month' }, 80);
    expect(api()[1].body).toEqual({ plan_id: 'P-SEAT', quantity: '80' });
  });

  test('cancel at period end suspends; immediate cancel cancels; resume activates', async () => {
    const { fetchFn, api } = stubFetch(routes);
    const p = new PayPalProvider({ fetch: fetchFn });
    await p.cancel(ref, { atPeriodEnd: true });
    await p.cancel(ref, { atPeriodEnd: false });
    await p.resume(ref);
    expect(api().map((c) => c.url.pathname)).toEqual([
      '/v1/billing/subscriptions/I-SUB1/suspend',
      '/v1/billing/subscriptions/I-SUB1/cancel',
      '/v1/billing/subscriptions/I-SUB1/activate',
    ]);
    expect(api()[0].body).toEqual({ reason: PAYPAL_CANCEL_AT_PERIOD_END_NOTE });
    expect(api()[1].body.reason).toBeTruthy();
  });

  test('no portal', async () => {
    expect(await new PayPalProvider().portalUrl()).toBeNull();
  });
});

describe('PayPalProvider.parseWebhook', () => {
  const event = {
    id: 'WH-EVT-1',
    event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
    create_time: '2026-10-01T00:00:00Z',
    resource: {
      id: 'I-SUB1',
      status: 'ACTIVE',
      custom_id: 'school-1',
      plan_id: 'P-SEAT',
      quantity: '12',
      billing_info: { last_payment: { time: '2026-10-01T00:00:00Z' }, next_billing_time: '2026-11-01T10:00:00Z' },
    },
  };
  const headers = {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
    'paypal-transmission-id': 'tx-1',
    'paypal-transmission-sig': 'sig==',
    'paypal-transmission-time': '2026-10-01T00:00:01Z',
  };
  const req = (over: Partial<WebhookRequest> = {}): WebhookRequest => ({
    rawBody: Buffer.from(JSON.stringify(event)),
    headers,
    query: {},
    ...over,
  });
  const verifier = (status: string) => stubFetch([
    (c) => (c.url.pathname === '/v1/notifications/verify-webhook-signature' ? { body: { verification_status: status } } : undefined),
  ]);

  test('SUCCESS: posts the transmission headers and event, maps it', async () => {
    process.env.PAYPAL_PLAN_PER_USER = 'P-SEAT';
    const { fetchFn, api } = verifier('SUCCESS');
    const events = await new PayPalProvider({ fetch: fetchFn }).parseWebhook(req());
    expect(api()[0].body).toEqual({
      auth_algo: 'SHA256withRSA',
      cert_url: 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
      transmission_id: 'tx-1',
      transmission_sig: 'sig==',
      transmission_time: '2026-10-01T00:00:01Z',
      webhook_id: 'WH-123',
      webhook_event: event,
    });
    expect(events).toEqual([
      {
        type: 'subscription.updated',
        eventId: 'WH-EVT-1',
        providerSubscriptionId: 'I-SUB1',
        providerCustomerId: null,
        schoolId: 'school-1',
        status: 'active',
        plan: 'per_user',
        quantity: 12,
        currentPeriodStart: new Date('2026-10-01T00:00:00Z'),
        currentPeriodEnd: new Date('2026-11-01T10:00:00Z'),
        cancelAtPeriodEnd: false,
      },
    ]);
  });

  test('FAILURE is rejected', async () => {
    const { fetchFn } = verifier('FAILURE');
    await expect(new PayPalProvider({ fetch: fetchFn }).parseWebhook(req())).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test('missing headers, bad JSON and missing webhook id are rejected without calling PayPal', async () => {
    const { fetchFn, calls } = verifier('SUCCESS');
    const p = new PayPalProvider({ fetch: fetchFn });
    const { ['paypal-transmission-sig']: _sig, ...noSig } = headers;
    await expect(p.parseWebhook(req({ headers: noSig }))).rejects.toThrow('transmission_sig');
    await expect(p.parseWebhook(req({ rawBody: Buffer.from('not json') }))).rejects.toBeInstanceOf(WebhookVerificationError);
    await expect(p.parseWebhook(req({ rawBody: Buffer.from('{"no":"id"}') }))).rejects.toBeInstanceOf(WebhookVerificationError);
    delete process.env.PAYPAL_WEBHOOK_ID;
    await expect(p.parseWebhook(req())).rejects.toBeInstanceOf(WebhookVerificationError);
    expect(calls.length).toBe(0);
  });
});

describe('PayPalProvider.mapEvent', () => {
  const p = new PayPalProvider();
  const ev = (event_type: string, resource: object) => ({ id: 'WH-X', event_type, create_time: '2026-10-05T00:00:00Z', resource });

  test.each([
    ['BILLING.SUBSCRIPTION.ACTIVATED', 'ACTIVE', 'active'],
    ['BILLING.SUBSCRIPTION.UPDATED', 'ACTIVE', 'active'],
    ['BILLING.SUBSCRIPTION.UPDATED', 'APPROVAL_PENDING', 'incomplete'],
    ['BILLING.SUBSCRIPTION.RE-ACTIVATED', 'ACTIVE', 'active'],
    ['BILLING.SUBSCRIPTION.SUSPENDED', 'SUSPENDED', 'past_due'],
  ])('%s with %s -> %s', (type, status, expected) => {
    expect(p.mapEvent(ev(type, { id: 'I-1', status, custom_id: 'school-1' }))).toMatchObject({
      type: 'subscription.updated',
      providerSubscriptionId: 'I-1',
      status: expected,
      schoolId: 'school-1',
      cancelAtPeriodEnd: false,
      plan: null,
      quantity: null,
    });
  });

  test('our own suspension means active, cancelling at period end', () => {
    expect(
      p.mapEvent(ev('BILLING.SUBSCRIPTION.SUSPENDED', { id: 'I-1', status: 'SUSPENDED', status_change_note: PAYPAL_CANCEL_AT_PERIOD_END_NOTE })),
    ).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
  });

  test.each(['BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.EXPIRED'])('%s -> canceled', (type) => {
    expect(p.mapEvent(ev(type, { id: 'I-1', custom_id: 'school-1' }))).toEqual({
      type: 'subscription.canceled',
      eventId: 'WH-X',
      providerSubscriptionId: 'I-1',
      schoolId: 'school-1',
    });
  });

  test('BILLING.SUBSCRIPTION.PAYMENT.FAILED', () => {
    expect(p.mapEvent(ev('BILLING.SUBSCRIPTION.PAYMENT.FAILED', { id: 'I-1', custom_id: 'school-1' }))).toEqual({
      type: 'invoice.payment_failed',
      eventId: 'WH-X',
      providerSubscriptionId: 'I-1',
      schoolId: 'school-1',
    });
  });

  test('PAYMENT.SALE.COMPLETED converts the decimal amount exactly', () => {
    expect(
      p.mapEvent(ev('PAYMENT.SALE.COMPLETED', {
        id: 'SALE-1',
        billing_agreement_id: 'I-1',
        custom: 'school-1',
        amount: { total: '300.00', currency: 'USD' },
        create_time: '2026-10-05T01:02:03Z',
        state: 'completed',
      })),
    ).toEqual({
      type: 'invoice.paid',
      eventId: 'WH-X',
      providerInvoiceId: 'SALE-1',
      providerSubscriptionId: 'I-1',
      schoolId: 'school-1',
      amountCents: 30000,
      currency: 'USD',
      paidAt: new Date('2026-10-05T01:02:03Z'),
    });
    expect(p.mapEvent(ev('PAYMENT.SALE.COMPLETED', { id: 'S', billing_agreement_id: 'I-1', amount: { total: '19.99', currency: 'usd' } })))
      .toMatchObject({ amountCents: 1999, currency: 'USD', schoolId: null });
  });

  test('a sale not tied to a subscription, and unknown types, are ignored', () => {
    expect(p.mapEvent(ev('PAYMENT.SALE.COMPLETED', { id: 'S', amount: { total: '1.00', currency: 'USD' } })).type).toBe('ignored');
    expect(p.mapEvent(ev('CHECKOUT.ORDER.APPROVED', {}))).toEqual({ type: 'ignored', eventId: 'WH-X', reason: 'unhandled CHECKOUT.ORDER.APPROVED' });
  });
});
