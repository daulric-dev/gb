import { describe, expect, test } from 'bun:test';
import {
  addMonth,
  amountFor,
  billingEnabled,
  billingReturnUrl,
  loadBillingConfig,
  planPrice,
  seatsFor,
} from './billing.config';

describe('billing config', () => {
  test('defaults: billing off, contract prices', () => {
    const cfg = loadBillingConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.perUserCents).toBe(500);
    expect(cfg.flatCents).toBe(30000);
    expect(cfg.currency).toBe('USD');
    expect(cfg.trialDays).toBe(30);
    expect(cfg.graceDays).toBe(7);
    expect([...cfg.allowedProviders]).toEqual([]);
    expect([...cfg.platformAdminEmails]).toEqual([]);
  });

  test('BILLING_ENABLED accepts true-ish values only', () => {
    for (const v of ['true', 'TRUE', '1', 'yes', ' on ']) {
      expect(billingEnabled({ BILLING_ENABLED: v })).toBe(true);
    }
    for (const v of [undefined, '', 'false', '0', 'no', 'enabled']) {
      expect(billingEnabled({ BILLING_ENABLED: v })).toBe(false);
    }
  });

  test('numbers fall back when malformed or negative', () => {
    const cfg = loadBillingConfig({
      BILLING_PER_USER_CENTS: '700',
      BILLING_FLAT_CENTS: 'abc',
      BILLING_TRIAL_DAYS: '-3',
      BILLING_GRACE_DAYS: '0',
      BILLING_CURRENCY: 'ttd',
    });
    expect(cfg.perUserCents).toBe(700);
    expect(cfg.flatCents).toBe(30000);
    expect(cfg.trialDays).toBe(30);
    expect(cfg.graceDays).toBe(0);
    expect(cfg.currency).toBe('TTD');
    expect(loadBillingConfig({ BILLING_CURRENCY: 'dollars' }).currency).toBe('USD');
  });

  test('provider allowlist and admin emails are trimmed lower-case sets', () => {
    const cfg = loadBillingConfig({
      PAYMENT_PROVIDERS: ' Stripe, manual,,WIPAY ',
      PLATFORM_ADMIN_EMAILS: 'Ops@Example.com, dev@x.io',
    });
    expect([...cfg.allowedProviders].sort()).toEqual(['manual', 'stripe', 'wipay']);
    expect(cfg.platformAdminEmails.has('ops@example.com')).toBe(true);
    expect(loadBillingConfig({ PAYMENT_PROVIDERS: '' }).allowedProviders.size).toBe(0);
  });

  test('APP_URL wins, else the first FRONTEND_URL origin', () => {
    expect(loadBillingConfig({ APP_URL: 'https://app.gb.test/' }).appUrl).toBe('https://app.gb.test');
    const saved = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://web.gb.test,http://localhost:3000';
    try {
      expect(loadBillingConfig({}).appUrl).toBe('https://web.gb.test');
    } finally {
      if (saved === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = saved;
    }
    const cfg = loadBillingConfig({ APP_URL: 'https://app.gb.test' });
    expect(billingReturnUrl(cfg, 'success')).toBe(
      'https://app.gb.test/dashboard/settings/billing?checkout=success',
    );
    expect(billingReturnUrl(cfg, 'cancel')).toEndWith('?checkout=cancel');
  });

  test('plan prices, seats and amounts', () => {
    const cfg = loadBillingConfig({});
    expect(planPrice(cfg, 'per_user')).toEqual({ plan: 'per_user', unitAmountCents: 500, currency: 'USD', interval: 'month' });
    expect(seatsFor('per_user', 0)).toBe(1);
    expect(seatsFor('per_user', 42)).toBe(42);
    expect(seatsFor('flat', 42)).toBe(1);
    expect(amountFor(cfg, 'per_user', 42)).toBe(21000);
    expect(amountFor(cfg, 'flat', 42)).toBe(30000);
  });

  test('addMonth keeps the day, clamped to month end', () => {
    expect(addMonth(new Date('2026-10-15T10:00:00Z')).toISOString()).toBe('2026-11-15T10:00:00.000Z');
    expect(addMonth(new Date('2027-01-31T00:00:00Z')).toISOString()).toBe('2027-02-28T00:00:00.000Z');
    expect(addMonth(new Date('2026-12-05T00:00:00Z')).toISOString()).toBe('2027-01-05T00:00:00.000Z');
  });
});
