/**
 * The only way the translation module reaches an engine: one call of the
 * `translate` package (franciscop/translate) for one text.
 *
 * The package builds each engine request from an engine definition and
 * sends it with the global `fetch`. We hand it our own definitions so that:
 *
 * - every request carries an AbortSignal (TRANSLATION_TIMEOUT_MS, 15 s);
 * - DeepL authenticates with the `Authorization: DeepL-Auth-Key` header in a
 *   POST body (the package's own DeepL engine puts the key in the query
 *   string, which DeepL no longer accepts);
 * - "detect the source language" works (the package itself only takes ISO
 *   639-1 codes for `from`; the engines accept `auto` / no source);
 * - a non-2xx answer fails with its status instead of a JSON parse error;
 * - redirects are refused (`redirect: 'error'`), so a checked LibreTranslate
 *   address cannot bounce the request to an unchecked one.
 *
 * LibreTranslate is the one engine reached at an address the organisation
 * chooses, so before each call its URL is checked (http(s), https unless the
 * organisation marked the server as on its private network, no credentials)
 * and its host resolved with the webhook destination resolver, refusing
 * private / loopback / reserved addresses unless `allow_private_network`.
 * The package then connects with the global `fetch`, which resolves the name
 * again: see the README for the DNS-rebinding window this leaves.
 *
 * Errors never carry the text being translated (Google and Yandex put it in
 * the URL, so fetch errors are reduced to their name / code / status).
 */
import { randomUUID } from 'node:crypto';
import translate, { Translate } from 'translate';
import { checkProviderUrl } from '@/ai/ai-fetch';
import { resolveWebhookDestinations } from '@/integrations/delivery/webhook-destination';
import { translationTimeoutMs, type TranslationEngine } from './translation.constants';

export interface EngineConfig {
  engine: TranslationEngine;
  /** LibreTranslate only. */
  url: string | null;
  key: string | null;
  allowPrivateNetwork: boolean;
}

/** An engine call that failed: `status` is the engine's HTTP status, `code` a short reason. Never the text. */
export class TranslationEngineError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** The LibreTranslate URL is refused (format or address). Safe to show to an organisation admin. */
export class TranslationUrlError extends Error {}

type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

type EngineOptions = { key?: string; url?: string; from: string; to: string; text: string };
type EngineDef = {
  needkey: boolean;
  fetch: (o: EngineOptions) => [string, RequestInit];
  parse: (res: Response) => Promise<string>;
};
type PackageEngine = {
  needkey?: boolean;
  fetch: (o: EngineOptions) => [string, Record<string, unknown>?];
  parse: (res: Response) => Promise<string>;
};

/** The package's own engine definitions (URL building and response parsing reused for Google and LibreTranslate). */
const BUILTIN = (translate as unknown as { engines: Record<string, PackageEngine> }).engines;

/** `from` when the source language should be detected. */
export const AUTO = 'auto';

/** Fails a non-2xx answer with its status before the package's parser sees it. */
function checked(name: string, parse: (res: Response) => Promise<string>) {
  return async (res: Response): Promise<string> => {
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new TranslationEngineError(`${name} refused the API key (HTTP ${res.status})`, 'AUTH', res.status);
      }
      if (res.status === 429 || res.status === 456) {
        throw new TranslationEngineError(`${name} is rate-limiting or over quota (HTTP ${res.status})`, 'RATE_LIMITED', res.status);
      }
      throw new TranslationEngineError(`${name} answered HTTP ${res.status}`, 'HTTP_ERROR', res.status);
    }
    try {
      const out = await parse(res);
      if (typeof out !== 'string') throw new Error('not a string');
      return out;
    } catch (err) {
      if (err instanceof TranslationEngineError) throw err;
      throw new TranslationEngineError(`${name} sent an answer that could not be read`, 'BAD_RESPONSE', res.status);
    }
  };
}

/**
 * DeepL: POST form body, key in the `Authorization: DeepL-Auth-Key` header.
 * Free-plan keys (ending `:fx`) go to api-free.deepl.com.
 */
export function deeplEngine(from: string, signal?: AbortSignal): EngineDef {
  return {
    needkey: true,
    fetch: ({ key = '', to, text }) => {
      const body = new URLSearchParams({ text, target_lang: to.toUpperCase() });
      if (from !== AUTO) body.set('source_lang', from.toUpperCase());
      return [
        `https://api${key.endsWith(':fx') ? '-free' : ''}.deepl.com/v2/translate`,
        {
          method: 'POST',
          headers: {
            Authorization: `DeepL-Auth-Key ${key}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
          signal,
          redirect: 'error',
        },
      ];
    },
    parse: checked('DeepL', async (res) => {
      const json = (await res.json()) as { translations?: { text?: unknown }[] };
      const text = json?.translations?.[0]?.text;
      if (typeof text !== 'string') throw new Error('no translation');
      return text;
    }),
  };
}

function googleEngine(from: string, signal?: AbortSignal): EngineDef {
  const base = BUILTIN.google;
  return {
    needkey: false,
    fetch: (o) => {
      const [url, init] = base.fetch({ ...o, from });
      return [url, { ...(init ?? {}), signal, redirect: 'error' }];
    },
    parse: checked('Google', base.parse),
  };
}

function libreEngine(from: string, endpoint: string | undefined, signal?: AbortSignal): EngineDef {
  const base = BUILTIN.libre;
  return {
    needkey: false,
    fetch: (o) => {
      if (!endpoint) throw new TranslationUrlError('LibreTranslate needs the address of its server');
      const [url, init] = base.fetch({ ...o, url: endpoint, from });
      return [url, { ...(init ?? {}), signal, redirect: 'error' }];
    },
    parse: checked('LibreTranslate', base.parse),
  };
}

/** Yandex Translate v1.5 (the package's endpoint; the key is a query parameter there). */
function yandexEngine(from: string, signal?: AbortSignal): EngineDef {
  const base = BUILTIN.yandex;
  return {
    needkey: true,
    fetch: ({ key = '', to, text }) => [
      'https://translate.yandex.net/api/v1.5/tr.json/translate' +
        `?key=${encodeURIComponent(key)}&lang=${from === AUTO ? to : `${from}-${to}`}&text=${encodeURIComponent(text)}`,
      { method: 'POST', body: '', signal, redirect: 'error' },
    ],
    parse: checked('Yandex', base.parse),
  };
}

/** The engine definitions for one call, `from` (or AUTO) and the checked LibreTranslate endpoint captured. */
export function engineDefinitions(
  from: string,
  signal?: AbortSignal,
  libreUrl?: string,
): Record<TranslationEngine, EngineDef> {
  return {
    google: googleEngine(from, signal),
    deepl: deeplEngine(from, signal),
    libre: libreEngine(from, libreUrl, signal),
    yandex: yandexEngine(from, signal),
  };
}

/** The LibreTranslate endpoint for a server address: `https://host/` → `https://host/translate`. */
export function libreEndpoint(raw: string): string {
  const url = new URL(raw);
  if (!/\/translate\/?$/.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/translate`;
  }
  return url.toString();
}

/** Checks a LibreTranslate address's form (on save). */
export function checkLibreUrl(raw: string, allowPrivate: boolean): URL {
  try {
    return checkProviderUrl(raw, { allowPrivate });
  } catch (err) {
    throw new TranslationUrlError(
      ((err as Error).message ?? 'The URL is not valid').replace('The base URL', 'The LibreTranslate URL'),
    );
  }
}

/**
 * Before each LibreTranslate call: the address's form, then every address
 * its host resolves to (private / loopback / reserved refused unless the
 * organisation allows its private network).
 */
export async function assertLibreDestination(
  raw: string | null,
  allowPrivate: boolean,
  resolver?: Resolver,
): Promise<string> {
  if (!raw) throw new TranslationUrlError('LibreTranslate needs the address of its server');
  const url = checkLibreUrl(raw, allowPrivate);
  try {
    await resolveWebhookDestinations(url.hostname, resolver, { allowPrivate });
  } catch (err) {
    const message = (err as Error).message ?? '';
    if (/private or reserved/.test(message)) {
      throw new TranslationUrlError(
        'The LibreTranslate server resolves to a private or reserved address. Allow the private network for it if it runs inside your network.',
      );
    }
    throw new TranslationUrlError('The LibreTranslate server address did not resolve');
  }
  return libreEndpoint(url.toString());
}

function reduceError(err: unknown, engine: TranslationEngine): TranslationEngineError | TranslationUrlError {
  if (err instanceof TranslationEngineError || err instanceof TranslationUrlError) return err;
  const e = err as { name?: string; code?: string };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return new TranslationEngineError(`The ${engine} engine did not answer in time`, 'TIMEOUT');
  }
  // fetch's own failure (DNS, refused, TLS): name / code only, never the message (it can hold the URL and so the text).
  return new TranslationEngineError(`Could not reach the ${engine} engine`, e?.code ?? e?.name ?? 'NETWORK');
}

export interface CallOptions {
  /** ISO 639-1 source, or AUTO to let the engine detect it. */
  from: string;
  to: string;
  resolver?: Resolver;
  timeoutMs?: number;
}

/**
 * Translates one text with the package. The caller has already handled
 * empty text and `from === to`. Throws TranslationEngineError /
 * TranslationUrlError.
 */
export async function callEngine(cfg: EngineConfig, text: string, opts: CallOptions): Promise<string> {
  try {
    let url: string | undefined;
    if (cfg.engine === 'libre') url = await assertLibreDestination(cfg.url, cfg.allowPrivateNetwork, opts.resolver);
    if (!cfg.key && (cfg.engine === 'deepl' || cfg.engine === 'yandex')) {
      throw new TranslationEngineError(`The ${cfg.engine} engine needs an API key`, 'NO_KEY');
    }
    const signal = AbortSignal.timeout(opts.timeoutMs ?? translationTimeoutMs());
    // The package validates `from` as ISO 639-1 and returns the text as is
    // when it equals `to`; for AUTO it gets any other code and the engine
    // definitions use the captured AUTO instead.
    const packageFrom = opts.from === AUTO ? (opts.to === 'en' ? 'es' : 'en') : opts.from;
    const t = Translate({
      engine: cfg.engine,
      key: cfg.key ?? undefined,
      from: packageFrom,
      to: opts.to,
      // The package keeps a process-wide cache keyed by url, languages,
      // engine and text (not the key or our AUTO), unbounded unless timed.
      // CacheService is our cache: give each call a unique id (the package
      // `url`, which our engine definitions never read) and a 1 ms life so
      // the package cache never answers and never grows.
      cache: 1,
      engines: engineDefinitions(opts.from, signal, url) as never,
      ...({ url: `call:${randomUUID()}` } as object),
    });
    return await t(text);
  } catch (err) {
    throw reduceError(err, cfg.engine);
  }
}
