import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { PaddleProvider } from './paddle.provider';
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

const SECRET = 'pdl_ntfset_secret';

beforeEach(() => {
  process.env.PADDLE_API_KEY = 'pdl_sdbx_apikey';
  process.env.PADDLE_WEBHOOK_SECRET = SECRET;
  process.env.PADDLE_ENV = 'sandbox';
  delete process.env.PADDLE_PRICE_PER_USER;
  delete process.env.PADDLE_PRICE_FLAT;
  delete process.env.PADDLE_PRODUCT_ID;
  delete process.env.PADDLE_CHECKOUT_URL;
});

interface Call {
  method: string;
  url: URL;
  body: any;
  headers: Headers;
}
type Route = (c: Call) => { status?: number; body: unknown } | undefined;

function stubFetch(routes: Route[]) {
  const calls: Call[] = [];
  const fetchFn = (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    for (const r of routes) {
      const res = r(call);
      if (res) return Promise.resolve(Response.json(res.body, { status: res.status ?? 200 }));
    }
    return Promise.resolve(Response.json({ error: { type: 'request_error', code: 'not_found', detail: 'Not found' } }, { status: 404 }));
  };
  return { calls, fetchFn };
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

const txn = { data: { id: 'txn_1', customer_id: null, checkout: { url: 'https://app.test/pay?_ptxn=txn_1' } } };

describe('PaddleProvider.isConfigured', () => {
  test('requires the API key, webhook secret and a valid env', () => {
    const p = new PaddleProvider();
    expect(p.isConfigured()).toBe(true);
    process.env.PADDLE_ENV = 'production';
    expect(p.isConfigured()).toBe(true);
    process.env.PADDLE_ENV = 'classic';
    expect(p.isConfigured()).toBe(false);
    process.env.PADDLE_ENV = 'sandbox';
    delete process.env.PADDLE_WEBHOOK_SECRET;
    expect(p.isConfigured()).toBe(false);
    process.env.PADDLE_WEBHOOK_SECRET = SECRET;
    delete process.env.PADDLE_API_KEY;
    expect(p.isConfigured()).toBe(false);
  });
});

describe('PaddleProvider.createCheckout', () => {
  test('inline non-catalog price, quantity, custom_data, sandbox base, headers', async () => {
    const { calls, fetchFn } = stubFetch([(c) => (c.url.pathname === '/transactions' ? { status: 201, body: txn } : undefined)]);
    const result = await new PaddleProvider({ fetch: fetchFn }).createCheckout(ctx());
    expect(result).toEqual({ redirectUrl: 'https://app.test/pay?_ptxn=txn_1', providerRef: 'txn_1', providerCustomerId: null });

    const call = calls[0];
    expect(call.method).toBe('POST');
    expect(call.url.href).toBe('https://sandbox-api.paddle.com/transactions');
    expect(call.headers.get('authorization')).toBe('Bearer pdl_sdbx_apikey');
    expect(call.headers.get('paddle-version')).toBe('1');
    expect(call.body).toEqual({
      items: [
        {
          quantity: 42,
          price: {
            description: 'GradeBook per user (GradeBook billing)',
            name: 'Monthly, per user',
            unit_price: { amount: '500', currency_code: 'USD' },
            billing_cycle: { interval: 'month', frequency: 1 },
            quantity: { minimum: 1, maximum: 100000 },
            custom_data: { plan: 'per_user' },
            product: { name: 'GradeBook per user', tax_category: 'standard' },
          },
        },
      ],
      collection_mode: 'automatic',
      custom_data: { schoolId: 'school-1', plan: 'per_user', checkoutKey: 'idem-1' },
    });
  });

  test('catalog price ids, customer reuse, checkout URL override, production base', async () => {
    process.env.PADDLE_ENV = 'production';
    process.env.PADDLE_PRICE_FLAT = 'pri_flat';
    process.env.PADDLE_CHECKOUT_URL = 'https://app.test/pay';
    const { calls, fetchFn } = stubFetch([
      (c) => (c.url.pathname === '/transactions' ? { body: { data: { ...txn.data, customer_id: 'ctm_1' } } } : undefined),
    ]);
    const result = await new PaddleProvider({ fetch: fetchFn }).createCheckout(
      ctx({ price: { plan: 'flat', unitAmountCents: 30000, currency: 'USD', interval: 'month' }, quantity: 7, providerCustomerId: 'ctm_1' }),
    );
    expect(result.providerCustomerId).toBe('ctm_1');
    expect(calls[0].url.origin).toBe('https://api.paddle.com');
    expect(calls[0].body.items).toEqual([{ price_id: 'pri_flat', quantity: 1 }]);
    expect(calls[0].body.customer_id).toBe('ctm_1');
    expect(calls[0].body.checkout).toEqual({ url: 'https://app.test/pay' });
  });

  test('a configured product id is used for inline prices', async () => {
    process.env.PADDLE_PRODUCT_ID = 'pro_1';
    const { calls, fetchFn } = stubFetch([(c) => (c.url.pathname === '/transactions' ? { body: txn } : undefined)]);
    await new PaddleProvider({ fetch: fetchFn }).createCheckout(ctx({ price: { plan: 'flat', unitAmountCents: 30000, currency: 'usd', interval: 'month' } }));
    const price = calls[0].body.items[0].price;
    expect(price.product_id).toBe('pro_1');
    expect(price.product).toBeUndefined();
    expect(price.unit_price).toEqual({ amount: '30000', currency_code: 'USD' });
    expect(price.quantity).toEqual({ minimum: 1, maximum: 1 });
    expect(calls[0].body.items[0].quantity).toBe(1);
  });

  test('no default payment link -> clear error', async () => {
    const { fetchFn } = stubFetch([(c) => (c.url.pathname === '/transactions' ? { body: { data: { id: 'txn_1', checkout: { url: null } } } } : undefined)]);
    await expect(new PaddleProvider({ fetch: fetchFn }).createCheckout(ctx())).rejects.toThrow('default payment link');
  });

  test('API errors carry Paddle’s code and detail but not the key', async () => {
    const { fetchFn } = stubFetch([
      (c) => (c.url.pathname === '/transactions'
        ? { status: 400, body: { error: { type: 'request_error', code: 'bad_request', detail: 'Invalid request.', errors: [{ field: 'items[0].quantity', message: 'must be at most 100' }] } } }
        : undefined),
    ]);
    const err = await new PaddleProvider({ fetch: fetchFn }).createCheckout(ctx()).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderApiError);
    expect(err.message).toContain('bad_request: Invalid request.');
    expect(err.message).toContain('items[0].quantity: must be at most 100');
    expect(err.message).not.toContain('pdl_sdbx_apikey');
  });
});

describe('PaddleProvider subscription changes', () => {
  const ref = { providerSubscriptionId: 'sub_1', providerCustomerId: 'ctm_1', plan: 'per_user' as const };
  const subscription = {
    data: {
      id: 'sub_1',
      customer_id: 'ctm_9',
      custom_data: { schoolId: 'school-1', plan: 'per_user' },
      items: [{ quantity: 10, price: { id: 'pri_seat', product_id: 'pro_1' } }],
    },
  };
  const api = () => stubFetch([
    (c) => (c.method === 'GET' && c.url.pathname === '/subscriptions/sub_1' ? { body: subscription } : undefined),
    (c) => (c.url.pathname.startsWith('/subscriptions/sub_1') ? { body: subscription } : undefined),
    (c) => (c.url.pathname.endsWith('/portal-sessions')
      ? { status: 201, body: { data: { urls: { general: { overview: 'https://portal/overview' }, subscriptions: [{ id: 'sub_1', view_subscription: 'https://portal/sub_1' }] } } } }
      : undefined),
  ]);

  test('updateQuantity patches items with immediate proration', async () => {
    const { calls, fetchFn } = api();
    await new PaddleProvider({ fetch: fetchFn }).updateQuantity(ref, 57);
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url.pathname).toBe('/subscriptions/sub_1');
    expect(patch.body).toEqual({ items: [{ price_id: 'pri_seat', quantity: 57 }], proration_billing_mode: 'prorated_immediately' });
  });

  test('changePlan swaps the price and records the plan', async () => {
    process.env.PADDLE_PRICE_FLAT = 'pri_flat';
    const { calls, fetchFn } = api();
    await new PaddleProvider({ fetch: fetchFn }).changePlan(ref, { plan: 'flat', unitAmountCents: 30000, currency: 'USD', interval: 'month' }, 80);
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toEqual({
      items: [{ price_id: 'pri_flat', quantity: 1 }],
      custom_data: { schoolId: 'school-1', plan: 'flat' },
      proration_billing_mode: 'prorated_immediately',
    });
  });

  test('changePlan with an inline price', async () => {
    const { calls, fetchFn } = api();
    await new PaddleProvider({ fetch: fetchFn }).changePlan({ ...ref, plan: 'flat' }, { plan: 'per_user', unitAmountCents: 500, currency: 'USD', interval: 'month' }, 12);
    const item = calls.find((c) => c.method === 'PATCH')!.body.items[0];
    expect(item.quantity).toBe(12);
    expect(item.price.unit_price).toEqual({ amount: '500', currency_code: 'USD' });
  });

  test('cancel at period end / immediately, and resume', async () => {
    const { calls, fetchFn } = api();
    const p = new PaddleProvider({ fetch: fetchFn });
    await p.cancel(ref, { atPeriodEnd: true });
    await p.cancel(ref, { atPeriodEnd: false });
    await p.resume(ref);
    expect(calls.map((c) => [c.method, c.url.pathname, c.body])).toEqual([
      ['POST', '/subscriptions/sub_1/cancel', { effective_from: 'next_billing_period' }],
      ['POST', '/subscriptions/sub_1/cancel', { effective_from: 'immediately' }],
      ['PATCH', '/subscriptions/sub_1', { scheduled_change: null }],
    ]);
  });

  test('portalUrl creates a portal session (looking up the customer when needed)', async () => {
    const { calls, fetchFn } = api();
    const p = new PaddleProvider({ fetch: fetchFn });
    expect(await p.portalUrl(ref)).toBe('https://portal/sub_1');
    expect(calls[0].url.pathname).toBe('/customers/ctm_1/portal-sessions');
    expect(calls[0].body).toEqual({ subscription_ids: ['sub_1'] });

    calls.length = 0;
    await p.portalUrl({ ...ref, providerCustomerId: null });
    expect(calls.map((c) => c.url.pathname)).toEqual(['/subscriptions/sub_1', '/customers/ctm_9/portal-sessions']);
  });
});

describe('PaddleProvider.parseWebhook', () => {
  const event = {
    event_id: 'evt_1',
    event_type: 'subscription.updated',
    occurred_at: '2026-10-01T00:00:00Z',
    notification_id: 'ntf_1',
    data: {
      id: 'sub_1',
      status: 'active',
      customer_id: 'ctm_1',
      custom_data: { schoolId: 'school-1', plan: 'per_user' },
      items: [{ quantity: 12, price: { id: 'pri_x' } }],
      current_billing_period: { starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-11-01T00:00:00Z' },
      scheduled_change: { action: 'cancel', effective_at: '2026-11-01T00:00:00Z' },
    },
  };
  const raw = JSON.stringify(event);
  const sign = (body: string, ts = Math.floor(Date.now() / 1000), secret = SECRET) =>
    `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`;
  const req = (signature: string | undefined, body = raw): WebhookRequest => ({
    rawBody: Buffer.from(body),
    headers: signature ? { 'paddle-signature': signature } : {},
    query: {},
  });

  test('valid signature -> mapped event', async () => {
    expect(await new PaddleProvider().parseWebhook(req(sign(raw)))).toEqual([
      {
        type: 'subscription.updated',
        eventId: 'evt_1',
        providerSubscriptionId: 'sub_1',
        providerCustomerId: 'ctm_1',
        schoolId: 'school-1',
        status: 'active',
        plan: 'per_user',
        quantity: 12,
        currentPeriodStart: new Date('2026-10-01T00:00:00Z'),
        currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
        cancelAtPeriodEnd: true,
      },
    ]);
  });

  test('any of several h1 values may match (secret rotation)', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const good = sign(raw, ts).split('h1=')[1];
    const header = `ts=${ts};h1=${'0'.repeat(64)};h1=${good}`;
    expect((await new PaddleProvider().parseWebhook(req(header)))[0].eventId).toBe('evt_1');
  });

  test('wrong secret is rejected', async () => {
    await expect(new PaddleProvider().parseWebhook(req(sign(raw, undefined, 'other')))).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test('tampered body is rejected', async () => {
    const sig = sign(raw);
    await expect(new PaddleProvider().parseWebhook(req(sig, raw.replace('"active"', '"canceled"')))).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test('stale or future timestamps are rejected', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(new PaddleProvider().parseWebhook(req(sign(raw, now - 301)))).rejects.toThrow('too old');
    await expect(new PaddleProvider().parseWebhook(req(sign(raw, now + 3600)))).rejects.toThrow('too old');
    expect((await new PaddleProvider().parseWebhook(req(sign(raw, now - 200))))[0].eventId).toBe('evt_1');
  });

  test('missing or malformed headers and missing secret are rejected', async () => {
    const p = new PaddleProvider();
    await expect(p.parseWebhook(req(undefined))).rejects.toBeInstanceOf(WebhookVerificationError);
    await expect(p.parseWebhook(req('h1=abc'))).rejects.toThrow('Malformed');
    await expect(p.parseWebhook(req('ts=abc;h1=abc'))).rejects.toThrow('Malformed');
    await expect(p.parseWebhook(req(`ts=${Math.floor(Date.now() / 1000)}`))).rejects.toThrow('Malformed');
    delete process.env.PADDLE_WEBHOOK_SECRET;
    await expect(p.parseWebhook(req(sign(raw)))).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test('a signed body that is not an event is rejected', async () => {
    await expect(new PaddleProvider().parseWebhook(req(sign('{}'), '{}'))).rejects.toBeInstanceOf(WebhookVerificationError);
    await expect(new PaddleProvider().parseWebhook(req(sign('nope'), 'nope'))).rejects.toBeInstanceOf(WebhookVerificationError);
  });
});

describe('PaddleProvider.mapEvent', () => {
  const p = new PaddleProvider();
  const ev = (event_type: string, data: object) => ({ event_id: 'evt_x', event_type, occurred_at: '2026-10-05T00:00:00Z', data });

  test.each([
    ['subscription.created', 'active', 'active'],
    ['subscription.activated', 'active', 'active'],
    ['subscription.updated', 'trialing', 'trialing'],
    ['subscription.past_due', 'past_due', 'past_due'],
    ['subscription.paused', 'paused', 'past_due'],
    ['subscription.resumed', 'active', 'active'],
    ['subscription.updated', 'canceled', 'canceled'],
    ['subscription.updated', 'weird', 'incomplete'],
  ])('%s (%s) -> %s', (type, status, expected) => {
    expect(p.mapEvent(ev(type, { id: 'sub_1', status, items: [] }))).toMatchObject({
      type: 'subscription.updated',
      status: expected,
      schoolId: null,
      plan: null,
      quantity: null,
      cancelAtPeriodEnd: false,
    });
  });

  test('plan from a configured price id or the price’s custom_data', () => {
    process.env.PADDLE_PRICE_FLAT = 'pri_flat';
    expect(p.mapEvent(ev('subscription.updated', { id: 's', status: 'active', items: [{ quantity: 1, price: { id: 'pri_flat' } }] }))).toMatchObject({ plan: 'flat' });
    expect(p.mapEvent(ev('subscription.updated', { id: 's', status: 'active', items: [{ quantity: 4, price: { id: 'pri_z', custom_data: { plan: 'per_user' } } }] }))).toMatchObject({ plan: 'per_user', quantity: 4 });
  });

  test('subscription.canceled', () => {
    expect(p.mapEvent(ev('subscription.canceled', { id: 'sub_1', custom_data: { schoolId: 'school-1' } }))).toEqual({
      type: 'subscription.canceled',
      eventId: 'evt_x',
      providerSubscriptionId: 'sub_1',
      schoolId: 'school-1',
    });
  });

  test('transaction.completed -> invoice.paid with minor units as-is', () => {
    expect(
      p.mapEvent(ev('transaction.completed', {
        id: 'txn_1',
        subscription_id: 'sub_1',
        currency_code: 'USD',
        custom_data: { schoolId: 'school-1' },
        details: { totals: { total: '30000', grand_total: '30000', currency_code: 'USD' } },
        payments: [{ status: 'captured', captured_at: '2026-10-05T01:00:00Z' }],
        billing_period: { starts_at: '2026-10-05T00:00:00Z', ends_at: '2026-11-05T00:00:00Z' },
      })),
    ).toEqual({
      type: 'invoice.paid',
      eventId: 'evt_x',
      providerInvoiceId: 'txn_1',
      providerSubscriptionId: 'sub_1',
      schoolId: 'school-1',
      amountCents: 30000,
      currency: 'USD',
      paidAt: new Date('2026-10-05T01:00:00Z'),
      periodStart: new Date('2026-10-05T00:00:00Z'),
      periodEnd: new Date('2026-11-05T00:00:00Z'),
    });
  });

  test('transaction.completed falls back to total and occurred_at; bad amounts are ignored', () => {
    expect(p.mapEvent(ev('transaction.completed', { id: 't', details: { totals: { total: '1999' } }, currency_code: 'usd' })))
      .toMatchObject({ amountCents: 1999, currency: 'USD', paidAt: new Date('2026-10-05T00:00:00Z'), providerSubscriptionId: null, schoolId: null });
    expect(p.mapEvent(ev('transaction.completed', { id: 't', details: { totals: { total: '19.99' } } })).type).toBe('ignored');
  });

  test('transaction.paid is ignored (completed reports the payment once)', () => {
    expect(p.mapEvent(ev('transaction.paid', { id: 't' }))).toEqual({ type: 'ignored', eventId: 'evt_x', reason: 'unhandled transaction.paid' });
  });

  test('transaction.payment_failed', () => {
    expect(p.mapEvent(ev('transaction.payment_failed', { id: 'txn_2', subscription_id: 'sub_1', custom_data: { schoolId: 'school-1' } }))).toEqual({
      type: 'invoice.payment_failed',
      eventId: 'evt_x',
      providerInvoiceId: 'txn_2',
      providerSubscriptionId: 'sub_1',
      schoolId: 'school-1',
    });
  });

  test('unknown events are ignored', () => {
    expect(p.mapEvent(ev('customer.updated', {})).type).toBe('ignored');
  });
});
