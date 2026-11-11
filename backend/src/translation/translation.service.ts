import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CacheService } from '@/cache/cache.service';
import { FeatureService } from '@/features/feature.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import {
  CALL_LIMIT,
  MAX_SEGMENTS_PER_CALL,
  MAX_TEXTS,
  MAX_TEXT_CHARS,
  MAX_TOTAL_CHARS,
  TRANSLATION_CACHE_PREFIX,
  TRANSLATION_CACHE_TTL,
  TRANSLATION_CONCURRENCY,
  callSize,
  normaliseLanguage,
  type TranslationEngine,
} from './translation.constants';
import {
  AUTO,
  TranslationEngineError,
  TranslationUrlError,
  callEngine,
  type EngineConfig,
} from './translation-engine';
import { TranslationSettingsService } from './translation-settings.service';
import type { TranslateTextsDto } from './translation.dto';

// ── pure helpers (exported for tests) ────────────────────────────────────

/** Leading whitespace, the text, trailing whitespace. */
export function splitWhitespace(text: string): { lead: string; core: string; trail: string } {
  // Index scan, not a regular expression: linear on any input (CodeQL
  // js/polynomial-redos flagged /^(\s*)([\s\S]*?)(\s*)$/ on request text).
  let start = 0;
  let end = text.length;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { lead: text.slice(0, start), core: text.slice(start, end), trail: text.slice(end) };
}

/** Worth sending: has at least one letter (numbers, symbols and blanks pass through). */
export function isTranslatable(core: string): boolean {
  return core.length > 0 && /\p{L}/u.test(core);
}

export function cacheKey(engine: string, url: string | null, from: string, to: string, text: string): string {
  const hash = createHash('sha256').update(`${engine}|${url ?? ''}|${from}|${to}|${text}`).digest('hex');
  return `${TRANSLATION_CACHE_PREFIX}${hash}`;
}

export type Job = { kind: 'batch'; items: string[] } | { kind: 'single'; text: string } | { kind: 'long'; text: string };

/**
 * Groups texts into engine calls: texts without line breaks are joined
 * with "\n" up to the engine's per-call size and MAX_SEGMENTS_PER_CALL;
 * a text with its own line breaks is sent alone; a text over the per-call
 * size is split (`splitLong`).
 */
export function planJobs(texts: string[], engine: TranslationEngine): Job[] {
  const max = CALL_LIMIT[engine].max;
  const jobs: Job[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length === 1) jobs.push({ kind: 'single', text: current[0] });
    else if (current.length > 1) jobs.push({ kind: 'batch', items: current });
    current = [];
  };
  for (const text of texts) {
    if (callSize(engine, text) > max) {
      jobs.push({ kind: 'long', text });
      continue;
    }
    if (text.includes('\n')) {
      jobs.push({ kind: 'single', text });
      continue;
    }
    if (current.length > 0) {
      const joined = `${current.join('\n')}\n${text}`;
      if (current.length >= MAX_SEGMENTS_PER_CALL || callSize(engine, joined) > max) flush();
    }
    current.push(text);
  }
  flush();
  return jobs;
}

/**
 * A text too large for one call, cut into pieces that fit: at sentence ends
 * and line breaks, else at spaces, else every few characters. Joining the
 * pieces gives the text back.
 */
export function splitLong(text: string, engine: TranslationEngine): string[] {
  const max = CALL_LIMIT[engine].max;
  const fits = (s: string) => callSize(engine, s) <= max;
  const pieces: string[] = [];
  let current = '';
  const push = (token: string) => {
    if (fits(current + token)) {
      current += token;
      return;
    }
    if (current) pieces.push(current);
    current = '';
    if (fits(token)) {
      current = token;
      return;
    }
    // Still too big: words, then characters (9 encoded bytes per character at worst).
    const words = token.split(/(?<=\s)/);
    if (words.length > 1) {
      for (const w of words) push(w);
      return;
    }
    const step = Math.max(1, Math.floor(max / 12));
    const chars = Array.from(token);
    for (let i = 0; i < chars.length; i += step) pieces.push(chars.slice(i, i + step).join(''));
  };
  for (const sentence of text.split(/(?<=[.!?。！？\n])/)) push(sentence);
  if (current) pieces.push(current);
  return pieces;
}

/** Runs `worker` over a queue that may grow, at most `limit` at once; the first failure stops new work. */
export async function runPool<T>(
  initial: T[],
  limit: number,
  worker: (item: T, enqueue: (more: T[]) => void) => Promise<void>,
): Promise<void> {
  const queue = [...initial];
  const running = new Set<Promise<void>>();
  let failure: { error: unknown } | null = null;
  const enqueue = (more: T[]) => {
    queue.push(...more);
  };
  const spawn = () => {
    while (!failure && running.size < Math.max(1, limit) && queue.length) {
      const item = queue.shift()!;
      const task: Promise<void> = worker(item, enqueue)
        .catch((error: unknown) => {
          failure ??= { error };
        })
        .finally(() => {
          running.delete(task);
          spawn();
        });
      running.add(task);
    }
  };
  spawn();
  while (running.size) await Promise.race(running);
  if (failure) throw (failure as { error: unknown }).error;
}

export interface BatchDeps {
  cache: Pick<CacheService, 'get' | 'set'>;
  /** One engine call (one string, possibly several joined lines). */
  call: (text: string) => Promise<string>;
  engine: TranslationEngine;
  /** Cache key parts besides the text. */
  scope: { url: string | null; from: string; to: string };
  concurrency?: number;
}

/**
 * Translates `texts` (same order and length back). Blank and letter-free
 * texts pass through; leading / trailing whitespace is kept; each distinct
 * text is looked up in the cache first, and only misses reach the engine,
 * joined into as few calls as the engine's limits allow. A joined call that
 * comes back with a different number of lines is retried one text per call.
 */
export async function translateBatch(texts: string[], deps: BatchDeps): Promise<string[]> {
  const parts = texts.map(splitWhitespace);
  const wanted = [...new Set(parts.filter((p) => isTranslatable(p.core)).map((p) => p.core))];
  const results = new Map<string, string>();
  const { engine, scope } = deps;
  const key = (core: string) => cacheKey(engine, scope.url, scope.from, scope.to, core);

  if (wanted.length && scope.from !== scope.to) {
    const cached = await Promise.all(wanted.map((core) => deps.cache.get(key(core))));
    const misses = wanted.filter((core, i) => {
      const hit = cached[i];
      if (typeof hit === 'string') results.set(core, hit);
      return typeof hit !== 'string';
    });

    const done = async (core: string, translated: string) => {
      results.set(core, translated);
      await deps.cache.set(key(core), translated, TRANSLATION_CACHE_TTL);
    };
    /** One text: its own whitespace kept, letter-free pieces not sent. */
    const one = async (text: string) => {
      const p = splitWhitespace(text);
      if (!isTranslatable(p.core)) return text;
      return p.lead + (await deps.call(p.core)).trim() + p.trail;
    };

    await runPool<Job>(planJobs(misses, engine), deps.concurrency ?? TRANSLATION_CONCURRENCY, async (job, enqueue) => {
      if (job.kind === 'single') {
        await done(job.text, (await deps.call(job.text)).trim());
      } else if (job.kind === 'long') {
        const pieces = splitLong(job.text, engine);
        const out: string[] = [];
        for (const piece of pieces) out.push(await one(piece));
        await done(job.text, out.join(''));
      } else {
        const answer = await deps.call(job.items.join('\n'));
        const lines = answer.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
        if (lines.length === job.items.length) {
          await Promise.all(job.items.map((core, i) => done(core, lines[i].trim() || core)));
        } else {
          enqueue(job.items.map((text) => ({ kind: 'single', text })));
        }
      }
    });
  }

  return parts.map((p, i) => {
    if (!isTranslatable(p.core) || scope.from === scope.to) return texts[i];
    return p.lead + (results.get(p.core) ?? p.core) + p.trail;
  });
}

/** Throws 400 when the request is over the limits (any caller of `POST /translation`). */
export function assertLimits(texts: unknown): asserts texts is string[] {
  if (!Array.isArray(texts) || texts.some((t) => typeof t !== 'string')) {
    throw new BadRequestException('texts must be an array of strings');
  }
  if (texts.length > MAX_TEXTS) throw new BadRequestException(`At most ${MAX_TEXTS} texts per request`);
  if (texts.some((t: string) => t.length > MAX_TEXT_CHARS)) {
    throw new BadRequestException(`Each text must be at most ${MAX_TEXT_CHARS} characters`);
  }
  const total = texts.reduce((n: number, t: string) => n + t.length, 0);
  if (total > MAX_TOTAL_CHARS) throw new BadRequestException(`At most ${MAX_TOTAL_CHARS} characters per request`);
}

export function requireLanguage(raw: unknown, field: string): string {
  const code = normaliseLanguage(raw);
  if (!code) throw new BadRequestException(`${field} must be an ISO 639-1 language code (for example es, fr, zh)`);
  return code;
}

// ── service ──────────────────────────────────────────────────────────────

/**
 * Machine translation for signed-in users through the organisation's engine
 * (see README). On only where the `translation` feature is on for the
 * caller's school and the organisation's settings are enabled.
 */
@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);

  constructor(
    private readonly settings: TranslationSettingsService,
    private readonly features: FeatureService,
    private readonly cache: CacheService,
  ) {}

  /** The engine settings when translation is on for `schoolId`, else null. */
  async activeConfig(schoolId: string | null): Promise<EngineConfig | null> {
    if (!(await this.features.isEnabled(schoolId, 'translation'))) return null;
    const stored = await this.settings.stored();
    if (!stored?.enabled) return null;
    if (stored.keyUnreadable) {
      throw new ConflictException({
        statusCode: 409,
        code: 'TRANSLATION_KEY_UNREADABLE',
        message: "The translation engine's stored API key cannot be read (the server key changed). An organisation admin must enter it again.",
      });
    }
    return stored;
  }

  /** Like `activeConfig`, but the FEATURE_DISABLED 403 instead of null. */
  async requireConfig(schoolId: string | null): Promise<EngineConfig> {
    const cfg = await this.activeConfig(schoolId);
    if (!cfg) throw new FeatureDisabledException('translation');
    return cfg;
  }

  async status(userId: string): Promise<{ enabled: boolean }> {
    const schoolId = await this.features.schoolOfUser(userId);
    if (!(await this.features.isEnabled(schoolId, 'translation'))) return { enabled: false };
    const stored = await this.settings.stored();
    return { enabled: !!stored?.enabled && !stored.keyUnreadable };
  }

  async translateForUser(userId: string, dto: TranslateTextsDto): Promise<{ translations: string[] }> {
    assertLimits(dto.texts);
    const to = requireLanguage(dto.to, 'to');
    const from = dto.from === undefined || dto.from === null || dto.from === '' ? AUTO : requireLanguage(dto.from, 'from');
    const cfg = await this.requireConfig(await this.features.schoolOfUser(userId));
    return { translations: await this.translateWith(cfg, dto.texts, from, to) };
  }

  /** Translates with `cfg` through the cache; 502 TRANSLATION_FAILED when the engine fails. */
  async translateWith(cfg: EngineConfig, texts: string[], from: string, to: string): Promise<string[]> {
    try {
      return await translateBatch(texts, {
        cache: this.cache,
        engine: cfg.engine,
        scope: { url: cfg.engine === 'libre' ? cfg.url : null, from, to },
        call: (text) => callEngine(cfg, text, { from, to }),
      });
    } catch (err) {
      this.logFailure(cfg.engine, err);
      throw new BadGatewayException({
        statusCode: 502,
        code: 'TRANSLATION_FAILED',
        message: 'Translation is not available right now. Try again later.',
      });
    }
  }

  /** Engine failures by code and status only: never the text, never a URL (Google's holds the text). */
  private logFailure(engine: TranslationEngine, err: unknown) {
    if (err instanceof TranslationEngineError) {
      this.logger.warn(`Translation engine ${engine} failed: code=${err.code} status=${err.status ?? '-'}`);
    } else if (err instanceof TranslationUrlError) {
      this.logger.warn(`Translation engine ${engine} refused: ${err.message}`);
    } else {
      this.logger.error(`Translation engine ${engine} failed: ${(err as Error)?.name ?? 'Error'}`);
    }
  }

  /**
   * `POST /organisation/translation/test`: the SAVED settings only (never an
   * address from the request), "Hello" into Spanish, no cache.
   */
  async test(): Promise<{ ok: boolean; sample?: string; message?: string }> {
    const stored = await this.settings.stored();
    if (!stored) return { ok: false, message: 'Save the translation settings first.' };
    if (stored.keyUnreadable) {
      return { ok: false, message: 'The stored API key cannot be read (the server key changed). Enter it again.' };
    }
    try {
      const sample = await callEngine(stored, 'Hello', { from: 'en', to: 'es' });
      return { ok: true, sample };
    } catch (err) {
      this.logFailure(stored.engine, err);
      if (err instanceof TranslationEngineError || err instanceof TranslationUrlError) {
        return { ok: false, message: err.message };
      }
      return { ok: false, message: 'The test failed' };
    }
  }
}
