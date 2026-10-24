import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import Stripe from 'stripe';
import { StripeProvider } from './stripe.provider';
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

const SECRET = 'whsec_test_secret';

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  delete process.env.STRIPE_PRICE_PER_USER;
  delete process.env.STRIPE_PRICE_FLAT;
});

interface Call {
  method: string;
  path: string;
  body: URLSearchParams;
  headers: Headers;
}

type Route = (call: Call) => { status?: number; body: unknown } | undefined;

/** A fetch stub that records Stripe API calls and answers from `routes`. */
function stubFetch(routes: Route[]) {
  const calls: Call[] = [];
  const fetchFn = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      body: new URLSearchParams(
        typeof init?.body === 'string' ? init.body : url.search,
      ),
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    for (const route of routes) {
      const res = route(call);
      if (res) {
        return Promise.resolve(
          new Response(JSON.stringify(res.body), {
            status: res.status ?? 200,
            headers: { 'content-type': 'application/json', 'request-id': 'req_1' },
          }),
        );
      }
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({ error: { message: `no route for ${call.path}`, type: 'invalid_request_error' } }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      ),
    );
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

const session = { id: 'cs_test_1', object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/cs_test_1', customer: null };
const subscription = (over: Record<string, unknown> = {}) => ({
  id: 'sub_1',
  object: 'subscription',
  customer: 'cus_1',
  metadata: { schoolId: 'school-1', plan: 'per_user' },
  items: { object: 'list', data: [{ id: 'si_1', object: 'subscription_item', quantity: 10 }] },
  ...over,
});

describe('StripeProvider.isConfigured', () => {
  test('needs both the secret key and webhook secret', () => {
    const p = new StripeProvider();
    expect(p.isConfigured()).toBe(true);
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(p.isConfigured()).toBe(false);
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.STRIPE_SECRET_KEY = '  ';
    expect(p.isConfigured()).toBe(false);
  });

  test('identity', () => {
    const p = new StripeProvider();
    expect(p.id).toBe('stripe');
    expect(p.mode).toBe('subscription');
  });
});

describe('StripeProvider.createCheckout', () => {
  test('inline price on a stable product, quantity, metadata, URLs, idempotency', async () => {
    const { calls, fetchFn } = stubFetch([
      (c) => (c.method === 'GET' && c.path === '/v1/products/gradebook_per_user'
        ? { status: 404, body: { error: { type: 'invalid_request_error', message: 'No such product', code: 'resource_missing' } } }
        : undefined),
      (c) => (c.method === 'POST' && c.path === '/v1/products' ? { body: { id: 'gradebook_per_user', object: 'product' } } : undefined),
      (c) => (c.path === '/v1/checkout/sessions' ? { body: session } : undefined),
    ]);
    const p = new StripeProvider({ fetch: fetchFn });
    const result = await p.createCheckout(ctx());

    expect(result).toEqual({
      redirectUrl: session.url,
      providerRef: 'cs_test_1',
      providerCustomerId: null,
    });

    const product = calls.find((c) => c.method === 'POST' && c.path === '/v1/products')!;
    expect(product.body.get('id')).toBe('gradebook_per_user');
    expect(product.body.get('name')).toBe('GradeBook per user');

    const create = calls.find((c) => c.path === '/v1/checkout/sessions')!;
    const b = create.body;
    expect(create.method).toBe('POST');
    expect(b.get('mode')).toBe('subscription');
    expect(b.get('line_items[0][quantity]')).toBe('42');
    expect(b.get('line_items[0][price_data][unit_amount]')).toBe('500');
    expect(b.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(b.get('line_items[0][price_data][product]')).toBe('gradebook_per_user');
    expect(b.get('line_items[0][price_data][recurring][interval]')).toBe('month');
    expect(b.get('metadata[schoolId]')).toBe('school-1');
    expect(b.get('subscription_data[metadata][schoolId]')).toBe('school-1');
    expect(b.get('subscription_data[metadata][plan]')).toBe('per_user');
    expect(b.get('client_reference_id')).toBe('school-1');
    expect(b.get('success_url')).toBe('https://app.test/billing?checkout=success');
    expect(b.get('cancel_url')).toBe('https://app.test/billing?checkout=cancel');
    expect(b.get('customer_email')).toBe('admin@school.test');
    expect(b.get('customer')).toBeNull();
    expect(create.headers.get('idempotency-key')).toBe('idem-1');
    expect(create.headers.get('authorization')).toBe('Bearer sk_test_123');

    // The product is remembered: a second checkout skips the lookup.
    await p.createCheckout(ctx({ idempotencyKey: 'idem-2' }));
    expect(calls.filter((c) => c.path.startsWith('/v1/products')).length).toBe(2);
  });

  test('flat plan: quantity 1, existing product, reuses the customer', async () => {
    const { calls, fetchFn } = stubFetch([
      (c) => (c.path === '/v1/products/gradebook_flat' ? { body: { id: 'gradebook_flat', object: 'product' } } : undefined),
      (c) => (c.path === '/v1/checkout/sessions' ? { body: { ...session, customer: 'cus_9' } } : undefined),
    ]);
    const p = new StripeProvider({ fetch: fetchFn });
    const result = await p.createCheckout(
      ctx({
        price: { plan: 'flat', unitAmountCents: 30000, currency: 'USD', interval: 'month' },
        quantity: 99,
        providerCustomerId: 'cus_9',
      }),
    );
    expect(result.providerCustomerId).toBe('cus_9');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/products')).toBe(false);
    const b = calls.find((c) => c.path === '/v1/checkout/sessions')!.body;
    expect(b.get('line_items[0][quantity]')).toBe('1');
    expect(b.get('line_items[0][price_data][unit_amount]')).toBe('30000');
    expect(b.get('line_items[0][price_data][product]')).toBe('gradebook_flat');
    expect(b.get('customer')).toBe('cus_9');
    expect(b.get('customer_email')).toBeNull();
  });

  test('configured price ids are used instead of inline prices', async () => {
    process.env.STRIPE_PRICE_PER_USER = 'price_seat';
    const { calls, fetchFn } = stubFetch([
      (c) => (c.path === '/v1/checkout/sessions' ? { body: session } : undefined),
    ]);
    await new StripeProvider({ fetch: fetchFn }).createCheckout(ctx());
    expect(calls.length).toBe(1);
    const b = calls[0].body;
    expect(b.get('line_items[0][price]')).toBe('price_seat');
    expect(b.get('line_items[0][price_data][unit_amount]')).toBeNull();
    expect(b.get('line_items[0][quantity]')).toBe('42');
  });

  test('API errors carry Stripe’s message but not the key', async () => {
    process.env.STRIPE_PRICE_PER_USER = 'price_seat';
    const { fetchFn } = stubFetch([
      (c) => (c.path === '/v1/checkout/sessions'
        ? { status: 400, body: { error: { type: 'invalid_request_error', message: 'No such price: price_seat', code: 'resource_missing' } } }
        : undefined),
    ]);
    const err = await new StripeProvider({ fetch: fetchFn }).createCheckout(ctx()).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderApiError);
    expect(err.message).toContain('No such price: price_seat');
    expect(err.message).not.toContain('sk_test_123');
  });

  test('throws without a secret key', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await expect(new StripeProvider().createCheckout(ctx())).rejects.toThrow('STRIPE_SECRET_KEY');
  });
});

describe('StripeProvider subscription changes', () => {
  const ref = { providerSubscriptionId: 'sub_1', providerCustomerId: 'cus_1', plan: 'per_user' as const };

  function api() {
    return stubFetch([
      (c) => (c.method === 'GET' && c.path === '/v1/subscriptions/sub_1' ? { body: subscription() } : undefined),
      (c) => (c.path.startsWith('/v1/products/') ? { body: { id: c.path.split('/').pop(), object: 'product' } } : undefined),
      (c) => (c.path === '/v1/subscriptions/sub_1' ? { body: subscription() } : undefined),
      (c) => (c.path === '/v1/billing_portal/sessions' ? { body: { id: 'bps_1', object: 'billing_portal.session', url: 'https://billing.stripe.com/p/session/1' } } : undefined),
    ]);
  }

  test('updateQuantity updates the item with prorations', async () => {
    const { calls, fetchFn } = api();
    await new StripeProvider({ fetch: fetchFn }).updateQuantity(ref, 57);
    const update = calls.find((c) => c.method === 'POST' && c.path === '/v1/subscriptions/sub_1')!;
    expect(update.body.get('items[0][id]')).toBe('si_1');
    expect(update.body.get('items[0][quantity]')).toBe('57');
    expect(update.body.get('proration_behavior')).toBe('create_prorations');
  });

  test('changePlan swaps the item price and records the plan', async () => {
    const { calls, fetchFn } = api();
    await new StripeProvider({ fetch: fetchFn }).changePlan(
      ref,
      { plan: 'flat', unitAmountCents: 30000, currency: 'USD', interval: 'month' },
      80,
    );
    const update = calls.find((c) => c.method === 'POST' && c.path === '/v1/subscriptions/sub_1')!;
    expect(update.body.get('items[0][id]')).toBe('si_1');
    expect(update.body.get('items[0][price_data][unit_amount]')).toBe('30000');
    expect(update.body.get('items[0][price_data][product]')).toBe('gradebook_flat');
    expect(update.body.get('items[0][quantity]')).toBe('1');
    expect(update.body.get('metadata[plan]')).toBe('flat');
    expect(update.body.get('metadata[schoolId]')).toBe('school-1');
    expect(update.body.get('proration_behavior')).toBe('create_prorations');
  });

  test('changePlan with a configured price id', async () => {
    process.env.STRIPE_PRICE_PER_USER = 'price_seat';
    const { calls, fetchFn } = api();
    await new StripeProvider({ fetch: fetchFn }).changePlan(
      { ...ref, plan: 'flat' },
      { plan: 'per_user', unitAmountCents: 500, currency: 'USD', interval: 'month' },
      12,
    );
    const update = calls.find((c) => c.method === 'POST' && c.path === '/v1/subscriptions/sub_1')!;
    expect(update.body.get('items[0][price]')).toBe('price_seat');
    expect(update.body.get('items[0][quantity]')).toBe('12');
  });

  test('cancel at period end, immediately, and resume', async () => {
    const { calls, fetchFn } = api();
    const p = new StripeProvider({ fetch: fetchFn });
    await p.cancel(ref, { atPeriodEnd: true });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body.get('cancel_at_period_end')).toBe('true');

    await p.cancel(ref, { atPeriodEnd: false });
    expect(calls[1].method).toBe('DELETE');
    expect(calls[1].path).toBe('/v1/subscriptions/sub_1');

    await p.resume(ref);
    expect(calls[2].body.get('cancel_at_period_end')).toBe('false');
  });

  test('portalUrl uses the customer, looking it up when unknown', async () => {
    const { calls, fetchFn } = api();
    const p = new StripeProvider({ fetch: fetchFn });
    expect(await p.portalUrl(ref, 'https://app.test/billing')).toBe('https://billing.stripe.com/p/session/1');
    const portal = calls.find((c) => c.path === '/v1/billing_portal/sessions')!;
    expect(portal.body.get('customer')).toBe('cus_1');
    expect(portal.body.get('return_url')).toBe('https://app.test/billing');

    calls.length = 0;
    await p.portalUrl({ ...ref, providerCustomerId: null }, 'https://app.test/billing');
    expect(calls[0].path).toBe('/v1/subscriptions/sub_1');
    expect(calls[1].body.get('customer')).toBe('cus_1');
  });
});

describe('StripeProvider.parseWebhook', () => {
  async function signed(event: object, secret = SECRET, timestamp?: number): Promise<WebhookRequest> {
    const payload = JSON.stringify(event);
    const header = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload,
      secret,
      ...(timestamp ? { timestamp } : {}),
    });
    return {
      rawBody: Buffer.from(payload),
      headers: { 'stripe-signature': header },
      query: {},
    };
  }

  const subEvent = {
    id: 'evt_1',
    object: 'event',
    type: 'customer.subscription.updated',
    created: 1_760_000_000,
    data: {
      object: {
        id: 'sub_1',
        object: 'subscription',
        customer: 'cus_1',
        status: 'active',
        cancel_at_period_end: false,
        cancel_at: null,
        metadata: { schoolId: 'school-1', plan: 'per_user' },
        items: {
          data: [
            {
              id: 'si_1',
              quantity: 12,
              current_period_start: 1_760_000_000,
              current_period_end: 1_762_592_000,
              price: { id: 'price_x', product: 'gradebook_per_user' },
            },
          ],
        },
      },
    },
  };

  test('verifies the signature and maps the event', async () => {
    const events = await new StripeProvider().parseWebhook(await signed(subEvent));
    expect(events).toEqual([
      {
        type: 'subscription.updated',
        eventId: 'evt_1',
        providerSubscriptionId: 'sub_1',
        providerCustomerId: 'cus_1',
        schoolId: 'school-1',
        status: 'active',
        plan: 'per_user',
        quantity: 12,
        currentPeriodStart: new Date(1_760_000_000_000),
        currentPeriodEnd: new Date(1_762_592_000_000),
        cancelAtPeriodEnd: false,
      },
    ]);
  });

  test('rejects a wrong secret', async () => {
    const req = await signed(subEvent, 'whsec_other');
    await expect(new StripeProvider().parseWebhook(req)).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test('rejects a tampered body', async () => {
    const req = await signed(subEvent);
    req.rawBody = Buffer.from(req.rawBody.toString().replace('"active"', '"canceled"'));
    await expect(new StripeProvider().parseWebhook(req)).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test('rejects an old timestamp', async () => {
    const req = await signed(subEvent, SECRET, Math.floor(Date.now() / 1000) - 3600);
    await expect(new StripeProvider().parseWebhook(req)).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test('rejects a missing header or missing secret', async () => {
    const req = await signed(subEvent);
    await expect(
      new StripeProvider().parseWebhook({ ...req, headers: {} }),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
    delete process.env.STRIPE_WEBHOOK_SECRET;
    await expect(new StripeProvider().parseWebhook(req)).rejects.toBeInstanceOf(WebhookVerificationError);
  });
});

describe('StripeProvider.mapEvent', () => {
  const p = new StripeProvider();
  const ev = (type: string, object: object) => ({ id: 'evt_x', object: 'event', type, created: 1_760_000_000, data: { object } }) as unknown as Stripe.Event;

  test('checkout.session.completed', () => {
    expect(
      p.mapEvent(ev('checkout.session.completed', {
        mode: 'subscription',
        subscription: 'sub_1',
        customer: 'cus_1',
        payment_status: 'paid',
        client_reference_id: 'school-1',
        metadata: { schoolId: 'school-1', plan: 'flat' },
      })),
    ).toEqual({
      type: 'subscription.updated',
      eventId: 'evt_x',
      providerSubscriptionId: 'sub_1',
      providerCustomerId: 'cus_1',
      schoolId: 'school-1',
      status: 'active',
      plan: 'flat',
    });

    const unpaid = p.mapEvent(ev('checkout.session.completed', {
      mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', payment_status: 'unpaid', metadata: {},
      client_reference_id: 'school-2',
    }));
    expect(unpaid).toMatchObject({ status: 'incomplete', schoolId: 'school-2', plan: null });

    expect(p.mapEvent(ev('checkout.session.completed', { mode: 'payment', subscription: null })).type).toBe('ignored');
  });

  test.each([
    ['trialing', 'trialing'],
    ['active', 'active'],
    ['past_due', 'past_due'],
    ['unpaid', 'unpaid'],
    ['canceled', 'canceled'],
    ['incomplete', 'incomplete'],
    ['incomplete_expired', 'canceled'],
    ['paused', 'past_due'],
    ['something_new', 'incomplete'],
  ])('subscription status %s -> %s', (stripeStatus, status) => {
    const mapped = p.mapEvent(ev('customer.subscription.created', {
      id: 'sub_1', customer: { id: 'cus_1' }, status: stripeStatus, cancel_at_period_end: false, cancel_at: null,
      metadata: {}, items: { data: [{ quantity: 3, price: { id: 'price_other', product: 'gradebook_flat' } }] },
    }));
    expect(mapped).toMatchObject({ type: 'subscription.updated', status, providerCustomerId: 'cus_1', plan: 'flat', schoolId: null });
  });

  test('cancel_at counts as a pending cancel; plan from configured price', () => {
    process.env.STRIPE_PRICE_PER_USER = 'price_seat';
    const mapped = p.mapEvent(ev('customer.subscription.updated', {
      id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, cancel_at: 1_762_592_000,
      metadata: {}, items: { data: [{ quantity: 3, price: { id: 'price_seat', product: 'prod_x' } }] },
    }));
    expect(mapped).toMatchObject({ cancelAtPeriodEnd: true, plan: 'per_user' });
  });

  test('customer.subscription.deleted', () => {
    expect(p.mapEvent(ev('customer.subscription.deleted', { id: 'sub_1', metadata: { schoolId: 'school-1' } }))).toEqual({
      type: 'subscription.canceled',
      eventId: 'evt_x',
      providerSubscriptionId: 'sub_1',
      schoolId: 'school-1',
    });
  });

  test('invoice.paid', () => {
    expect(
      p.mapEvent(ev('invoice.paid', {
        id: 'in_1',
        amount_paid: 21000,
        currency: 'usd',
        status_transitions: { paid_at: 1_760_000_100 },
        period_start: 1, period_end: 2,
        parent: { subscription_details: { subscription: 'sub_1', metadata: { schoolId: 'school-1' } } },
        lines: { data: [{ period: { start: 1_760_000_000, end: 1_762_592_000 } }] },
      })),
    ).toEqual({
      type: 'invoice.paid',
      eventId: 'evt_x',
      providerInvoiceId: 'in_1',
      providerSubscriptionId: 'sub_1',
      schoolId: 'school-1',
      amountCents: 21000,
      currency: 'USD',
      paidAt: new Date(1_760_000_100_000),
      periodStart: new Date(1_760_000_000_000),
      periodEnd: new Date(1_762_592_000_000),
    });
  });

  test('invoice.payment_failed', () => {
    expect(
      p.mapEvent(ev('invoice.payment_failed', {
        id: 'in_2',
        parent: { subscription_details: { subscription: { id: 'sub_1' }, metadata: {} } },
      })),
    ).toEqual({
      type: 'invoice.payment_failed',
      eventId: 'evt_x',
      providerInvoiceId: 'in_2',
      providerSubscriptionId: 'sub_1',
      schoolId: null,
    });
  });

  test('unknown events are ignored', () => {
    expect(p.mapEvent(ev('charge.refunded', {}))).toEqual({
      type: 'ignored',
      eventId: 'evt_x',
      reason: 'unhandled charge.refunded',
    });
  });
});
