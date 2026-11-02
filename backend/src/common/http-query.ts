import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';

/**
 * HTTP QUERY: a safe, idempotent read whose filters travel in a JSON body
 * instead of the URL. The search and filter list endpoints use it
 * (`@QueryMethod()` + `@Body()`); see docs/content/backend/http-query.md.
 */
export const QUERY_METHOD = 'QUERY';

/**
 * Methods the browser may use cross-origin. QUERY is not CORS-safelisted, so
 * browsers send a preflight for it; it has to be listed here for that to pass.
 */
export const CORS_METHODS = [
  'GET',
  QUERY_METHOD,
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
];

/**
 * A QUERY with no filters may arrive with no body at all. Fastify answers a
 * QUERY without `Content-Type` with 400 (RFC 10008 says the server MUST), and
 * its JSON parser answers an empty JSON body with 400
 * `FST_ERR_CTP_EMPTY_JSON_BODY`. Neither is useful for "list with the
 * defaults", so an empty QUERY body (no `Content-Type`, or a JSON one) is
 * replaced with `{}` before parsing: the handler gets an empty DTO, every
 * filter at its default. A non-empty body, another content type and every
 * other method keep Fastify's behaviour.
 */
export function acceptEmptyQueryBodies(instance: FastifyInstance): void {
  instance.addHook('preParsing', (request, _reply, payload, done) => {
    const headers = request.raw.headers;
    const type = headers['content-type'];
    if (
      request.raw.method !== QUERY_METHOD ||
      headers['transfer-encoding'] !== undefined ||
      (headers['content-length'] !== undefined &&
        headers['content-length'] !== '0') ||
      (type !== undefined && !/^application\/json\b/i.test(type))
    ) {
      done(null, payload);
      return;
    }
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(EMPTY_QUERY_BODY.length);
    done(null, Readable.from([EMPTY_QUERY_BODY]));
  });
}

const EMPTY_QUERY_BODY = Buffer.from('{}');
