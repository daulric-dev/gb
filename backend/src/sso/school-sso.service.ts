import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SsoRegistry, labelOf } from './sso.registry';
import {
  SsoSettingsService,
  type SsoSettingBefore,
  type SsoSettingWrite,
} from './sso-settings.service';
import {
  diff,
  secretState,
  SsoAuditService,
  type SsoActor,
  type SsoAuditEntry,
} from './sso-audit.service';
import { SsoAlertService } from './sso-alert.service';
import { apiBase, oidcRedirectUri, samlAcsUrl } from './sso.config';
import { SamlAdapter } from './adapters/saml.adapter';
import type { SsoAdapter, SsoSettingField } from './sso.types';

/** One sign-in provider as a school's admins see it. Never a secret. */
export interface SchoolSsoProviderItem {
  key: string;
  /** The name admins see ("Custom OpenID Connect", "SAML 2.0"). */
  label: string;
  /** What the login button says for this school: "Continue with <buttonLabel>". */
  buttonLabel: string;
  kind: 'oauth' | 'saml';
  /** Switched on for this school (its own row, else the env). */
  enabled: boolean;
  /** Enabled and fully configured: the school's domains can use it. */
  available: boolean;
  /**
   * Whose settings apply: the school's own (`school`, it saved some) or the
   * install-wide env fallback (`env`, it has not).
   */
  configSource: 'school' | 'env';
  needsClient: boolean;
  /** The client ID in effect (not secret). */
  clientId: string | null;
  hasSecret: boolean;
  secretSource: 'school' | 'env' | null;
  /** A saved secret no longer decrypts (AUTH_SECRET changed): enter it again. */
  secretUnreadable: boolean;
  settings: Record<string, string>;
  settingFields: readonly SsoSettingField[];
  /** OAuth: what to register as the redirect URI at the provider. */
  redirectUri: string | null;
  /** SAML: what each domain's identity provider is given. */
  saml: { metadataUrl: string; acsUrl: string; entityId: string } | null;
  notes: string | null;
  updatedAt: string | null;
}

/** PUT body, already validated by the DTO. */
export interface SchoolSsoProviderUpdate {
  enabled?: boolean;
  clientId?: string;
  /** Write-only; "" clears it. */
  clientSecret?: string;
  settings?: Record<string, string | null>;
}

const MAX_SETTING = 512;

/**
 * The audit entries for one save of a school's sign-in app: on/off, client ID
 * and each setting by its key (`issuer`, `displayName`, ...), and the secret
 * - as "set" / "cleared", never its value.
 */
export function appSaveEntries(
  key: string,
  before: SsoSettingBefore | null,
  write: SsoSettingWrite,
): SsoAuditEntry[] {
  const entries: SsoAuditEntry[] = [];
  const app = { app: key };
  const wasEnabled = before ? before.enabled : null;
  if (wasEnabled !== write.enabled) {
    entries.push({
      action: write.enabled ? 'app_enabled' : 'app_disabled',
      changes: { ...app, enabled: { before: wasEnabled, after: write.enabled } },
    });
  }
  const settingsAfter = write.settings !== undefined ? write.settings : (before?.settings ?? {});
  const fields = diff(
    { ...(before?.settings ?? {}), clientId: before?.clientId ?? null },
    {
      ...settingsAfter,
      clientId: write.clientId !== undefined ? write.clientId : (before?.clientId ?? null),
    },
  );
  if (fields) entries.push({ action: 'app_changed', changes: { ...app, ...fields } });
  if (write.clientSecret !== undefined) {
    const had = !!before?.secretStored;
    const has = write.clientSecret !== null;
    // Typing a new secret over a saved one is a change too; clearing
    // nothing is not.
    if (had || has) {
      entries.push({
        action: 'app_secret_changed',
        changes: {
          ...app,
          clientSecret: { before: had ? secretState(true) : null, after: secretState(has) },
        },
      });
    }
  }
  return entries;
}

/**
 * A school's own sign-in apps (Google, Microsoft, custom OpenID Connect):
 * on/off, OAuth client ID, write-only secret and the provider's settings. Shared by the school admin's routes
 * (`/schools/current/sso/providers`) and the organisation console's
 * (`/organisation/schools/:id/sso/providers`); callers check who may touch
 * which school. SAML is listed for its service provider details but has
 * nothing to save here - each email domain holds its IdP.
 */
@Injectable()
export class SchoolSsoService {
  private readonly logger = new Logger(SchoolSsoService.name);

  constructor(
    private readonly registry: SsoRegistry,
    private readonly settings: SsoSettingsService,
    private readonly audit: SsoAuditService,
    private readonly alerts: SsoAlertService,
  ) {}

  async list(schoolId: string, req?: FastifyRequest): Promise<SchoolSsoProviderItem[]> {
    const items: SchoolSsoProviderItem[] = [];
    for (const adapter of this.registry.all()) {
      items.push(await this.item(schoolId, adapter, req));
    }
    return items;
  }

  private async item(
    schoolId: string,
    adapter: SsoAdapter,
    req?: FastifyRequest,
  ): Promise<SchoolSsoProviderItem> {
    const { config, source, row } = await this.settings.resolve(adapter, schoolId);
    return {
      key: adapter.id,
      label: adapter.adminLabel ?? adapter.label,
      buttonLabel: labelOf(adapter, config),
      kind: adapter.kind,
      enabled: config.enabled,
      available: adapter.available(config),
      configSource: source,
      needsClient: adapter.needsClient,
      clientId: adapter.needsClient ? config.clientId : null,
      hasSecret: !!config.clientSecret,
      secretSource: config.clientSecret ? source : null,
      secretUnreadable: !!row?.secretUnreadable,
      settings: config.settings,
      settingFields: adapter.settingFields,
      redirectUri: adapter.kind === 'oauth' ? oidcRedirectUri(req) : null,
      saml:
        adapter instanceof SamlAdapter
          ? {
              metadataUrl: `${apiBase(req)}/api/auth/sso/saml/metadata`,
              acsUrl: samlAcsUrl(req),
              entityId: adapter.entityId(),
            }
          : null,
      notes: adapter.adminNotes ?? null,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  }

  async update(
    schoolId: string,
    key: string,
    dto: SchoolSsoProviderUpdate,
    actor: SsoActor,
    req?: FastifyRequest,
  ): Promise<SchoolSsoProviderItem> {
    const adapter = this.registry.adapter(key);
    if (!adapter) throw new NotFoundException('Sign-in provider not found');
    const label = adapter.adminLabel ?? adapter.label;
    if (!adapter.needsClient) {
      throw new BadRequestException(
        `${label} is set up on each email domain, not here`,
      );
    }
    if (
      dto.enabled === undefined &&
      dto.clientId === undefined &&
      dto.clientSecret === undefined &&
      dto.settings === undefined
    ) {
      throw new BadRequestException('Nothing to update');
    }
    const { row } = await this.settings.resolve(adapter, schoolId);

    // A school's first save starts its own app, off until it says otherwise:
    // the env's switch does not carry over.
    const write: SsoSettingWrite = { enabled: dto.enabled ?? row?.enabled ?? false };

    if (dto.clientId !== undefined) {
      const clientId = dto.clientId.trim();
      if (/\s/.test(clientId)) {
        throw new BadRequestException('The client ID cannot contain spaces');
      }
      write.clientId = clientId || null;
    }
    if (dto.clientSecret !== undefined) {
      write.clientSecret = dto.clientSecret.trim() || null;
    }
    if (dto.settings !== undefined) {
      write.settings = this.settingsFor(adapter, label, row?.settings ?? {}, dto.settings);
    }
    // Settings that depend on each other (and network checks, for an
    // admin-entered address) whenever they change or it is turned on.
    if (adapter.checkSettings && (write.settings !== undefined || (write.enabled && !row?.enabled))) {
      await adapter.checkSettings(write.settings ?? row?.settings ?? {}, write.enabled);
    }

    // Switching a provider on without working credentials would offer a
    // button that cannot sign anyone in. The school's own values only: once
    // it has a row, the env does not fill gaps.
    if (write.enabled) {
      const clientId = write.clientId !== undefined ? write.clientId : (row?.clientId ?? null);
      const secret =
        write.clientSecret !== undefined ? write.clientSecret : (row?.clientSecret ?? null);
      if (!clientId || !secret) {
        throw new BadRequestException(
          `Add ${label}'s client ID and client secret before turning it on`,
        );
      }
    }

    let entries: SsoAuditEntry[] = [];
    try {
      await this.settings.save(schoolId, key, write, actor.id, async (tx, before) => {
        entries = appSaveEntries(key, before, write);
        await this.audit.record(tx, schoolId, actor, entries);
      });
    } catch (err) {
      this.logger.error(
        `Failed to save school ${schoolId}'s ${key} sign-in app: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to save the sign-in settings');
    }
    if (entries.length) void this.alerts.notify(schoolId, actor, entries).catch(() => undefined);
    this.logger.log(
      `User ${actor.id} updated school ${schoolId}'s ${key} sign-in app (enabled: ${write.enabled})`,
    );
    return this.item(schoolId, adapter, req);
  }

  private settingsFor(
    adapter: SsoAdapter,
    label: string,
    current: Record<string, string>,
    patch: Record<string, string | null>,
  ): Record<string, string> {
    const fields = new Set(adapter.settingFields.map((f) => f.key));
    const next = { ...current };
    for (const [k, value] of Object.entries(patch)) {
      if (!fields.has(k)) {
        throw new BadRequestException(`${label} has no setting "${k}"`);
      }
      if (value === null || value === '') {
        delete next[k];
        continue;
      }
      if (typeof value !== 'string' || value.length > MAX_SETTING) {
        throw new BadRequestException(
          `"${k}" must be text of at most ${MAX_SETTING} characters`,
        );
      }
      const normalized = adapter.normalizeSetting
        ? adapter.normalizeSetting(k, value)
        : value.trim();
      if (normalized) next[k] = normalized;
      else delete next[k];
    }
    return next;
  }
}
