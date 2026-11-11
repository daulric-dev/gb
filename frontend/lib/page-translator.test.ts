import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ApiError } from "@/lib/api";
import {
  attributesFor,
  collectTargets,
  PageTranslator,
  type TranslateFn,
} from "@/lib/page-translator";
import { TranslationCache } from "@/lib/translation";

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  root.remove();
  document.documentElement.lang = "en";
});

function texts(el: Node): string[] {
  return collectTargets(el).texts.map((t) => t.nodeValue!.trim());
}

describe("collectTargets", () => {
  test("collects text and skips code, inputs, editors and opted-out content", () => {
    root.innerHTML = `
      <h1>Welcome</h1>
      <p>Due <b>tomorrow</b></p>
      <pre>const x = 1</pre>
      <p>Run <code>npm test</code> now</p>
      <textarea>typed by a student</textarea>
      <select><option>Option text</option></select>
      <div contenteditable="true">editing</div>
      <span translate="no">Ada Lovelace</span>
      <span class="notranslate">Keep me</span>
      <div translate="no"><p>Deep <em>inside</em></p></div>
      <script>var a = "x"</script>
      <style>.a{}</style>
    `;
    expect(texts(root)).toEqual(["Welcome", "Due", "tomorrow", "Run", "now"]);
  });

  test("a node reached directly still respects its ancestors", () => {
    root.innerHTML = `<div translate="no"><p id="in">Hidden</p></div><p id="out">Shown</p>`;
    expect(texts(root.querySelector("#in")!)).toEqual([]);
    expect(texts(root.querySelector("#in")!.firstChild!)).toEqual([]);
    expect(texts(root.querySelector("#out")!.firstChild!)).toEqual(["Shown"]);
  });

  test("attributes: placeholder, title, aria-label, alt and button values only", () => {
    root.innerHTML = `
      <input id="a" placeholder="Search" value="typed">
      <input id="b" type="submit" value="Send">
      <input id="c" type="text" value="typed">
      <img id="d" alt="Logo" src="x.png">
      <button id="e" aria-label="Close" title="Close dialog">x</button>
      <textarea id="f" placeholder="Write here"></textarea>
      <code id="g" title="Not this"></code>
    `;
    const q = (id: string) => root.querySelector(`#${id}`)!;
    expect(attributesFor(q("a"))).toEqual(["placeholder"]);
    expect(attributesFor(q("b"))).toEqual(["value"]);
    expect(attributesFor(q("c"))).toEqual([]);
    expect(attributesFor(q("d"))).toEqual(["alt"]);
    expect(attributesFor(q("e"))).toEqual(["title", "aria-label"]);
    const ids = collectTargets(root).elements.map((e) => e.id).sort();
    expect(ids).toEqual(["a", "b", "d", "e", "f"]);
  });
});

function fakeTranslate(prefix = "ES:"): { fn: TranslateFn; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    fn: async (texts) => {
      calls.push(texts);
      return texts.map((t) => `${prefix}${t}`);
    },
  };
}

function make(fn: TranslateFn, extra: Partial<ConstructorParameters<typeof PageTranslator>[0]> = {}) {
  return new PageTranslator({
    translate: fn,
    root: () => root,
    cache: new TranslationCache(null),
    schedule: (cb) => cb(),
    debounceMs: 0,
    ...extra,
  });
}

describe("PageTranslator", () => {
  test("translates in place, keeps whitespace and restores originals", async () => {
    root.innerHTML = `<p id="p">  Hello world  </p><span>12/03</span><input id="i" placeholder="Search">`;
    const textNode = root.querySelector("#p")!.firstChild as Text;
    const { fn, calls } = fakeTranslate();
    const t = make(fn);

    t.setLanguage("es");
    await t.whenIdle();

    expect(calls).toEqual([["Hello world", "Search"]]);
    expect(root.querySelector("#p")!.firstChild).toBe(textNode); // same node, not wrapped
    expect(textNode.nodeValue).toBe("  ES:Hello world  ");
    expect(root.querySelector("span")!.textContent).toBe("12/03");
    expect(root.querySelector("#i")!.getAttribute("placeholder")).toBe("ES:Search");
    expect(document.documentElement.lang).toBe("es");

    t.setLanguage("en");
    expect(textNode.nodeValue).toBe("  Hello world  ");
    expect(root.querySelector("#i")!.getAttribute("placeholder")).toBe("Search");
    expect(document.documentElement.lang).toBe("en");
    t.destroy();
  });

  test("switching language translates the originals, never translated text", async () => {
    root.innerHTML = `<p>Grades</p>`;
    const es = fakeTranslate("ES:");
    const calls: string[][] = [];
    const t = make(async (texts, to) => {
      calls.push(texts);
      return to === "es" ? es.fn(texts, to) : texts.map((x) => `FR:${x}`);
    });
    t.setLanguage("es");
    await t.whenIdle();
    t.setLanguage("fr");
    await t.whenIdle();
    expect(root.textContent).toBe("FR:Grades");
    expect(calls).toEqual([["Grades"], ["Grades"]]);
    t.destroy();
  });

  test("de-duplicates and uses the cache", async () => {
    root.innerHTML = `<p>Save</p><p>Save</p><p>Cancel</p>`;
    const cache = new TranslationCache(null);
    cache.setMany("es", [["Cancel", "Cancelar"]]);
    const { fn, calls } = fakeTranslate();
    const t = make(fn, { cache });
    t.setLanguage("es");
    await t.whenIdle();
    expect(calls).toEqual([["Save"]]);
    expect(root.textContent).toBe("ES:SaveES:SaveCancelar");
    t.destroy();
  });

  test("new and rewritten text is translated; rewritten text is a fresh original", async () => {
    root.innerHTML = `<p id="p">Loading</p>`;
    const { fn, calls } = fakeTranslate();
    const t = make(fn);
    t.setLanguage("es");
    await t.whenIdle();

    const text = root.querySelector("#p")!.firstChild as Text;
    text.nodeValue = "Ready"; // what React does on an update
    const added = document.createElement("span");
    added.textContent = "New item";
    root.appendChild(added);
    t.flushMutations();
    await t.whenIdle();

    expect(text.nodeValue).toBe("ES:Ready");
    expect(added.textContent).toBe("ES:New item");
    expect(calls.flat()).toEqual(["Loading", "Ready", "New item"]);

    t.setLanguage("en");
    expect(text.nodeValue).toBe("Ready");
    t.destroy();
  });

  test("its own writes do not trigger more requests", async () => {
    root.innerHTML = `<p>Hello</p>`;
    const { fn, calls } = fakeTranslate();
    const t = make(fn);
    t.setLanguage("es");
    await t.whenIdle();
    t.flushMutations();
    await t.whenIdle();
    expect(calls).toEqual([["Hello"]]);
    t.destroy();
  });

  test("splits large pages into requests within the limits", async () => {
    root.innerHTML = Array.from({ length: 450 }, (_, i) => `<p>Item ${i}</p>`).join("");
    const { fn, calls } = fakeTranslate();
    const t = make(fn);
    t.setLanguage("es");
    await t.whenIdle();
    // A small first request (what is on screen), then requests within the limits.
    expect(calls[0].length).toBe(40);
    expect(calls.every((c) => c.length <= 200)).toBe(true);
    expect(calls.flat().length).toBe(450);
    expect(root.textContent).toContain("ES:Item 449");
    t.destroy();
  });

  test("switching language while a request is in flight translates into the new one", async () => {
    root.innerHTML = `<p>Hello</p>`;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const calls: [string, string[]][] = [];
    const t = make(async (texts, to) => {
      calls.push([to, texts]);
      if (to === "es") await gate;
      return texts.map((x) => `${to.toUpperCase()}:${x}`);
    });
    t.setLanguage("es");
    t.setLanguage("fr");
    await new Promise((r) => setTimeout(r, 0));
    // French is asked for at once, without waiting for the Spanish request.
    expect(calls.map(([to]) => to)).toEqual(["es", "fr"]);
    expect(root.textContent).toBe("FR:Hello");
    release();
    await t.whenIdle();
    expect(root.textContent).toBe("FR:Hello");
    t.destroy();
  });

  test("a switch is not held up by the old language's requests", async () => {
    root.innerHTML = Array.from({ length: 200 }, (_, i) => `<p>Line ${i}</p>`).join("");
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const t = make(
      async (texts, to) => {
        if (to === "es") await gate; // every Spanish request hangs
        return texts.map((x) => `${to.toUpperCase()}:${x}`);
      },
      { firstBatchSize: 10, concurrency: 2, limits: { maxTexts: 10, maxChars: 5000, maxTotalChars: 50000 } },
    );
    t.setLanguage("es"); // fills both slots and queues the rest
    t.setLanguage("zh");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector("p")!.textContent).toBe("ZH:Line 0");
    release();
    await t.whenIdle();
    expect(root.textContent).toContain("ZH:Line 199");
    expect(root.textContent).not.toContain("ES:");
    t.destroy();
  });

  test("reports when it is busy", async () => {
    root.innerHTML = `<p>Hello</p>`;
    const busy: boolean[] = [];
    const { fn } = fakeTranslate();
    const t = make(fn, { onBusy: (b) => busy.push(b) });
    t.setLanguage("es");
    await t.whenIdle();
    expect(busy).toEqual([true, false]);
    t.destroy();
  });

  test("FEATURE_DISABLED stops and restores", async () => {
    root.innerHTML = `<p>Hello</p>`;
    let disabled = 0;
    const t = make(
      async () => {
        throw new ApiError(403, "off", { code: "FEATURE_DISABLED" });
      },
      { onDisabled: () => disabled++ },
    );
    t.setLanguage("es");
    await t.whenIdle();
    expect(disabled).toBe(1);
    expect(root.textContent).toBe("Hello");
    t.setLanguage("fr"); // ignored once disabled
    await t.whenIdle();
    expect(document.documentElement.lang).toBe("en");
    t.destroy();
  });

  test("a 429 backs off and retries", async () => {
    root.innerHTML = `<p>Hello</p>`;
    let attempts = 0;
    const t = make(
      async (texts) => {
        attempts++;
        if (attempts === 1) throw new ApiError(429, "slow down");
        return texts.map((x) => `ES:${x}`);
      },
      { backoffMs: 5 },
    );
    t.setLanguage("es");
    await t.whenIdle();
    expect(root.textContent).toBe("Hello");
    await new Promise((r) => setTimeout(r, 20));
    await t.whenIdle();
    expect(attempts).toBe(2);
    expect(root.textContent).toBe("ES:Hello");
    t.destroy();
  });

  test("other errors report once per failure and are not retried", async () => {
    root.innerHTML = `<p>Hello</p>`;
    let errors = 0;
    let attempts = 0;
    const t = make(
      async () => {
        attempts++;
        throw new ApiError(502, "bad gateway");
      },
      { onError: () => errors++ },
    );
    t.setLanguage("es");
    await t.whenIdle();
    root.appendChild(document.createElement("p")).textContent = "Hello";
    t.flushMutations();
    await t.whenIdle();
    expect(attempts).toBe(1);
    expect(errors).toBe(1);
    t.destroy();
  });
});
