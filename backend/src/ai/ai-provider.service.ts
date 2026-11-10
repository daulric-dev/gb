import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { openSecret, sealSecret } from '@/account/secret-box';
import {
  AI_KEY_INFO,
  ANTHROPIC_DEFAULT_MODEL,
  MODEL_SUGGESTIONS,
  aiKeyAad,
  type AiProviderKind,
} from './ai.constants';
import { AiUrlError, checkProviderUrl } from './ai-fetch';
import type { ProviderConfig } from './adapters/types';
import type { CreateAiProviderDto, UpdateAiProviderDto, AiOrgSettingsDto } from './ai.dto';

export const PROVIDER_SELECT = {
  id: true,
  name: true,
  kind: true,
  base_url: true,
  model: true,
  api_key_enc: true,
  api_key_last4: true,
  monthly_cap: true,
  is_default: true,
  allow_private_network: true,
  available_to_schools: true,
  created_by: true,
  created_at: true,
  updated_at: true,
} as const;

export type ProviderRow = Prisma.ai_providerGetPayload<{ select: typeof PROVIDER_SELECT }>;

export interface OrgAiSettings {
  keepPrompts: boolean;
  userHourlyLimit: number;
}

export const DEFAULT_ORG_SETTINGS: OrgAiSettings = { keepPrompts: false, userHourlyLimit: 30 };

/** The organisation default: the default one, else the only one. Null when none can be chosen. */
export function selectProvider<T extends { is_default: boolean }>(rows: T[]): T | null {
  return rows.find((r) => r.is_default) ?? (rows.length === 1 ? rows[0] : null);
}

/**
 * The provider a school's requests use: the school's own choice while it is
 * still one of the organisation's providers and available to schools, else
 * the organisation default if that is available to schools. Null when
 * neither applies (409 AI_NO_PROVIDER).
 */
export function resolveSchoolProvider<T extends { id: string; is_default: boolean; available_to_schools: boolean }>(
  rows: T[],
  choiceId: string | null | undefined,
): { provider: T | null; source: 'school' | 'organisation' | null } {
  const chosen = choiceId ? rows.find((r) => r.id === choiceId && r.available_to_schools) : undefined;
  if (chosen) return { provider: chosen, source: 'school' };
  const fallback = selectProvider(rows);
  if (fallback?.available_to_schools) return { provider: fallback, source: 'organisation' };
  return { provider: null, source: null };
}

/** Start of the current calendar month, UTC. */
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function last4(key: string): string {
  return key.trim().slice(-4);
}

/** Where requests go, for the data notice: the API host (never the key or path). */
export function providerHost(kind: string, baseUrl: string | null): string {
  if (!baseUrl) return kind === 'anthropic' ? 'api.anthropic.com' : '';
  try {
    return new URL(baseUrl).host;
  } catch {
    return '';
  }
}

/**
 * The organisation's AI providers (BYO: Anthropic or any OpenAI-compatible
 * endpoint) and organisation-wide AI settings. API keys are write-only:
 * encrypted with secret-box on save, decrypted only to make a request
 * (`configFor`), and answered as `keyLast4` / `hasKey` / `keyUnreadable`.
 */
@Injectable()
export class AiProviderService {
  private readonly logger = new Logger(AiProviderService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  view(p: ProviderRow, usedThisMonth?: number) {
    const key = openSecret(AI_KEY_INFO, aiKeyAad(p.id), p.api_key_enc);
    return {
      id: p.id,
      name: p.name,
      kind: p.kind as AiProviderKind,
      baseUrl: p.base_url,
      host: providerHost(p.kind, p.base_url),
      model: p.model,
      hasKey: true,
      keyLast4: p.api_key_last4,
      keyUnreadable: key === null,
      monthlyCap: p.monthly_cap,
      isDefault: p.is_default,
      allowPrivateNetwork: p.allow_private_network,
      availableToSchools: p.available_to_schools,
      ...(usedThisMonth !== undefined ? { usedThisMonth } : {}),
      createdAt: p.created_at.toISOString(),
      updatedAt: p.updated_at.toISOString(),
    };
  }

  async rows(): Promise<ProviderRow[]> {
    return this.prisma.ai_provider.findMany({ select: PROVIDER_SELECT, orderBy: { created_at: 'asc' } });
  }

  async list() {
    const rows = await this.rows();
    const counts = await Promise.all(rows.map((r) => this.usedThisMonth(r.id)));
    return {
      providers: rows.map((r, i) => this.view(r, counts[i])),
      suggestions: MODEL_SUGGESTIONS,
    };
  }

  /** Requests through a provider this calendar month that reached it (refusals by our own limits excluded). */
  usedThisMonth(providerId: string): Promise<number> {
    return this.prisma.ai_request.count({
      where: {
        provider_id: providerId,
        created_at: { gte: monthStart() },
        status: { notIn: ['rate_limited', 'cap_reached'] },
      },
    });
  }

  async require(id: string): Promise<ProviderRow> {
    const row = await this.prisma.ai_provider.findUnique({ where: { id }, select: PROVIDER_SELECT });
    if (!row) throw new NotFoundException('AI provider not found');
    return row;
  }

  /** The organisation default provider, or null. */
  async current(): Promise<ProviderRow | null> {
    return selectProvider(await this.rows());
  }

  private cleanBaseUrl(kind: AiProviderKind, raw: string | null | undefined, allowPrivate: boolean): string | null {
    const value = raw?.trim() || null;
    if (!value) {
      if (kind === 'openai_compatible') {
        throw new BadRequestException('An OpenAI-compatible provider needs a base URL (for example https://api.openai.com/v1)');
      }
      return null;
    }
    try {
      checkProviderUrl(value, { allowPrivate });
    } catch (err) {
      if (err instanceof AiUrlError) throw new BadRequestException(err.message);
      throw err;
    }
    return value;
  }

  async create(dto: CreateAiProviderDto, actorId: string) {
    const kind = dto.kind;
    const allowPrivate = dto.allowPrivateNetwork === true;
    const baseUrl = this.cleanBaseUrl(kind, dto.baseUrl, allowPrivate);
    const model = dto.model?.trim() || (kind === 'anthropic' ? ANTHROPIC_DEFAULT_MODEL : '');
    if (!model) throw new BadRequestException('Give the model id the provider should use');
    const key = dto.apiKey.trim();
    if (!key) throw new BadRequestException('The API key is required');
    const existing = await this.prisma.ai_provider.count();
    const makeDefault = existing === 0 || dto.isDefault === true;
    const row = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) await tx.ai_provider.updateMany({ where: { is_default: true }, data: { is_default: false } });
      const created = await tx.ai_provider.create({
        data: {
          name: dto.name.trim(),
          kind,
          base_url: baseUrl,
          model,
          // Sealed below, once the id (the AAD) exists.
          api_key_enc: '',
          api_key_last4: last4(key),
          monthly_cap: dto.monthlyCap ?? null,
          is_default: makeDefault,
          allow_private_network: allowPrivate,
          available_to_schools: dto.availableToSchools ?? true,
          created_by: actorId,
        },
        select: { id: true },
      });
      const sealed = await tx.ai_provider.update({
        where: { id: created.id },
        data: { api_key_enc: sealSecret(AI_KEY_INFO, aiKeyAad(created.id), key) },
        select: PROVIDER_SELECT,
      });
      await this.auditLog?.record(tx, null, { id: actorId }, {
        entity: 'ai_provider',
        entityId: created.id,
        action: 'create',
        changes: auditChanges(null, {
          name: sealed.name,
          kind: sealed.kind,
          base_url: sealed.base_url,
          model: sealed.model,
          monthly_cap: sealed.monthly_cap,
          is_default: sealed.is_default,
          allow_private_network: sealed.allow_private_network,
          available_to_schools: sealed.available_to_schools,
          api_key_set: true,
        }),
      });
      return sealed;
    });
    this.logger.log(`Organisation admin ${actorId} added AI provider ${row.id} (${row.kind})`);
    return this.view(row);
  }

  async update(id: string, dto: UpdateAiProviderDto, actorId: string) {
    const before = await this.require(id);
    const kind = before.kind as AiProviderKind;
    const data: Prisma.ai_providerUpdateInput = { updated_at: new Date() };
    const allowPrivate = dto.allowPrivateNetwork ?? before.allow_private_network;
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.baseUrl !== undefined) {
      data.base_url = this.cleanBaseUrl(kind, dto.baseUrl, allowPrivate);
    } else if (dto.allowPrivateNetwork !== undefined && before.base_url) {
      // Turning the private network off must not leave an http (local) address behind.
      this.cleanBaseUrl(kind, before.base_url, allowPrivate);
    }
    if (dto.allowPrivateNetwork !== undefined) data.allow_private_network = dto.allowPrivateNetwork;
    if (dto.availableToSchools !== undefined) data.available_to_schools = dto.availableToSchools;
    if (dto.model !== undefined) {
      const model = dto.model.trim();
      if (!model) throw new BadRequestException('Give the model id the provider should use');
      data.model = model;
    }
    if (dto.monthlyCap !== undefined) data.monthly_cap = dto.monthlyCap;
    const key = dto.apiKey?.trim();
    if (key) {
      data.api_key_enc = sealSecret(AI_KEY_INFO, aiKeyAad(id), key);
      data.api_key_last4 = last4(key);
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const after = await tx.ai_provider.update({ where: { id }, data, select: PROVIDER_SELECT });
      await this.auditLog?.record(tx, null, { id: actorId }, {
        entity: 'ai_provider',
        entityId: id,
        action: 'update',
        changes: auditChanges(
          {
            name: before.name,
            base_url: before.base_url,
            model: before.model,
            monthly_cap: before.monthly_cap,
            allow_private_network: before.allow_private_network,
            available_to_schools: before.available_to_schools,
          },
          {
            name: after.name,
            base_url: after.base_url,
            model: after.model,
            monthly_cap: after.monthly_cap,
            allow_private_network: after.allow_private_network,
            available_to_schools: after.available_to_schools,
            ...(key ? { api_key_changed: true } : {}),
          },
        ),
      });
      return after;
    });
    return this.view(row);
  }

  async setDefault(id: string, actorId: string) {
    const before = await this.require(id);
    if (before.is_default) return this.view(before);
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.ai_provider.updateMany({ where: { is_default: true }, data: { is_default: false } });
      const after = await tx.ai_provider.update({
        where: { id },
        data: { is_default: true, updated_at: new Date() },
        select: PROVIDER_SELECT,
      });
      await this.auditLog?.record(tx, null, { id: actorId }, {
        entity: 'ai_provider',
        entityId: id,
        action: 'update',
        changes: auditChanges({ is_default: false }, { is_default: true }),
      });
      return after;
    });
    return this.view(row);
  }

  /** Removes the provider; its request log keeps the copied name. The oldest other provider becomes the default. */
  async remove(id: string, actorId: string) {
    const before = await this.require(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.ai_provider.delete({ where: { id } });
      if (before.is_default) {
        const next = await tx.ai_provider.findFirst({ orderBy: { created_at: 'asc' }, select: { id: true } });
        if (next) await tx.ai_provider.update({ where: { id: next.id }, data: { is_default: true } });
      }
      await this.auditLog?.record(tx, null, { id: actorId }, {
        entity: 'ai_provider',
        entityId: id,
        action: 'delete',
        changes: auditChanges({ name: before.name, kind: before.kind, model: before.model }, null),
      });
    });
  }

  /** The adapter config of a stored provider (the key decrypted here only). */
  configFor(p: ProviderRow): ProviderConfig {
    const apiKey = openSecret(AI_KEY_INFO, aiKeyAad(p.id), p.api_key_enc);
    if (apiKey === null) {
      throw new ConflictException({
        statusCode: 409,
        code: 'AI_KEY_UNREADABLE',
        message: "The AI provider's stored API key cannot be read (the server key changed). An organisation admin must enter it again.",
      });
    }
    return {
      kind: p.kind as AiProviderKind,
      baseUrl: p.base_url,
      model: p.model,
      apiKey,
      allowPrivateNetwork: p.allow_private_network === true,
    };
  }

  // ── organisation settings ─────────────────────────────────────────────

  async orgSettings(): Promise<OrgAiSettings> {
    const row = await this.prisma.ai_org_setting.findUnique({
      where: { id: true },
      select: { keep_prompts: true, user_hourly_limit: true },
    });
    return row ? { keepPrompts: row.keep_prompts, userHourlyLimit: row.user_hourly_limit } : { ...DEFAULT_ORG_SETTINGS };
  }

  async updateOrgSettings(dto: AiOrgSettingsDto, actorId: string): Promise<OrgAiSettings> {
    const before = await this.orgSettings();
    const next: OrgAiSettings = {
      keepPrompts: dto.keepPrompts ?? before.keepPrompts,
      userHourlyLimit: dto.userHourlyLimit ?? before.userHourlyLimit,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.ai_org_setting.upsert({
        where: { id: true },
        create: { id: true, keep_prompts: next.keepPrompts, user_hourly_limit: next.userHourlyLimit, updated_by: actorId },
        update: {
          keep_prompts: next.keepPrompts,
          user_hourly_limit: next.userHourlyLimit,
          updated_by: actorId,
          updated_at: new Date(),
        },
      });
      // Turning prompt keeping off clears what was kept.
      if (before.keepPrompts && !next.keepPrompts) {
        await tx.ai_request.updateMany({
          where: { prompt_expires_at: { not: null } },
          data: { prompt_text: null, response_text: null, prompt_expires_at: null },
        });
      }
      await this.auditLog?.record(tx, null, { id: actorId }, {
        entity: 'ai_org_setting',
        entityId: null,
        action: 'update',
        changes: auditChanges({ ...before }, { ...next }),
      });
    });
    return next;
  }

  /** The newest requests (no content unless prompts are kept) and this month's totals. */
  async usage(limit = 100) {
    const rows = await this.prisma.ai_request.findMany({
      orderBy: { created_at: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
      select: {
        id: true,
        user_id: true,
        school_id: true,
        course_id: true,
        feature: true,
        provider_name: true,
        model: true,
        status: true,
        error: true,
        input_tokens: true,
        output_tokens: true,
        duration_ms: true,
        prompt_expires_at: true,
        created_at: true,
      },
    });
    const month = await this.prisma.ai_request.count({
      where: { created_at: { gte: monthStart() }, status: { notIn: ['rate_limited', 'cap_reached'] } },
    });
    return {
      thisMonth: month,
      requests: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        schoolId: r.school_id,
        courseId: r.course_id,
        feature: r.feature,
        provider: r.provider_name,
        model: r.model,
        status: r.status,
        error: r.error,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        durationMs: r.duration_ms,
        promptKept: r.prompt_expires_at !== null,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }
}
