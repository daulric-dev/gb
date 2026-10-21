import type { FastifyReply } from 'fastify';
import { corsOriginFor } from '@/config/origins';
import type { SseEvent } from './attendance.realtime';

const SSE_HEARTBEAT_MS = 25_000;

/**
 * Turn the response into an event stream fed by `subscribe`, the same way
 * the chat stream does: CORS written by hand (the reply is hijacked), a
 * heartbeat so proxies keep it open, and cleanup on disconnect.
 *
 * Do every check that can fail before calling this; once hijacked, the
 * response can no longer carry an error status.
 */
export async function openEventStream(
  req: any,
  reply: FastifyReply,
  subscribe: (send: (event: SseEvent) => void) => Promise<() => void>,
): Promise<void> {
  reply.hijack();
  const raw = reply.raw;
  const origin = req.headers?.origin as string | undefined;
  const allowedOrigin = corsOriginFor(origin);
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin':
      origin === allowedOrigin ? origin : allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  });
  raw.write('retry: 5000\n\n');

  const send = (event: SseEvent) => {
    raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  };

  const unsubscribe = await subscribe(send);
  const heartbeat = setInterval(() => raw.write(': ping\n\n'), SSE_HEARTBEAT_MS);

  let closed = false;
  const onClose = () => cleanup();
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    req.raw.off('close', onClose);
    req.raw.off('error', onClose);
  };

  if (req.raw.destroyed) {
    cleanup();
    return;
  }
  req.raw.on('close', onClose);
  req.raw.on('error', onClose);
}
