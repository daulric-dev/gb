import { Logger } from '@nestjs/common';
import { trimTrailingSlashes } from '@/common/trim-slashes';
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

interface ChatCompletion {
  model?: string;
  choices?: {
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Any server speaking OpenAI's chat completions API (OpenAI, Azure
 * OpenAI-compatible endpoints, OpenRouter, Ollama / vLLM / LM Studio):
 * `POST {baseUrl}/chat/completions` through the guarded fetch. Asks for
 * `response_format: json_schema` (strict); a server that rejects that
 * (400/422) is asked once more with the schema in the prompt and "JSON
 * only". The caller validates the answer against the schema either way.
 */
const logger = new Logger('OpenAiCompatibleAdapter');

export class OpenAiCompatibleAdapter implements AiAdapter {
  constructor(
    private readonly config: ProviderConfig,
    private readonly deps: AdapterDeps,
  ) {}

  private url(): string {
    if (!this.config.baseUrl) throw new AiProviderError('provider', 'This provider has no base URL');
    return `${trimTrailingSlashes(this.config.baseUrl)}/chat/completions`;
  }

  body(req: StructuredRequest, structured: boolean): Record<string, unknown> {
    const schema = providerSchema(req.schema);
    const system = structured
      ? req.system
      : `${req.system}\n\nRespond with a single JSON object only, no other text, matching this JSON schema:\n${JSON.stringify(schema)}`;
    return {
      model: this.config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: req.user },
      ],
      ...(structured
        ? { response_format: { type: 'json_schema', json_schema: { name: req.name, strict: true, schema } } }
        : {}),
    };
  }

  private async post(body: Record<string, unknown>): Promise<{ status: number; json: ChatCompletion | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.timeoutMs);
    try {
      const res = await this.deps.fetch(this.url(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let json: ChatCompletion | null = null;
      try {
        json = JSON.parse(text) as ChatCompletion;
      } catch {
        json = null;
      }
      return { status: res.status, json };
    } catch (err) {
      if (controller.signal.aborted) throw new AiProviderError('timeout', 'The provider took too long to answer.');
      if (isGuardRefusal(err)) throw new AiProviderError('blocked', (err as Error).message);
      // Keep the real cause for operators (never request or response content).
      const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : '';
      const message = err instanceof Error ? err.message : 'unknown error';
      logger.warn(`OpenAI-compatible request failed: ${code} ${message}`.trim());
      throw new AiProviderError('provider', 'Could not reach the provider.');
    } finally {
      clearTimeout(timer);
    }
  }

  async complete(req: StructuredRequest): Promise<AdapterResult> {
    let out = await this.post(this.body(req, true));
    // Servers without json_schema support answer 400 / 422: retry once in JSON-only mode.
    if (out.status === 400 || out.status === 422) out = await this.post(this.body(req, false));
    const { status, json } = out;
    if (status === 401 || status === 403) {
      throw new AiProviderError('auth', 'The provider refused the API key. Check it in the AI provider settings.');
    }
    if (status === 429) throw new AiProviderError('rate_limited', 'The provider is rate-limiting requests. Try again in a minute.');
    if (status === 404) {
      throw new AiProviderError('provider', 'The provider does not know this model or endpoint. Check the model id and base URL.');
    }
    if (status >= 300 && status < 400) {
      throw new AiProviderError('provider', 'The base URL redirects; use the final URL.');
    }
    if (status !== 200 || !json) {
      throw new AiProviderError('provider', `The provider answered with an error (HTTP ${status}).`);
    }
    const choice = json.choices?.[0];
    if (!choice) throw new AiProviderError('invalid_output', 'The provider returned no answer.');
    if (choice.message?.refusal || choice.finish_reason === 'content_filter') {
      throw new AiProviderError('refused', REFUSAL_MESSAGE);
    }
    if (choice.finish_reason === 'length') throw new AiProviderError('truncated', TRUNCATED_MESSAGE);
    return {
      text: choice.message?.content ?? '',
      inputTokens: typeof json.usage?.prompt_tokens === 'number' ? json.usage.prompt_tokens : null,
      outputTokens: typeof json.usage?.completion_tokens === 'number' ? json.usage.completion_tokens : null,
      model: typeof json.model === 'string' ? json.model : this.config.model,
    };
  }
}
