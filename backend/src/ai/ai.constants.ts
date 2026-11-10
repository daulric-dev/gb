/** HKDF info for provider API keys (src/account/secret-box.ts). */
export const AI_KEY_INFO = 'gradebook:ai-provider-key:v1';
export const aiKeyAad = (providerId: string) => Buffer.from(`ai-provider:${providerId}`);

export const AI_PROVIDER_KINDS = ['anthropic', 'openai_compatible'] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

export const AI_FEATURES = ['quiz_questions', 'rubric_feedback', 'page_summary', 'test'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export type AiRequestStatus =
  | 'pending'
  | 'ok'
  | 'refused'
  | 'truncated'
  | 'invalid_output'
  | 'error'
  | 'rate_limited'
  | 'cap_reached';

/** Anthropic's API, used when an anthropic provider has no base URL. */
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';

/** Shown as suggestions in the model field; any model id can be typed. */
export const MODEL_SUGGESTIONS: Record<AiProviderKind, string[]> = {
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  openai_compatible: ['gpt-5', 'gpt-5-mini', 'llama3.3', 'qwen3', 'mistral-small'],
};

/** Output token ceiling per request (non-streaming). */
export const AI_MAX_OUTPUT_TOKENS = 16_000;

/** Whole-request timeout (ms); AI_REQUEST_TIMEOUT_MS overrides. */
export function aiTimeoutMs(): number {
  const v = Number(process.env.AI_REQUEST_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 5_000 && v <= 600_000 ? v : 120_000;
}

/** Largest response body read from a provider (bytes). */
export const AI_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** Stored prompts (keep_prompts) are cleared after this. */
export const AI_PROMPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Request log rows are deleted after this. */
export const AI_LOG_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
/** How often the log sweep runs in each instance. */
export const AI_SWEEP_MS = 6 * 60 * 60 * 1000;

/** Largest pasted or page text sent for quiz questions or a summary (characters). */
export const AI_MAX_SOURCE_CHARS = 30_000;
/** Largest submission text sent for rubric feedback (characters). */
export const AI_MAX_SUBMISSION_CHARS = 30_000;
export const AI_MAX_QUESTIONS = 10;

/** Question kinds the model may draft: auto-gradable ones and essay (never file upload). */
export const AI_QUESTION_KINDS = [
  'multiple_choice',
  'true_false',
  'short_answer',
  'multiple_select',
  'numeric',
  'matching',
  'ordering',
  'essay',
] as const;
export type AiQuestionKind = (typeof AI_QUESTION_KINDS)[number];

/** Shown with every draft. */
export const AI_DRAFT_NOTE = 'AI-generated: review before using. Nothing is saved until you accept it.';
