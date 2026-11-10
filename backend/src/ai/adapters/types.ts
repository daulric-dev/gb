import type { AiProviderKind } from '../ai.constants';
import type { JsonSchema } from '../json-schema';
import type { GuardedFetch } from '../ai-fetch';

/** A provider as the adapters need it: the key already decrypted. */
export interface ProviderConfig {
  kind: AiProviderKind;
  baseUrl: string | null;
  model: string;
  apiKey: string;
  /**
   * The organisation marked this provider as running on its private network:
   * private / loopback addresses and plain http are allowed for it (and only
   * it). Absent or false: refused, whatever WEBHOOK_ALLOW_PRIVATE says.
   */
  allowPrivateNetwork?: boolean;
}

export interface StructuredRequest {
  /** Fixed per feature (no ids or timestamps), so providers can cache it. */
  system: string;
  user: string;
  /** Name for providers that want one (OpenAI's json_schema.name). */
  name: string;
  schema: JsonSchema;
}

export interface AdapterResult {
  /** The model's answer text (JSON expected). */
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  /** The model that answered (a server-side fallback can differ). */
  model: string;
}

export interface AiAdapter {
  complete(req: StructuredRequest): Promise<AdapterResult>;
}

export interface AdapterDeps {
  fetch: GuardedFetch;
  timeoutMs: number;
}

export type AiErrorKind =
  | 'refused'
  | 'truncated'
  | 'invalid_output'
  | 'auth'
  | 'rate_limited'
  | 'timeout'
  | 'blocked'
  | 'provider';

/** Every adapter failure, typed so the service can log and answer consistently. */
export class AiProviderError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    /** Refusals: the provider's category (Anthropic `stop_details.category`), if any. */
    readonly category: string | null = null,
  ) {
    super(message);
  }
}

export const REFUSAL_MESSAGE =
  'The model declined this request. Try rewording the source text, or write this one yourself.';
export const TRUNCATED_MESSAGE =
  'The answer was cut off before it finished. Ask for fewer questions or use a shorter text.';
