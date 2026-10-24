import { describe, expect, test } from 'bun:test';
import { computeEntitlement, initialTrialEnd, type EntitlementInput } from './billing.entitlement';

const NOW = new Date('2026-10-24T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const GRACE = 7;

function input(over: Partial<EntitlementInput> = {}): EntitlementInput {
  return {
    status: 'trialing',
    trialEndsAt: days(10),
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    compUntil: null,
    mode: null,
    oldestOpenDueAt: null,
    ...over,
  };
}
const ent = (over: Partial<EntitlementInput>) => computeEntitlement(input(over), NOW, GRACE);

describe('trial', () => {
  test('in trial: trialing, writable', () => {
    expect(ent({})).toEqual({ status: 'trialing', readOnly: false });
  });
  test('trial over without paying: read-only at once (no grace)', () => {
    expect(ent({ trialEndsAt: days(-1) })).toEqual({ status: 'read_only', readOnly: true });
  });
  test('a missing trial end counts as over', () => {
    expect(ent({ trialEndsAt: null }).readOnly).toBe(true);
  });
  test('initial trial runs from max(created, now)', () => {
    expect(initialTrialEnd(new Date('2020-01-01T00:00:00Z'), NOW, 30)).toEqual(days(30));
    expect(initialTrialEnd(null, NOW, 30)).toEqual(days(30));
    expect(initialTrialEnd(days(2), NOW, 30)).toEqual(days(32));
  });
});

describe('subscription mode', () => {
  const sub = { mode: 'subscription' as const, trialEndsAt: days(-40) };
  test('active within period', () => {
    expect(ent({ ...sub, status: 'active', currentPeriodEnd: days(5) })).toEqual({ status: 'active', readOnly: false });
  });
  test('active, renewal missed: grace then read-only', () => {
    expect(ent({ ...sub, status: 'active', currentPeriodEnd: days(-6) }).readOnly).toBe(false);
    expect(ent({ ...sub, status: 'active', currentPeriodEnd: days(-8) }).readOnly).toBe(true);
  });
  test('active without a known period end stays writable', () => {
    expect(ent({ ...sub, status: 'active', currentPeriodEnd: null }).readOnly).toBe(false);
  });
  test('cancel at period end: no grace after the end', () => {
    expect(ent({ ...sub, status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: days(1) }).readOnly).toBe(false);
    expect(ent({ ...sub, status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: days(-1) }).readOnly).toBe(true);
  });
  test('past_due: writable during grace, read-only beyond it', () => {
    expect(ent({ ...sub, status: 'past_due', currentPeriodEnd: days(-3) })).toEqual({ status: 'past_due', readOnly: false });
    expect(ent({ ...sub, status: 'past_due', currentPeriodEnd: days(-7.5) })).toEqual({ status: 'read_only', readOnly: true });
  });
  test('canceled: writable until the paid period ends', () => {
    expect(ent({ ...sub, status: 'canceled', currentPeriodEnd: days(3) }).readOnly).toBe(false);
    expect(ent({ ...sub, status: 'canceled', currentPeriodEnd: days(-1) }).readOnly).toBe(true);
  });
  test('unpaid and incomplete are read-only once the trial is over', () => {
    expect(ent({ ...sub, status: 'unpaid', currentPeriodEnd: days(5) }).readOnly).toBe(true);
    expect(ent({ ...sub, status: 'incomplete' }).readOnly).toBe(true);
    expect(ent({ mode: 'subscription', status: 'incomplete', trialEndsAt: days(3) }).readOnly).toBe(false);
  });
  test('provider-side trial runs to its period end', () => {
    expect(ent({ ...sub, status: 'trialing', currentPeriodEnd: days(4) }).readOnly).toBe(false);
  });
});

describe('invoice mode', () => {
  const inv = { mode: 'invoice' as const, trialEndsAt: days(-40) };
  test('paid through the future: active', () => {
    expect(ent({ ...inv, status: 'active', currentPeriodEnd: days(20) })).toEqual({ status: 'active', readOnly: false });
  });
  test('open invoice not yet due keeps a lapsed school writable', () => {
    expect(ent({ ...inv, status: 'trialing', oldestOpenDueAt: days(10) })).toEqual({ status: 'trialing', readOnly: false });
  });
  test('open invoice past due shows past_due during grace', () => {
    expect(ent({ ...inv, status: 'active', currentPeriodEnd: days(-2), oldestOpenDueAt: days(-2) })).toEqual({ status: 'past_due', readOnly: false });
  });
  test('open invoice past due + grace: read-only', () => {
    expect(ent({ ...inv, status: 'active', currentPeriodEnd: days(20), oldestOpenDueAt: days(-8) })).toEqual({ status: 'read_only', readOnly: true });
  });
  test('an overdue invoice does not cut a running trial short', () => {
    expect(ent({ mode: 'invoice', status: 'trialing', trialEndsAt: days(2), oldestOpenDueAt: days(-30) }).readOnly).toBe(false);
  });
  test('active without a period end (never paid) is read-only', () => {
    expect(ent({ ...inv, status: 'active', currentPeriodEnd: null }).readOnly).toBe(true);
  });
});

describe('complimentary access', () => {
  test('comp_until in the future overrides everything', () => {
    expect(ent({ status: 'unpaid', trialEndsAt: days(-100), compUntil: days(1), mode: 'invoice', oldestOpenDueAt: days(-50) })).toEqual({ status: 'active', readOnly: false });
  });
  test('an expired comp no longer applies', () => {
    expect(ent({ status: 'trialing', trialEndsAt: days(-10), compUntil: days(-1) }).readOnly).toBe(true);
  });
});
