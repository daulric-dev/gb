/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import Fastify from 'fastify';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { createMockPrisma } from '@/test/prisma-mock';
import { FakeProvider } from '@/test/billing-fakes';
import { BillingRegistry } from './billing.registry';
import { BillingWebhookController } from './billing-webhook.controller';
import { registerWebhookRawBody } from './raw-body';
import { WebhookVerificationError } from './providers/payment-provider';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

let provider: FakeProvider;
let handle: ReturnType<typeof mock>;
let controller: BillingWebhookController;

beforeEach(() => {
  process.env.APP_URL = 'https://app.gb.test';
  provider = new FakeProvider('subp');
  handle = mock(async () => 1);
  const registry = new BillingRegistry(createMockPrisma() as never, [provider]);
  controller = new BillingWebhookController(registry, { handle } as never);
});

const req = (over: Record<string, unknown> = {}) =>
  ({ method: 'POST', rawBody: Buffer.from('{"a":1}'), headers: { 'stripe-signature': 't=1' }, query: { x: '1' }, ...over }) as never;

function replyMock() {
  const reply: any = { sent: undefined, code: undefined };
  reply.status = mock((code: number) => ((reply.code = code), reply));
  reply.send = mock((body: unknown) => ((reply.sent = body), reply));
  reply.redirect = mock((url: string, _code?: number) => url);
  return reply;
}

describe('BillingWebhookController', () => {
  test('passes the exact raw body, headers and query to the provider', async () => {
    const reply = replyMock();
    await controller.post('subp', req(), reply);
    expect(reply.code).toBe(200);
    expect(reply.sent).toEqual({ received: true });
    const arg = provider.parseWebhook.mock.calls[0][0] as any;
    expect(arg.rawBody.toString()).toBe('{"a":1}');
    expect(arg.headers['stripe-signature']).toBe('t=1');
    expect(arg.query).toEqual({ x: '1' });
    expect(handle).toHaveBeenCalledTimes(1);
  });

  test('unknown or unconfigured provider: 404', async () => {
    await expect(controller.post('nope', req(), replyMock())).rejects.toBeInstanceOf(NotFoundException);
    provider.configured = false;
    await expect(controller.post('subp', req(), replyMock())).rejects.toBeInstanceOf(NotFoundException);
  });

  test('verification failure: 400, nothing applied', async () => {
    provider.parseWebhook.mockRejectedValue(new WebhookVerificationError('bad sig'));
    await expect(controller.post('subp', req(), replyMock())).rejects.toBeInstanceOf(BadRequestException);
    expect(handle).not.toHaveBeenCalled();
  });

  test('any other failure: 500 so the provider retries', async () => {
    provider.parseWebhook.mockRejectedValue(new Error('boom'));
    await expect(controller.post('subp', req(), replyMock())).rejects.toBeInstanceOf(InternalServerErrorException);
    provider.parseWebhook.mockResolvedValue([]);
    handle.mockRejectedValue(new Error('db'));
    await expect(controller.post('subp', req(), replyMock())).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  test('GET (hosted-page return) redirects to the billing page', async () => {
    const reply = replyMock();
    provider.parseWebhook.mockResolvedValue([{ type: 'invoice.paid', eventId: 'e', invoiceId: 'i', amountCents: 1, currency: 'USD', paidAt: new Date() }]);
    await controller.get('subp', req({ method: 'GET', rawBody: undefined }), reply);
    expect(reply.redirect.mock.calls[0]).toEqual(['https://app.gb.test/dashboard/settings/billing?checkout=success', 302]);
    provider.parseWebhook.mockRejectedValue(new WebhookVerificationError('bad'));
    await controller.get('subp', req({ method: 'GET', rawBody: undefined }), reply);
    expect(reply.redirect.mock.calls[1][0]).toEndWith('checkout=cancel');
  });

  test('a browser form POST (Accept: text/html) also redirects', async () => {
    const reply = replyMock();
    provider.parseWebhook.mockResolvedValue([{ type: 'invoice.paid', eventId: 'e', invoiceId: 'i', amountCents: 1, currency: 'USD', paidAt: new Date() }]);
    await controller.post('subp', req({ headers: { accept: 'text/html,application/xhtml+xml' } }), reply);
    expect(reply.redirect.mock.calls[0][0]).toEndWith('checkout=success');
    expect(handle).toHaveBeenCalledTimes(1);
  });
});

describe('raw body capture', () => {
  async function app() {
    const f = Fastify();
    registerWebhookRawBody(f);
    f.post('/api/billing/webhooks/:id', async (r) => ({
      raw: (r as unknown as { rawBody?: Buffer }).rawBody?.toString('base64') ?? null,
      body: Buffer.isBuffer(r.body) ? 'buffer' : r.body,
    }));
    f.post('/api/other', async (r) => ({
      raw: (r as unknown as { rawBody?: Buffer }).rawBody ?? null,
      body: r.body,
    }));
    await f.ready();
    return f;
  }

  test('webhook route keeps the exact bytes and still parses JSON', async () => {
    const f = await app();
    const payload = '{ "id":"evt_1",  "amount": 10 }';
    const res = await f.inject({ method: 'POST', url: '/api/billing/webhooks/stripe', headers: { 'content-type': 'application/json' }, payload });
    const json = res.json();
    expect(Buffer.from(json.raw, 'base64').toString()).toBe(payload);
    expect(json.body).toEqual({ id: 'evt_1', amount: 10 });
    await f.close();
  });

  test('webhook route accepts content types nobody else does, as a buffer', async () => {
    const f = await app();
    const res = await f.inject({ method: 'POST', url: '/api/billing/webhooks/wipay', headers: { 'content-type': 'application/xml' }, payload: '<x/>' });
    expect(res.statusCode).toBe(200);
    expect(Buffer.from(res.json().raw, 'base64').toString()).toBe('<x/>');
    expect(res.json().body).toBe('buffer');
    await f.close();
  });

  test('other routes: JSON unchanged, no raw body, unknown types still 415', async () => {
    const f = await app();
    const ok = await f.inject({ method: 'POST', url: '/api/other', headers: { 'content-type': 'application/json' }, payload: '{"a":1}' });
    expect(ok.json()).toEqual({ raw: null, body: { a: 1 } });
    const bad = await f.inject({ method: 'POST', url: '/api/other', headers: { 'content-type': 'application/xml' }, payload: '<x/>' });
    expect(bad.statusCode).toBe(415);
    await f.close();
  });
});
