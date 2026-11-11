import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { X509Certificate } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { IntegrationAuditService } from '@/integrations/audit/integration-audit.service';
import { WEBHOOK_EVENT_KEYS } from '@/integrations/events/webhook-event-types';
import { normaliseWebhookUrl, WebhookService } from './webhook.service';
import {
  decryptWebhookHeaderValue,
  decryptWebhookSecret,
  encryptWebhookHeaderValue,
  encryptWebhookSecret,
} from './webhook-secret';
import { parseCaBundle } from './webhook-tls';
import { OTHER_IDP, TEST_IDP } from '@/test/saml-idp';

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
    verify_tls: true,
    tls_ca_cert: null as string | null,
    created_by: 'admin-1',
    created_at: new Date('2026-11-01T00:00:00Z'),
    updated_at: new Date('2026-11-01T00:00:00Z'),
    headers: [] as { id: string; name: string; value_enc: string }[],
    ...over,
  };
}

const H1 = '44444444-4444-4444-8444-444444444444';
const H2 = '55555555-5555-4555-8555-555555555555';
const savedHeaders = () => [
  { id: H1, name: 'Authorization', value_enc: encryptWebhookHeaderValue({ schoolId: SCHOOL, webhookId: HOOK, headerId: H1 }, 'Bearer old-token') },
  { id: H2, name: 'X-API-Key', value_enc: encryptWebhookHeaderValue({ schoolId: SCHOOL, webhookId: HOOK, headerId: H2 }, 'old-api-key') },
];

function setup() {
  const prisma: MockPrisma = createMockPrisma();
  const tx = createMockPrisma();
  prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
  // Rows are found only in their own school.
  prisma.school_webhook.findFirst.mockImplementation(async ({ where }: any) =>
    where.id === HOOK && where.school_id === SCHOOL ? hookRow() : null,
  );
  tx.school_webhook.create.mockImplementation(async ({ data }: any) =>
    hookRow({ ...data, headers: data.headers?.create ?? [] }),
  );
  const deliveries = { sendNow: mock(async () => ({ ok: true })) };
  const alerts = { tlsVerificationDisabled: mock(async () => {}) };
  const service = new WebhookService(
    prisma as any,
    new IntegrationAuditService(prisma as any),
    deliveries as any,
    alerts as any,
  );
  const audit = () => tx.integration_audit_log.createMany.mock.calls.flatMap((c: any[]) => c[0].data);
  return { service, prisma, tx, deliveries, audit, alerts };
}

describe('URLs', () => {
  const prevAllow = process.env.WEBHOOK_ALLOW_PRIVATE;
  afterEach(() => {
    if (prevAllow === undefined) delete process.env.WEBHOOK_ALLOW_PRIVATE;
    else process.env.WEBHOOK_ALLOW_PRIVATE = prevAllow;
  });

  test('with WEBHOOK_ALLOW_PRIVATE=true any http(s) URL is accepted, internal addresses included; other schemes and junk are not', () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
    expect(normaliseWebhookUrl('http://10.0.0.5:8080/hook')).toBe('http://10.0.0.5:8080/hook');
    expect(normaliseWebhookUrl(' https://localhost/x#frag ')).toBe('https://localhost/x');
    expect(normaliseWebhookUrl('http://sis.internal/')).toBe('http://sis.internal/');
    for (const bad of ['ftp://x', 'javascript:alert(1)', 'not a url', '']) {
      expect(() => normaliseWebhookUrl(bad)).toThrow(BadRequestException);
    }
  });

  test('without it plain http is refused and https is required', () => {
    delete process.env.WEBHOOK_ALLOW_PRIVATE;
    expect(() => normaliseWebhookUrl('http://sis.example.com/hook')).toThrow(/https:\/\//);
    expect(normaliseWebhookUrl('https://sis.example.com/hook')).toBe('https://sis.example.com/hook');
    process.env.WEBHOOK_ALLOW_PRIVATE = 'false';
    expect(() => normaliseWebhookUrl('http://sis.example.com/hook')).toThrow(BadRequestException);
  });
});

describe('WebhookService', () => {
  // Several cases use internal http URLs, as a trusted self-hosted install may.
  const prevAllow = process.env.WEBHOOK_ALLOW_PRIVATE;
  beforeEach(() => {
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
  });
  afterEach(() => {
    if (prevAllow === undefined) delete process.env.WEBHOOK_ALLOW_PRIVATE;
    else process.env.WEBHOOK_ALLOW_PRIVATE = prevAllow;
  });

  test('create stores the secret encrypted, returns it once, expands "*" and audits without the secret', async () => {
    const { service, tx, audit } = setup();
    const { webhook, secret: shown, secretGenerated } = await service.create(
      SCHOOL,
      { name: ' SIS ', url: 'http://sis.internal/hooks', events: ['*'] },
      ADMIN,
    );
    expect(secretGenerated).toBe(true);
    const secret = shown!;
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
    const { secret, secretGenerated } = await service.rotateSecret(SCHOOL, HOOK, ORG);
    expect(secretGenerated).toBe(true);
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
    prisma.school.findUnique.mockResolvedValue({ name: 'Riverside' });
    prisma.webhook_delivery.findFirst.mockResolvedValue({
      id: DELIVERY, webhook_id: HOOK, school_id: SCHOOL, event_id: 'e', event_type: 'ping', status: 'succeeded',
      attempts: 1, next_attempt_at: null, last_status_code: 200, last_error: null, duration_ms: 12,
      created_at: new Date(), delivered_at: new Date(), payload: {}, response_excerpt: 'ok',
    });
    const d = await service.test(SCHOOL, HOOK, ADMIN);
    const created = tx.webhook_delivery.create.mock.calls[0][0].data;
    expect(created.event_type).toBe('ping');
    expect(created.payload).toEqual({
      event_type: 'ping',
      message: 'Test event from GradeBook',
      data: { school: { id: SCHOOL, name: 'Riverside' }, webhook: { id: HOOK, name: 'SIS' } },
    });
    expect(created.event_id).toMatch(/^[0-9a-f-]{36}$/);
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

  const NEW_PAYLOAD = {
    event_type: 'course.archived',
    message: 'Maths was archived',
    data: { school: { id: SCHOOL, name: 'Riverside' }, course: { id: OTHER, name: 'Maths', code: null } },
  };

  function redeliverSetup(payload: unknown) {
    const s = setup();
    s.prisma.webhook_delivery.findFirst.mockImplementation(async ({ where }: any) =>
      where.school_id !== SCHOOL
        ? null
        : {
            id: where.id, webhook_id: HOOK, school_id: SCHOOL, event_id: 'evt-1', event_type: 'course.archived',
            payload, status: 'abandoned', attempts: 8, next_attempt_at: null,
            last_status_code: 500, last_error: 'HTTP 500', duration_ms: 5, created_at: new Date(),
            delivered_at: null, response_excerpt: null, webhook: { name: 'SIS' },
          },
    );
    s.tx.webhook_delivery.create.mockResolvedValue({ id: 'new-1' });
    return s;
  }

  test('redeliver copies a new-shape payload unchanged', async () => {
    const { service, tx } = redeliverSetup(NEW_PAYLOAD);
    await service.redeliver(SCHOOL, DELIVERY, ADMIN);
    expect(tx.webhook_delivery.create.mock.calls[0][0].data.payload).toEqual(NEW_PAYLOAD);
  });

  test('redeliver converts an old-shape payload to { event_type, message, data } with the school in data', async () => {
    const { service, tx } = redeliverSetup({
      id: 'evt-1',
      type: 'course.archived',
      apiVersion: 1,
      createdAt: '2026-11-01T10:00:00.000Z',
      school: { id: SCHOOL, name: 'Riverside' },
      data: { course: { id: OTHER, name: 'Maths', code: null } },
    });
    await service.redeliver(SCHOOL, DELIVERY, ADMIN);
    const created = tx.webhook_delivery.create.mock.calls[0][0].data;
    expect(created.payload).toEqual(NEW_PAYLOAD);
    expect(Object.keys(created.payload)).toEqual(['event_type', 'message', 'data']);
    expect(created.event_id).toBe('evt-1');
  });

  test('redeliver copies the payload and event id into a new delivery, sends it and audits it', async () => {
    const { service, prisma, tx, deliveries, audit } = setup();
    prisma.webhook_delivery.findFirst.mockImplementation(async ({ where }: any) =>
      where.school_id !== SCHOOL
        ? null
        : {
            id: where.id, webhook_id: HOOK, school_id: SCHOOL, event_id: 'evt-1', event_type: 'grade.recorded',
            payload: { event_type: 'grade.recorded', message: 'm', data: {} }, status: 'abandoned', attempts: 8, next_attempt_at: null,
            last_status_code: 500, last_error: 'HTTP 500', duration_ms: 5, created_at: new Date(),
            delivered_at: null, response_excerpt: null, webhook: { name: 'SIS' },
          },
    );
    tx.webhook_delivery.create.mockResolvedValue({ id: 'new-1' });
    await service.redeliver(SCHOOL, DELIVERY, ADMIN);
    expect(tx.webhook_delivery.create.mock.calls[0][0].data).toMatchObject({
      event_id: 'evt-1', event_type: 'grade.recorded', payload: { event_type: 'grade.recorded', message: 'm', data: {} }, webhook_id: HOOK,
    });
    expect(deliveries.sendNow).toHaveBeenCalledWith('new-1');
    expect(audit()[0]).toMatchObject({ action: 'delivery_redelivered', changes: { deliveryId: DELIVERY, newDeliveryId: 'new-1' } });
    await expect(service.redeliver(OTHER, DELIVERY, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });

  test('create with custom headers and an own signing secret: values encrypted per header, neither echoed nor audited', async () => {
    const { service, tx, audit } = setup();
    const own = 'receiver-provided-secret-2026';
    const r = await service.create(
      SCHOOL,
      {
        name: 'SIS',
        url: 'https://sis.example/x',
        events: ['grade.recorded'],
        headers: [{ name: 'Authorization', value: 'Bearer tok-abc' }, { name: 'X-API-Key', value: 'key-xyz' }],
        signingSecret: own,
      },
      ADMIN,
    );
    expect(r.secret).toBeNull();
    expect(r.secretGenerated).toBe(false);
    const data = tx.school_webhook.create.mock.calls[0][0].data;
    expect(decryptWebhookSecret({ schoolId: SCHOOL, webhookId: data.id }, data.secret_enc)).toBe(own);
    const rows = data.headers.create;
    expect(rows.map((h: any) => h.name)).toEqual(['Authorization', 'X-API-Key']);
    expect(decryptWebhookHeaderValue({ schoolId: SCHOOL, webhookId: data.id, headerId: rows[0].id }, rows[0].value_enc)).toBe('Bearer tok-abc');
    expect(r.webhook.headers).toEqual([
      { id: rows[0].id, name: 'Authorization', hasValue: true, valueUnreadable: false },
      { id: rows[1].id, name: 'X-API-Key', hasValue: true, valueUnreadable: false },
    ]);
    const out = JSON.stringify([r, audit()]);
    for (const leak of ['tok-abc', 'key-xyz', own, 'value_enc']) expect(out).not.toContain(leak);
    expect(audit()[0].changes).toMatchObject({ headers: { added: ['Authorization', 'X-API-Key'] }, customSigningSecret: true });
  });

  test('a bad own signing secret or header is refused before anything is written', async () => {
    const { service, tx } = setup();
    const base = { name: 'x', url: 'https://a.b', events: ['grade.recorded'] };
    await expect(service.create(SCHOOL, { ...base, signingSecret: 'short' }, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(SCHOOL, { ...base, headers: [{ name: 'X-GradeBook-Event', value: 'x' }] }, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(SCHOOL, { ...base, headers: [{ name: 'X-Key' }] }, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.rotateSecret(SCHOOL, HOOK, ADMIN, 'bad\nsecret-value-123')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.school_webhook.create).not.toHaveBeenCalled();
    expect(tx.school_webhook.update).not.toHaveBeenCalled();
  });

  test('update headers: keep (rename), replace, add and delete; audited by name only', async () => {
    const { service, prisma, tx, audit } = setup();
    prisma.school_webhook.findFirst.mockResolvedValue(hookRow({ headers: savedHeaders() }));
    await service.update(
      SCHOOL,
      HOOK,
      {
        headers: [
          { id: H1, name: 'Authorization', value: 'Bearer new-token' },
          { name: 'X-Tenant', value: 'riverside-tenant' },
        ],
      },
      ADMIN,
    );
    expect(tx.school_webhook_header.deleteMany.mock.calls[0][0]).toEqual({ where: { id: { in: [H2] }, webhook_id: HOOK } });
    const upd = tx.school_webhook_header.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: H1 });
    expect(decryptWebhookHeaderValue({ schoolId: SCHOOL, webhookId: HOOK, headerId: H1 }, upd.data.value_enc)).toBe('Bearer new-token');
    const created = tx.school_webhook_header.createMany.mock.calls[0][0].data[0];
    expect(created).toMatchObject({ webhook_id: HOOK, name: 'X-Tenant' });
    expect(decryptWebhookHeaderValue({ schoolId: SCHOOL, webhookId: HOOK, headerId: created.id }, created.value_enc)).toBe('riverside-tenant');
    expect(audit()[0]).toMatchObject({
      action: 'webhook_updated',
      changes: { headers: { added: ['X-Tenant'], removed: ['X-API-Key'], valueChanged: ['Authorization'] } },
    });
    for (const leak of ['new-token', 'riverside-tenant', 'old-api-key']) expect(JSON.stringify(audit())).not.toContain(leak);
  });

  test('a rename keeps the stored value; an unchanged list writes nothing', async () => {
    const { service, prisma, tx, audit } = setup();
    prisma.school_webhook.findFirst.mockResolvedValue(hookRow({ headers: savedHeaders() }));
    await service.update(SCHOOL, HOOK, { headers: [{ id: H1, name: 'Authorization' }, { id: H2, name: 'X-Api-Token' }] }, ADMIN);
    const calls = tx.school_webhook_header.update.mock.calls.map((c: any[]) => c[0]);
    // Through a temporary name first, so swapping two names never clashes.
    expect(calls[0]).toEqual({ where: { id: H2 }, data: { name: `tmp-${H2}` } });
    expect(calls[1].data).toMatchObject({ name: 'X-Api-Token' });
    expect(calls[1].data.value_enc).toBeUndefined();
    expect(audit()[0].changes.headers).toEqual({ renamed: [{ before: 'X-API-Key', after: 'X-Api-Token' }] });

    const again = setup();
    again.prisma.school_webhook.findFirst.mockResolvedValue(hookRow({ headers: savedHeaders() }));
    await again.service.update(SCHOOL, HOOK, { headers: [{ id: H1, name: 'Authorization' }, { id: H2, name: 'X-API-Key', value: '' }] }, ADMIN);
    expect(again.tx.school_webhook.update).not.toHaveBeenCalled();
    expect(again.audit()).toEqual([]);
  });

  test('list shows header names only, never values', async () => {
    const { service, prisma } = setup();
    prisma.school_webhook.findMany.mockResolvedValue([hookRow({ headers: savedHeaders() })]);
    const [item] = await service.list(SCHOOL);
    expect(item.headers.map((h) => h.name)).toEqual(['Authorization', 'X-API-Key']);
    expect(JSON.stringify(item)).not.toContain('old-token');
    expect(JSON.stringify(item)).not.toContain('old-api-key');
  });

  test('rotate with an own signing secret stores it, does not echo it, and audits only that it was custom', async () => {
    const { service, tx, audit } = setup();
    const own = 'receiver-provided-secret-2026';
    const r = await service.rotateSecret(SCHOOL, HOOK, ADMIN, own);
    expect(r).toMatchObject({ secret: null, secretGenerated: false });
    const data = tx.school_webhook.update.mock.calls[0][0].data;
    expect(decryptWebhookSecret({ schoolId: SCHOOL, webhookId: HOOK }, data.secret_enc)).toBe(own);
    expect(audit()[0]).toMatchObject({ action: 'secret_rotated', changes: { customSigningSecret: true } });
    expect(JSON.stringify(audit())).not.toContain(own);
  });
});

describe('WebhookService TLS settings', () => {
  const fp = (pem: string) => new X509Certificate(pem).fingerprint256;

  test('verification is on by default and shown with no CA', async () => {
    const { service, tx, alerts } = setup();
    const r = await service.create(SCHOOL, { name: 'SIS', url: 'https://sis.example/x', events: ['grade.recorded'] }, ADMIN);
    expect(tx.school_webhook.create.mock.calls[0][0].data).toMatchObject({ verify_tls: true, tls_ca_cert: null });
    expect(r.webhook.tls).toEqual({ verify: true, caFingerprints: [] });
    expect(alerts.tlsVerificationDisabled).not.toHaveBeenCalled();
  });

  test('create with verification off and a CA: stored normalised, audited by fingerprint, alerted', async () => {
    const { service, tx, audit, alerts } = setup();
    const r = await service.create(
      SCHOOL,
      { name: 'SIS', url: 'https://sis.example/x', events: ['grade.recorded'], tls: { verify: false, caCert: `  ${TEST_IDP.cert}  ` } },
      ADMIN,
    );
    const data = tx.school_webhook.create.mock.calls[0][0].data;
    expect(data.verify_tls).toBe(false);
    expect(data.tls_ca_cert.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true);
    expect(r.webhook.tls).toEqual({ verify: false, caFingerprints: [fp(TEST_IDP.cert)] });
    const entries = audit();
    expect(entries[0].changes.tlsCaFingerprints).toEqual([fp(TEST_IDP.cert)]);
    expect(JSON.stringify(entries)).not.toContain('BEGIN CERTIFICATE');
    expect(entries[1]).toMatchObject({ action: 'tls_verification_disabled' });
    expect(alerts.tlsVerificationDisabled).toHaveBeenCalledWith(SCHOOL, { id: data.id, name: 'SIS' });
  });

  test('a bad CA bundle is refused before anything is written', async () => {
    const { service, tx } = setup();
    await expect(
      service.create(SCHOOL, { name: 'SIS', url: 'https://x.example', events: ['ping'], tls: { caCert: 'nope' } }, ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update(SCHOOL, HOOK, { tls: { caCert: 'nope' } }, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.school_webhook.create).not.toHaveBeenCalled();
    expect(tx.school_webhook.update).not.toHaveBeenCalled();
  });

  test('turning verification off is its own audited change and emails the admins; on again is audited, not alerted', async () => {
    const { service, tx, audit, alerts, prisma } = setup();
    await service.update(SCHOOL, HOOK, { tls: { verify: false } }, ADMIN);
    expect(tx.school_webhook.update.mock.calls[0][0].data).toMatchObject({ verify_tls: false });
    expect(audit()).toEqual([
      expect.objectContaining({ action: 'tls_verification_disabled', changes: { verifyTls: { before: true, after: false } } }),
    ]);
    expect(alerts.tlsVerificationDisabled).toHaveBeenCalledTimes(1);

    prisma.school_webhook.findFirst.mockResolvedValue(hookRow({ verify_tls: false }));
    await service.update(SCHOOL, HOOK, { tls: { verify: true } }, ADMIN);
    expect(audit()[1]).toMatchObject({ action: 'tls_verification_enabled' });
    expect(alerts.tlsVerificationDisabled).toHaveBeenCalledTimes(1);
    // Unchanged: nothing written.
    await service.update(SCHOOL, HOOK, { tls: { verify: false } }, ADMIN);
    expect(audit()).toHaveLength(2);
  });

  test('changing or clearing the CA records fingerprints before and after, never the PEM', async () => {
    const { service, tx, audit, prisma } = setup();
    const stored = parseCaBundle(TEST_IDP.cert).pem;
    prisma.school_webhook.findFirst.mockResolvedValue(hookRow({ tls_ca_cert: stored }));
    await service.update(SCHOOL, HOOK, { tls: { caCert: OTHER_IDP.cert } }, ADMIN);
    expect(audit()[0]).toMatchObject({
      action: 'tls_ca_changed',
      changes: { caFingerprints: { before: [fp(TEST_IDP.cert)], after: [fp(OTHER_IDP.cert)] } },
    });
    await service.update(SCHOOL, HOOK, { tls: { caCert: '' } }, ADMIN);
    expect(tx.school_webhook.update.mock.calls[1][0].data.tls_ca_cert).toBeNull();
    expect(audit()[1].changes).toEqual({ caFingerprints: { before: [fp(TEST_IDP.cert)], after: [] } });
    // The same bundle again (after normalising) is no change.
    await service.update(SCHOOL, HOOK, { tls: { caCert: `${TEST_IDP.cert}\n` } }, ADMIN);
    expect(audit()).toHaveLength(2);
    expect(JSON.stringify(audit())).not.toContain('BEGIN CERTIFICATE');
  });
});

