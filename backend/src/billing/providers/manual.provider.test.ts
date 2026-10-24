import { describe, expect, test } from 'bun:test';
import { ManualProvider, formatMoney } from './manual.provider';
import { WebhookVerificationError } from './payment-provider';

const ctx = {
  invoiceId: 'inv-1',
  invoiceNumber: 'GB-202610-0007',
  schoolId: 's1',
  schoolName: 'Riverside',
  customerEmail: 'admin@x.test',
  amountCents: 8000,
  currency: 'USD',
  description: 'GradeBook',
  successUrl: 'https://app/s',
  cancelUrl: 'https://app/c',
  callbackUrl: 'https://api/cb',
};

describe('ManualProvider', () => {
  test('is an always-configured invoice provider', () => {
    const p = new ManualProvider({});
    expect(p.id).toBe('manual');
    expect(p.mode).toBe('invoice');
    expect(p.isConfigured()).toBe(true);
  });

  test('payInvoice: no redirect, bank details plus the invoice number to quote', async () => {
    const p = new ManualProvider({ BILLING_MANUAL_INSTRUCTIONS: 'Bank: Demo Bank, acct 123' });
    const result = await p.payInvoice(ctx);
    expect(result.redirectUrl).toBeNull();
    expect(result.providerRef).toBeNull();
    expect(result.instructions).toContain('Bank: Demo Bank, acct 123');
    expect(result.instructions).toContain('GB-202610-0007');
    expect(result.instructions).toContain('80.00 USD');
  });

  test('falls back to generic instructions when none are configured', async () => {
    const result = await new ManualProvider({}).payInvoice(ctx);
    expect(result.instructions).toContain('bank transfer');
    expect(result.instructions).toContain('GB-202610-0007');
  });

  test('has no webhooks', async () => {
    const p = new ManualProvider({});
    await expect(p.parseWebhook()).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test('formatMoney', () => {
    expect(formatMoney(30000, 'TTD')).toBe('300.00 TTD');
    expect(formatMoney(5, 'USD')).toBe('0.05 USD');
  });
});
