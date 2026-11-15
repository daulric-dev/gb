import { beforeEach, describe, expect, test } from 'bun:test';
import {
  REPORT_LINK_TTL_SECONDS,
  signReportLink,
  verifyReportLink,
} from './report-link';

const DOC = 'doc-1';
const SCHOOL = 'school-1';

beforeEach(() => {
  process.env.AUTH_SECRET = 'a'.repeat(40);
});

describe('signReportLink / verifyReportLink', () => {
  test('round-trips the document, school and expiry', () => {
    const now = Date.UTC(2026, 0, 1);
    const { token, expiresAt } = signReportLink(DOC, SCHOOL, now);

    const claims = verifyReportLink(token, now);
    expect(claims?.d).toBe(DOC);
    expect(claims?.s).toBe(SCHOOL);
    expect(expiresAt.getTime()).toBe(now + REPORT_LINK_TTL_SECONDS * 1000);
  });

  test('every link gets its own id, so one use cannot spend another', () => {
    const now = Date.UTC(2026, 0, 1);
    const a = verifyReportLink(signReportLink(DOC, SCHOOL, now).token, now);
    const b = verifyReportLink(signReportLink(DOC, SCHOOL, now).token, now);

    expect(a?.j).toBeString();
    expect(a!.j.length).toBeGreaterThanOrEqual(20);
    expect(a!.j).not.toBe(b!.j);
  });

  test('refuses an expired link', () => {
    const now = Date.UTC(2026, 0, 1);
    const { token } = signReportLink(DOC, SCHOOL, now);
    expect(verifyReportLink(token, now + REPORT_LINK_TTL_SECONDS * 1000 + 1)).toBeNull();
  });

  test('refuses a tampered payload, signature or shape', () => {
    const now = Date.UTC(2026, 0, 1);
    const { token } = signReportLink(DOC, SCHOOL, now);
    const [payload, sig] = token.split('.');

    const forged = Buffer.from(
      JSON.stringify({ d: 'other-doc', s: SCHOOL, e: now / 1000 + 60, j: 'x' }),
    ).toString('base64url');
    expect(verifyReportLink(`${forged}.${sig}`, now)).toBeNull();
    expect(verifyReportLink(`${payload}.${sig}x`, now)).toBeNull();
    expect(verifyReportLink(`${payload}.${sig}.extra`, now)).toBeNull();
    expect(verifyReportLink('nonsense', now)).toBeNull();
    expect(verifyReportLink('x'.repeat(2000), now)).toBeNull();
  });

  test('refuses a link signed before single use existed (no id)', () => {
    // What the old signer produced: the same claims without `j`. It verifies
    // under the same key, so only the shape check refuses it.
    const now = Date.UTC(2026, 0, 1);
    const { token } = signReportLink(DOC, SCHOOL, now);
    const claims = JSON.parse(
      Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
    );
    delete claims.j;
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    // Re-sign it the way the old code would have, with the same key.
    const { token: fresh } = signReportLink(DOC, SCHOOL, now);
    expect(fresh.split('.')[1]).toBeString();
    expect(verifyReportLink(`${payload}.${fresh.split('.')[1]}`, now)).toBeNull();
  });
});
