import { api } from "@/lib/api";

/**
 * Live machine translation of the web app (site text and course content).
 *
 * The backend wraps a translation engine the organisation picks (Google,
 * DeepL, LibreTranslate or Yandex). Nothing is sent anywhere until someone
 * picks a language other than English in the header; the choice is kept per
 * browser. The DOM side lives in `lib/page-translator.ts`.
 */

// ── Languages ────────────────────────────────────────────────────────────────

export interface Language {
  /** The code sent to the API (`to`). */
  code: string;
  /** The language's own name, shown in the picker. */
  label: string;
  /** The English name, for screen readers and admin text. */
  english: string;
}

/** Add a language here to offer it everywhere (picker, teacher drafts). */
export const LANGUAGES = [
  { code: "en", label: "English", english: "English" },
  { code: "es", label: "Español", english: "Spanish" },
  { code: "fr", label: "Français", english: "French" },
  { code: "pt", label: "Português", english: "Portuguese" },
  { code: "ar", label: "العربية", english: "Arabic" },
  { code: "zh", label: "中文 (简体)", english: "Chinese (Simplified)" },
] as const satisfies readonly Language[];

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

/** The language the app is written in: showing it needs no translation. */
export const DEFAULT_LANGUAGE: LanguageCode = "en";

/** Every language other than the default: what a page or draft can be translated into. */
export const TARGET_LANGUAGES = LANGUAGES.filter((l) => l.code !== DEFAULT_LANGUAGE);

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && LANGUAGES.some((l) => l.code === value);
}

export function languageLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

// ── The chosen language (per browser) ────────────────────────────────────────

export const LANGUAGE_STORAGE_KEY = "gb_language";

/**
 * The supported language for a device language tag (BCP 47), or null:
 * "es-MX" is es, "zh-CN"/"zh-Hans" is zh. Traditional Chinese (zh-TW,
 * zh-HK, zh-Hant) is not offered, so it gets null.
 */
export function matchLanguage(tag: unknown): LanguageCode | null {
  if (typeof tag !== "string" || tag.length > 35) return null;
  const parts = tag.trim().replace(/_/g, "-").toLowerCase().split("-");
  if (parts[0] === "zh" && parts.some((p) => p === "hant" || p === "tw" || p === "hk" || p === "mo")) {
    return null;
  }
  return isLanguageCode(parts[0]) ? parts[0] : null;
}

/** The device's preferred language, if the app offers it (browser languages, best first). */
export function deviceLanguage(languages?: readonly string[] | null): LanguageCode | null {
  let tags = languages;
  if (tags === undefined) {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    tags = nav ? (nav.languages?.length ? nav.languages : [nav.language]) : [];
  }
  for (const tag of tags ?? []) {
    const code = matchLanguage(tag);
    if (code) return code;
  }
  return null;
}

/**
 * The language to show: the choice made in this browser, else the device's
 * language, else English. Read on the device only; nothing is fetched.
 */
export function readStoredLanguage(storage?: Storage | null, languages?: readonly string[] | null): LanguageCode {
  try {
    const s = storage === undefined ? globalThis.localStorage : storage;
    const v = s?.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguageCode(v)) return v;
  } catch {
    // Blocked storage: fall back to the device language.
  }
  return deviceLanguage(languages) ?? DEFAULT_LANGUAGE;
}

/** Remembers the choice in this browser (English too, so it wins over the device language). */
export function storeLanguage(code: LanguageCode, storage?: Storage | null): void {
  try {
    const s = storage === undefined ? globalThis.localStorage : storage;
    s?.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    // Blocked storage: the choice lasts until the page is reloaded.
  }
}

// ── API limits and batching ──────────────────────────────────────────────────

/** POST /translation limits (backend). */
export const TRANSLATION_LIMITS = {
  maxTexts: 200,
  maxChars: 5_000,
  maxTotalChars: 50_000,
} as const;

export type TranslationLimits = {
  maxTexts: number;
  maxChars: number;
  maxTotalChars: number;
};

/**
 * Splits unique texts into requests that each fit the API limits, keeping
 * their order. Texts longer than `maxChars` are left out: they cannot be
 * sent at all (the page keeps the original).
 */
export function batchTexts(
  texts: Iterable<string>,
  limits: TranslationLimits = TRANSLATION_LIMITS,
): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let total = 0;
  const seen = new Set<string>();
  for (const text of texts) {
    if (seen.has(text) || text.length === 0 || text.length > limits.maxChars) continue;
    seen.add(text);
    if (
      current.length > 0 &&
      (current.length >= limits.maxTexts || total + text.length > limits.maxTotalChars)
    ) {
      batches.push(current);
      current = [];
      total = 0;
    }
    current.push(text);
    total += text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// ── Text rules ───────────────────────────────────────────────────────────────

/** Leading whitespace, the text, trailing whitespace. */
export function splitWhitespace(value: string): { lead: string; core: string; trail: string } {
  // Index scan, not a regular expression: linear on any input.
  let start = 0;
  let end = value.length;
  while (start < end && /\s/.test(value[start])) start++;
  while (end > start && /\s/.test(value[end - 1])) end--;
  return { lead: value.slice(0, start), core: value.slice(start, end), trail: value.slice(end) };
}

/** A translation put back between the original's leading and trailing whitespace. */
export function withWhitespaceOf(original: string, translated: string): string {
  const { lead, trail } = splitWhitespace(original);
  return `${lead}${translated.trim()}${trail}`;
}

const LETTER = /\p{L}/u;
const URL_LIKE = /^(?:https?:\/\/|www\.)\S+$/i;
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Whether a (trimmed) string is worth sending: it has letters, is more than a
 * single character, fits the API's per-text limit and is not a bare link or
 * email address. Numbers, dates ("12/03"), scores ("8/10") and symbols stay.
 */
export function isTranslatable(core: string, limits: TranslationLimits = TRANSLATION_LIMITS): boolean {
  if (core.length < 2 || core.length > limits.maxChars) return false;
  if (!LETTER.test(core)) return false;
  if (URL_LIKE.test(core) || EMAIL_LIKE.test(core)) return false;
  return true;
}

// ── Cache ────────────────────────────────────────────────────────────────────

export const CACHE_STORAGE_PREFIX = "gb_translation_cache:";
/** Entries kept per language, in memory and in sessionStorage. */
export const CACHE_MAX_ENTRIES = 3_000;
/** Characters kept in sessionStorage per language (keys + values). */
export const CACHE_MAX_STORED_CHARS = 1_000_000;

/**
 * Translations per language: in memory, mirrored to sessionStorage so a
 * reload does not ask again. Oldest entries go first once it is full.
 */
export class TranslationCache {
  private readonly maps = new Map<string, Map<string, string>>();

  constructor(
    private readonly storage: Storage | null = safeSessionStorage(),
    private readonly maxEntries = CACHE_MAX_ENTRIES,
    private readonly maxStoredChars = CACHE_MAX_STORED_CHARS,
  ) {}

  private map(lang: string): Map<string, string> {
    let m = this.maps.get(lang);
    if (m) return m;
    m = new Map();
    try {
      const raw = this.storage?.getItem(CACHE_STORAGE_PREFIX + lang);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string") m.set(k, v);
        }
      }
    } catch {
      // Unreadable or blocked: start empty.
    }
    this.maps.set(lang, m);
    return m;
  }

  get(lang: string, text: string): string | undefined {
    return this.map(lang).get(text);
  }

  has(lang: string, text: string): boolean {
    return this.map(lang).has(text);
  }

  /** Adds translations, then saves the language once. */
  setMany(lang: string, entries: Iterable<[string, string]>): void {
    const m = this.map(lang);
    for (const [k, v] of entries) {
      m.delete(k);
      m.set(k, v);
    }
    while (m.size > this.maxEntries) {
      const oldest = m.keys().next().value;
      if (oldest === undefined) break;
      m.delete(oldest);
    }
    this.persist(lang, m);
  }

  private persist(lang: string, m: Map<string, string>): void {
    if (!this.storage) return;
    // Newest first until the character budget is spent.
    const kept: [string, string][] = [];
    let chars = 0;
    for (const [k, v] of [...m.entries()].reverse()) {
      chars += k.length + v.length;
      if (chars > this.maxStoredChars) break;
      kept.push([k, v]);
    }
    try {
      this.storage.setItem(CACHE_STORAGE_PREFIX + lang, JSON.stringify(Object.fromEntries(kept.reverse())));
    } catch {
      // Full or blocked: the in-memory copy still works.
    }
  }
}

function safeSessionStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

// ── API ──────────────────────────────────────────────────────────────────────

export interface TranslationStatus {
  enabled: boolean;
}

export const TRANSLATION_ENGINES = ["google", "deepl", "libre", "yandex"] as const;
export type TranslationEngine = (typeof TRANSLATION_ENGINES)[number];

export const ENGINE_INFO: Record<
  TranslationEngine,
  { label: string; description: string; needsKey: boolean; keyOptional?: boolean; needsUrl: boolean }
> = {
  google: {
    label: "Google",
    description:
      "No key needed. Uses Google's unofficial public endpoint, which can stop working or be rate limited at any time. Text is sent to Google.",
    needsKey: false,
    needsUrl: false,
  },
  deepl: {
    label: "DeepL",
    description: "Needs a DeepL API key (free or pro). Text is sent to DeepL.",
    needsKey: true,
    needsUrl: false,
  },
  libre: {
    label: "LibreTranslate",
    description:
      "Open source and can be self-hosted, so text never leaves your network. Needs the server's URL; a key only if the server requires one.",
    needsKey: false,
    keyOptional: true,
    needsUrl: true,
  },
  yandex: {
    label: "Yandex",
    description: "Needs a Yandex Translate API key. Text is sent to Yandex.",
    needsKey: true,
    needsUrl: false,
  },
};

/** GET/PUT /organisation/translation. */
export interface OrgTranslationSettings {
  engine: TranslationEngine;
  url: string | null;
  hasKey: boolean;
  allowPrivateNetwork: boolean;
  enabled: boolean;
  updatedAt: string | null;
}

export interface OrgTranslationUpdate {
  engine: TranslationEngine;
  url?: string | null;
  /** Left out: keep the saved key. Null: remove it. */
  key?: string | null;
  allowPrivateNetwork?: boolean;
  enabled: boolean;
}

export const translationApi = {
  status: () => api<TranslationStatus>("/translation/status"),
  translate: (texts: string[], to: string, from?: string) =>
    api<{ translations: string[] }>("/translation", {
      method: "POST",
      body: from ? { texts, to, from } : { texts, to },
    }),
  /** A translated copy of an activity, saved as a draft. */
  translateActivity: <T>(courseId: string, activityId: string, to: string) =>
    api<T>(`/courses/${courseId}/activities/${activityId}/translate`, {
      method: "POST",
      body: { to },
    }),
};

export const translationOrgApi = {
  get: () => api<OrgTranslationSettings>("/organisation/translation"),
  save: (body: OrgTranslationUpdate) =>
    api<OrgTranslationSettings>("/organisation/translation", { method: "PUT", body, stepUp: true }),
  test: () =>
    api<{ ok: boolean; sample?: string; message?: string }>("/organisation/translation/test", {
      method: "POST",
    }),
};
