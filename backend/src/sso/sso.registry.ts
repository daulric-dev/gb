import { Injectable } from '@nestjs/common';
import type { SsoAdapter, SsoProviderInfo } from './sso.types';
import { GoogleAdapter } from './adapters/google.adapter';
import { AzureAdapter } from './adapters/azure.adapter';
import { SamlAdapter } from './adapters/saml.adapter';

/**
 * Every sign-in provider the app knows about. Register a new adapter here;
 * SSO_PROVIDERS decides which of them a deployment actually offers.
 */
const ADAPTERS: SsoAdapter[] = [
  new GoogleAdapter(),
  new AzureAdapter(),
  new SamlAdapter(),
];

@Injectable()
export class SsoRegistry {
  private readonly byId = new Map(ADAPTERS.map((a) => [a.id, a]));

  /** An enabled adapter, or undefined. Disabled ones are as good as absent. */
  get(id: string | null | undefined): SsoAdapter | undefined {
    const adapter = id ? this.byId.get(id) : undefined;
    return adapter?.isEnabled() ? adapter : undefined;
  }

  /** Every adapter, enabled or not - for validating stored ids. */
  known(id: string): boolean {
    return this.byId.has(id);
  }

  enabled(): SsoProviderInfo[] {
    return ADAPTERS.filter((a) => a.isEnabled()).map(info);
  }

  /** The adapter a Supabase identity provider name belongs to. */
  forIdentityProvider(provider: string): SsoAdapter | undefined {
    if (provider.startsWith('sso:')) return this.get('saml');
    return this.get(provider);
  }
}

export function info(a: SsoAdapter): SsoProviderInfo {
  return { id: a.id, label: a.label, kind: a.kind };
}
