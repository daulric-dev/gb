import { safeWebhookFetch, type FetchLike } from '@/integrations/delivery/webhook-sender';
import { AI_MAX_RESPONSE_BYTES, aiTimeoutMs } from './ai.constants';
import { guardedFetch } from './ai-fetch';
import { parseJsonText, SchemaError, validateSchema, type JsonSchema } from './json-schema';
import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { OpenAiCompatibleAdapter } from './adapters/openai-compatible.adapter';
import { AiProviderError, type AdapterResult, type AiAdapter, type ProviderConfig } from './adapters/types';

export interface StructuredResult<T> {
  value: T;
  raw: AdapterResult;
}

/**
 * The provider-neutral entry point every AI feature uses:
 * `generateStructured({ system, user, schema })`. Picks the adapter for the
 * provider's kind, then parses and validates the answer against the schema
 * before anyone sees it (an invalid answer is an `invalid_output` error, not
 * a partial result). The output stays untrusted data: features read fields
 * from it and never execute or render it as HTML.
 */
export class AiGateway {
  /**
   * Tests swap the transport under the guard (the guard itself stays). The
   * guard is built per request from the provider's own private-network
   * setting.
   */
  constructor(
    private readonly transport: FetchLike = safeWebhookFetch,
    private readonly maxBytes = AI_MAX_RESPONSE_BYTES,
  ) {}

  adapter(config: ProviderConfig): AiAdapter {
    const fetch = guardedFetch(this.transport, this.maxBytes, { allowPrivate: config.allowPrivateNetwork === true });
    const deps = { fetch, timeoutMs: aiTimeoutMs() };
    return config.kind === 'anthropic' ? new AnthropicAdapter(config, deps) : new OpenAiCompatibleAdapter(config, deps);
  }

  async generateStructured<T>(
    config: ProviderConfig,
    req: { system: string; user: string; schema: JsonSchema; name: string; maxTokens?: number },
  ): Promise<StructuredResult<T>> {
    const raw = await this.adapter(config).complete(req);
    let value: unknown;
    try {
      value = parseJsonText(raw.text);
      validateSchema(req.schema, value);
    } catch (err) {
      if (err instanceof SchemaError) {
        throw new AiProviderError('invalid_output', `The model's answer was not in the expected shape (${err.message}). Try again.`);
      }
      throw err;
    }
    return { value: value as T, raw };
  }
}
