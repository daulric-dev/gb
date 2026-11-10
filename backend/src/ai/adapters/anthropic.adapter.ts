import Anthropic from '@anthropic-ai/sdk';
import { AI_MAX_OUTPUT_TOKENS, ANTHROPIC_DEFAULT_BASE_URL } from '../ai.constants';
import { providerSchema } from '../json-schema';
import { isGuardRefusal } from '../ai-fetch';
import {
  AiProviderError,
  REFUSAL_MESSAGE,
  TRUNCATED_MESSAGE,
  type AdapterDeps,
  type AdapterResult,
  type AiAdapter,
  type ProviderConfig,
  type StructuredRequest,
} from './types';

/** Models that take server-side refusal fallbacks (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-fable-5-2']);
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Models that accept `output_config.effort` (older ones answer 400 to it). */
export function supportsEffort(model: string): boolean {
  return /^claude-(opus-(4-[5-9]|5)|sonnet-(4-6|5)|haiku-5|fable|mythos)/.test(model);
}

export function supportsFallbacks(model: string): boolean {
  return FALLBACK_MODELS.has(model);
}

/**
 * Anthropic through the official SDK. The SDK gets the guarded fetch as its
 * `fetch`, so every request it makes (retries included) passes the SSRF
 * guard, the https rule and the response cap. Non-streaming
 * `beta.messages.create` with structured outputs (`output_config.format`, a
 * JSON schema): the beta endpoint because refusal fallbacks are a beta.
 * Adaptive thinking is the model's default and is left alone (no `thinking`
 * parameter: disabling it or a budget is a 400 on claude-opus-5-5).
 */
export class AnthropicAdapter implements AiAdapter {
  readonly client: Anthropic;

  constructor(
    private readonly config: ProviderConfig,
    deps: AdapterDeps,
  ) {
    this.client = new Anthropic({
      // An explicit key: the SDK then ignores ANTHROPIC_* credentials in the environment.
      apiKey: config.apiKey,
      baseURL: config.baseUrl || ANTHROPIC_DEFAULT_BASE_URL,
      fetch: deps.fetch,
      timeout: deps.timeoutMs,
      maxRetries: 1,
    });
  }

  params(req: StructuredRequest): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
    const model = this.config.model;
    return {
      model,
      max_tokens: Math.min(req.maxTokens ?? AI_MAX_OUTPUT_TOKENS, AI_MAX_OUTPUT_TOKENS),
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      output_config: {
        ...(supportsEffort(model) ? { effort: 'medium' as const } : {}),
        format: { type: 'json_schema', schema: providerSchema(req.schema) },
      },
      ...(supportsFallbacks(model) ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
    };
  }

  async complete(req: StructuredRequest): Promise<AdapterResult> {
    let res: Anthropic.Beta.Messages.BetaMessage;
    try {
      res = await this.client.beta.messages.create(this.params(req));
    } catch (err) {
      throw mapAnthropicError(err);
    }
    if (res.stop_reason === 'refusal') {
      throw new AiProviderError('refused', REFUSAL_MESSAGE, res.stop_details?.category ?? null);
    }
    if (res.stop_reason === 'max_tokens' || res.stop_reason === 'model_context_window_exceeded') {
      throw new AiProviderError('truncated', TRUNCATED_MESSAGE);
    }
    const text = res.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      text,
      inputTokens: res.usage?.input_tokens ?? null,
      outputTokens: res.usage?.output_tokens ?? null,
      model: res.model,
    };
  }
}

/** SDK errors by class, never by message text. */
export function mapAnthropicError(err: unknown): AiProviderError {
  if (err instanceof AiProviderError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiProviderError('auth', 'The provider refused the API key. Check it in the AI provider settings.');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiProviderError('rate_limited', 'The provider is rate-limiting requests. Try again in a minute.');
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AiProviderError('provider', 'The provider does not know this model or endpoint. Check the model id and base URL.');
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AiProviderError('provider', `The provider rejected the request: ${err.message}`.slice(0, 500));
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiProviderError('timeout', 'The provider took too long to answer.');
  }
  if (err instanceof Anthropic.APIConnectionError) {
    const cause = (err as { cause?: unknown }).cause;
    if (isGuardRefusal(cause)) return new AiProviderError('blocked', (cause as Error).message);
    return new AiProviderError('provider', 'Could not reach the provider.');
  }
  if (err instanceof Anthropic.APIError) {
    return new AiProviderError('provider', `The provider answered with an error (HTTP ${err.status ?? '?'}).`);
  }
  if (isGuardRefusal(err)) return new AiProviderError('blocked', (err as Error).message);
  return new AiProviderError('provider', 'The provider request failed.');
}
