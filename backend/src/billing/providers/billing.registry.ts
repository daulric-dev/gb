import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { billingEnabled } from './billing.config';
import type { PaymentProvider } from './providers/payment-provider';
import { StripeProvider } from './providers/stripe.provider';

/** Injection token for the provider list (tests pass their own). */
export const PAYMENT_PROVIDER_LIST = Symbol('PAYMENT_PROVIDER_LIST');

/**
 * Every payment provider the app knows about. Stripe is the only one; to add
 * another, implement PaymentProvider and register it here. A registered
 * provider is offered to schools once its credentials are set.
 */
export function defaultProviders(): PaymentProvider[] {
  return [new StripeProvider()];
}

export interface ProviderInfo {
  id: string;
  label: string;
}

export function info(p: PaymentProvider): ProviderInfo {
  return { id: p.id, label: p.label };
}

@Injectable()
export class BillingRegistry implements OnModuleInit {
  private readonly logger = new Logger(BillingRegistry.name);
  private readonly providers: PaymentProvider[];
  private readonly byId: Map<string, PaymentProvider>;

  constructor(@Optional() @Inject(PAYMENT_PROVIDER_LIST) providers?: PaymentProvider[]) {
    this.providers = providers ?? defaultProviders();
    this.byId = new Map(this.providers.map((p) => [p.id, p]));
  }

  /** Billing on but nothing to take payment with: say so once at startup. */
  onModuleInit() {
    if (billingEnabled() && this.enabled().length === 0) {
      this.logger.warn(
        'BILLING_ENABLED is on but no payment provider is configured - set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. Schools cannot subscribe until then.',
      );
    }
  }

  /**
   * A registered provider, configured or not (for stored ids and webhooks).
   * Unknown ids - such as a removed provider still stored on an old row - are
   * undefined, which callers treat as "no provider".
   */
  find(id: string | null | undefined): PaymentProvider | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  configured(p: PaymentProvider): boolean {
    try {
      return p.isConfigured();
    } catch {
      return false;
    }
  }

  /** The providers a school may choose at checkout: those with credentials. */
  enabled(): PaymentProvider[] {
    return this.providers.filter((p) => this.configured(p));
  }

  /** A configured provider, or undefined. Unconfigured ones are as good as absent. */
  getEnabled(id: string | null | undefined): PaymentProvider | undefined {
    const provider = this.find(id);
    return provider && this.configured(provider) ? provider : undefined;
  }
}
