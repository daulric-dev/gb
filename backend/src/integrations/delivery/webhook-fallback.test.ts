import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { safeWebhookFetch } from './webhook-sender';

// A server on IPv4 loopback only, reached through `localhost`, which on many
// machines resolves to ::1 first: the sender must move on to 127.0.0.1
// after ::1 refuses the connection.
describe('safeWebhookFetch address fallback', () => {
  let server: Server;
  let port: number;
  let hits = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  test('reaches an IPv4-only server via localhost, sending the request once', async () => {
    const res = await safeWebhookFetch(`http://localhost:${port}/`, {
      method: 'POST',
      body: '{}',
      allowPrivate: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(hits).toBe(1);
  });

  test('a refused connection on every address still fails', async () => {
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    await expect(
      safeWebhookFetch(`http://localhost:${deadPort}/`, { method: 'GET', allowPrivate: true }),
    ).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  test('private addresses stay refused without allowPrivate', async () => {
    await expect(
      safeWebhookFetch(`http://localhost:${port}/`, { method: 'GET', allowPrivate: false }),
    ).rejects.toThrow('private or reserved');
  });
});
