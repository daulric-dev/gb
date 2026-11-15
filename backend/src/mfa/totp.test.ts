import { describe, expect, test } from 'bun:test';
import {
  base32Decode,
  base32Encode,
  hashRecoveryCode,
  hotp,
  matchStep,
  newRecoveryCodes,
  newSecret,
  otpauthUri,
  timeStep,
  totp,
} from './totp';

// RFC 6238 appendix B: the SHA-1 seed is the ASCII string "12345678901234567890".
const RFC_KEY = Buffer.from('12345678901234567890', 'ascii');
const RFC_VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP (RFC 6238)', () => {
  test.each(RFC_VECTORS)('appendix B SHA-1 vector at T=%p', (seconds, expected) => {
    expect(totp(RFC_KEY, seconds * 1000, 8)).toBe(expected);
    // The 6-digit code apps show is the same value's last six digits.
    expect(totp(RFC_KEY, seconds * 1000)).toBe(expected.slice(2));
  });

  test('RFC 4226 appendix D HOTP values', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, i) => expect(hotp(RFC_KEY, BigInt(i))).toBe(code));
  });

  test('base32 round trip and the RFC 4648 example', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('mzxw6ytboi======').toString()).toBe('foobar');
    const secret = newSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(() => base32Decode('not base32!')).toThrow();
  });

  test('accepts the current step and one either side, nothing further', () => {
    const now = 1_700_000_000_000;
    const step = timeStep(now);
    expect(matchStep(RFC_KEY, totp(RFC_KEY, now), now)).toBe(step);
    expect(matchStep(RFC_KEY, totp(RFC_KEY, now - 30_000), now)).toBe(step - 1n);
    expect(matchStep(RFC_KEY, totp(RFC_KEY, now + 30_000), now)).toBe(step + 1n);
    expect(matchStep(RFC_KEY, totp(RFC_KEY, now - 60_000), now)).toBeNull();
    expect(matchStep(RFC_KEY, totp(RFC_KEY, now + 60_000), now)).toBeNull();
  });

  test('tolerates spaces, rejects junk', () => {
    const now = 1_700_000_000_000;
    const code = totp(RFC_KEY, now);
    expect(matchStep(RFC_KEY, `${code.slice(0, 3)} ${code.slice(3)}`, now)).not.toBeNull();
    expect(matchStep(RFC_KEY, 'abcdef', now)).toBeNull();
    expect(matchStep(RFC_KEY, '12345', now)).toBeNull();
  });

  test('replay: a step at or before the last used one never matches', () => {
    const now = 1_700_000_000_000;
    const step = timeStep(now);
    const code = totp(RFC_KEY, now);
    expect(matchStep(RFC_KEY, code, now, step)).toBeNull();
    expect(matchStep(RFC_KEY, totp(RFC_KEY, now - 30_000), now, step - 1n)).toBeNull();
    expect(matchStep(RFC_KEY, totp(RFC_KEY, now + 30_000), now, step)).toBe(step + 1n);
  });

  test('otpauth URI', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'a@b.com', 'GradeBook');
    expect(uri).toStartWith('otpauth://totp/GradeBook%3Aa%40b.com?');
    const params = new URL(uri).searchParams;
    expect(params.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(params.get('issuer')).toBe('GradeBook');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
  });

  test('recovery codes: ten distinct, readable, hashed ignoring case and hyphens', () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(hashRecoveryCode(codes[0])).toBe(hashRecoveryCode(codes[0].toUpperCase().replace('-', ' ')));
    expect(hashRecoveryCode(codes[0])).toMatch(/^[0-9a-f]{64}$/);
  });
});
