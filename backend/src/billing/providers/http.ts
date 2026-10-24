import { timingSafeEqual } from 'node:crypto';

/**
 * Small helpers shared by the payment providers: an injectable fetch, request
 * timeouts, provider error formatting and money conversions.
 */

/** The subset of fetch the providers use; tests pass a stub. */
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

export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function requireEnv(provider: string, name: string): string {
  const value = env(name);
  if (!value) throw new ProviderApiError(provider, `${name} is not set`);
  return value;
}

/**
 * fetch with a timeout. Network failures and timeouts become
 * ProviderApiError so callers see one error type.
 */
export async function send(
  provider: string,
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchFn(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    const reason =
      err instanceof Error && err.name === 'TimeoutError'
        ? `request timed out after ${HTTP_TIMEOUT_MS / 1000}s`
        : `request failed: ${err instanceof Error ? err.message : String(err)}`;
    throw new ProviderApiError(provider, `${reason} (${describeUrl(url)})`);
  }
}

/** Reads a response body as JSON; an empty or non-JSON body becomes null. */
export async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** "POST /v1/billing/plans" style label for errors - no query strings. */
function describeUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return 'request';
  }
}

/** Currencies without minor units (amounts are whole numbers). */
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'HUF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'TWD',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

export function currencyDecimals(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

/**
 * Integer minor units -> decimal string, without going through floats:
 * 30000 -> "300.00", 1999 -> "19.99", 5 -> "0.05".
 */
export function centsToDecimal(cents: number, currency = 'USD'): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`Invalid amount in minor units: ${cents}`);
  }
  const decimals = currencyDecimals(currency);
  if (decimals === 0) return String(cents);
  const digits = String(cents).padStart(decimals + 1, '0');
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

/**
 * Decimal string -> integer minor units, without going through floats:
 * "300.00" -> 30000, "19.99" -> 1999, "5" -> 500, "0.5" -> 50.
 * Throws on anything that is not a plain non-negative decimal or has more
 * fraction digits than the currency allows.
 */
export function decimalToCents(value: string, currency = 'USD'): number {
  const decimals = currencyDecimals(currency);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new RangeError(`Invalid decimal amount: "${value}"`);
  const [, whole, fraction = ''] = match;
  const trimmed = fraction.replace(/0+$/, '');
  if (trimmed.length > decimals) {
    throw new RangeError(`Too many decimal places in "${value}"`);
  }
  const cents = Number(whole + fraction.padEnd(decimals, '0').slice(0, decimals));
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`Amount out of range: "${value}"`);
  }
  return cents;
}

/** Constant-time string comparison (false for different lengths). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Unix seconds (or null) -> Date (or null). */
export function fromUnix(seconds: number | null | undefined): Date | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}

/** ISO string (or null) -> Date (or null); invalid strings become null. */
export function fromIso(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function header(
  headers: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  return value === undefined || value === '' ? undefined : value;
}
