import { describe, expect, test } from 'bun:test';
import {
  QR_CLAIM_TTL_MS,
  QR_WINDOW_MS,
  claimDeviceTag,
  claimFromDevice,
  newQrSecret,
  qrClaim,
  qrToken,
  qrWindow,
  readQrClaim,
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
  const DEVICE = 'device-aaaaaaaaaaaaaaaaaa';

  test('a claim verifies for its session until it expires', () => {
    const { claim, expiresAt } = qrClaim(secret, 'session-1', now, DEVICE);
    expect(expiresAt).toBe(now + QR_CLAIM_TTL_MS);
    expect(verifyQrClaim(secret, 'session-1', claim, now + 60_000, DEVICE)).toBe(true);
    expect(verifyQrClaim(secret, 'session-1', claim, expiresAt + 1, DEVICE)).toBe(false);
  });

  test('a claim is bound to its session and secret', () => {
    const { claim } = qrClaim(secret, 'session-1', now, DEVICE);
    expect(verifyQrClaim(secret, 'session-2', claim, now, DEVICE)).toBe(false);
    expect(verifyQrClaim(newQrSecret(), 'session-1', claim, now, DEVICE)).toBe(false);
  });

  test('a claim is bound to the device that scanned', () => {
    const { claim } = qrClaim(secret, 'session-1', now, DEVICE);
    expect(verifyQrClaim(secret, 'session-1', claim, now, 'another-device-bbbbbbbbbb')).toBe(false);
    expect(verifyQrClaim(secret, 'session-1', claim, now, undefined)).toBe(false);

    // The signature still checks out on its own, so the caller can tell a
    // forwarded claim apart from a forged one.
    const read = readQrClaim(secret, 'session-1', claim, now);
    expect(read).not.toBeNull();
    expect(claimFromDevice(secret, read!.device, DEVICE)).toBe(true);
    expect(claimFromDevice(secret, read!.device, 'another-device-bbbbbbbbbb')).toBe(false);
    // The claim carries a tag of the device, never the id itself.
    expect(claim).not.toContain(DEVICE);
    expect(read!.device).toBe(claimDeviceTag(secret, DEVICE));
  });

  test('swapping the device tag breaks the signature', () => {
    const { claim } = qrClaim(secret, 'session-1', now, DEVICE);
    const [exp, nonce, , mac] = claim.split('.');
    const other = claimDeviceTag(secret, 'another-device-bbbbbbbbbb');
    expect(
      readQrClaim(secret, 'session-1', `${exp}.${nonce}.${other}.${mac}`, now),
    ).toBeNull();
  });

  test('a tampered expiry or malformed claim is refused', () => {
    const { claim } = qrClaim(secret, 'session-1', now, DEVICE);
    const [exp, nonce, device, mac] = claim.split('.');
    expect(
      verifyQrClaim(secret, 'session-1', `${now + 60_000}.${nonce}.${device}.${mac}`, now, DEVICE),
    ).toBe(false);
    expect(verifyQrClaim(secret, 'session-1', `${exp}.x.${device}.${mac}`, now, DEVICE)).toBe(false);
    expect(verifyQrClaim(secret, 'session-1', 'garbage', now, DEVICE)).toBe(false);
    expect(verifyQrClaim(secret, 'session-1', `${claim}.x`, now, DEVICE)).toBe(false);
  });
});

describe('attendance QR claim nonces', () => {
  const secret = newQrSecret();
  const now = 1_800_000_000_000;
  const DEVICE = 'device-aaaaaaaaaaaaaaaaaa';

  test('each claim carries a distinct nonce that verification returns', () => {
    const a = qrClaim(secret, 'session-1', now, DEVICE);
    const b = qrClaim(secret, 'session-1', now, DEVICE);
    expect(a.claim).not.toBe(b.claim);
    const read = readQrClaim(secret, 'session-1', a.claim, now);
    expect(read?.nonce).toBe(a.claim.split('.')[1]);
    expect(read?.expiresAt).toBe(a.expiresAt);
  });

  test('a claim lasts at most five minutes', () => {
    expect(QR_CLAIM_TTL_MS).toBeLessThanOrEqual(5 * 60_000);
  });

  test('a claim in an older format is refused', () => {
    const { claim } = qrClaim(secret, 'session-1', now, DEVICE);
    const [exp, nonce, , mac] = claim.split('.');
    expect(readQrClaim(secret, 'session-1', `${exp}.${mac}`, now)).toBeNull();
    expect(readQrClaim(secret, 'session-1', `${exp}.${nonce}.${mac}`, now)).toBeNull();
  });
});
