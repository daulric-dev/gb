import { describe, expect, test } from "bun:test";
import {
  batchTexts,
  CACHE_STORAGE_PREFIX,
  clearTranslationCache,
  ENGINE_INFO,
  languageToOffer,
  readLanguageChoice,
  sharedTranslationCache,
  DEFAULT_LANGUAGE,
  isLanguageCode,
  isTranslatable,
  LANGUAGE_STORAGE_KEY,
  LANGUAGES,
  readStoredLanguage,
  deviceLanguage,
  matchLanguage,
  splitWhitespace,
  storeLanguage,
  TARGET_LANGUAGES,
  TranslationCache,
  withWhitespaceOf,
} from "@/lib/translation";

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

const throwing = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
  removeItem() {
    throw new Error("blocked");
  },
} as unknown as Storage;

describe("languages", () => {
  test("English is the default and not a target", () => {
    expect(DEFAULT_LANGUAGE).toBe("en");
    expect(LANGUAGES.map((l) => l.code)).toEqual(["en", "es", "fr", "pt", "ar", "zh"]);
    expect(TARGET_LANGUAGES.some((l) => l.code === "en")).toBe(false);
    expect(isLanguageCode("fr")).toBe(true);
    expect(isLanguageCode("xx")).toBe(false);
    expect(isLanguageCode(null)).toBe(false);
  });

  test("stored choice round-trips, English included", () => {
    const s = new MemoryStorage();
    expect(readStoredLanguage(s)).toBe("en");
    expect(readLanguageChoice(s)).toBeNull();
    storeLanguage("ar", s);
    expect(s.getItem(LANGUAGE_STORAGE_KEY)).toBe("ar");
    expect(readStoredLanguage(s)).toBe("ar");
    storeLanguage("en", s);
    expect(readLanguageChoice(s)).toBe("en");
    expect(readStoredLanguage(s)).toBe("en");
  });

  test("with no choice, English is shown: the device language is only offered", () => {
    const s = new MemoryStorage();
    // Nothing is translated without a choice, whatever the device prefers.
    expect(readStoredLanguage(s)).toBe("en");
    expect(languageToOffer(s, ["fr-CA", "en-US"])).toBe("fr");
    expect(languageToOffer(s, ["de-DE", "pt-BR"])).toBe("pt");
    expect(languageToOffer(s, ["zh-Hans-CN"])).toBe("zh");
    expect(languageToOffer(s, ["zh-TW"])).toBeNull();
    expect(languageToOffer(s, ["de-DE"])).toBeNull();
    // English devices are never asked.
    expect(languageToOffer(s, ["en-GB", "fr-FR"])).toBeNull();
    expect(deviceLanguage(["es-419"])).toBe("es");
    expect(matchLanguage("ar_EG")).toBe("ar");
    expect(matchLanguage(42)).toBeNull();
  });

  test("an answer (a \"no\" included) is never asked again", () => {
    const s = new MemoryStorage();
    storeLanguage("en", s);
    expect(languageToOffer(s, ["fr-FR"])).toBeNull();
    expect(readStoredLanguage(s)).toBe("en");
    // Even an unreadable stored value counts as answered (it is not offered again).
    s.setItem(LANGUAGE_STORAGE_KEY, "klingon");
    expect(languageToOffer(s, ["fr-FR"])).toBeNull();
  });

  test("unknown or blocked storage: English, and no question (an answer could not be kept)", () => {
    const s = new MemoryStorage();
    s.setItem(LANGUAGE_STORAGE_KEY, "klingon");
    expect(readStoredLanguage(s)).toBe("en");
    expect(readStoredLanguage(throwing)).toBe("en");
    expect(languageToOffer(throwing, ["es"])).toBeNull();
    expect(languageToOffer(null, ["es"])).toBeNull();
    expect(() => storeLanguage("fr", throwing)).not.toThrow();
    expect(readStoredLanguage(null)).toBe("en");
  });
});

describe("sign-out", () => {
  test("clears every cached translation, keeps the language choice and other keys", () => {
    const session = new MemoryStorage();
    const cache = new TranslationCache(session);
    cache.setMany("es", [["Ada Lovelace's report", "Informe de Ada Lovelace"]]);
    cache.setMany("fr", [["Hello", "Bonjour"]]);
    session.setItem("other", "kept");
    session.setItem(LANGUAGE_STORAGE_KEY, "es");
    clearTranslationCache(session);
    expect(session.getItem(CACHE_STORAGE_PREFIX + "es")).toBeNull();
    expect(session.getItem(CACHE_STORAGE_PREFIX + "fr")).toBeNull();
    expect(session.getItem("other")).toBe("kept");
    expect(session.getItem(LANGUAGE_STORAGE_KEY)).toBe("es");
    expect(() => clearTranslationCache(throwing)).not.toThrow();
    expect(() => clearTranslationCache(null)).not.toThrow();
  });

  test("the shared in-memory cache is emptied too (same instance)", () => {
    const shared = sharedTranslationCache();
    shared.setMany("es", [["Grades", "Notas"]]);
    expect(shared.get("es", "Grades")).toBe("Notas");
    // Default storage: this tab's sessionStorage, where the shared cache keeps its copy.
    clearTranslationCache();
    expect(sharedTranslationCache()).toBe(shared);
    expect(shared.has("es", "Grades")).toBe(false);
  });
});

describe("engines", () => {
  test("Google and Yandex are uncontracted and say where text goes", () => {
    expect(ENGINE_INFO.google.uncontracted).toBe(true);
    expect(ENGINE_INFO.yandex.uncontracted).toBe(true);
    expect(ENGINE_INFO.libre.uncontracted).toBe(false);
    expect(ENGINE_INFO.deepl.uncontracted).toBe(false);
    expect(ENGINE_INFO.google.transfer).toMatch(/United States/);
    expect(ENGINE_INFO.yandex.transfer).toMatch(/Russia/);
    expect(ENGINE_INFO.deepl.transfer).toMatch(/data processing agreement/);
  });
});

describe("text rules", () => {
  test("splits and restores surrounding whitespace", () => {
    expect(splitWhitespace("  Hello world\n")).toEqual({ lead: "  ", core: "Hello world", trail: "\n" });
    expect(splitWhitespace("x")).toEqual({ lead: "", core: "x", trail: "" });
    expect(splitWhitespace("   ")).toEqual({ lead: "   ", core: "", trail: "" });
    expect(withWhitespaceOf(" Save ", "Guardar")).toBe(" Guardar ");
    expect(withWhitespaceOf("\n\tDue soon", " Bientôt ")).toBe("\n\tBientôt");
  });

  test("only strings with letters are worth translating", () => {
    expect(isTranslatable("Assignments")).toBe(true);
    expect(isTranslatable("Due 12/03")).toBe(true);
    expect(isTranslatable("12/03")).toBe(false);
    expect(isTranslatable("8 / 10")).toBe(false);
    expect(isTranslatable("95%")).toBe(false);
    expect(isTranslatable("·")).toBe(false);
    expect(isTranslatable("A")).toBe(false);
    expect(isTranslatable("")).toBe(false);
    expect(isTranslatable("https://example.org/page")).toBe(false);
    expect(isTranslatable("teacher@school.org")).toBe(false);
    expect(isTranslatable("Écrire")).toBe(true);
  });

  test("texts over the per-text limit are not sent", () => {
    expect(isTranslatable("a".repeat(5000))).toBe(true);
    expect(isTranslatable("a".repeat(5001))).toBe(false);
  });
});

describe("batchTexts", () => {
  test("de-duplicates and keeps order", () => {
    expect(batchTexts(["a1", "b2", "a1", "c3"])).toEqual([["a1", "b2", "c3"]]);
  });

  test("splits by count", () => {
    const texts = Array.from({ length: 450 }, (_, i) => `t${i}`);
    const batches = batchTexts(texts);
    expect(batches.map((b) => b.length)).toEqual([200, 200, 50]);
    expect(batches.flat()).toEqual(texts);
  });

  test("splits by total characters and drops oversize texts", () => {
    const limits = { maxTexts: 100, maxChars: 10, maxTotalChars: 25 };
    const batches = batchTexts(["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc", "x".repeat(11), "dd"], limits);
    expect(batches).toEqual([["aaaaaaaaaa", "bbbbbbbbbb"], ["cccccccccc", "dd"]]);
    for (const b of batches) {
      expect(b.length).toBeLessThanOrEqual(limits.maxTexts);
      expect(b.join("").length).toBeLessThanOrEqual(limits.maxTotalChars);
    }
  });

  test("real limits hold for large pages", () => {
    const texts = Array.from({ length: 300 }, (_, i) => `${i}`.padEnd(400, "x"));
    for (const b of batchTexts(texts)) {
      expect(b.length).toBeLessThanOrEqual(200);
      expect(b.join("").length).toBeLessThanOrEqual(50_000);
    }
  });
});

describe("TranslationCache", () => {
  test("keeps languages apart and survives a new instance via storage", () => {
    const s = new MemoryStorage();
    const c = new TranslationCache(s);
    c.setMany("es", [["Hello", "Hola"]]);
    c.setMany("fr", [["Hello", "Bonjour"]]);
    expect(c.get("es", "Hello")).toBe("Hola");
    expect(c.get("fr", "Hello")).toBe("Bonjour");
    expect(c.has("pt", "Hello")).toBe(false);
    const again = new TranslationCache(s);
    expect(again.get("es", "Hello")).toBe("Hola");
  });

  test("drops the oldest entries once full", () => {
    const c = new TranslationCache(null, 2);
    c.setMany("es", [["one", "uno"], ["two", "dos"], ["three", "tres"]]);
    expect(c.has("es", "one")).toBe(false);
    expect(c.get("es", "three")).toBe("tres");
  });

  test("stores only up to the character budget, newest first", () => {
    const s = new MemoryStorage();
    const c = new TranslationCache(s, 100, 12);
    c.setMany("es", [["aaa", "AAA"], ["bbb", "BBB"], ["ccc", "CCC"]]);
    const stored = JSON.parse(s.getItem(`${CACHE_STORAGE_PREFIX}es`)!);
    expect(stored).toEqual({ bbb: "BBB", ccc: "CCC" });
    expect(c.get("es", "aaa")).toBe("AAA");
  });

  test("blocked or corrupt storage still works in memory", () => {
    const c = new TranslationCache(throwing);
    expect(() => c.setMany("es", [["Hi", "Hola"]])).not.toThrow();
    expect(c.get("es", "Hi")).toBe("Hola");
    const s = new MemoryStorage();
    s.setItem(`${CACHE_STORAGE_PREFIX}es`, "{not json");
    expect(new TranslationCache(s).get("es", "Hi")).toBeUndefined();
  });
});
