import { Injectable, Optional } from '@nestjs/common';
import type { SsoAdapter, SsoProviderConfig, SsoProviderInfo } from './sso.types';
import { GoogleAdapter } from './adapters/google.adapter';
import { AzureAdapter } from './adapters/azure.adapter';
import { SamlAdapter } from './adapters/saml.adapter';
import { SsoSettingsService, type ResolvedSsoConfig } from './sso-settings.service';

/**
 * Every sign-in provider the app knows about. Register a new adapter here;
 * each school's own settings (or, for a school without its own app, the
 * install-wide env vars) decide which of them a school offers.
 */
function createAdapters(): SsoAdapter[] {
  return [new GoogleAdapter(), new AzureAdapter(), new SamlAdapter()];
}

/** An adapter usable for a sign-in, with the configuration it runs under. */
export interface ResolvedProvider {
  adapter: SsoAdapter;
  config: SsoProviderConfig;
  source: 'school' | 'env';
  /** Identifies whose credentials these are, for adapter caches. */
  clientKey: string;
}

/** `school:<id>` for a school's own app, `env` for the install-wide one. */
export function clientKeyOf(source: 'school' | 'env', schoolId: string | null): string {
  return source === 'school' && schoolId ? `school:${schoolId}` : 'env';
}

@Injectable()
export class SsoRegistry {
  private readonly adapters = createAdapters();
  private readonly byId = new Map(this.adapters.map((a) => [a.id, a]));

  /**
   * Without the settings service (tests, scripts) every school uses the
   * env, as if none had saved its own app.
   */
  constructor(@Optional() private readonly settings?: SsoSettingsService) {}

  /** Any registered adapter, available or not. */
  adapter(id: string | null | undefined): SsoAdapter | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  /** Every registered adapter, in registration order. */
  all(): readonly SsoAdapter[] {
    return this.adapters;
  }

  /** Every adapter, available or not - for validating stored ids. */
  known(id: string): boolean {
    return this.byId.has(id);
  }

  /** The configuration `schoolId` (null: none known) has for an adapter. */
  async configFor(adapter: SsoAdapter, schoolId: string | null): Promise<ResolvedSsoConfig> {
    return this.settings
      ? this.settings.resolve(adapter, schoolId)
      : { config: adapter.envConfig(), source: 'env' };
  }

  /**
   * The provider `id` as `schoolId` has it, when it is available there
   * (switched on and fully configured); otherwise undefined. A school's own
   * row wins; with none, the env applies.
   */
  async resolve(
    id: string | null | undefined,
    schoolId: string | null,
  ): Promise<ResolvedProvider | undefined> {
    const adapter = this.adapter(id);
    if (!adapter) return undefined;
    const { config, source } = await this.configFor(adapter, schoolId);
    if (!adapter.available(config)) return undefined;
    return { adapter, config, source, clientKey: clientKeyOf(source, schoolId) };
  }

  /** The providers available to one school (its own apps, env fallback, SAML). */
  async availableFor(schoolId: string): Promise<SsoProviderInfo[]> {
    const out: SsoProviderInfo[] = [];
    for (const adapter of this.adapters) {
      if (await this.resolve(adapter.id, schoolId)) out.push(info(adapter));
    }
    return out;
  }

  /**
   * Providers that work before anyone says which school they are from: the
   * OAuth ones the env sets up install-wide. School-specific providers (a
   * school's own app, SAML) are offered once the email is known (discover).
   */
  unscoped(): SsoProviderInfo[] {
    return this.adapters
      .filter((a) => a.needsClient && a.available(a.envConfig()))
      .map(info);
  }
}

export function info(a: SsoAdapter): SsoProviderInfo {
  return { id: a.id, label: a.label, kind: a.kind };
}
