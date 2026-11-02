import { describe, expect, mock, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { sendWebhook, signWebhook, USER_AGENT, webhookHeaders } from './webhook-sender';

const REQ = {
  url: 'http://10.0.0.5:8080/hooks',
  secret: 'whsec_test',
  deliveryId: 'd-1',
  eventId: 'e-1',
  schoolId: 's-1',
  eventType: 'grade.recorded',
  body: '{"event_type":"grade.recorded","message":"Ada Lovelace received 18/20 for Essay in Maths","data":{}}',
  timestamp: 1_790_000_000,
};

describe('signing and headers', () => {
  test('v1=<hex HMAC-SHA256(secret, "<timestamp>.<rawBody>")>', () => {
    const expected = createHmac('sha256', REQ.secret).update(`${REQ.timestamp}.${REQ.body}`).digest('hex');
    expect(signWebhook(REQ.secret, REQ.timestamp, REQ.body)).toBe(`v1=${expected}`);
    expect(signWebhook(REQ.secret, REQ.timestamp, REQ.body)).toMatch(/^v1=[0-9a-f]{64}$/);
    // Any change to the body or the time changes the signature.
    expect(signWebhook(REQ.secret, REQ.timestamp + 1, REQ.body)).not.toBe(signWebhook(REQ.secret, REQ.timestamp, REQ.body));
  });

  test('every delivery header: the event metadata that is not in the body', () => {
    expect(webhookHeaders(REQ, REQ.timestamp)).toEqual({
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      'X-GradeBook-Event': 'grade.recorded',
      'X-GradeBook-Event-Id': 'e-1',
      'X-GradeBook-School-Id': 's-1',
      'X-GradeBook-Api-Version': '1',
      'X-GradeBook-Delivery': 'd-1',
      'X-GradeBook-Timestamp': String(REQ.timestamp),
      'X-GradeBook-Signature': signWebhook(REQ.secret, REQ.timestamp, REQ.body),
    });
    expect(USER_AGENT).toBe('GradeBook-Webhooks/1');
  });

  test("custom headers are added as they are; GradeBook's own always win", () => {
    const h = webhookHeaders(
      {
        ...REQ,
        headers: {
          Authorization: 'Bearer abc',
          'X-API-Key': 'k1',
          'X-GradeBook-Signature': 'forged',
          'X-GradeBook-Event-Id': 'forged',
          'X-GradeBook-School-Id': 'forged',
        },
      },
      REQ.timestamp,
    );
    expect(h['X-GradeBook-Event-Id']).toBe('e-1');
    expect(h['X-GradeBook-School-Id']).toBe('s-1');
    expect(h.Authorization).toBe('Bearer abc');
    expect(h['X-API-Key']).toBe('k1');
    expect(h['X-GradeBook-Signature']).toBe(signWebhook(REQ.secret, REQ.timestamp, REQ.body));
  });

  test('a custom signing secret signs the same way', () => {
    const own = 'my-own-receiver-secret-1234';
    const expected = createHmac('sha256', own).update(`${REQ.timestamp}.${REQ.body}`).digest('hex');
    expect(webhookHeaders({ ...REQ, secret: own }, REQ.timestamp)['X-GradeBook-Signature']).toBe(`v1=${expected}`);
  });
});

describe('sendWebhook', () => {
  test('POSTs the exact body, does not follow redirects, and treats 2xx as success', async () => {
    const fetchImpl = mock(async (_url: string, _init: RequestInit) => new Response('ok', { status: 200 }));
    const r = await sendWebhook(REQ, fetchImpl);
    expect(r).toMatchObject({ ok: true, statusCode: 200, error: null, responseExcerpt: 'ok' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(REQ.url);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.body).toBe(REQ.body);
  });

  test('a 3xx is a failure (the redirect is not followed)', async () => {
    const r = await sendWebhook(REQ, async () => new Response(null, { status: 301, headers: { location: 'https://elsewhere' } }));
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(301);
    expect(r.error).toContain('Redirect');
  });

  test('a 5xx is a failure with its status', async () => {
    const r = await sendWebhook(REQ, async () => new Response('boom', { status: 503 }));
    expect(r).toMatchObject({ ok: false, statusCode: 503, error: 'HTTP 503', responseExcerpt: 'boom' });
  });

  test('reads at most 1 KB of the response', async () => {
    const r = await sendWebhook(REQ, async () => new Response('x'.repeat(10_000), { status: 200 }));
    expect(r.responseExcerpt!.length).toBe(1024);
  });

  test('times out', async () => {
    const hang = (_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const r = await sendWebhook(REQ, hang, 20);
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBeNull();
    expect(r.error).toContain('Timed out');
  });

  test('a network error is a failure, never a throw', async () => {
    const r = await sendWebhook(REQ, async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    });
    expect(r).toMatchObject({ ok: false, statusCode: null });
    expect(r.error).toContain('ECONNREFUSED');
  });
});
