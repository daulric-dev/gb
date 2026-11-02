import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { IntegrationAuditService } from '@/integrations/audit/integration-audit.service';
import { WEBHOOK_EVENT_KEYS } from '@/integrations/events/webhook-event-types';
import { normaliseWebhookUrl, WebhookService } from './webhook.service';
import { decryptWebhookSecret, encryptWebhookSecret } from './webhook-secret';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const HOOK = '22222222-2222-4222-8222-222222222222';
const DELIVERY = '33333333-3333-4333-8333-333333333333';
const ADMIN = { id: 'admin-1', via: 'school_admin' as const };
const ORG = { id: 'org-1', via: 'organisation_admin' as const };

beforeEach(() => {
  process.env.AUTH_SECRET = 'a'.repeat(40);
});

function hookRow(over: Record<string, unknown> = {}) {
  return {
    id: HOOK,
    school_id: SCHOOL,
    name: 'SIS',
    url: 'https://sis.riverside.edu/hooks',
    secret_enc: encryptWebhookSecret({ schoolId: SCHOOL, webhookId: HOOK }, 'whsec_old'),
    events: ['grade.recorded'],
    enabled: true,
    consecutive_failures: 0,
    disabled_reason: null,
    created_by: 'admin-1',
    created_at: new Date('2026-11-01T00:00:00Z'),
    updated_at: new Date('2026-11-01T00:00:00Z'),
    ...over,
  };
}

function setup() {
  const prisma: MockPrisma = createMockPrisma();
  const tx = createMockPrisma();
  prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
  // Rows are found only in their own school.
  prisma.school_webhook.findFirst.mockImplementation(async ({ where }: any) =>
    where.id === HOOK && where.school_id === SCHOOL ? hookRow() : null,
  );
  tx.school_webhook.create.mockImplementation(async ({ data }: any) => hookRow({ ...data }));
  const deliveries = { sendNow: mock(async () => ({ ok: true })) };
  const service = new WebhookService(prisma as any, new IntegrationAuditService(prisma as any), deliveries as any);
  const audit = () => tx.integration_audit_log.createMany.mock.calls.flatMap((c: any[]) => c[0].data);
  return { service, prisma, tx, deliveries, audit };
}

describe('URLs', () => {
  test('any http(s) URL is accepted, internal addresses included; other schemes and junk are not', () => {
    expect(normaliseWebhookUrl('http://10.0.0.5:8080/hook')).toBe('http://10.0.0.5:8080/hook');
    expect(normaliseWebhookUrl(' https://localhost/x#frag ')).toBe('https://localhost/x');
    expect(normaliseWebhookUrl('http://sis.internal/')).toBe('http://sis.internal/');
    for (const bad of ['ftp://x', 'javascript:alert(1)', 'not a url', '']) {
      expect(() => normaliseWebhookUrl(bad)).toThrow(BadRequestException);
    }
  });
});

describe('WebhookService', () => {
  test('create stores the secret encrypted, returns it once, expands "*" and audits without the secret', async () => {
    const { service, tx, audit } = setup();
    const { webhook, secret } = await service.create(
      SCHOOL,
      { name: ' SIS ', url: 'http://sis.internal/hooks', events: ['*'] },
      ADMIN,
    );
    expect(secret).toMatch(/^whsec_/);
    const data = tx.school_webhook.create.mock.calls[0][0].data;
    expect(data.secret_enc).not.toContain(secret);
    expect(decryptWebhookSecret({ schoolId: SCHOOL, webhookId: data.id }, data.secret_enc)).toBe(secret);
    expect(data.events).toEqual(WEBHOOK_EVENT_KEYS.filter((k) => k !== 'ping'));
    expect(data.name).toBe('SIS');
    expect(webhook).toMatchObject({ hasSecret: true, insecure: true, enabled: true });
    expect(JSON.stringify(webhook)).not.toContain(secret);
    expect(JSON.stringify(webhook)).not.toContain('secret_enc');
    const [entry] = audit();
    expect(entry).toMatchObject({ action: 'webhook_created', actor_via: 'school_admin', school_id: SCHOOL });
    expect(JSON.stringify(audit())).not.toContain(secret);
  });

  test('unknown event types and empty lists are refused', async () => {
    const { service } = setup();
    await expect(service.create(SCHOOL, { name: 'x', url: 'https://a.b', events: ['grades.released'] }, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(SCHOOL, { name: 'x', url: 'https://a.b', events: [] }, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
  });

  test('list never returns the secret; an unreadable secret is flagged', async () => {
    const { service, prisma } = setup();
    prisma.school_webhook.findMany.mockResolvedValue([hookRow(), hookRow({ id: OTHER, secret_enc: 'v1:x:y:z' })]);
    const items = await service.list(SCHOOL);
    expect(items.map((i) => i.secretUnreadable)).toEqual([false, true]);
    expect(JSON.stringify(items)).not.toContain('whsec');
    expect(JSON.stringify(items)).not.toContain('v1:');
  });

  test('rotate replaces the secret at once, shows the new one once, and audits only that it happened', async () => {
    const { service, tx, audit } = setup();
    const { secret } = await service.rotateSecret(SCHOOL, HOOK, ORG);
    const data = tx.school_webhook.update.mock.calls[0][0].data;
    expect(decryptWebhookSecret({ schoolId: SCHOOL, webhookId: HOOK }, data.secret_enc)).toBe(secret);
    expect(secret).not.toBe('whsec_old');
    expect(audit()).toEqual([
      expect.objectContaining({ action: 'secret_rotated', actor_via: 'organisation_admin', changes: {} }),
    ]);
  });

  test("another school's webhook is not found", async () => {
    const { service } = setup();
    await expect(service.get(OTHER, HOOK)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(OTHER, HOOK, { name: 'x' }, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(OTHER, HOOK, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delivery(OTHER, DELIVERY)).rejects.toBeInstanceOf(NotFoundException);
  });

  test('update audits field changes; switching back on clears an auto-disable', async () => {
    const { service, prisma, tx, audit } = setup();
    prisma.school_webhook.findFirst.mockResolvedValue(
      hookRow({ enabled: false, consecutive_failures: 50, disabled_reason: 'Switched off automatically' }),
    );
    await service.update(SCHOOL, HOOK, { url: 'https://new.example/x', enabled: true }, ADMIN);
    expect(tx.school_webhook.update.mock.calls[0][0].data).toMatchObject({
      url: 'https://new.example/x',
      enabled: true,
      consecutive_failures: 0,
      disabled_reason: null,
    });
    expect(audit().map((e: any) => e.action)).toEqual(['webhook_updated', 'webhook_enabled']);
    expect(audit()[0].changes.url).toEqual({ before: 'https://sis.riverside.edu/hooks', after: 'https://new.example/x' });
  });

  test('delete is audited with the name kept', async () => {
    const { service, tx, audit } = setup();
    await service.remove(SCHOOL, HOOK, ADMIN);
    expect(tx.school_webhook.delete.mock.calls[0][0]).toEqual({ where: { id: HOOK } });
    expect(audit()[0]).toMatchObject({ action: 'webhook_deleted', webhook: 'SIS', webhook_id: HOOK });
  });

  test('test sends a ping now and audits it', async () => {
    const { service, tx, prisma, deliveries, audit } = setup();
    tx.webhook_delivery.create.mockResolvedValue({ id: DELIVERY });
    prisma.webhook_delivery.findFirst.mockResolvedValue({
      id: DELIVERY, webhook_id: HOOK, school_id: SCHOOL, event_id: 'e', event_type: 'ping', status: 'succeeded',
      attempts: 1, next_attempt_at: null, last_status_code: 200, last_error: null, duration_ms: 12,
      created_at: new Date(), delivered_at: new Date(), payload: {}, response_excerpt: 'ok',
    });
    const d = await service.test(SCHOOL, HOOK, ADMIN);
    const created = tx.webhook_delivery.create.mock.calls[0][0].data;
    expect(created.event_type).toBe('ping');
    expect(created.payload).toMatchObject({ type: 'ping', apiVersion: 1, data: { webhook: { id: HOOK, name: 'SIS' } } });
    expect(deliveries.sendNow).toHaveBeenCalledWith(DELIVERY);
    expect(d.status).toBe('succeeded');
    expect(audit()[0]).toMatchObject({ action: 'test_sent' });
  });

  test('deliveries QUERY filters by status and event type, newest first, capped', async () => {
    const { service, prisma } = setup();
    await service.listDeliveries(SCHOOL, HOOK, { status: 'failed', eventType: 'grade.recorded', limit: 500 });
    const args = prisma.webhook_delivery.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ webhook_id: HOOK, school_id: SCHOOL, status: 'failed', event_type: 'grade.recorded' });
    expect(args.orderBy).toEqual([{ created_at: 'desc' }, { id: 'desc' }]);
    expect(args.take).toBe(200);
    await expect(service.listDeliveries(SCHOOL, HOOK, { before: DELIVERY })).rejects.toBeInstanceOf(BadRequestException);
  });

  test('redeliver copies the payload and event id into a new delivery, sends it and audits it', async () => {
    const { service, prisma, tx, deliveries, audit } = setup();
    prisma.webhook_delivery.findFirst.mockImplementation(async ({ where }: any) =>
      where.school_id !== SCHOOL
        ? null
        : {
            id: where.id, webhook_id: HOOK, school_id: SCHOOL, event_id: 'evt-1', event_type: 'grade.recorded',
            payload: { id: 'evt-1' }, status: 'abandoned', attempts: 8, next_attempt_at: null,
            last_status_code: 500, last_error: 'HTTP 500', duration_ms: 5, created_at: new Date(),
            delivered_at: null, response_excerpt: null, webhook: { name: 'SIS' },
          },
    );
    tx.webhook_delivery.create.mockResolvedValue({ id: 'new-1' });
    await service.redeliver(SCHOOL, DELIVERY, ADMIN);
    expect(tx.webhook_delivery.create.mock.calls[0][0].data).toMatchObject({
      event_id: 'evt-1', event_type: 'grade.recorded', payload: { id: 'evt-1' }, webhook_id: HOOK,
    });
    expect(deliveries.sendNow).toHaveBeenCalledWith('new-1');
    expect(audit()[0]).toMatchObject({ action: 'delivery_redelivered', changes: { deliveryId: DELIVERY, newDeliveryId: 'new-1' } });
    await expect(service.redeliver(OTHER, DELIVERY, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });
});
