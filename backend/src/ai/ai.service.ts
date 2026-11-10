import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { FeatureService } from '@/features/feature.service';
import { userSchoolId } from '@/common/user-school';
import {
  AI_LOG_RETENTION_MS,
  AI_PROMPT_RETENTION_MS,
  AI_SWEEP_MS,
  type AiFeature,
  type AiRequestStatus,
} from './ai.constants';
import { AiGateway } from './ai-gateway';
import { AiProviderError, type AiErrorKind, type ProviderConfig } from './adapters/types';
import type { JsonSchema } from './json-schema';
import { TEST_SCHEMA, TEST_SYSTEM } from './prompts';
import {
  AiProviderService,
  monthStart,
  providerHost,
  resolveSchoolProvider,
  selectProvider,
  type ProviderRow,
} from './ai-provider.service';

export interface RunContext {
  userId: string;
  schoolId: string | null;
  courseId: string | null;
  feature: AiFeature;
}

export interface RunRequest {
  system: string;
  user: string;
  schema: JsonSchema;
  name: string;
  /** Output token ceiling for the feature (see AI_FEATURE_MAX_TOKENS). */
  maxTokens?: number;
}

const STATUS_FOR: Record<AiErrorKind, AiRequestStatus> = {
  refused: 'refused',
  truncated: 'truncated',
  invalid_output: 'invalid_output',
  auth: 'error',
  rate_limited: 'error',
  timeout: 'error',
  blocked: 'error',
  provider: 'error',
};

/** The HTTP answer for a failed AI request. Clients key off `code`. */
export function aiHttpError(err: AiProviderError): HttpException {
  if (err.kind === 'refused') {
    return new HttpException(
      { statusCode: 422, code: 'AI_REFUSED', category: err.category, message: err.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (err.kind === 'truncated') {
    return new HttpException({ statusCode: 422, code: 'AI_TRUNCATED', message: err.message }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  if (err.kind === 'invalid_output') {
    return new HttpException({ statusCode: 502, code: 'AI_INVALID_OUTPUT', message: err.message }, HttpStatus.BAD_GATEWAY);
  }
  return new HttpException({ statusCode: 502, code: 'AI_PROVIDER_ERROR', message: err.message }, HttpStatus.BAD_GATEWAY);
}

function tooMany(code: string, message: string): HttpException {
  return new HttpException({ statusCode: 429, code, message }, HttpStatus.TOO_MANY_REQUESTS);
}

/** Plain-language data notice shown next to every AI setting and button. */
export function dataNotice(provider: { name: string; kind: string; base_url: string | null } | null): string {
  if (!provider) return 'No AI provider is set up for your organisation yet.';
  const where =
    provider.kind === 'anthropic'
      ? `Anthropic (${providerHost(provider.kind, provider.base_url)})`
      : `an OpenAI-compatible service at ${providerHost(provider.kind, provider.base_url) || 'the configured address'}`;
  return (
    `AI requests are sent to "${provider.name}", ${where}, set up by your organisation. ` +
    'Only the text needed for the request is sent. Student names and email addresses are replaced with placeholders first. ' +
    "Students' work is sent only for rubric feedback suggestions, and only if your school allows it. " +
    'Everything the AI returns is a draft for a teacher to review; it never marks work or changes anything on its own.'
  );
}

/**
 * Runs AI requests (limits, logging, errors), and the school's AI settings.
 * Every request is a row in `public.ai_request` (who, feature, provider,
 * model, tokens, status); the prompt and answer are stored only while the
 * organisation keeps prompts, and cleared after 30 days.
 */
@Injectable()
export class AiService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiService.name);
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  /** Tests swap the gateway's transport. */
  gateway = new AiGateway();

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: AiProviderService,
    private readonly features: FeatureService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.sweepTimer = setInterval(() => void this.sweep().catch((e) => this.logger.warn(`AI log sweep failed: ${e}`)), AI_SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /** Clears expired kept prompts and deletes log rows older than a year. */
  async sweep(now = new Date()) {
    const cleared = await this.prisma.ai_request.updateMany({
      where: { prompt_expires_at: { lte: now } },
      data: { prompt_text: null, response_text: null, prompt_expires_at: null },
    });
    const deleted = await this.prisma.ai_request.deleteMany({
      where: { created_at: { lt: new Date(now.getTime() - AI_LOG_RETENTION_MS) } },
    });
    return { cleared: cleared.count, deleted: deleted.count };
  }

  /** The school's stored provider choice (null = organisation default). */
  private async schoolChoice(schoolId: string | null): Promise<string | null> {
    if (!schoolId) return null;
    const row = await this.prisma.ai_school_setting.findUnique({
      where: { school_id: schoolId },
      select: { provider_id: true },
    });
    return row?.provider_id ?? null;
  }

  /** The provider a school's requests use (see `resolveSchoolProvider`), or null. */
  async providerFor(schoolId: string | null): Promise<ProviderRow | null> {
    const [rows, choice] = await Promise.all([this.providers.rows(), this.schoolChoice(schoolId)]);
    return resolveSchoolProvider(rows, choice).provider;
  }

  /**
   * The provider requests go to: the school's choice if it is still one of
   * the organisation's providers available to schools, else the organisation
   * default (if available to schools), else 409 AI_NO_PROVIDER.
   */
  async requireProvider(schoolId: string | null): Promise<ProviderRow> {
    const provider = await this.providerFor(schoolId);
    if (!provider) {
      throw new ConflictException({
        statusCode: 409,
        code: 'AI_NO_PROVIDER',
        message: 'Your organisation has not set up an AI provider for schools yet.',
      });
    }
    return provider;
  }

  /**
   * One AI request: logged first (status pending), refused with 429 past the
   * user's hourly limit or the provider's monthly cap, then sent through the
   * gateway (which validates the answer against the schema). Returns the
   * validated value; writes nothing but the log and an audit entry.
   */
  async run<T>(ctx: RunContext, provider: ProviderRow, req: RunRequest): Promise<{ value: T; requestId: string; model: string }> {
    const settings = await this.providers.orgSettings();
    const log = await this.prisma.ai_request.create({
      data: {
        user_id: ctx.userId,
        school_id: ctx.schoolId,
        course_id: ctx.courseId,
        feature: ctx.feature,
        provider_id: provider.id,
        provider_name: provider.name,
        provider_kind: provider.kind,
        model: provider.model,
        status: 'pending',
      },
      select: { id: true },
    });
    const finish = (data: Record<string, unknown>) =>
      this.prisma.ai_request.update({ where: { id: log.id }, data }).catch((e) => {
        this.logger.warn(`Could not update AI request log ${log.id}: ${e}`);
      });

    const counted = { notIn: ['rate_limited', 'cap_reached'] };
    if (ctx.feature !== 'test') {
      const recent = await this.prisma.ai_request.count({
        where: { user_id: ctx.userId, created_at: { gte: new Date(Date.now() - 60 * 60 * 1000) }, status: counted },
      });
      if (recent > settings.userHourlyLimit) {
        await finish({ status: 'rate_limited' });
        throw tooMany('AI_RATE_LIMITED', `You can make ${settings.userHourlyLimit} AI requests an hour. Try again later.`);
      }
    }
    if (provider.monthly_cap !== null) {
      const used = await this.prisma.ai_request.count({
        where: { provider_id: provider.id, created_at: { gte: monthStart() }, status: counted },
      });
      if (used > provider.monthly_cap) {
        await finish({ status: 'cap_reached' });
        throw tooMany('AI_CAP_REACHED', "Your organisation's monthly AI request limit has been reached.");
      }
    }

    let config: ProviderConfig;
    try {
      config = this.providers.configFor(provider);
    } catch (err) {
      await finish({ status: 'error', error: 'API key unreadable' });
      throw err;
    }

    const started = Date.now();
    const kept = settings.keepPrompts
      ? {
          prompt_text: `${req.system}\n\n---\n\n${req.user}`,
          prompt_expires_at: new Date(started + AI_PROMPT_RETENTION_MS),
        }
      : {};
    try {
      const out = await this.gateway.generateStructured<T>(config, req);
      await finish({
        status: 'ok',
        model: out.raw.model || provider.model,
        input_tokens: out.raw.inputTokens,
        output_tokens: out.raw.outputTokens,
        duration_ms: Date.now() - started,
        ...kept,
        ...(settings.keepPrompts ? { response_text: out.raw.text } : {}),
      });
      await this.audit(ctx, log.id, provider, 'ok');
      return { value: out.value, requestId: log.id, model: out.raw.model || provider.model };
    } catch (err) {
      const e = err instanceof AiProviderError ? err : new AiProviderError('provider', 'The provider request failed.');
      if (!(err instanceof AiProviderError)) this.logger.warn(`AI request ${log.id} failed: ${(err as Error)?.message}`);
      const status = STATUS_FOR[e.kind];
      await finish({
        status,
        error: (e.category ? `${e.message} (${e.category})` : e.message).slice(0, 500),
        duration_ms: Date.now() - started,
        ...kept,
      });
      await this.audit(ctx, log.id, provider, status);
      throw aiHttpError(e);
    }
  }

  private async audit(ctx: RunContext, requestId: string, provider: ProviderRow, status: AiRequestStatus) {
    if (!this.auditLog) return;
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.auditLog!.record(tx, ctx.schoolId, { id: ctx.userId }, {
          entity: 'ai_request',
          entityId: requestId,
          action: 'create',
          changes: auditChanges(null, {
            feature: ctx.feature,
            course_id: ctx.courseId,
            provider: provider.name,
            model: provider.model,
            status,
          }),
        });
      });
    } catch (e) {
      this.logger.warn(`Could not audit AI request ${requestId}: ${(e as Error)?.message ?? String(e)}`);
    }
  }

  /**
   * Test a saved provider with a tiny structured request. Only saved
   * providers can be tested: the base URL was validated and stored (behind
   * step-up) when the provider was saved, so no request body ever reaches
   * an outbound request directly.
   */
  async testProvider(providerId: string, actorId: string) {
    const provider = await this.providers.require(providerId);
    try {
      const out = await this.run<{ ok: boolean }>(
        { userId: actorId, schoolId: null, courseId: null, feature: 'test' },
        provider,
        { system: TEST_SYSTEM, user: 'Reply with {"ok": true}.', schema: TEST_SCHEMA, name: 'connection_test' },
      );
      return { ok: true as const, message: `Connected: ${out.model} answered in the expected format.` };
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() !== 404) {
        const body = err.getResponse() as { message?: string } | string;
        return { ok: false as const, message: typeof body === 'string' ? body : (body.message ?? 'The test failed') };
      }
      throw err;
    }
  }

  // ── school settings ───────────────────────────────────────────────────

  async allowStudentWork(schoolId: string): Promise<boolean> {
    const row = await this.prisma.ai_school_setting.findUnique({
      where: { school_id: schoolId },
      select: { allow_student_work: true },
    });
    return row?.allow_student_work ?? false;
  }

  private static summary(p: ProviderRow) {
    return { id: p.id, name: p.name, kind: p.kind, model: p.model, host: providerHost(p.kind, p.base_url) };
  }

  /** What a teacher or admin sees about AI for a school: provider, notice, the school's switch. */
  async statusFor(schoolId: string) {
    await this.features.assertEnabled(schoolId, 'ai_assistance');
    const provider = await this.providerFor(schoolId);
    return {
      provider: provider ? AiService.summary(provider) : null,
      allowStudentWork: await this.allowStudentWork(schoolId),
      notice: dataNotice(provider),
    };
  }

  /**
   * The school settings view: the status plus the school's provider choice
   * (`providerId`, null = organisation default), the organisation default
   * and the providers the organisation makes available to schools. The
   * model is set on each provider by the organisation; schools only choose.
   */
  private async schoolSettingsView(schoolId: string) {
    const status = await this.statusFor(schoolId);
    const [rows, choice] = await Promise.all([this.providers.rows(), this.schoolChoice(schoolId)]);
    const available = rows.filter((r) => r.available_to_schools);
    const orgDefault = selectProvider(rows);
    return {
      ...status,
      providerId: choice,
      /** The stored choice is no longer available, so the organisation default is used. */
      choiceUnavailable: !!choice && !available.some((r) => r.id === choice),
      organisationDefault: orgDefault?.available_to_schools ? AiService.summary(orgDefault) : null,
      availableProviders: available.map((p) => AiService.summary(p)),
    };
  }

  private async activeSchool(userId: string): Promise<string> {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) throw new BadRequestException('You are not assigned to a school');
    return schoolId;
  }

  async getSchoolSettings(userId: string) {
    return this.schoolSettingsView(await this.activeSchool(userId));
  }

  /**
   * Change the school's switch and/or provider choice. A provider must be
   * one of the organisation's providers marked available to schools (400
   * otherwise); null goes back to the organisation default. Audited as
   * `ai_school_setting` (provider id and name, never a key).
   */
  async updateSchoolSettings(
    userId: string,
    input: { allowStudentWork?: boolean; providerId?: string | null },
  ) {
    const schoolId = await this.activeSchool(userId);
    await this.features.assertEnabled(schoolId, 'ai_assistance');
    const current = await this.prisma.ai_school_setting.findUnique({
      where: { school_id: schoolId },
      select: { allow_student_work: true, provider_id: true },
    });
    const before = {
      allow_student_work: current?.allow_student_work ?? false,
      provider_id: current?.provider_id ?? null,
    };
    let chosen: { id: string; name: string } | null = null;
    if (input.providerId) {
      const p = await this.prisma.ai_provider.findUnique({
        where: { id: input.providerId },
        select: { id: true, name: true, available_to_schools: true },
      });
      if (!p || !p.available_to_schools) {
        throw new BadRequestException(
          "Choose one of your organisation's AI providers that is available to schools, or the organisation default.",
        );
      }
      chosen = { id: p.id, name: p.name };
    }
    const next = {
      allow_student_work: input.allowStudentWork ?? before.allow_student_work,
      provider_id: input.providerId === undefined ? before.provider_id : (chosen?.id ?? null),
    };
    const beforeName =
      before.provider_id === next.provider_id
        ? null
        : before.provider_id
          ? ((
              await this.prisma.ai_provider.findUnique({ where: { id: before.provider_id }, select: { name: true } })
            )?.name ?? null)
          : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.ai_school_setting.upsert({
        where: { school_id: schoolId },
        create: { school_id: schoolId, ...next, updated_by: userId },
        update: { ...next, updated_by: userId, updated_at: new Date() },
      });
      await this.auditLog?.record(tx, schoolId, { id: userId }, {
        entity: 'ai_school_setting',
        entityId: schoolId,
        action: 'update',
        changes: auditChanges(
          {
            ...before,
            ...(before.provider_id !== next.provider_id ? { provider_name: beforeName } : {}),
          },
          {
            ...next,
            ...(before.provider_id !== next.provider_id ? { provider_name: chosen?.name ?? null } : {}),
          },
        ),
      });
    });
    return this.schoolSettingsView(schoolId);
  }
}
