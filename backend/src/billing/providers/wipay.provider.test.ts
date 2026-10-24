import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { signParams, WiPayProvider } from './wipay.provider';
import { WebhookVerificationError } from './payment-provider';
import type { InvoicePaymentContext, WebhookRequest } from './payment-provider';
import { ProviderApiError } from './http';

const savedEnv = { ...process.env };
afterAll(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

const KEY = '123';

beforeEach(() => {
  process.env.WIPAY_ACCOUNT_NUMBER = '1234567890';
  process.env.WIPAY_API_KEY = KEY;
  process.env.WIPAY_ENV = 'sandbox';
  process.env.WIPAY_COUNTRY_CODE = 'TT';
  delete process.env.WIPAY_CURRENCY;
  delete process.env.WIPAY_FEE_STRUCTURE;
});

const INVOICE = '3f2b8c1e-7d4a-4c55-9a0e-1b2c3d4e5f60';
const CALLBACK = 'https://api.gb.test/api/billing/webhooks/wipay';

const ctx = (over: Partial<InvoicePaymentContext> = {}): InvoicePaymentContext => ({
  invoiceId: INVOICE,
  invoiceNumber: 'GB-202610-0001',
  schoolId: 'school-1',
  schoolName: 'St. Rose',
  customerEmail: 'admin@school.test',
  amountCents: 30000,
  currency: 'USD',
  description: 'GradeBook October 2026',
  successUrl: 'https://app.test/billing?checkout=success',
  cancelUrl: 'https://app.test/billing?checkout=cancel',
  callbackUrl: CALLBACK,
  ...over,
});

interface Call { url: string; init: RequestInit; form: URLSearchParams }

function stubFetch(status = 200, body: unknown = { url: 'https://tt.wipayfinancial.com/hosted/abc', message: 'OK', transaction_id: 'SB-12-1-x-20261001000000' }) {
  const calls: Call[] = [];
  const fetchFn = (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init!, form: new URLSearchParams(String(init?.body ?? '')) });
    return Promise.resolve(Response.json(body, { status }));
  };
  return { calls, fetchFn };
}

describe('WiPayProvider.isConfigured', () => {
  test('requires account + key and valid env/country/currency/fees', () => {
    const p = new WiPayProvider();
    expect(p.isConfigured()).toBe(true);
    expect(p.mode).toBe('invoice');
    process.env.WIPAY_COUNTRY_CODE = 'GD';
    expect(p.isConfigured()).toBe(false);
    process.env.WIPAY_COUNTRY_CODE = 'jm';
    expect(p.isConfigured()).toBe(true);
    process.env.WIPAY_CURRENCY = 'EUR';
    expect(p.isConfigured()).toBe(false);
    process.env.WIPAY_CURRENCY = 'JMD';
    process.env.WIPAY_FEE_STRUCTURE = 'free';
    expect(p.isConfigured()).toBe(false);
    process.env.WIPAY_FEE_STRUCTURE = 'customer_pay';
    process.env.WIPAY_ENV = 'prod';
    expect(p.isConfigured()).toBe(false);
    process.env.WIPAY_ENV = 'live';
    expect(p.isConfigured()).toBe(true);
    delete process.env.WIPAY_API_KEY;
    expect(p.isConfigured()).toBe(false);
  });
});

describe('WiPayProvider.payInvoice', () => {
  test('posts the documented form and returns the hosted page', async () => {
    const { calls, fetchFn } = stubFetch();
    const result = await new WiPayProvider({ fetch: fetchFn }).payInvoice(ctx());
    expect(result).toEqual({ redirectUrl: 'https://tt.wipayfinancial.com/hosted/abc', providerRef: 'SB-12-1-x-20261001000000' });

    const call = calls[0];
    expect(call.url).toBe('https://tt.wipayfinancial.com/plugins/payments/request');
    expect(call.init.method).toBe('POST');
    const headers = new Headers(call.init.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(call.init.redirect).toBe('manual');

    const f = call.form;
    expect(f.get('account_number')).toBe('1234567890');
    expect(f.get('total')).toBe('300.00');
    expect(f.get('currency')).toBe('USD');
    expect(f.get('country_code')).toBe('TT');
    expect(f.get('environment')).toBe('sandbox');
    expect(f.get('fee_structure')).toBe('merchant_absorb');
    expect(f.get('method')).toBe('credit_card');
    expect(f.get('avs')).toBe('0');
    expect(f.get('origin')).toBe('GradeBook');
    expect(f.get('email')).toBe('admin@school.test');
    // Never send the API key.
    expect(call.init.body).not.toContain(`=${KEY}&`);

    const orderId = f.get('order_id')!;
    expect(orderId).toMatch(/^[a-z0-9]{3,16}$/);

    const response = new URL(f.get('response_url')!);
    expect(response.origin + response.pathname).toBe(CALLBACK);
    expect(response.searchParams.get('gb_inv')).toBe(INVOICE);
    expect(response.searchParams.get('gb_amt')).toBe('300.00');
    expect(response.searchParams.get('gb_cur')).toBe('USD');
    expect(response.searchParams.get('gb_sig')).toBe(signParams(KEY, INVOICE, '300.00', 'USD', orderId));
    expect(f.get('response_url')!.length).toBeLessThanOrEqual(255);
  });

  test('order ids are unique per attempt', async () => {
    const { calls, fetchFn } = stubFetch();
    const p = new WiPayProvider({ fetch: fetchFn });
    await p.payInvoice(ctx());
    await p.payInvoice(ctx());
    expect(calls[0].form.get('order_id')).not.toBe(calls[1].form.get('order_id'));
  });

  test('country, currency and fee structure come from env; cents are exact', async () => {
    process.env.WIPAY_COUNTRY_CODE = 'jm';
    process.env.WIPAY_CURRENCY = 'jmd';
    process.env.WIPAY_FEE_STRUCTURE = 'customer_pay';
    process.env.WIPAY_ENV = 'live';
    const { calls, fetchFn } = stubFetch();
    await new WiPayProvider({ fetch: fetchFn }).payInvoice(ctx({ amountCents: 1999, currency: 'JMD' }));
    const f = calls[0].form;
    expect(calls[0].url).toBe('https://jm.wipayfinancial.com/plugins/payments/request');
    expect(f.get('total')).toBe('19.99');
    expect(f.get('currency')).toBe('JMD');
    expect(f.get('country_code')).toBe('JM');
    expect(f.get('fee_structure')).toBe('customer_pay');
    expect(f.get('environment')).toBe('live');
  });

  test('refuses a currency other than WIPAY_CURRENCY, and USD below 1.00', async () => {
    const { calls, fetchFn } = stubFetch();
    const p = new WiPayProvider({ fetch: fetchFn });
    await expect(p.payInvoice(ctx({ currency: 'TTD' }))).rejects.toThrow('WIPAY_CURRENCY=USD');
    await expect(p.payInvoice(ctx({ amountCents: 99 }))).rejects.toThrow('minimum');
    expect(calls.length).toBe(0);
  });

  test('a callback URL that would exceed 255 characters is refused', async () => {
    const { fetchFn } = stubFetch();
    await expect(
      new WiPayProvider({ fetch: fetchFn }).payInvoice(ctx({ callbackUrl: `https://api.gb.test/${'x'.repeat(200)}` })),
    ).rejects.toThrow('255');
  });

  test('a long email is left out', async () => {
    const { calls, fetchFn } = stubFetch();
    await new WiPayProvider({ fetch: fetchFn }).payInvoice(ctx({ customerEmail: `${'a'.repeat(45)}@school.test` }));
    expect(calls[0].form.get('email')).toBeNull();
  });

  test('error responses carry WiPay’s message', async () => {
    const { fetchFn } = stubFetch(400, { url: 'https://x/?status=error', message: 'Invalid account_number' });
    const err = await new WiPayProvider({ fetch: fetchFn }).payInvoice(ctx()).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderApiError);
    expect(err.message).toContain('Invalid account_number');
  });

  test('a redirect without JSON uses the Location header', async () => {
    const fetchFn = () => Promise.resolve(new Response(null, { status: 302, headers: { location: 'https://tt.wipayfinancial.com/hosted/xyz' } }));
    const result = await new WiPayProvider({ fetch: fetchFn }).payInvoice(ctx());
    expect(result.redirectUrl).toBe('https://tt.wipayfinancial.com/hosted/xyz');
    expect(result.providerRef).toMatch(/^gb/);
  });
});

describe('WiPayProvider.parseWebhook', () => {
  const ORDER = 'gbmabc1234ab12';
  const TXN = `SB-12-1-${ORDER}-20261001000000`;
  const md5 = (s: string) => createHash('md5').update(s).digest('hex');

  /** What the callback looks like after WiPay appends its parameters. */
  function callback(over: Record<string, string | undefined> = {}, amount = '300.00'): Record<string, string | undefined> {
    return {
      gb_inv: INVOICE,
      gb_amt: amount,
      gb_cur: 'USD',
      gb_sig: signParams(KEY, INVOICE, amount, 'USD', ORDER),
      status: 'success',
      transaction_id: TXN,
      order_id: ORDER,
      total: '300.00',
      currency: 'USD',
      message: '[1-R1]: Transaction is approved.',
      date: '2026-10-01 00:00:00',
      hash: md5(`${TXN}${amount}${KEY}`),
      ...over,
    };
  }
  const req = (query: Record<string, string | undefined>, extra: Partial<WebhookRequest> = {}): WebhookRequest => ({
    rawBody: Buffer.alloc(0),
    headers: {},
    query,
    ...extra,
  });
  const p = () => new WiPayProvider();

  test('success with a correct hash -> invoice.paid for our invoice', async () => {
    const [event] = await p().parseWebhook(req(callback()));
    expect(event).toMatchObject({
      type: 'invoice.paid',
      eventId: TXN,
      invoiceId: INVOICE,
      providerInvoiceId: TXN,
      amountCents: 30000,
      currency: 'USD',
    });
    expect(event.type === 'invoice.paid' && event.paidAt).toBeInstanceOf(Date);
  });

  test('the hash is over the ORIGINAL total, not WiPay’s final total (fees)', async () => {
    const [event] = await p().parseWebhook(req(callback({ total: '310.75' })));
    expect(event).toMatchObject({ type: 'invoice.paid', amountCents: 30000 });
  });

  test('uppercase hash is accepted; 19.99 converts exactly', async () => {
    const q = callback({}, '19.99');
    q.hash = q.hash!.toUpperCase();
    expect((await p().parseWebhook(req(q)))[0]).toMatchObject({ amountCents: 1999 });
  });

  test('incorrect hash is rejected', async () => {
    await expect(p().parseWebhook(req(callback({ hash: md5(`${TXN}300.00wrong-key`) })))).rejects.toBeInstanceOf(WebhookVerificationError);
    await expect(p().parseWebhook(req(callback({ hash: undefined })))).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test('tampered amount is rejected even with a matching WiPay hash', async () => {
    // An attacker lowers gb_amt and recomputes nothing: our signature fails.
    const tampered = callback({ gb_amt: '3.00', hash: md5(`${TXN}3.00${KEY}`) });
    await expect(p().parseWebhook(req(tampered))).rejects.toThrow('altered');
  });

  test('tampered invoice id or order id is rejected', async () => {
    await expect(p().parseWebhook(req(callback({ gb_inv: 'other-invoice' })))).rejects.toThrow('altered');
    await expect(p().parseWebhook(req(callback({ order_id: 'gbother' })))).rejects.toThrow('altered');
  });

  test('a transaction for a different order is rejected', async () => {
    const otherTxn = 'SB-12-1-gbsomethingelse-20261001000000';
    await expect(
      p().parseWebhook(req(callback({ transaction_id: otherTxn, hash: md5(`${otherTxn}300.00${KEY}`) }))),
    ).rejects.toThrow('does not match the order');
  });

  test('sandbox transactions are refused in live mode', async () => {
    process.env.WIPAY_ENV = 'live';
    await expect(p().parseWebhook(req(callback()))).rejects.toThrow('Sandbox');
  });

  test('missing parameters or API key are rejected', async () => {
    await expect(p().parseWebhook(req(callback({ gb_sig: undefined })))).rejects.toBeInstanceOf(WebhookVerificationError);
    await expect(p().parseWebhook(req({ status: 'success' }))).rejects.toBeInstanceOf(WebhookVerificationError);
    delete process.env.WIPAY_API_KEY;
    await expect(p().parseWebhook(req(callback()))).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test('failed -> invoice.payment_failed (no hash by design)', async () => {
    const q = callback({ status: 'failed', hash: undefined, message: '[N-R5101]: 3D Secure authentication failed.' });
    expect(await p().parseWebhook(req(q))).toEqual([
      { type: 'invoice.payment_failed', eventId: TXN, invoiceId: INVOICE, providerInvoiceId: TXN },
    ]);
  });

  test('error without a transaction id still maps, keyed by order', async () => {
    const q = callback({ status: 'error', hash: undefined, transaction_id: undefined });
    expect(await p().parseWebhook(req(q))).toEqual([
      { type: 'invoice.payment_failed', eventId: `${ORDER}:error`, invoiceId: INVOICE, providerInvoiceId: null },
    ]);
  });

  test('failed with altered parameters is still rejected', async () => {
    await expect(p().parseWebhook(req(callback({ status: 'failed', gb_inv: 'x' })))).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test('unknown status is ignored', async () => {
    expect((await p().parseWebhook(req(callback({ status: 'pending', hash: undefined }))))[0]).toMatchObject({ type: 'ignored' });
  });

  test('handles WiPay appending with a second "?"', async () => {
    const q = callback();
    const { status, transaction_id, order_id, hash, gb_sig, ...ours } = q;
    const broken = { ...ours, gb_sig: `${gb_sig}?status=${status}`, transaction_id, order_id, hash };
    expect((await p().parseWebhook(req(broken)))[0]).toMatchObject({ type: 'invoice.paid', invoiceId: INVOICE });
  });

  test('accepts a form-encoded POST body', async () => {
    const body = new URLSearchParams(callback() as Record<string, string>).toString();
    const [event] = await p().parseWebhook(
      req({}, { rawBody: Buffer.from(body), headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
    );
    expect(event).toMatchObject({ type: 'invoice.paid', invoiceId: INVOICE });
  });
});
