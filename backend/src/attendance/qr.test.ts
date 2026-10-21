import { describe, expect, test } from 'bun:test';
import {
  QR_CLAIM_TTL_MS,
  QR_WINDOW_MS,
  newQrSecret,
  qrClaim,
  qrToken,
  qrWindow,
  verifyQrClaim,
  verifyQrToken,
} from './qr';

describe('attendance QR tokens', () => {
  const secret = newQrSecret();
  const now = 1_800_000_000_000;

  test('a fresh secret is 64 hex characters and differs each time', () => {
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(newQrSecret()).not.toBe(secret);
  });

  test('tokens are URL-safe and stable within a window', () => {
    const token = qrToken(secret, qrWindow(now));
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(qrToken(secret, qrWindow(now + 1))).toBe(
      qrToken(secret, qrWindow(now)),
    );
  });

  test('accepts the current and the previous window', () => {
    const token = qrToken(secret, qrWindow(now));
    expect(verifyQrToken(secret, token, now)).toBe(true);
    expect(verifyQrToken(secret, token, now + QR_WINDOW_MS)).toBe(true);
  });

  test('rejects a token two windows old', () => {
    const token = qrToken(secret, qrWindow(now));
    expect(verifyQrToken(secret, token, now + 2 * QR_WINDOW_MS)).toBe(false);
  });

  test('rejects a token from another session or a forged one', () => {
    const other = qrToken(newQrSecret(), qrWindow(now));
    expect(verifyQrToken(secret, other, now)).toBe(false);
    expect(verifyQrToken(secret, 'not-a-token', now)).toBe(false);
    expect(verifyQrToken(secret, '', now)).toBe(false);
  });
});

describe('attendance QR claims', () => {
  const secret = newQrSecret();
  const now = 1_800_000_000_000;

  test('a claim verifies for its session until it expires', () => {
    const { claim, expiresAt } = qrClaim(secret, 'session-1', now);
    expect(expiresAt).toBe(now + QR_CLAIM_TTL_MS);
    expect(verifyQrClaim(secret, 'session-1', claim, now + 60_000)).toBe(true);
    expect(verifyQrClaim(secret, 'session-1', claim, expiresAt + 1)).toBe(false);
  });

  test('a claim is bound to its session and secret', () => {
    const { claim } = qrClaim(secret, 'session-1', now);
    expect(verifyQrClaim(secret, 'session-2', claim, now)).toBe(false);
    expect(verifyQrClaim(newQrSecret(), 'session-1', claim, now)).toBe(false);
  });

  test('a tampered expiry or malformed claim is refused', () => {
    const { claim } = qrClaim(secret, 'session-1', now);
    const [, mac] = claim.split('.');
    expect(verifyQrClaim(secret, 'session-1', `${now + 5 * 60_000}.${mac}`, now)).toBe(false);
    expect(verifyQrClaim(secret, 'session-1', 'garbage', now)).toBe(false);
    expect(verifyQrClaim(secret, 'session-1', `${claim}.x`, now)).toBe(false);
  });
});
