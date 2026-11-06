import { beforeEach, describe, expect, test } from 'bun:test';
import {
  customSecretProblem,
  decryptWebhookHeaderValue,
  decryptWebhookSecret,
  encryptWebhookHeaderValue,
  encryptWebhookSecret,
  generateWebhookSecret,
} from './webhook-secret';

const OWNER = { schoolId: '11111111-1111-4111-8111-111111111111', webhookId: '22222222-2222-4222-8222-222222222222' };

beforeEach(() => {
  process.env.AUTH_SECRET = 'a'.repeat(40);
  delete process.env.DATA_ENCRYPTION_KEY;
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

  test('header values use their own key and AAD: never interchangeable with the signing secret or another header', () => {
    const header = { ...OWNER, headerId: '33333333-3333-4333-8333-333333333333' };
    const enc = encryptWebhookHeaderValue(header, 'Bearer abc');
    expect(enc).not.toContain('Bearer');
    expect(decryptWebhookHeaderValue(header, enc)).toBe('Bearer abc');
    // Swapped into the signing secret column, or the other way round: unreadable.
    expect(decryptWebhookSecret(OWNER, enc)).toBeNull();
    expect(decryptWebhookHeaderValue(header, encryptWebhookSecret(OWNER, 'whsec_abc'))).toBeNull();
    // Moved to another header, webhook or school: unreadable.
    expect(decryptWebhookHeaderValue({ ...header, headerId: OWNER.webhookId }, enc)).toBeNull();
    expect(decryptWebhookHeaderValue({ ...header, webhookId: header.headerId }, enc)).toBeNull();
    expect(decryptWebhookHeaderValue({ ...header, schoolId: header.headerId }, enc)).toBeNull();
  });

  test('a custom signing secret: 16-256 printable ASCII characters, no edge spaces', () => {
    expect(customSecretProblem('a'.repeat(16))).toBeNull();
    expect(customSecretProblem('my receiver secret 2026!')).toBeNull();
    expect(customSecretProblem('a'.repeat(15))).toContain('16-256');
    expect(customSecretProblem('a'.repeat(257))).toContain('16-256');
    expect(customSecretProblem(' ' + 'a'.repeat(20))).toContain('space');
    expect(customSecretProblem('a'.repeat(20) + '\n')).toContain('printable');
    expect(customSecretProblem('pässwörd-pässwörd')).toContain('printable');
  });
});
