import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { FeatureService } from '@/features/feature.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { lawfulBasesFor, retentionTable, type RetentionItem } from './privacy.catalog';
import { buildRecipients, type AdditionalRecipient, type Recipient, type RecipientSources } from './privacy.recipients';
import type { UpdatePrivacySettingsDto } from './privacy.dto';

/** The stored privacy details, as the organisation console edits them. */
export interface PrivacySettingsView {
  controllerName: string | null;
  controllerAddress: string | null;
  privacyEmail: string | null;
  dpoName: string | null;
  dpoEmail: string | null;
  supervisoryAuthorityName: string | null;
  supervisoryAuthorityUrl: string | null;
  dataLocation: string | null;
  lawfulBases: Record<string, string[]>;
  additionalRecipients: AdditionalRecipient[];
  updatedAt: string | null;
}

/** Field keys of PrivacySettingsView that the notice needs (`missing`) or should have (`recommended`). */
export const REQUIRED_FIELDS = [
  'controllerName',
  'controllerAddress',
  'privacyEmail',
  'supervisoryAuthorityName',
  'supervisoryAuthorityUrl',
] as const;
export const RECOMMENDED_FIELDS = ['dpoName', 'dpoEmail', 'dataLocation'] as const;

/** `GET /api/privacy/notice`: everything the public notice fills in. */
export interface PrivacyNotice {
  /** True once every required field is filled in. */
  configured: boolean;
  missing: string[];
  recommended: string[];
  organisationName: string | null;
  controller: { name: string | null; address: string | null; privacyEmail: string | null };
  dpo: { name: string | null; email: string | null } | null;
  supervisoryAuthority: { name: string | null; url: string | null } | null;
  dataLocation: string | null;
  lawfulBases: ReturnType<typeof lawfulBasesFor>;
  retention: RetentionItem[];
  recipients: Recipient[];
  /** The organisation's own feature switches, so the notice can say what is in use. */
  features: Record<string, boolean>;
  updatedAt: string | null;
}

const NOTICE_CACHE_KEY = 'privacy:notice';
/** Seconds. Changes made here drop it at once; config changes elsewhere show within a minute. */
const NOTICE_CACHE_TTL = 60;

type Row = {
  controller_name: string | null;
  controller_address: string | null;
  privacy_email: string | null;
  dpo_name: string | null;
  dpo_email: string | null;
  supervisory_authority_name: string | null;
  supervisory_authority_url: string | null;
  data_location: string | null;
  lawful_bases: unknown;
  additional_recipients: unknown;
  updated_at: Date;
};

const SELECT = {
  controller_name: true,
  controller_address: true,
  privacy_email: true,
  dpo_name: true,
  dpo_email: true,
  supervisory_authority_name: true,
  supervisory_authority_url: true,
  data_location: true,
  lawful_bases: true,
  additional_recipients: true,
  updated_at: true,
} as const;

/** Keys of the view mapped to their columns. */
const TEXT_FIELDS = {
  controllerName: 'controller_name',
  controllerAddress: 'controller_address',
  privacyEmail: 'privacy_email',
  dpoName: 'dpo_name',
  dpoEmail: 'dpo_email',
  supervisoryAuthorityName: 'supervisory_authority_name',
  supervisoryAuthorityUrl: 'supervisory_authority_url',
  dataLocation: 'data_location',
} as const;

function asBases(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
  }
  return out;
}

function asRecipients(value: unknown): AdditionalRecipient[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .filter((r) => typeof r.name === 'string' && typeof r.purpose === 'string')
    .map((r) => ({
      name: r.name as string,
      purpose: r.purpose as string,
      location: typeof r.location === 'string' ? r.location : null,
    }));
}

export function settingsView(row: Row | null): PrivacySettingsView {
  return {
    controllerName: row?.controller_name ?? null,
    controllerAddress: row?.controller_address ?? null,
    privacyEmail: row?.privacy_email ?? null,
    dpoName: row?.dpo_name ?? null,
    dpoEmail: row?.dpo_email ?? null,
    supervisoryAuthorityName: row?.supervisory_authority_name ?? null,
    supervisoryAuthorityUrl: row?.supervisory_authority_url ?? null,
    dataLocation: row?.data_location ?? null,
    lawfulBases: asBases(row?.lawful_bases),
    additionalRecipients: asRecipients(row?.additional_recipients),
    updatedAt: row?.updated_at.toISOString() ?? null,
  };
}

/** The required and recommended fields that are still empty. */
export function missingFields(view: PrivacySettingsView): { missing: string[]; recommended: string[] } {
  const empty = (k: keyof PrivacySettingsView) => {
    const v = view[k];
    return typeof v !== 'string' || v.trim() === '';
  };
  return {
    missing: REQUIRED_FIELDS.filter(empty),
    recommended: RECOMMENDED_FIELDS.filter(empty),
  };
}

/** Assembles the notice from the settings and the gathered configuration. Pure. */
export function buildNotice(
  view: PrivacySettingsView,
  organisationName: string | null,
  sources: Omit<RecipientSources, 'additional'>,
  env: Record<string, string | undefined> = process.env,
): PrivacyNotice {
  const { missing, recommended } = missingFields(view);
  const dpo = view.dpoName || view.dpoEmail ? { name: view.dpoName, email: view.dpoEmail } : null;
  const authority =
    view.supervisoryAuthorityName || view.supervisoryAuthorityUrl
      ? { name: view.supervisoryAuthorityName, url: view.supervisoryAuthorityUrl }
      : null;
  return {
    configured: missing.length === 0,
    missing,
    recommended,
    organisationName,
    controller: {
      name: view.controllerName,
      address: view.controllerAddress,
      privacyEmail: view.privacyEmail,
    },
    dpo,
    supervisoryAuthority: authority,
    dataLocation: view.dataLocation,
    lawfulBases: lawfulBasesFor(view.lawfulBases),
    retention: retentionTable(env),
    recipients: buildRecipients({ ...sources, additional: view.additionalRecipients }),
    features: sources.features,
    updatedAt: view.updatedAt,
  };
}

/**
 * The organisation's privacy notice details (`public.privacy_setting`, one
 * row) and the public notice built from them and the live configuration.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureService,
    @Optional() private readonly cache?: CacheService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  private row(): Promise<Row | null> {
    return this.prisma.privacy_setting.findUnique({ where: { id: true }, select: SELECT });
  }

  async get(): Promise<PrivacySettingsView & { missing: string[]; recommended: string[] }> {
    const view = settingsView(await this.row());
    return { ...view, ...missingFields(view) };
  }

  async update(dto: UpdatePrivacySettingsDto, actorId: string) {
    const before = settingsView(await this.row());
    const data: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(TEXT_FIELDS)) {
      const value = dto[key as keyof typeof TEXT_FIELDS];
      if (value === undefined) continue;
      data[column] = typeof value === 'string' && value.trim() ? value.trim() : null;
    }
    if (dto.lawfulBases !== undefined) {
      data.lawful_bases = Object.fromEntries(
        Object.entries(dto.lawfulBases).filter(([, v]) => Array.isArray(v) && v.length > 0),
      );
    }
    if (dto.additionalRecipients !== undefined) {
      data.additional_recipients = dto.additionalRecipients.map((r) => ({
        name: r.name.trim(),
        purpose: r.purpose.trim(),
        location: r.location?.trim() || null,
      }));
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.privacy_setting.upsert({
        where: { id: true },
        create: { id: true, ...data, updated_by: actorId },
        update: { ...data, updated_by: actorId, updated_at: new Date() },
        select: SELECT,
      });
      const after = settingsView(row);
      const pick = (v: PrivacySettingsView) => {
        const { updatedAt: _ignored, ...rest } = v;
        return rest as Record<string, unknown>;
      };
      await this.auditLog?.record(tx, null, { id: actorId }, {
        entity: 'privacy_setting',
        entityId: null,
        action: before.updatedAt ? 'update' : 'create',
        changes: auditChanges(before.updatedAt ? pick(before) : null, pick(after)),
      });
      return after;
    });
    await this.cache?.delete(NOTICE_CACHE_KEY).catch(() => undefined);
    this.logger.log(`Organisation admin ${actorId} saved the privacy notice details`);
    return { ...saved, ...missingFields(saved) };
  }

  /** The public notice; cached for a minute. */
  async notice(): Promise<PrivacyNotice> {
    const cached = (await this.cache?.get(NOTICE_CACHE_KEY).catch(() => null)) as PrivacyNotice | null | undefined;
    if (cached) return cached;
    const notice = await this.buildFresh();
    await this.cache?.set(NOTICE_CACHE_KEY, notice, NOTICE_CACHE_TTL).catch(() => undefined);
    return notice;
  }

  private async buildFresh(): Promise<PrivacyNotice> {
    const [row, organisation, features, aiProviders, translation, webhooks, ltiTools, rosterSources, ssoApps, samlDomains] =
      await Promise.all([
        this.row(),
        this.prisma.organisation.findFirst({ select: { name: true } }),
        this.features.effective(null),
        this.prisma.ai_provider.findMany({ select: { name: true, kind: true, base_url: true } }),
        this.prisma.translation_setting.findUnique({ where: { id: true }, select: { engine: true, url: true, enabled: true } }),
        this.prisma.school_webhook.findMany({ where: { enabled: true }, select: { url: true }, distinct: ['url'], take: 500 }),
        this.prisma.lti_tool.findMany({
          where: { enabled: true },
          select: { name: true, login_url: true, target_link_uri: true, send_name: true, send_email: true },
        }),
        this.prisma.roster_source.findMany({ select: { name: true, kind: true, base_url: true } }),
        this.prisma.school_sso_provider.findMany({ where: { enabled: true }, select: { provider: true, settings: true } }),
        this.prisma.school_email_domain.findMany({
          where: { sso_provider: 'saml', saml_entry_point: { not: null } },
          select: { saml_entry_point: true },
          distinct: ['saml_entry_point'],
          take: 200,
        }),
      ]);

    return buildNotice(settingsView(row), organisation?.name ?? null, {
      env: process.env,
      features: { ...features },
      aiProviders: aiProviders.map((p) => ({ name: p.name, kind: p.kind, baseUrl: p.base_url })),
      translation,
      webhookUrls: webhooks.map((w) => w.url),
      ltiTools: ltiTools.map((t) => ({
        name: t.name,
        loginUrl: t.login_url,
        targetLinkUri: t.target_link_uri,
        sendName: t.send_name,
        sendEmail: t.send_email,
      })),
      rosterSources: rosterSources.map((s) => ({ name: s.name, kind: s.kind, baseUrl: s.base_url })),
      schoolSsoProviders: ssoApps.map((a) => {
        const settings = (a.settings ?? {}) as Record<string, unknown>;
        return { provider: a.provider, issuer: typeof settings.issuer === 'string' ? settings.issuer : null };
      }),
      samlEntryPoints: samlDomains.map((d) => d.saml_entry_point).filter((u): u is string => !!u),
    });
  }
}
