/**
 * Small helpers shared by payment providers: an injectable fetch (for
 * tests), the request timeout, provider error formatting and env lookups.
 */

/** The subset of fetch a provider uses; tests pass a stub. */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ProviderOptions {
  /** Replaces the global fetch (tests). */
  fetch?: FetchLike;
}

/** Every provider HTTP call gives up after this long. */
export const HTTP_TIMEOUT_MS = 15_000;

/** A provider API answered with an error (or not at all). Never carries secrets. */
export class ProviderApiError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status: number | null = null,
  ) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderApiError';
  }
}

/** A trimmed environment variable, or undefined when unset or blank. */
export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function requireEnv(provider: string, name: string): string {
  const value = env(name);
  if (!value) throw new ProviderApiError(provider, `${name} is not set`);
  return value;
}

/** Unix seconds (or null) -> Date (or null). */
export function fromUnix(seconds: number | null | undefined): Date | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}
