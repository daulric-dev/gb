import type { KeyObject } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { safeWebhookFetch, type FetchLike } from '@/integrations/delivery/webhook-sender';
import { TOOL_JWKS_TTL_MS } from './lti.constants';
import { rsaKeyFromJwk, rsaKeyFromPem } from './jwt';

const JWKS_TIMEOUT_MS = 5_000;
const JWKS_MAX_BYTES = 64 * 1024;
/** After a miss on an unknown kid, refetch at most this often. */
const REFETCH_INTERVAL_MS = 30_000;

export interface ToolKeySource {
  id: string;
  jwks_url: string | null;
  public_key_pem: string | null;
}

type CachedJwks = { keys: Map<string, KeyObject>; unnamed: KeyObject[]; fetchedAt: number };

export class ToolKeyError extends Error {}

/**
 * A tool's public keys, for checking its client assertions: its pasted PEM,
 * or its JWKS URL fetched through the webhooks' SSRF-safe fetcher (the host
 * must resolve to a public address, the connection is pinned to that
 * address, redirects are not followed, 5 s timeout, 64 KB at most). Cached
 * for five minutes per tool; an unknown `kid` refetches (at most every 30 s)
 * so a tool's key rotation is picked up.
 */
@Injectable()
export class ToolKeyService {
  private readonly logger = new Logger(ToolKeyService.name);
  private readonly cache = new Map<string, CachedJwks>();
  /** Tests swap the fetcher. */
  fetchImpl: FetchLike = safeWebhookFetch;

  forget(toolId: string): void {
    this.cache.delete(toolId);
  }

  async keyFor(tool: ToolKeySource, kid: string | undefined): Promise<KeyObject> {
    if (tool.public_key_pem) {
      const key = rsaKeyFromPem(tool.public_key_pem);
      if (key) return key;
      if (!tool.jwks_url) throw new ToolKeyError('The tool has no usable public key');
    }
    if (!tool.jwks_url) throw new ToolKeyError('The tool has no public key');

    let jwks = this.cache.get(tool.id);
    const now = Date.now();
    const stale = !jwks || now - jwks.fetchedAt > TOOL_JWKS_TTL_MS;
    const missing = jwks && !this.pick(jwks, kid) && now - jwks.fetchedAt > REFETCH_INTERVAL_MS;
    if (stale || missing) {
      jwks = await this.fetchJwks(tool.jwks_url);
      this.cache.set(tool.id, jwks);
    }
    const key = this.pick(jwks!, kid);
    if (!key) throw new ToolKeyError('No key in the tool JWKS matches the token kid');
    return key;
  }

  private pick(jwks: CachedJwks, kid: string | undefined): KeyObject | undefined {
    if (kid) return jwks.keys.get(kid);
    // No kid: only unambiguous when the set holds exactly one key.
    const all = [...jwks.keys.values(), ...jwks.unnamed];
    return all.length === 1 ? all[0] : undefined;
  }

  async fetchJwks(url: string): Promise<CachedJwks> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JWKS_TIMEOUT_MS);
    let text: string;
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'GradeBook-LTI/1' },
        redirect: 'manual',
        signal: controller.signal,
      });
      if (res.status !== 200) throw new ToolKeyError(`Tool JWKS answered HTTP ${res.status}`);
      text = await readLimited(res, JWKS_MAX_BYTES);
    } catch (error) {
      if (error instanceof ToolKeyError) throw error;
      this.logger.warn(`Tool JWKS fetch failed: ${(error as Error).message}`);
      throw new ToolKeyError(`Could not fetch the tool JWKS: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ToolKeyError('Tool JWKS is not JSON');
    }
    const list = (body as { keys?: unknown })?.keys;
    if (!Array.isArray(list)) throw new ToolKeyError('Tool JWKS has no keys');
    const keys = new Map<string, KeyObject>();
    const unnamed: KeyObject[] = [];
    for (const jwk of list.slice(0, 20)) {
      if (!jwk || typeof jwk !== 'object') continue;
      const key = rsaKeyFromJwk(jwk as Record<string, unknown>);
      if (!key) continue;
      const kid = (jwk as { kid?: unknown }).kid;
      if (typeof kid === 'string' && kid) keys.set(kid, key);
      else unnamed.push(key);
    }
    return { keys, unnamed, fetchedAt: Date.now() };
  }
}

async function readLimited(res: Response, limit: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      size += value.byteLength;
      if (size > limit) throw new ToolKeyError('Tool JWKS is too large');
      chunks.push(Buffer.from(value));
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString('utf8');
}
