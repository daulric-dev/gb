import { describe, expect, test } from "bun:test";
import {
  batchTexts,
  CACHE_STORAGE_PREFIX,
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
    expect(readStoredLanguage(s, [])).toBe("en");
    storeLanguage("ar", s);
    expect(s.getItem(LANGUAGE_STORAGE_KEY)).toBe("ar");
    expect(readStoredLanguage(s, ["fr-FR"])).toBe("ar");
    storeLanguage("en", s);
    // An explicit English choice wins over a non-English device.
    expect(readStoredLanguage(s, ["fr-FR"])).toBe("en");
  });

  test("with no choice, the device language is used when offered", () => {
    const s = new MemoryStorage();
    expect(readStoredLanguage(s, ["fr-CA", "en-US"])).toBe("fr");
    expect(readStoredLanguage(s, ["de-DE", "pt-BR"])).toBe("pt");
    expect(readStoredLanguage(s, ["zh-Hans-CN"])).toBe("zh");
    expect(readStoredLanguage(s, ["zh-TW"])).toBe("en");
    expect(readStoredLanguage(s, ["de-DE"])).toBe("en");
    expect(deviceLanguage(["es-419"])).toBe("es");
    expect(matchLanguage("ar_EG")).toBe("ar");
    expect(matchLanguage(42)).toBeNull();
  });

  test("unknown or blocked storage falls back to the device, then English", () => {
    const s = new MemoryStorage();
    s.setItem(LANGUAGE_STORAGE_KEY, "klingon");
    expect(readStoredLanguage(s, [])).toBe("en");
    expect(readStoredLanguage(throwing, [])).toBe("en");
    expect(readStoredLanguage(throwing, ["es"])).toBe("es");
    expect(() => storeLanguage("fr", throwing)).not.toThrow();
    expect(readStoredLanguage(null, [])).toBe("en");
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
