import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { LookupFunction } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { DELIVERY_TIMEOUT_MS, RESPONSE_EXCERPT_BYTES } from '@/integrations/config/webhook.config';
import { WEBHOOK_API_VERSION } from '@/integrations/events/webhook-event-types';
import { fetchTlsOptions, type FetchTlsOptions, type WebhookTls } from '@/integrations/webhooks/webhook-tls';
import { resolveWebhookDestination } from './webhook-destination';

export const USER_AGENT = 'GradeBook-Webhooks/1';

/**
 * `v1=<hex HMAC-SHA256(secret, "<timestamp>.<rawBody>")>`: the value of
 * X-GradeBook-Signature. The timestamp is unix seconds, as sent in
 * X-GradeBook-Timestamp; the body is the exact bytes sent.
 */
export function signWebhook(secret: string, timestamp: number, rawBody: string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
  return `v1=${mac}`;
}

export interface WebhookRequest {
  url: string;
  secret: string;
  deliveryId: string;
  /** The event id, shared by every delivery (and redelivery) of the event: receivers dedupe on it. */
  eventId: string;
  schoolId: string;
  eventType: string;
  /** The exact JSON body. */
  body: string;
  /** Unix seconds; now by default. */
  timestamp?: number;
  /** The webhook's custom headers (decrypted), sent as they are. */
  headers?: Record<string, string>;
  /** Certificate checks for https URLs; verify with the public roots by default. */
  tls?: WebhookTls;
}

/**
 * Every header a delivery carries: the webhook's custom headers, then
 * GradeBook's own (which always win; reserved names are refused on save).
 * The event's metadata travels here, not in the body: the body is only
 * `{ event_type, message, data }`.
 */
export function webhookHeaders(req: WebhookRequest, timestamp: number): Record<string, string> {
  return {
    ...req.headers,
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
    'X-GradeBook-Event': req.eventType,
    'X-GradeBook-Event-Id': req.eventId,
    'X-GradeBook-School-Id': req.schoolId,
    'X-GradeBook-Api-Version': String(WEBHOOK_API_VERSION),
    'X-GradeBook-Delivery': req.deliveryId,
    'X-GradeBook-Timestamp': String(timestamp),
    'X-GradeBook-Signature': signWebhook(req.secret, timestamp, req.body),
  };
}

export interface WebhookAttempt {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  /** At most RESPONSE_EXCERPT_BYTES of the response body. */
  responseExcerpt: string | null;
  durationMs: number;
  /** Whether the receiver's certificate was checked: null for plain http. */
  tlsVerified: boolean | null;
}

/**
 * Request settings plus TLS verification options for the Node HTTPS
 * transport. `allowPrivate` overrides WEBHOOK_ALLOW_PRIVATE for this request
 * only (see `resolveWebhookDestination`); webhooks, LTI and OneRoster leave
 * it out and keep the install-wide switch.
 */
export type WebhookFetchInit = RequestInit & { tls?: FetchTlsOptions; allowPrivate?: boolean };
export type FetchLike = (url: string, init: WebhookFetchInit) => Promise<Response>;

export const safeWebhookFetch: FetchLike = async (target, init) => {
  const url = new URL(target);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTP or HTTPS');
  }
  const destination = await resolveUntilAborted(url.hostname, init.signal, init.allowPrivate);
  const headers = new Headers(init.headers);
  headers.set('accept-encoding', 'identity');
  const options = {
    method: init.method,
    headers: Object.fromEntries(headers.entries()),
    signal: init.signal ?? undefined,
    agent: false,
    lookup: pinnedLookup(destination.address, destination.family),
    ...(url.protocol === 'https:'
      ? {
          rejectUnauthorized: init.tls?.rejectUnauthorized ?? true,
          ...(init.tls?.ca ? { ca: init.tls.ca } : {}),
        }
      : {}),
  };
  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      options,
      (incoming) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value === undefined) continue;
          for (const item of Array.isArray(value) ? value : [value]) {
            responseHeaders.append(name, item);
          }
        }
        const status = incoming.statusCode ?? 502;
        const hasBody = status !== 204 && status !== 205 && status !== 304;
        const body = hasBody ? responseBody(incoming) : null;
        if (!hasBody) incoming.resume();
        resolve(
          new Response(body, {
            status,
            statusText: incoming.statusMessage,
            headers: responseHeaders,
          }),
        );
      },
    );
    request.on('error', reject);
    if (typeof init.body === 'string') request.write(init.body);
    request.end();
  });
};

function responseBody(incoming: IncomingMessage): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      incoming.on('readable', () => {
        let chunk: Buffer | null;
        while ((chunk = incoming.read()) !== null) {
          controller.enqueue(new Uint8Array(chunk));
        }
      });
      incoming.once('end', () => controller.close());
      incoming.once('error', (error) => controller.error(error));
    },
    cancel() {
      incoming.destroy();
    },
  });
}

function pinnedLookup(address: string, family: number): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

function resolveUntilAborted(
  hostname: string,
  signal: AbortSignal | null | undefined,
  allowPrivate: boolean | undefined,
): Promise<{ address: string; family: number }> {
  const resolveDestination = () =>
    resolveWebhookDestination(hostname, undefined, { allowPrivate });
  if (!signal) return resolveDestination();
  if (signal.aborted) {
    return Promise.reject(new Error('Webhook request was aborted'));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('Webhook request was aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    resolveDestination().then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

/** Reads at most `limit` bytes of a body, then lets the rest go. */
async function readExcerpt(res: Response, limit: number): Promise<string | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  if (size === 0) return null;
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, limit);
  // Cut back to whole characters so a split multi-byte one is not mangled.
  return buf.toString('utf8').replace(/�+$/, '');
}

/**
 * POST one delivery: 10 s timeout for the whole exchange, redirects not
 * followed (a 3xx is a failure: a moved endpoint must be updated, and
 * following would re-send the payload somewhere nobody chose), at most 1 KB
 * of the response read. 2xx is success. Never throws. On https the
 * webhook's TLS settings go to fetch as `tls` (Bun): certificate checked
 * unless verification is off, against its CA bundle when it has one.
 */
export async function sendWebhook(
  req: WebhookRequest,
  fetchImpl: FetchLike = safeWebhookFetch,
  timeoutMs = DELIVERY_TIMEOUT_MS,
): Promise<WebhookAttempt> {
  const timestamp = req.timestamp ?? Math.floor(Date.now() / 1000);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const tls = fetchTlsOptions(req.url, req.tls);
  const tlsVerified = tls ? tls.rejectUnauthorized : null;
  try {
    const res = await fetchImpl(req.url, {
      method: 'POST',
      headers: webhookHeaders(req, timestamp),
      body: req.body,
      redirect: 'manual',
      signal: controller.signal,
      ...(tls ? { tls } : {}),
    });
    const excerpt = await readExcerpt(res, RESPONSE_EXCERPT_BYTES).catch(() => null);
    const ok = res.status >= 200 && res.status < 300;
    let error: string | null = null;
    if (!ok) {
      error =
        res.status >= 300 && res.status < 400
          ? `Redirect (HTTP ${res.status}) not followed: update the webhook's URL`
          : `HTTP ${res.status}`;
    }
    return { ok, statusCode: res.status, error, responseExcerpt: excerpt, durationMs: Date.now() - started, tlsVerified };
  } catch (err) {
    const aborted = controller.signal.aborted;
    return {
      ok: false,
      statusCode: null,
      error: aborted ? `Timed out after ${Math.round(timeoutMs / 1000)} s` : describeError(err),
      responseExcerpt: null,
      durationMs: Date.now() - started,
      tlsVerified,
    };
  } finally {
    clearTimeout(timer);
  }
}

function describeError(err: unknown): string {
  const e = err as { message?: string; cause?: { code?: string; message?: string } };
  const cause = e?.cause?.code ?? e?.cause?.message;
  const message = e?.message ?? String(err);
  return (cause ? `${message} (${cause})` : message).slice(0, 500);
}
