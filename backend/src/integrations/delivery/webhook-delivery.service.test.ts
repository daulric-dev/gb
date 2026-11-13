import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { encryptWebhookHeaderValue, encryptWebhookSecret } from '@/integrations/webhooks/webhook-secret';
import { IntegrationAuditService } from '@/integrations/audit/integration-audit.service';
import { envelopeBody, WebhookDeliveryService } from './webhook-delivery.service';
import { signWebhook } from './webhook-sender';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const HOOK = '22222222-2222-4222-8222-222222222222';
const DELIVERY = '33333333-3333-4333-8333-333333333333';

const saved = { ...process.env };
beforeEach(() => {
  process.env.AUTH_SECRET = 'a'.repeat(40);
});
afterEach(() => {
  for (const k of ['WEBHOOK_MAX_ATTEMPTS', 'WEBHOOK_MAX_CONSECUTIVE_FAILURES']) delete process.env[k];
  process.env.AUTH_SECRET = saved.AUTH_SECRET;
});

const EVENT = '44444444-4444-4444-8444-444444444444';
const COURSE = { id: '55555555-5555-4555-8555-555555555555', name: 'Maths', code: null };
// Keys out of order, as jsonb hands them back.
const payload = {
  data: { course: COURSE, createdBy: null, school: { id: SCHOOL, name: 'Riverside' } },
  message: 'Maths was created',
  event_type: 'course.created',
};
/** A delivery stored before the three-key body. */
const legacyPayload = {
  data: { course: COURSE, createdBy: null },
  school: { id: SCHOOL, name: 'Riverside' },
  createdAt: '2026-11-04T09:00:00.000Z',
  apiVersion: 1,
  type: 'course.created',
  id: EVENT,
};

function setup(opts: {
  attempts?: number;
  enabled?: boolean;
  feature?: boolean;
  failures?: number;
  status?: number;
  secretEnc?: string;
  headers?: { id: string; name: string; value_enc: string }[];
  body?: string;
  payload?: unknown;
  url?: string;
  verifyTls?: boolean;
  ca?: string | null;
} = {}) {
  const prisma: MockPrisma = createMockPrisma();
  const tx = createMockPrisma();
  prisma.$transaction.mockImplementation(async (arg: any) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg)));
  const hook = {
    id: HOOK,
    school_id: SCHOOL,
    name: 'SIS',
    url: opts.url ?? 'http://sis.internal/hooks',
    secret_enc: opts.secretEnc ?? encryptWebhookSecret({ schoolId: SCHOOL, webhookId: HOOK }, 'whsec_x'),
    enabled: opts.enabled ?? true,
    verify_tls: opts.verifyTls ?? true,
    tls_ca_cert: opts.ca ?? null,
    headers: opts.headers ?? [],
  };
  prisma.webhook_delivery.findUnique.mockResolvedValue({
    id: DELIVERY,
    webhook_id: HOOK,
    school_id: SCHOOL,
    event_id: EVENT,
    event_type: 'course.created',
    payload: opts.payload ?? payload,
    status: 'pending',
    attempts: opts.attempts ?? 0,
    webhook: hook,
  });
  prisma.school_webhook.update.mockResolvedValue({
    consecutive_failures: (opts.failures ?? 0) + 1,
    enabled: true,
  });
  tx.school_webhook.updateMany.mockResolvedValue({ count: 1 });
  const features = { isEnabled: mock(async () => opts.feature ?? true) };
  const alerts = { autoDisabled: mock(async () => {}) };
  const queue = { addBulk: mock(async () => []) };
  const service = new WebhookDeliveryService(
    prisma as any,
    features as any,
    new IntegrationAuditService(prisma as any),
    alerts as any,
    queue as any,
  );
  const calls: { url: string; init: RequestInit }[] = [];
  service.fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(opts.body ?? 'received', { status: opts.status ?? 200 });
  };
  service.random = () => 0.5;
  const updates = () => prisma.webhook_delivery.update.mock.calls.map((c: any[]) => c[0].data);
  return { service, prisma, tx, alerts, queue, calls, updates };
}

describe('WebhookDeliveryService.attempt', () => {
  test('a 2xx marks the delivery succeeded and resets the failure count', async () => {
    const { service, prisma, calls } = setup();
    const r = await service.attempt(DELIVERY);
    expect(r?.ok).toBe(true);
    const data = prisma.webhook_delivery.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'succeeded', attempts: 1, next_attempt_at: null, last_status_code: 200 });
    expect(data.delivered_at).toBeInstanceOf(Date);
    expect(prisma.school_webhook.updateMany.mock.calls[0][0]).toEqual({
      where: { id: HOOK, consecutive_failures: { gt: 0 } },
      data: { consecutive_failures: 0 },
    });
    // Signed with the decrypted secret over the exact body sent.
    const h = calls[0].init.headers as Record<string, string>;
    const body = calls[0].init.body as string;
    expect(body).toBe(envelopeBody(payload));
    expect(Object.keys(JSON.parse(body))).toEqual(['event_type', 'message', 'data']);
    expect(JSON.parse(body).event_type).toBe(h['X-GradeBook-Event']);
    expect(h['X-GradeBook-Signature']).toBe(signWebhook('whsec_x', Number(h['X-GradeBook-Timestamp']), body));
    expect(h['X-GradeBook-Delivery']).toBe(DELIVERY);
    expect(h['X-GradeBook-Event-Id']).toBe(EVENT);
    expect(h['X-GradeBook-School-Id']).toBe(SCHOOL);
    expect(h['X-GradeBook-Api-Version']).toBe('1');
    // Already in the new shape: the stored payload is left alone.
    expect(data.payload).toBeUndefined();
  });

  test('TLS: http has none (tls_verified null); https verifies by default, or not when off, recorded per attempt', async () => {
    const http = setup({ verifyTls: false });
    await http.service.attempt(DELIVERY);
    expect((http.calls[0].init as any).tls).toBeUndefined();
    expect(http.updates()[0].tls_verified).toBeNull();

    const on = setup({ url: 'https://sis.example/hooks', ca: 'PEM' });
    await on.service.attempt(DELIVERY);
    expect((on.calls[0].init as any).tls).toEqual({ rejectUnauthorized: true, ca: 'PEM' });
    expect(on.updates()[0].tls_verified).toBe(true);

    const off = setup({ url: 'https://sis.example/hooks', verifyTls: false });
    await off.service.sendNow(DELIVERY);
    expect((off.calls[0].init as any).tls).toEqual({ rejectUnauthorized: false });
    expect(off.updates()[0].tls_verified).toBe(false);
  });

  test('a delivery queued in the old shape is sent (and stored) as the three-key envelope', async () => {
    const { service, calls, updates } = setup({ payload: legacyPayload, status: 500 });
    await service.attempt(DELIVERY);
    const body = calls[0].init.body as string;
    const sent = JSON.parse(body);
    expect(Object.keys(sent)).toEqual(['event_type', 'message', 'data']);
    expect(sent).toEqual({
      event_type: 'course.created',
      message: 'Maths was created',
      data: { school: { id: SCHOOL, name: 'Riverside' }, course: COURSE, createdBy: null },
    });
    const h = calls[0].init.headers as Record<string, string>;
    expect(h['X-GradeBook-Event-Id']).toBe(EVENT);
    expect(h['X-GradeBook-Signature']).toBe(signWebhook('whsec_x', Number(h['X-GradeBook-Timestamp']), body));
    // Written back with the outcome (retry included), so the row shows what was sent.
    expect(updates()[0].payload).toEqual(sent);
  });

  test('a failure is retried later with backoff, queued in Redis mode, and counted', async () => {
    const { service, updates, queue, prisma } = setup({ status: 500 });
    const before = Date.now();
    await service.attempt(DELIVERY);
    const data = updates()[0];
    expect(data).toMatchObject({ status: 'pending', attempts: 1, last_status_code: 500, last_error: 'HTTP 500' });
    expect((data.next_attempt_at as Date).getTime() - before).toBeGreaterThanOrEqual(60_000 - 50);
    expect((queue.addBulk.mock.calls[0] as any[])[0][0]).toMatchObject({ data: { deliveryId: DELIVERY }, opts: { delay: 60_000 } });
    expect(prisma.school_webhook.update.mock.calls[0][0].data).toEqual({ consecutive_failures: { increment: 1 } });
  });

  test('the last attempt abandons the delivery', async () => {
    const { service, updates, queue } = setup({ status: 502, attempts: 7 });
    await service.attempt(DELIVERY);
    expect(updates()[0]).toMatchObject({ status: 'abandoned', attempts: 8, next_attempt_at: null });
    expect(queue.addBulk).not.toHaveBeenCalled();
  });

  test('after N consecutive failures the webhook switches itself off, logs it and alerts once', async () => {
    process.env.WEBHOOK_MAX_CONSECUTIVE_FAILURES = '3';
    const { service, tx, alerts } = setup({ status: 500, failures: 2 });
    await service.attempt(DELIVERY);
    await new Promise((r) => setTimeout(r, 0));
    const off = tx.school_webhook.updateMany.mock.calls[0][0];
    expect(off.where).toEqual({ id: HOOK, enabled: true });
    expect(off.data).toMatchObject({ enabled: false });
    expect(off.data.disabled_reason).toContain('3 failed deliveries');
    const audit = tx.integration_audit_log.createMany.mock.calls[0][0].data[0];
    expect(audit).toMatchObject({ action: 'webhook_auto_disabled', actor_via: 'system', actor_id: null, webhook_id: HOOK });
    expect(alerts.autoDisabled).toHaveBeenCalledTimes(1);
    expect((alerts.autoDisabled.mock.calls[0] as any[])[2]).toBe(3);
  });

  test('below the threshold nothing is switched off', async () => {
    const { service, tx, alerts } = setup({ status: 500, failures: 0 });
    await service.attempt(DELIVERY);
    expect(tx.school_webhook.updateMany).not.toHaveBeenCalled();
    expect(alerts.autoDisabled).not.toHaveBeenCalled();
  });

  test('a switched-off webhook or integrations feature sends nothing', async () => {
    for (const opts of [{ enabled: false }, { feature: false }]) {
      const { service, updates, calls } = setup(opts);
      await service.attempt(DELIVERY);
      expect(calls).toHaveLength(0);
      expect(updates()[0]).toMatchObject({ status: 'abandoned', next_attempt_at: null });
    }
  });

  test('an unreadable secret (AUTH_SECRET changed) is a failure, not a send', async () => {
    const { service, updates, calls } = setup({ secretEnc: 'v1:bad:bad:bad' });
    await service.attempt(DELIVERY);
    expect(calls).toHaveLength(0);
    expect(updates()[0].last_error).toContain('rotate');
  });

  test('sendNow (test, redeliver) ends succeeded or failed, never retried or counted', async () => {
    const { service, updates, prisma, queue } = setup({ status: 404 });
    await service.sendNow(DELIVERY);
    expect(updates()[0]).toMatchObject({ status: 'failed', next_attempt_at: null, attempts: 1 });
    expect(prisma.school_webhook.update).not.toHaveBeenCalled();
    expect(queue.addBulk).not.toHaveBeenCalled();
  });

  test('processOne claims by id and sends only what it claimed', async () => {
    const { service, prisma, calls } = setup();
    // Not due (or not pending): nothing to claim.
    prisma.webhook_delivery.findMany.mockResolvedValueOnce([]);
    await service.processOne(DELIVERY);
    expect(calls).toHaveLength(0);
    // Due, but another worker's claim won the compare-and-set.
    prisma.webhook_delivery.findMany.mockResolvedValueOnce([{ id: DELIVERY }]);
    prisma.webhook_delivery.updateMany.mockResolvedValueOnce({ count: 0 });
    await service.processOne(DELIVERY);
    expect(calls).toHaveLength(0);
    prisma.webhook_delivery.findMany.mockResolvedValueOnce([{ id: DELIVERY }]);
    prisma.webhook_delivery.updateMany.mockResolvedValueOnce({ count: 1 });
    await service.processOne(DELIVERY);
    expect(calls).toHaveLength(1);
    expect(prisma.webhook_delivery.findMany.mock.calls[0][0].where).toMatchObject({
      id: DELIVERY,
      status: 'pending',
    });
  });

  test('claim: due pending rows oldest first, each pushed out by a lease only while still due', async () => {
    const { service, prisma } = setup();
    const OTHER = '66666666-6666-4666-8666-666666666666';
    prisma.webhook_delivery.findMany.mockResolvedValue([{ id: DELIVERY }, { id: OTHER }]);
    prisma.webhook_delivery.updateMany.mockImplementation(async ({ where }: any) => ({
      count: where.id === DELIVERY ? 1 : 0,
    }));
    const before = Date.now();
    expect(await service.claim(10)).toEqual([DELIVERY]);

    const read = prisma.webhook_delivery.findMany.mock.calls[0][0];
    expect(read.where.status).toBe('pending');
    const now = read.where.next_attempt_at.lte as Date;
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(read.orderBy).toEqual([{ next_attempt_at: 'asc' }, { id: 'asc' }]);
    expect(read.take).toBe(10);

    const write = prisma.webhook_delivery.updateMany.mock.calls[0][0];
    expect(write.where).toEqual({ id: DELIVERY, status: 'pending', next_attempt_at: { lte: now } });
    expect(write.data.next_attempt_at.getTime()).toBeGreaterThan(now.getTime());
  });

  test('custom headers are sent as name: value on scheduled attempts and on sendNow (test, redeliver)', async () => {
    const H1 = '55555555-5555-4555-8555-555555555555';
    const H2 = '66666666-6666-4666-8666-666666666666';
    const headers = [
      { id: H1, name: 'Authorization', value_enc: encryptWebhookHeaderValue({ schoolId: SCHOOL, webhookId: HOOK, headerId: H1 }, 'Bearer tok-123') },
      { id: H2, name: 'X-API-Key', value_enc: encryptWebhookHeaderValue({ schoolId: SCHOOL, webhookId: HOOK, headerId: H2 }, 'key-456') },
    ];
    for (const run of ['attempt', 'sendNow'] as const) {
      const { service, calls } = setup({ headers });
      await service[run](DELIVERY);
      const h = calls[0].init.headers as Record<string, string>;
      expect(h.Authorization).toBe('Bearer tok-123');
      expect(h['X-API-Key']).toBe('key-456');
      // GradeBook's own headers are still there and signed as before.
      expect(h['X-GradeBook-Signature']).toBe(signWebhook('whsec_x', Number(h['X-GradeBook-Timestamp']), calls[0].init.body as string));
      expect(h['Content-Type']).toBe('application/json');
    }
  });

  test('header values are redacted from the stored response excerpt and error', async () => {
    const H1 = '55555555-5555-4555-8555-555555555555';
    const headers = [
      { id: H1, name: 'X-API-Key', value_enc: encryptWebhookHeaderValue({ schoolId: SCHOOL, webhookId: HOOK, headerId: H1 }, 'super-secret-key') },
    ];
    const { service, updates } = setup({ headers, status: 401, body: 'bad key: super-secret-key' });
    await service.sendNow(DELIVERY);
    const stored = updates()[0];
    expect(stored.response_excerpt).toBe('bad key: [redacted]');
    expect(JSON.stringify(updates())).not.toContain('super-secret-key');
    // Request headers are never written to the delivery row.
    expect(Object.keys(stored)).not.toContain('headers');
  });

  test("a header value that can't be decrypted (moved to another header, or AUTH_SECRET changed) is a failure, not a send", async () => {
    const H1 = '55555555-5555-4555-8555-555555555555';
    const other = '77777777-7777-4777-8777-777777777777';
    const headers = [
      { id: H1, name: 'X-API-Key', value_enc: encryptWebhookHeaderValue({ schoolId: SCHOOL, webhookId: HOOK, headerId: other }, 'k') },
    ];
    const { service, updates, calls } = setup({ headers });
    await service.sendNow(DELIVERY);
    expect(calls).toHaveLength(0);
    expect(updates()[0].last_error).toContain('X-API-Key');
    expect(updates()[0].last_error).toContain('enter it again');
  });
});
