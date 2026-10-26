import { Readable } from 'node:stream';
import { PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/** Where providers post webhooks. Signatures are computed over the exact bytes. */
export const WEBHOOK_PATH_PREFIX = '/api/billing/webhooks/';

/**
 * Largest webhook body we buffer. Stripe events are a few KB; anything this
 * big is refused before its signature is checked, so an unauthenticated
 * sender cannot make us hold an unbounded body in memory.
 */
export const WEBHOOK_MAX_BYTES = 1024 * 1024;

/** 413, with the statusCode Fastify's own error handler reads. */
function tooLarge(): PayloadTooLargeException {
  return Object.assign(new PayloadTooLargeException('Webhook body too large'), {
    statusCode: 413,
  });
}

export interface RawBodyRequest {
  rawBody?: Buffer;
}

export function isWebhookUrl(url: string | undefined): boolean {
  return !!url && url.startsWith(WEBHOOK_PATH_PREFIX);
}

/**
 * Keep the raw request body for the billing webhook route only.
 *
 * A `preParsing` hook reads the body into a buffer, stores it on
 * `request.rawBody`, and hands the normal parsers an identical stream, so
 * JSON and form bodies still parse as usual and nothing changes for any other
 * route. Providers that post a content type nobody else accepts (plain text,
 * XML...) get a buffer body on this route and a 415 everywhere else.
 */
export function registerWebhookRawBody(fastify: FastifyInstance): void {
  fastify.addHook('preParsing', async (request, _reply, payload) => {
    if (!isWebhookUrl(request.url)) return payload;
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > WEBHOOK_MAX_BYTES) {
      throw tooLarge();
    }
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of payload) {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
      received += buf.length;
      if (received > WEBHOOK_MAX_BYTES) {
        throw tooLarge();
      }
      chunks.push(buf);
    }
    const raw = Buffer.concat(chunks);
    (request as FastifyRequest & RawBodyRequest).rawBody = raw;
    const replay = Readable.from([raw]) as Readable & {
      receivedEncodedLength?: number;
    };
    replay.receivedEncodedLength = raw.length;
    return replay;
  });

  fastify.addContentTypeParser(
    '*',
    { parseAs: 'buffer' },
    (request, body, done) => {
      if (isWebhookUrl(request.url)) {
        done(null, body);
        return;
      }
      done(
        new UnsupportedMediaTypeException(
          `Unsupported Media Type: ${request.headers['content-type'] ?? ''}`,
        ),
        undefined,
      );
    },
  );
}
