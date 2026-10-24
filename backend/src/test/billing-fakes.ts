/* eslint-disable @typescript-eslint/no-unused-vars */
 
import { mock } from 'bun:test';
import type {
  BillingEvent,
  CheckoutResult,
  PaymentProvider,
} from '@/billing/providers/payment-provider';

/**
 * A payment provider for unit tests only: every method is a bun mock with a
 * harmless default, so tests assert on what billing asked the provider to do.
 */
export class FakeProvider implements PaymentProvider {
  readonly label: string;
  configured = true;

  createCheckout = mock(
    (..._args: any[]): Promise<CheckoutResult> =>
      Promise.resolve({
        redirectUrl: 'https://pay.test/checkout',
        providerRef: 'cs_1',
        providerCustomerId: 'cus_1',
      }),
  );
  payInvoice = mock(
    (..._args: any[]): Promise<CheckoutResult> =>
      Promise.resolve({ redirectUrl: 'https://pay.test/invoice', providerRef: null }),
  );
  updateQuantity = mock((..._args: any[]): Promise<void> => Promise.resolve());
  changePlan = mock((..._args: any[]): Promise<void> => Promise.resolve());
  cancel = mock((..._args: any[]): Promise<void> => Promise.resolve());
  resume = mock((..._args: any[]): Promise<void> => Promise.resolve());
  portalUrl = mock((..._args: any[]): Promise<string | null> => Promise.resolve('https://pay.test/portal'));
  parseWebhook = mock((..._args: any[]): Promise<BillingEvent[]> => Promise.resolve([]));

  constructor(
    readonly id = 'fake',
    readonly mode: 'subscription' | 'invoice' = 'subscription',
  ) {
    this.label = `Fake ${id}`;
  }

  isConfigured(): boolean {
    return this.configured;
  }
}

/** A subscription row with defaults. */
export function subRow(over: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    school_id: 'school-1',
    plan: null as string | null,
    status: 'trialing',
    provider: null as string | null,
    provider_customer_id: null as string | null,
    provider_subscription_id: null as string | null,
    quantity: 1,
    trial_ends_at: null as Date | null,
    current_period_start: null as Date | null,
    current_period_end: null as Date | null,
    cancel_at_period_end: false,
    comp_until: null as Date | null,
    comp_note: null as string | null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

export function invoiceRow(over: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    number: 'GB-202610-0001',
    school_id: 'school-1',
    plan: 'per_user',
    seats: 10,
    amount_cents: 5000,
    currency: 'USD',
    status: 'open',
    provider: 'manual' as string | null,
    provider_invoice_id: null as string | null,
    period_start: new Date('2026-10-01T00:00:00Z'),
    period_end: new Date('2026-11-01T00:00:00Z'),
    due_at: new Date('2026-10-15T00:00:00Z'),
    paid_at: null as Date | null,
    method: null as string | null,
    reference: null as string | null,
    note: null as string | null,
    marked_by: null as string | null,
    created_at: new Date('2026-10-01T00:00:00Z'),
    ...over,
  };
}
