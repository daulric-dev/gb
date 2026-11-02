import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { createHash, X509Certificate } from 'node:crypto';
import { OTHER_IDP, TEST_IDP } from '@/test/saml-idp';
import { selfSignedCert } from '@/test/tls-cert';
import { sendWebhook, type WebhookFetchInit } from '@/integrations/delivery/webhook-sender';
import { caFingerprints, fetchTlsOptions, MAX_CA_BYTES, parseCaBundle } from './webhook-tls';

const REQ = {
  secret: 'whsec_x',
  deliveryId: 'd-1',
  eventId: 'e-1',
  schoolId: 's-1',
  eventType: 'ping',
  body: '{"event_type":"ping","message":"Test event from GradeBook","data":{}}',
};

describe('CA bundle', () => {
  test('one or more PEM certificates: normalised, with SHA-256 fingerprints', () => {
    const one = parseCaBundle(`\n  ${TEST_IDP.cert}\n`);
    expect(one.fingerprints).toEqual([new X509Certificate(TEST_IDP.cert).fingerprint256]);
    expect(one.fingerprints[0]).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(one.pem.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true);
    // The fingerprint is the SHA-256 of the DER.
    const der = new X509Certificate(TEST_IDP.cert).raw;
    expect(one.fingerprints[0].replace(/:/g, '').toLowerCase()).toBe(createHash('sha256').update(der).digest('hex'));

    const two = parseCaBundle(`${TEST_IDP.cert}\n${OTHER_IDP.cert}`);
    expect(two.fingerprints).toHaveLength(2);
    expect(parseCaBundle(two.pem)).toEqual(two); // stable once normalised
    expect(caFingerprints(two.pem)).toEqual(two.fingerprints);
    expect(caFingerprints(null)).toEqual([]);
  });

  test('anything but certificates is refused', () => {
    const bad = [
      '',
      'hello',
      `${TEST_IDP.cert}\nstray text`,
      // Truncated: lines lost in copying.
      TEST_IDP.cert.split('\n').filter((_, i) => i < 3 || i > 9).join('\n'),
      `-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----`,
      `${TEST_IDP.cert}\n-----BEGIN PRIVATE KEY-----\nMIGH\n-----END PRIVATE KEY-----`,
      `${TEST_IDP.cert}\n`.repeat(Math.ceil(MAX_CA_BYTES / TEST_IDP.cert.length) + 1),
    ];
    for (const raw of bad) expect(() => parseCaBundle(raw)).toThrow(BadRequestException);
    expect(() => parseCaBundle(`${TEST_IDP.cert}\n-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----`)).toThrow(
      /private key/,
    );
  });
});

describe('fetch TLS options', () => {
  test('verify on by default; off passes rejectUnauthorized false; a CA bundle is passed; http has none', () => {
    expect(fetchTlsOptions('https://sis.example/x', undefined)).toEqual({ rejectUnauthorized: true });
    expect(fetchTlsOptions('https://sis.example/x', { verify: true, ca: null })).toEqual({ rejectUnauthorized: true });
    expect(fetchTlsOptions('https://sis.example/x', { verify: false, ca: null })).toEqual({ rejectUnauthorized: false });
    expect(fetchTlsOptions('HTTPS://sis.example/x', { verify: true, ca: 'PEM' })).toEqual({ rejectUnauthorized: true, ca: 'PEM' });
    expect(fetchTlsOptions('http://10.0.0.5/x', { verify: false, ca: 'PEM' })).toBeUndefined();
  });

  test('sendWebhook hands them to fetch and reports tlsVerified', async () => {
    const seen: WebhookFetchInit[] = [];
    const fetchImpl = async (_u: string, init: WebhookFetchInit) => {
      seen.push(init);
      return new Response('ok');
    };
    expect((await sendWebhook({ ...REQ, url: 'https://a.example/' }, fetchImpl)).tlsVerified).toBe(true);
    expect((await sendWebhook({ ...REQ, url: 'https://a.example/', tls: { verify: false, ca: null } }, fetchImpl)).tlsVerified).toBe(false);
    expect((await sendWebhook({ ...REQ, url: 'http://a.example/', tls: { verify: false, ca: null } }, fetchImpl)).tlsVerified).toBeNull();
    expect(seen.map((i) => i.tls)).toEqual([{ rejectUnauthorized: true }, { rejectUnauthorized: false }, undefined]);
  });
});

// Live: Bun's fetch against a local HTTPS server with a self-signed certificate.
const pair = selfSignedCert();
const other = pair ? selfSignedCert('Some other CA') : null;
describe.skipIf(!pair || typeof Bun === 'undefined')('live HTTPS delivery (self-signed certificate)', () => {
  let server: ReturnType<typeof Bun.serve>;
  let url: string;
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      tls: { cert: pair!.cert, key: pair!.key },
      fetch: () => new Response('received', { status: 200 }),
    });
    url = `https://127.0.0.1:${server.port}/hooks`;
  });
  afterAll(() => {
    void server.stop(true);
  });

  test('verification on (default): the self-signed certificate is refused', async () => {
    const r = await sendWebhook({ ...REQ, url });
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBeNull();
    expect(r.error?.toLowerCase()).toContain('self');
    expect(r.tlsVerified).toBe(true);
  });

  test('its CA trusted: delivered with verification on', async () => {
    const ca = parseCaBundle(pair!.cert).pem;
    const r = await sendWebhook({ ...REQ, url, tls: { verify: true, ca } });
    expect(r).toMatchObject({ ok: true, statusCode: 200, tlsVerified: true });
  });

  test('another CA trusted: still refused', async () => {
    const r = await sendWebhook({ ...REQ, url, tls: { verify: true, ca: other!.cert } });
    expect(r.ok).toBe(false);
  });

  test('verification off: delivered, marked unverified', async () => {
    const r = await sendWebhook({ ...REQ, url, tls: { verify: false, ca: null } });
    expect(r).toMatchObject({ ok: true, statusCode: 200, tlsVerified: false });
  });
});
