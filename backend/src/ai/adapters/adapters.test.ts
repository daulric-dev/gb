import { afterEach, describe, expect, mock, test } from 'bun:test';
import Anthropic from '@anthropic-ai/sdk';
import { guardedFetch, checkProviderUrl, AiUrlError } from '../ai-fetch';
import { AiGateway } from '../ai-gateway';
import type { JsonSchema } from '../json-schema';
import { AnthropicAdapter, FALLBACK_BETA, mapAnthropicError, supportsEffort } from './anthropic.adapter';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter';
import { AiProviderError } from './types';

const SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: { ok: { type: 'boolean' }, note: { type: 'string', maxLength: 5 } },
};
const REQ = { system: 'fixed system prompt', user: 'hello', schema: SCHEMA, name: 'test' };

type Call = { url: string; init: { method?: string; headers?: Record<string, string>; body?: string } };

/** A transport under the real guard: records what would have gone out. */
function transport(respond: (call: Call, n: number) => Response) {
  const calls: Call[] = [];
  const fn = mock(async (url: string, init: Call['init']) => {
    calls.push({ url, init });
    return respond({ url, init }, calls.length);
  });
  return { calls, fn };
}

function anthropicMessage(over: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: '{"ok":true}' }],
      stop_reason: 'end_turn',
      stop_details: null,
      usage: { input_tokens: 12, output_tokens: 3 },
      ...over,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const savedPrivate = process.env.WEBHOOK_ALLOW_PRIVATE;
afterEach(() => {
  if (savedPrivate === undefined) delete process.env.WEBHOOK_ALLOW_PRIVATE;
  else process.env.WEBHOOK_ALLOW_PRIVATE = savedPrivate;
});

describe('Anthropic adapter (official SDK)', () => {
  test('the SDK sends through the injected guarded fetch: structured output, effort, fallbacks, no thinking override', async () => {
    const t = transport(() => anthropicMessage());
    const adapter = new AnthropicAdapter(
      { kind: 'anthropic', baseUrl: null, model: 'claude-opus-5-5', apiKey: 'sk-ant-test-1234' },
      { fetch: guardedFetch(t.fn as any), timeoutMs: 10_000 },
    );
    const out = await adapter.complete(REQ);
    expect(out).toEqual({ text: '{"ok":true}', inputTokens: 12, outputTokens: 3, model: 'claude-opus-5-5' });
    expect(t.calls).toHaveLength(1);
    const { url, init } = t.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    // SDK 1.x sends the key as a bearer token.
    expect(init.headers!.authorization).toBe('Bearer sk-ant-test-1234');
    expect(init.headers!['anthropic-beta']).toBe(FALLBACK_BETA);
    const body = JSON.parse(init.body!);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.max_tokens).toBe(16000);
    expect(body.fallbacks).toBe('default');
    expect(body.output_config.effort).toBe('medium');
    expect(body.output_config.format.type).toBe('json_schema');
    // Constraints structured outputs reject are stripped (enforced locally).
    expect(body.output_config.format.schema.properties.note).toEqual({ type: 'string' });
    expect(body.thinking).toBeUndefined();
    expect(body.system).toBe('fixed system prompt');
  });

  test('a custom base URL is used; other models get no fallbacks beta; old models no effort', async () => {
    const t = transport(() => anthropicMessage({ model: 'claude-haiku-4-5' }));
    const adapter = new AnthropicAdapter(
      { kind: 'anthropic', baseUrl: 'https://gateway.example.org/anthropic', model: 'claude-haiku-4-5', apiKey: 'k' },
      { fetch: guardedFetch(t.fn as any), timeoutMs: 10_000 },
    );
    await adapter.complete(REQ);
    expect(t.calls[0].url.startsWith('https://gateway.example.org/anthropic/v1/messages')).toBe(true);
    const body = JSON.parse(t.calls[0].init.body!);
    expect(body.fallbacks).toBeUndefined();
    expect(t.calls[0].init.headers!['anthropic-beta']).toBeUndefined();
    expect(body.output_config.effort).toBeUndefined();
    expect(supportsEffort('claude-opus-5-5')).toBe(true);
    expect(supportsEffort('claude-sonnet-5-5')).toBe(true);
    expect(supportsEffort('claude-3-haiku')).toBe(false);
  });

  test('stop_reason refusal => refused with the category; max_tokens => truncated', async () => {
    const refused = new AnthropicAdapter(
      { kind: 'anthropic', baseUrl: null, model: 'claude-opus-5-5', apiKey: 'k' },
      {
        fetch: guardedFetch(transport(() =>
          anthropicMessage({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } }),
        ).fn as any),
        timeoutMs: 10_000,
      },
    );
    const err = (await refused.complete(REQ).catch((e) => e)) as AiProviderError;
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.kind).toBe('refused');
    expect(err.category).toBe('cyber');
    expect(err.message).toContain('declined');

    const cut = new AnthropicAdapter(
      { kind: 'anthropic', baseUrl: null, model: 'claude-opus-5-5', apiKey: 'k' },
      { fetch: guardedFetch(transport(() => anthropicMessage({ stop_reason: 'max_tokens' })).fn as any), timeoutMs: 10_000 },
    );
    expect(((await cut.complete(REQ).catch((e) => e)) as AiProviderError).kind).toBe('truncated');
  });

  test('typed SDK errors map to error kinds (401 => auth, 429 => rate_limited)', async () => {
    const make = (status: number) =>
      new AnthropicAdapter(
        { kind: 'anthropic', baseUrl: null, model: 'claude-opus-5-5', apiKey: 'k' },
        {
          fetch: guardedFetch(transport(() =>
            new Response(JSON.stringify({ type: 'error', error: { type: 'x', message: 'nope' } }), {
              status,
              headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
            }),
          ).fn as any),
          timeoutMs: 10_000,
        },
      );
    expect(((await make(401).complete(REQ).catch((e) => e)) as AiProviderError).kind).toBe('auth');
    expect(((await make(429).complete(REQ).catch((e) => e)) as AiProviderError).kind).toBe('rate_limited');
    expect(mapAnthropicError(new Anthropic.APIConnectionTimeoutError()).kind).toBe('timeout');
  });

  test('SSRF: the SDK cannot reach a private address through the real guard, even with WEBHOOK_ALLOW_PRIVATE=true', async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
    const adapter = new AnthropicAdapter(
      { kind: 'anthropic', baseUrl: 'https://127.0.0.1:8443', model: 'claude-opus-5-5', apiKey: 'k' },
      { fetch: guardedFetch(), timeoutMs: 5_000 },
    );
    const err = (await adapter.complete(REQ).catch((e) => e)) as AiProviderError;
    expect(err.kind).toBe('blocked');
    expect(err.message).toContain('private or reserved');
  });
});

describe('OpenAI-compatible adapter', () => {
  const config = { kind: 'openai_compatible' as const, baseUrl: 'https://llm.example.org/v1/', model: 'gpt-5', apiKey: 'sk-oa-9999' };
  const completion = (content: string, finish = 'stop', extra: Record<string, unknown> = {}) =>
    new Response(
      JSON.stringify({ model: 'gpt-5', choices: [{ finish_reason: finish, message: { content, ...extra } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }),
      { status: 200 },
    );

  test('POSTs {baseURL}/chat/completions through the guard with json_schema response_format', async () => {
    const t = transport(() => completion('{"ok":true}'));
    const out = await new OpenAiCompatibleAdapter(config, { fetch: guardedFetch(t.fn as any), timeoutMs: 5_000 }).complete(REQ);
    expect(out).toEqual({ text: '{"ok":true}', inputTokens: 5, outputTokens: 2, model: 'gpt-5' });
    expect(t.calls[0].url).toBe('https://llm.example.org/v1/chat/completions');
    expect(t.calls[0].init.headers!.authorization).toBe('Bearer sk-oa-9999');
    const body = JSON.parse(t.calls[0].init.body!);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'fixed system prompt' });
  });

  test('a server without json_schema (400) is asked again for JSON only', async () => {
    const t = transport((_c, n) => (n === 1 ? new Response('{"error":"response_format"}', { status: 400 }) : completion('```json\n{"ok":false}\n```')));
    const gateway = new AiGateway(t.fn as any);
    const out = await gateway.generateStructured<{ ok: boolean }>(config, REQ);
    expect(out.value).toEqual({ ok: false });
    const second = JSON.parse(t.calls[1].init.body!);
    expect(second.response_format).toBeUndefined();
    expect(second.messages[0].content).toContain('JSON');
  });

  test('length => truncated; content_filter or refusal => refused; 401 => auth', async () => {
    const run = async (res: () => Response) =>
      (await new OpenAiCompatibleAdapter(config, { fetch: guardedFetch(transport(res).fn as any), timeoutMs: 5_000 })
        .complete(REQ)
        .catch((e) => e)) as AiProviderError;
    expect((await run(() => completion('{"ok"', 'length'))).kind).toBe('truncated');
    expect((await run(() => completion('', 'content_filter'))).kind).toBe('refused');
    expect((await run(() => completion('', 'stop', { refusal: 'no' }))).kind).toBe('refused');
    expect((await run(() => new Response('{}', { status: 401 }))).kind).toBe('auth');
  });

  test('SSRF: a local server is refused for a provider not on the private network, whatever WEBHOOK_ALLOW_PRIVATE says', async () => {
    // The install-wide webhook switch is on: it must not open AI providers.
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
    const local = { ...config, baseUrl: 'http://localhost:11434/v1' };
    const err = (await new OpenAiCompatibleAdapter(local, { fetch: guardedFetch(), timeoutMs: 5_000 })
      .complete(REQ)
      .catch((e) => e)) as AiProviderError;
    expect(err.kind).toBe('blocked');
    const priv = { ...config, baseUrl: 'https://10.0.0.5/v1' };
    const err2 = (await new OpenAiCompatibleAdapter(priv, { fetch: guardedFetch(), timeoutMs: 5_000 })
      .complete(REQ)
      .catch((e) => e)) as AiProviderError;
    expect(err2.kind).toBe('blocked');
    expect(err2.message).toContain('private or reserved');
  });
});

describe('guarded fetch', () => {
  test('https only (http only for a private-network provider), no credentials or query in the base URL', () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
    expect(() => checkProviderUrl('http://llm.example.org/v1')).toThrow(AiUrlError);
    expect(() => checkProviderUrl('http://localhost:11434/v1', { allowPrivate: false })).toThrow(AiUrlError);
    expect(() => checkProviderUrl('https://u:p@llm.example.org')).toThrow(AiUrlError);
    expect(() => checkProviderUrl('https://llm.example.org/v1?x=1')).toThrow(AiUrlError);
    expect(() => checkProviderUrl('ftp://llm.example.org')).toThrow(AiUrlError);
    expect(checkProviderUrl('https://llm.example.org/v1').host).toBe('llm.example.org');
    expect(checkProviderUrl('http://localhost:11434/v1', { allowPrivate: true }).port).toBe('11434');
    // Still no credentials or query, even on the private network.
    expect(() => checkProviderUrl('http://u:p@localhost:11434/v1', { allowPrivate: true })).toThrow(AiUrlError);
    expect(() => checkProviderUrl('http://localhost:11434/v1?x=1', { allowPrivate: true })).toThrow(AiUrlError);
  });

  test('a private-network provider reaches 127.0.0.1 through the real guard (no WEBHOOK_ALLOW_PRIVATE); others are refused', async () => {
    delete process.env.WEBHOOK_ALLOW_PRIVATE;
    const seen: string[] = [];
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (req) => {
        seen.push(new URL(req.url).pathname);
        if (new URL(req.url).pathname === '/redirect') {
          return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
        }
        if (new URL(req.url).pathname === '/big') return new Response('x'.repeat(5000));
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }));
      },
    });
    try {
      const base = `http://127.0.0.1:${server.port}/v1`;
      const local = { kind: 'openai_compatible' as const, baseUrl: base, model: 'llama3.3', apiKey: 'k', allowPrivateNetwork: true };
      const out = await new AiGateway().generateStructured<{ ok: boolean }>(local, REQ);
      expect(out.value).toEqual({ ok: true });
      expect(seen).toEqual(['/v1/chat/completions']);

      // Same guard: redirects are not followed, the size cap holds.
      const f = guardedFetch(undefined, 1000, { allowPrivate: true });
      const redirected = await f(`http://127.0.0.1:${server.port}/redirect`);
      expect(redirected.status).toBe(302);
      expect(seen).toEqual(['/v1/chat/completions', '/redirect']);
      const big = await f(`http://127.0.0.1:${server.port}/big`);
      expect(await big.text().catch((e) => (e as Error).message)).toContain('larger than');

      // Without the provider's flag the same server is refused, even with the webhook switch on.
      process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
      const err = (await new AiGateway()
        .generateStructured({ ...local, allowPrivateNetwork: false }, REQ)
        .catch((e) => e)) as AiProviderError;
      expect(err.kind).toBe('blocked');
      const https = guardedFetch(undefined, undefined, { allowPrivate: false });
      expect(((await https(`https://127.0.0.1:${server.port}/v1`).catch((e) => e)) as Error).message).toContain(
        'private or reserved',
      );
      expect(seen).toHaveLength(3); // nothing new reached the server
    } finally {
      server.stop(true);
    }
  });

  test('redirects are not followed and bodies are size-capped', async () => {
    const t = transport(() => new Response('x'.repeat(5000), { status: 200 }));
    const f = guardedFetch(t.fn as any, 1000);
    const res = await f('https://llm.example.org/v1/chat/completions', { method: 'POST', body: '{}' });
    expect(t.calls[0].init).toMatchObject({ method: 'POST', body: '{}' });
    expect((t.fn.mock.calls[0][1] as { redirect: string }).redirect).toBe('manual');
    expect(await res.text().catch((e: Error) => e.message)).toContain('larger than');
  });
});

describe('gateway validation', () => {
  test("output that doesn't match the schema is rejected (invalid_output), never returned", async () => {
    const config = { kind: 'openai_compatible' as const, baseUrl: 'https://llm.example.org/v1', model: 'm', apiKey: 'k' };
    const reply = (content: string) =>
      new AiGateway(
        transport(() => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }))).fn as any,
      ).generateStructured(config, REQ);
    for (const bad of ['not json', '{"ok":"yes"}', '{"ok":true,"extra":1}', '{}', '{"ok":true,"note":"far too long"}']) {
      const err = (await reply(bad).catch((e) => e)) as AiProviderError;
      expect(err).toBeInstanceOf(AiProviderError);
      expect(err.kind).toBe('invalid_output');
    }
    expect((await reply('{"ok":true,"note":"hi"}')).value).toEqual({ ok: true, note: 'hi' });
  });
});
