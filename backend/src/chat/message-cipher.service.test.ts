import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { MessageCipher } from './message-cipher.service';

const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64');

describe('MessageCipher (enabled)', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {
      CHAT_ENCRYPTION_KEY: process.env.CHAT_ENCRYPTION_KEY,
      CHAT_ENCRYPTION_KEYS: process.env.CHAT_ENCRYPTION_KEYS,
      CHAT_ENCRYPTION_KEY_VERSION: process.env.CHAT_ENCRYPTION_KEY_VERSION,
    };
    delete process.env.CHAT_ENCRYPTION_KEYS;
    delete process.env.CHAT_ENCRYPTION_KEY_VERSION;
    process.env.CHAT_ENCRYPTION_KEY = KEY_A;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('round-trips a message body', () => {
    const cipher = new MessageCipher();
    const stored = cipher.encrypt('hello world');
    expect(stored).toStartWith('enc:v1:');
    expect(stored).not.toContain('hello world');
    expect(cipher.decrypt(stored)).toBe('hello world');
  });

  test('produces a different ciphertext each time (random IV)', () => {
    const cipher = new MessageCipher();
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  test('passes through legacy plaintext (no enc: prefix)', () => {
    const cipher = new MessageCipher();
    expect(cipher.decrypt('an old unencrypted row')).toBe(
      'an old unencrypted row',
    );
  });

  test('leaves null and empty bodies untouched', () => {
    const cipher = new MessageCipher();
    expect(cipher.encrypt(null)).toBeNull();
    expect(cipher.encrypt('')).toBe('');
    expect(cipher.decrypt(null)).toBeNull();
  });

  test('a tampered ciphertext fails auth and yields no plaintext', () => {
    const cipher = new MessageCipher();
    const stored = cipher.encrypt('secret')!;
    const parts = stored.split(':');
    // Flip the last character of the ciphertext segment.
    const ct = parts[4];
    parts[4] = ct.slice(0, -1) + (ct.endsWith('A') ? 'B' : 'A');
    expect(cipher.decrypt(parts.join(':'))).toBe('');
  });

  test('supports a rotation ring: new key encrypts, old key still decrypts', () => {
    // Encrypt an old message with only key v1 present.
    const v1Only = new MessageCipher();
    const old = v1Only.encrypt('older message');

    // Now both keys exist and v2 is current.
    process.env.CHAT_ENCRYPTION_KEYS = `1:${KEY_A},2:${KEY_B}`;
    delete process.env.CHAT_ENCRYPTION_KEY;
    const rotated = new MessageCipher();

    expect(rotated.encrypt('new message')).toStartWith('enc:v2:');
    expect(rotated.decrypt(old)).toBe('older message'); // v1 still readable
  });
});

describe('MessageCipher (disabled, dev)', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {
      CHAT_ENCRYPTION_KEY: process.env.CHAT_ENCRYPTION_KEY,
      CHAT_ENCRYPTION_KEYS: process.env.CHAT_ENCRYPTION_KEYS,
      NODE_ENV: process.env.NODE_ENV,
    };
    delete process.env.CHAT_ENCRYPTION_KEY;
    delete process.env.CHAT_ENCRYPTION_KEYS;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('passes bodies through unencrypted when no key is configured', () => {
    const cipher = new MessageCipher();
    expect(cipher.encrypt('plain in dev')).toBe('plain in dev');
    expect(cipher.decrypt('plain in dev')).toBe('plain in dev');
  });
});
