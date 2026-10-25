import { Readable } from 'node:stream';
import { UnsupportedMediaTypeException } from '@nestjs/common';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/** Where providers post webhooks. Signatures are computed over the exact bytes. */
export const WEBHOOK_PATH_PREFIX = '/api/billing/webhooks/';

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
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
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
