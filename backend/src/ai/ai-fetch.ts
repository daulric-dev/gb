/**
 * The only way the AI module reaches a provider. Wraps the webhook sender's
 * `safeWebhookFetch` (DNS resolved per request, the checked IP pinned to the
 * connection, redirects never followed) and adds:
 *
 * - private / loopback / reserved addresses decided **per provider**: refused
 *   unless the organisation marked the provider as running on its private
 *   network (`ai_provider.allow_private_network`). An explicit `allowPrivate`
 *   is always passed down, so WEBHOOK_ALLOW_PRIVATE (webhooks, LTI,
 *   OneRoster) never applies to AI requests;
 * - https only, unless the provider is on the private network (a local
 *   Ollama / vLLM / LM Studio server speaks plain http);
 * - no user name or password in the URL;
 * - a cap on the response body (AI_MAX_RESPONSE_BYTES): a larger body fails
 *   the read instead of filling memory.
 *
 * It has the WHATWG `fetch` signature so the Anthropic SDK can take it as its
 * `fetch` option: the SDK's requests get exactly the same guard.
 */
import { safeWebhookFetch, type FetchLike } from '@/integrations/delivery/webhook-sender';
import { AI_MAX_RESPONSE_BYTES } from './ai.constants';

export type GuardedFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class AiUrlError extends Error {}

export interface AiGuardOptions {
  /** The provider runs on the organisation's private network (allow_private_network). */
  allowPrivate?: boolean;
}

/** Refuses non-https (unless the provider is on the private network) and credentials in the URL. */
export function checkProviderUrl(raw: string, options: AiGuardOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AiUrlError('The base URL is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AiUrlError('The base URL must use https');
  }
  if (url.protocol === 'http:' && options.allowPrivate !== true) {
    throw new AiUrlError(
      'The base URL must use https (http only for a provider marked as running on your private network)',
    );
  }
  if (url.username || url.password) {
    throw new AiUrlError('The base URL must not contain a user name or password');
  }
  if (url.search || url.hash) {
    throw new AiUrlError('The base URL must not have a query string or fragment');
  }
  return url;
}

function headersRecord(h: RequestInit['headers'] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(h ?? {}).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function bodyString(body: RequestInit['body'] | undefined): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return Buffer.from(body as ArrayBuffer).toString('utf8');
  }
  // Streams, blobs and form data are never sent to a provider.
  throw new AiUrlError('Unsupported request body');
}

/** A body stream that errors once more than `limit` bytes have passed. */
export function capBody(res: Response, limit: number): Response {
  if (!res.body) return res;
  const reader = res.body.getReader();
  let size = 0;
  const capped = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => undefined);
        controller.error(new AiUrlError(`The provider's response is larger than ${Math.round(limit / 1024)} KB`));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(capped, { status: res.status, statusText: res.statusText, headers: res.headers });
}

export function guardedFetch(
  transport: FetchLike = safeWebhookFetch,
  maxBytes = AI_MAX_RESPONSE_BYTES,
  options: AiGuardOptions = {},
): GuardedFetch {
  // Always explicit: the install-wide WEBHOOK_ALLOW_PRIVATE is never consulted.
  const allowPrivate = options.allowPrivate === true;
  return async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = checkProviderUrl(raw, { allowPrivate });
    const res = await transport(url.toString(), {
      method: init.method ?? 'GET',
      headers: headersRecord(init.headers),
      body: bodyString(init.body),
      redirect: 'manual',
      signal: init.signal ?? undefined,
      allowPrivate,
    });
    return capBody(res, maxBytes);
  };
}

/** True for the SSRF guard's refusals (worth showing as they are). */
export function isGuardRefusal(err: unknown): boolean {
  const message = (err as Error)?.message ?? '';
  return err instanceof AiUrlError || /private or reserved address|must use HTTP|did not resolve/.test(message);
}
