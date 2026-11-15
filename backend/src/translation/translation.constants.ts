/** HKDF info for the engine's API key (src/account/secret-box.ts). */
export const TRANSLATION_KEY_INFO = 'gradebook:translation-key:v1';
/** The settings row is a singleton, so the AAD is fixed. */
export const TRANSLATION_KEY_AAD = Buffer.from('translation-setting');

export const TRANSLATION_ENGINES = ['google', 'deepl', 'libre', 'yandex'] as const;
export type TranslationEngine = (typeof TRANSLATION_ENGINES)[number];

/** Engines that refuse requests without an API key. LibreTranslate's key is optional (server-dependent). */
export const ENGINES_NEEDING_KEY: ReadonlySet<TranslationEngine> = new Set(['deepl', 'yandex']);

/** Limits on `POST /translation`. */
export const MAX_TEXTS = 200;
export const MAX_TEXT_CHARS = 5_000;
export const MAX_TOTAL_CHARS = 50_000;

/**
 * Hours a cached translation lives: TRANSLATION_CACHE_TTL_HOURS (1 - 720),
 * default 24. The cache holds the translated text (which may contain names,
 * feedback or messages) keyed by a hash of the original, so this is the
 * retention period of translated text; nothing else stores it.
 */
export function translationCacheTtlHours(): number {
  const v = Number(process.env.TRANSLATION_CACHE_TTL_HOURS);
  return Number.isInteger(v) && v >= 1 && v <= 720 ? v : 24;
}

/** Cached translations live this long (seconds: CacheService TTLs are in seconds). Read at startup. */
export const TRANSLATION_CACHE_TTL = translationCacheTtlHours() * 60 * 60;
export const TRANSLATION_CACHE_PREFIX = 'translation:';

/** Per engine call (ms). TRANSLATION_TIMEOUT_MS overrides (1 s - 120 s). */
export function translationTimeoutMs(): number {
  const v = Number(process.env.TRANSLATION_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 1_000 && v <= 120_000 ? v : 15_000;
}

/** Engine calls in flight at once for one request. */
export const TRANSLATION_CONCURRENCY = 4;
/** Most strings joined into one engine call. */
export const MAX_SEGMENTS_PER_CALL = 50;

/**
 * Largest text per engine call. Google and Yandex put the text in the query
 * string, so the limit is on its URL-encoded length (keeps the whole URL
 * well under the ~2 KB some proxies allow). DeepL and LibreTranslate take a
 * body; LibreTranslate's public instances refuse more than 5,000 characters.
 */
export const CALL_LIMIT: Record<TranslationEngine, { encoded: boolean; max: number }> = {
  google: { encoded: true, max: 1_800 },
  yandex: { encoded: true, max: 1_800 },
  deepl: { encoded: false, max: 4_500 },
  libre: { encoded: false, max: 4_500 },
};

/** Size of a text as the engine's limit counts it. */
export function callSize(engine: TranslationEngine, text: string): number {
  return CALL_LIMIT[engine].encoded ? encodeURIComponent(text).length : text.length;
}

/** ISO 639-1 codes (the two-letter language codes the engines take). */
export const ISO_639_1 = new Set(
  (
    'aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy ' +
    'da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ' +
    'ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt ' +
    'lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt ' +
    'qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to ' +
    'tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'
  ).split(' '),
);

/**
 * A language tag as an ISO 639-1 code: `es` stays `es`, `zh-CN` / `pt_BR` /
 * `EN` become `zh` / `pt` / `en`. Null when it is not one.
 */
export function normaliseLanguage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const primary = raw.trim().toLowerCase().split(/[-_]/)[0];
  return ISO_639_1.has(primary) ? primary : null;
}

/** The language's English name ("Spanish"), for the translated copy's title. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
