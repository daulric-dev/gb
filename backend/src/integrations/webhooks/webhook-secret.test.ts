import { beforeEach, describe, expect, test } from 'bun:test';
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  generateWebhookSecret,
} from './webhook-secret';

const OWNER = { schoolId: '11111111-1111-4111-8111-111111111111', webhookId: '22222222-2222-4222-8222-222222222222' };

beforeEach(() => {
  process.env.AUTH_SECRET = 'a'.repeat(40);
});

describe('webhook signing secrets', () => {
  test('32 random bytes, whsec_-prefixed, different every time', () => {
    const a = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a.slice(6), 'base64url')).toHaveLength(32);
    expect(generateWebhookSecret()).not.toBe(a);
  });

  test('encrypted at rest, bound to the school and the webhook', () => {
    const enc = encryptWebhookSecret(OWNER, 'whsec_abc');
    expect(enc).not.toContain('whsec_abc');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(decryptWebhookSecret(OWNER, enc)).toBe('whsec_abc');
    expect(decryptWebhookSecret({ ...OWNER, webhookId: OWNER.schoolId }, enc)).toBeNull();
    expect(decryptWebhookSecret({ ...OWNER, schoolId: OWNER.webhookId }, enc)).toBeNull();
  });

  test('a changed AUTH_SECRET makes it unreadable, not wrong', () => {
    const enc = encryptWebhookSecret(OWNER, 'whsec_abc');
    process.env.AUTH_SECRET = 'b'.repeat(40);
    expect(decryptWebhookSecret(OWNER, enc)).toBeNull();
    expect(decryptWebhookSecret(OWNER, 'garbage')).toBeNull();
  });
});
