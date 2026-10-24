import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { loadBillingConfig } from './billing.config';
import type { PaymentProvider } from './providers/payment-provider';
import { StripeProvider } from './providers/stripe.provider';
import { PayPalProvider } from './providers/paypal.provider';
import { PaddleProvider } from './providers/paddle.provider';
import { WiPayProvider } from './providers/wipay.provider';
import { ManualProvider } from './providers/manual.provider';

/** Injection token for the provider list (tests pass their own). */
export const PAYMENT_PROVIDER_LIST = Symbol('PAYMENT_PROVIDER_LIST');

/**
 * Every payment provider the app knows about. Register a new one here;
 * PAYMENT_PROVIDERS, credentials and the platform dashboard's switches decide
 * which of them a deployment actually offers.
 */
export function defaultProviders(): PaymentProvider[] {
  return [
    new StripeProvider(),
    new PayPalProvider(),
    new PaddleProvider(),
    new WiPayProvider(),
    new ManualProvider(),
  ];
}

export interface ProviderInfo {
  id: string;
  label: string;
  mode: 'subscription' | 'invoice';
}

export interface ProviderStatus extends ProviderInfo {
  allowedByEnv: boolean;
  configured: boolean;
  enabled: boolean;
}

export function info(p: PaymentProvider): ProviderInfo {
  return { id: p.id, label: p.label, mode: p.mode };
}

@Injectable()
export class BillingRegistry {
  private readonly providers: PaymentProvider[];
  private readonly byId: Map<string, PaymentProvider>;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(PAYMENT_PROVIDER_LIST) providers?: PaymentProvider[],
  ) {
    this.providers = providers ?? defaultProviders();
    this.byId = new Map(this.providers.map((p) => [p.id, p]));
  }

  /** A registered provider, enabled or not (for stored ids and webhooks). */
  find(id: string | null | undefined): PaymentProvider | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  known(id: string): boolean {
    return this.byId.has(id);
  }

  private configured(p: PaymentProvider): boolean {
    try {
      return p.isConfigured();
    } catch {
      return false;
    }
  }

  /** Every registered provider with the three switches that gate it. */
  async statuses(): Promise<ProviderStatus[]> {
    const allowed = loadBillingConfig().allowedProviders;
    const rows = await this.prisma.provider_setting.findMany({
      select: { provider_id: true, enabled: true },
    });
    const switchedOff = new Set(
      rows.filter((r) => !r.enabled).map((r) => r.provider_id),
    );
    return this.providers.map((p) => {
      const allowedByEnv = allowed.has(p.id);
      const configured = this.configured(p);
      return {
        ...info(p),
        allowedByEnv,
        configured,
        enabled: allowedByEnv && configured && !switchedOff.has(p.id),
      };
    });
  }

  /** What schools may choose at checkout. */
  async enabled(): Promise<PaymentProvider[]> {
    const on = new Set(
      (await this.statuses()).filter((s) => s.enabled).map((s) => s.id),
    );
    return this.providers.filter((p) => on.has(p.id));
  }

  /** An enabled provider, or undefined. Disabled ones are as good as absent. */
  async getEnabled(id: string | null | undefined): Promise<PaymentProvider | undefined> {
    if (!id || !this.byId.has(id)) return undefined;
    return (await this.enabled()).find((p) => p.id === id);
  }
}
