import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import type { SsoAdapter, SsoProviderConfig } from './sso.types';
import { decryptSsoSecret, encryptSsoSecret } from './sso-secret';

/** How long a school's loaded settings are used before they are read again. */
export const SSO_SETTINGS_TTL_MS = 30_000;

/** One public.school_sso_provider row, secret decrypted. */
export interface StoredSsoSetting {
  enabled: boolean;
  clientId: string | null;
  /** Decrypted; null when none is stored or it cannot be decrypted. */
  clientSecret: string | null;
  /** A ciphertext is stored (even one that no longer decrypts). */
  secretStored: boolean;
  /** Stored but not decryptable - AUTH_SECRET changed since it was saved. */
  secretUnreadable: boolean;
  settings: Record<string, string>;
  updatedAt: Date;
  updatedBy: string | null;
}

/** What a save changes; undefined leaves a field as it is. */
export interface SsoSettingWrite {
  enabled: boolean;
  /** null clears it. */
  clientId?: string | null;
  clientSecret?: string | null;
  settings?: Record<string, string>;
}

/** A school's row as it stood before a save, for the audit log. Never the secret. */
export interface SsoSettingBefore {
  enabled: boolean;
  clientId: string | null;
  secretStored: boolean;
  settings: Record<string, string>;
}

/**
 * A provider's configuration for one sign-in, and whose it is: the school's
 * own app (`school`), or the install-wide env one (`env`).
 */
export interface ResolvedSsoConfig {
  config: SsoProviderConfig;
  source: 'school' | 'env';
  /** The school's saved row, when there is one. */
  row?: StoredSsoSetting;
}

interface SchoolEntry {
  rows: Map<string, StoredSsoSetting>;
  loadedAt: number;
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '',
    ),
  );
}

/**
 * Each school's own sign-in apps (public.school_sso_provider), with the env
 * as the install-wide fallback.
 *
 * Precedence for (school, provider):
 * - the school has a row: that row, alone. Switched off, or missing a
 *   credential, the provider is unavailable for the school - the env never
 *   fills in for a school that set up (or turned off) its own.
 * - no row, or no school known yet: the env (SSO_PROVIDERS and the
 *   provider's GOOGLE_* / MICROSOFT_* variables), if the install sets it.
 * Providers that need no client (SAML) always follow the env config.
 *
 * Rows are read per school and reused for SSO_SETTINGS_TTL_MS, so other
 * instances see a change within ~30 s; a save here drops this instance's
 * copy at once.
 */
@Injectable()
export class SsoSettingsService {
  private readonly logger = new Logger(SsoSettingsService.name);
  private readonly schools = new Map<string, SchoolEntry>();
  private readonly loading = new Map<string, Promise<SchoolEntry>>();

  constructor(private readonly prisma: PrismaService) {}

  /** A school's saved rows by provider (at most SSO_SETTINGS_TTL_MS old). */
  async forSchool(schoolId: string): Promise<Map<string, StoredSsoSetting>> {
    const cached = this.schools.get(schoolId);
    if (cached && Date.now() - cached.loadedAt < SSO_SETTINGS_TTL_MS) {
      return cached.rows;
    }
    let pending = this.loading.get(schoolId);
    if (!pending) {
      pending = this.load(schoolId, cached).finally(() => this.loading.delete(schoolId));
      this.loading.set(schoolId, pending);
    }
    return (await pending).rows;
  }

  private async load(schoolId: string, previous?: SchoolEntry): Promise<SchoolEntry> {
    let rows: Awaited<ReturnType<PrismaService['school_sso_provider']['findMany']>>;
    try {
      rows = await this.prisma.school_sso_provider.findMany({
        where: { school_id: schoolId },
      });
    } catch (err) {
      this.logger.error(
        `Failed to load school ${schoolId}'s sign-in apps: ${(err as Error).message}`,
      );
      // Keep what we had; with nothing, fail rather than fall back to the
      // env for a school that may have its own (or have turned it off).
      // Retried after the TTL, not on every request.
      if (previous) {
        previous.loadedAt = Date.now();
        return previous;
      }
      throw err;
    }
    const next = new Map<string, StoredSsoSetting>();
    for (const row of rows) {
      const owner = { schoolId, provider: row.provider };
      const clientSecret = row.client_secret_enc
        ? decryptSsoSecret(owner, row.client_secret_enc)
        : null;
      if (row.client_secret_enc && clientSecret === null) {
        this.logger.warn(
          `School ${schoolId}'s ${row.provider} client secret cannot be decrypted (was AUTH_SECRET changed?); it must be entered again`,
        );
      }
      next.set(row.provider, {
        enabled: row.enabled,
        clientId: row.client_id?.trim() || null,
        clientSecret,
        secretStored: !!row.client_secret_enc,
        secretUnreadable: !!row.client_secret_enc && clientSecret === null,
        settings: stringMap(row.settings),
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
      });
    }
    const entry = { rows: next, loadedAt: Date.now() };
    this.schools.set(schoolId, entry);
    return entry;
  }

  /** Forget a school's copy; the next lookup reads the rows again. */
  invalidate(schoolId: string): void {
    this.schools.delete(schoolId);
  }

  /**
   * The configuration a sign-in for `schoolId` (null: no school known yet)
   * uses for `adapter`. See the class comment for the precedence.
   */
  async resolve(adapter: SsoAdapter, schoolId: string | null): Promise<ResolvedSsoConfig> {
    if (schoolId && adapter.needsClient) {
      const row = (await this.forSchool(schoolId)).get(adapter.id);
      if (row) {
        return {
          config: {
            enabled: row.enabled,
            clientId: row.clientId,
            clientSecret: row.clientSecret,
            settings: row.settings,
          },
          source: 'school',
          row,
        };
      }
    }
    return { config: adapter.envConfig(), source: 'env' };
  }

  /**
   * Save a school's row for a provider (secret encrypted) and reload it.
   * `inTransaction` runs in the same transaction, after the write, with the
   * row as it was (null: none) - the audit log's hook.
   */
  async save(
    schoolId: string,
    provider: string,
    write: SsoSettingWrite,
    actorId: string | null,
    inTransaction?: (
      tx: Prisma.TransactionClient,
      before: SsoSettingBefore | null,
    ) => Promise<void>,
  ): Promise<void> {
    const data: Prisma.school_sso_providerUncheckedUpdateInput = {
      enabled: write.enabled,
      updated_at: new Date(),
      updated_by: actorId,
    };
    if (write.clientId !== undefined) data.client_id = write.clientId;
    if (write.clientSecret !== undefined) {
      data.client_secret_enc =
        write.clientSecret === null
          ? null
          : encryptSsoSecret({ schoolId, provider }, write.clientSecret);
    }
    if (write.settings !== undefined) data.settings = write.settings;

    const where = { school_id_provider: { school_id: schoolId, provider } };
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.school_sso_provider.findUnique({
        where,
        select: { enabled: true, client_id: true, client_secret_enc: true, settings: true },
      });
      if (existing) {
        await tx.school_sso_provider.update({ where, data });
      } else {
        // ON CONFLICT DO NOTHING rather than catching a unique violation,
        // which would abort the transaction. Saved at the same moment by
        // someone else: apply ours on top.
        const { count } = await tx.school_sso_provider.createMany({
          data: [
            {
              school_id: schoolId,
              provider,
              enabled: write.enabled,
              client_id: write.clientId ?? null,
              client_secret_enc: (data.client_secret_enc as string | null | undefined) ?? null,
              settings: write.settings ?? {},
              updated_by: actorId,
            },
          ],
          skipDuplicates: true,
        });
        if (count === 0) await tx.school_sso_provider.update({ where, data });
      }
      await inTransaction?.(
        tx,
        existing
          ? {
              enabled: existing.enabled,
              clientId: existing.client_id?.trim() || null,
              secretStored: !!existing.client_secret_enc,
              settings: stringMap(existing.settings),
            }
          : null,
      );
    });
    // A load that started before the write would bring back the old rows.
    const inFlight = this.loading.get(schoolId);
    if (inFlight) await inFlight.catch(() => undefined);
    this.invalidate(schoolId);
    await this.forSchool(schoolId);
  }
}
