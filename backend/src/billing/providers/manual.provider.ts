import {
  WebhookVerificationError,
  type BillingEvent,
  type CheckoutResult,
  type InvoicePaymentContext,
  type PaymentProvider,
} from './payment-provider';

const DEFAULT_INSTRUCTIONS =
  'Pay by bank transfer. Contact the platform operator for bank details.';

/**
 * Manual invoices: the school pays by bank transfer (or cheque, cash...) and a
 * platform admin marks the invoice paid in the platform dashboard. There is
 * nothing to redirect to and no webhook - the "provider" is a person.
 *
 * BILLING_MANUAL_INSTRUCTIONS holds the bank details shown to school admins.
 */
export class ManualProvider implements PaymentProvider {
  readonly id = 'manual';
  readonly label = 'Bank transfer';
  readonly mode = 'invoice' as const;

  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  isConfigured(): boolean {
    return true;
  }

  instructions(invoiceNumber: string, amount: string): string {
    const base =
      this.env.BILLING_MANUAL_INSTRUCTIONS?.trim() || DEFAULT_INSTRUCTIONS;
    return `${base}\n\nAmount: ${amount}\nQuote invoice number ${invoiceNumber} as the payment reference.`;
  }

  payInvoice(ctx: InvoicePaymentContext): Promise<CheckoutResult> {
    return Promise.resolve({
      redirectUrl: null,
      providerRef: null,
      instructions: this.instructions(
        ctx.invoiceNumber,
        formatMoney(ctx.amountCents, ctx.currency),
      ),
    });
  }

  parseWebhook(): Promise<BillingEvent[]> {
    return Promise.reject(
      new WebhookVerificationError('Manual invoices have no webhooks'),
    );
  }
}

export function formatMoney(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}
