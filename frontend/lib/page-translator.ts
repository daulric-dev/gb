import { ApiError } from "@/lib/api";
import { isFeatureDisabledError } from "@/lib/features";
import {
  batchTexts,
  DEFAULT_LANGUAGE,
  isTranslatable,
  splitWhitespace,
  TRANSLATION_LIMITS,
  TranslationCache,
  withWhitespaceOf,
  type TranslationLimits,
} from "@/lib/translation";

/**
 * Translates the page in place: text nodes and a few attributes, never what
 * people type. Each node keeps its original (WeakMap) and only originals are
 * ever sent, so switching language or back to English restores exactly.
 *
 * What is never sent to the translation engine (personal data stays here):
 * - whole routes (`BLOCKED_ROUTES`): chat and messages, pastoral notes,
 *   student record pages, analytics (at-risk lists) and audit logs. On those
 *   pages nothing is collected or requested, and requests already queued for
 *   them are dropped;
 * - any subtree marked `translate="no"`, `.notranslate` or `data-private`
 *   (`BLOCKED_SELECTOR`): shared renderers mark names, avatars, marks,
 *   feedback, discussion replies, email addresses, school names and course
 *   codes this way (`<NoTranslate>` in components/translation);
 * - form fields, code and rich-text editors.
 * Free text inside course content (a name written in an announcement) is
 * not recognised and is sent like the rest of that content.
 *
 * Text is replaced through `nodeValue` on the existing nodes, never by
 * wrapping it in new elements: React keeps owning its nodes. When React later
 * writes a new value into a node, that value is a fresh original.
 */

/** Attributes whose text people read (or hear). */
export const TRANSLATED_ATTRIBUTES = ["placeholder", "title", "aria-label", "alt"] as const;

/**
 * Subtrees that are never translated, text or attributes: code, scripts,
 * rich-text editors and anything marked `translate="no"`, `.notranslate` or
 * `data-private` (personal data: names, marks, feedback, messages).
 */
export const BLOCKED_SELECTOR = [
  "script",
  "style",
  "noscript",
  "template",
  "code",
  "pre",
  "kbd",
  "samp",
  '[contenteditable]:not([contenteditable="false"])',
  '[translate="no"]',
  ".notranslate",
  "[data-private]",
].join(",");

/**
 * Routes whose pages are about individual people (messages, pastoral and
 * safeguarding notes, a student's record, at-risk analytics, audit logs):
 * nothing on them is ever sent for translation. Matched against the path
 * (`/dashboard/chat`, `/dashboard/chat/…`), not the query.
 */
export const BLOCKED_ROUTES: readonly RegExp[] = [
  /^\/dashboard\/chat(?:\/|$)/,
  /^\/portal\/messages(?:\/|$)/,
  /^\/dashboard\/pastoral(?:\/|$)/,
  // A student's record: profile, accommodations, guardians, pastoral timeline.
  /^\/dashboard\/students\/[^/]+(?:\/|$)/,
  /^\/dashboard\/attendance\/students\/[^/]+(?:\/|$)/,
  /^\/dashboard\/courses\/[^/]+\/outcomes\/students\/[^/]+(?:\/|$)/,
  // At-risk lists and per-student analytics.
  /^\/dashboard\/analytics(?:\/|$)/,
  /^\/dashboard\/courses\/[^/]+\/analytics(?:\/|$)/,
  /^\/dashboard\/audit-log(?:\/|$)/,
  /^\/organisation\/audit-log(?:\/|$)/,
];

/** Whether nothing on the page at `pathname` may be sent for translation. */
export function isBlockedRoute(pathname: string | null | undefined): boolean {
  if (typeof pathname !== "string") return false;
  // Trailing slashes and case do not matter to the router; they must not here either.
  const path = pathname.toLowerCase().replace(/\/+$/, "") || "/";
  return BLOCKED_ROUTES.some((re) => re.test(path));
}

function currentPathBlocked(): boolean {
  const loc = (globalThis as { location?: Location }).location;
  return isBlockedRoute(loc?.pathname);
}

/**
 * Elements whose text children are what someone typed or picked (a
 * textarea's value, a select's options); their placeholder or title is still
 * translated.
 */
export const INPUT_TEXT_SELECTOR = "textarea,select";

const BUTTON_INPUT_TYPES = new Set(["button", "submit", "reset"]);

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * Marks an element whose own attributes (an `aria-label` such as "Ada's
 * pages") hold personal data, while its children are still translated.
 */
export const PRIVATE_LABEL_ATTRIBUTE = "data-private-label";

/** The attributes of `el` that are translated (an input button's `value` included). */
export function attributesFor(el: Element): string[] {
  const out: string[] = [];
  if (el.hasAttribute(PRIVATE_LABEL_ATTRIBUTE)) return out;
  for (const name of TRANSLATED_ATTRIBUTES) if (el.hasAttribute(name)) out.push(name);
  if (
    el.tagName === "INPUT" &&
    BUTTON_INPUT_TYPES.has((el.getAttribute("type") ?? "").toLowerCase()) &&
    el.hasAttribute("value")
  ) {
    out.push("value");
  }
  return out;
}

/** Whether a text node's text must stay as it is. */
export function isSkippedText(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  return !!parent.closest(BLOCKED_SELECTOR) || !!parent.closest(INPUT_TEXT_SELECTOR);
}

/** Whether an element's attributes must stay as they are. */
export function isSkippedElement(el: Element): boolean {
  return !!el.closest(BLOCKED_SELECTOR);
}

/**
 * The text nodes and attribute-bearing elements under `root` that may be
 * translated (whitespace-only text left out). The root's ancestors count:
 * a node inside `translate="no"` is skipped however it is reached.
 */
export function collectTargets(root: Node): { texts: Text[]; elements: Element[] } {
  const texts: Text[] = [];
  const elements: Element[] = [];

  if (root.nodeType === TEXT_NODE) {
    const t = root as Text;
    if (!isSkippedText(t) && t.nodeValue?.trim()) texts.push(t);
    return { texts, elements };
  }
  if (root.nodeType !== ELEMENT_NODE) return { texts, elements };

  const start = root as Element;
  const parent = start.parentElement;
  if (parent?.closest(BLOCKED_SELECTOR)) return { texts, elements };

  const stack: [Element, boolean][] = [[start, !!parent?.closest(INPUT_TEXT_SELECTOR)]];
  while (stack.length) {
    const [el, inInput] = stack.pop()!;
    if (el.matches(BLOCKED_SELECTOR)) continue;
    if (attributesFor(el).length > 0) elements.push(el);
    const skipText = inInput || el.matches(INPUT_TEXT_SELECTOR);
    const children = el.childNodes;
    // Reverse onto the stack so nodes come out in document order.
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child.nodeType === ELEMENT_NODE) stack.push([child as Element, skipText]);
      else if (child.nodeType === TEXT_NODE && !skipText && child.nodeValue?.trim()) {
        texts.push(child as Text);
      }
    }
  }
  // Text nodes were collected per element; restore document order overall.
  return { texts: texts.length > 1 ? sortInDocumentOrder(texts) : texts, elements };
}

function sortInDocumentOrder<T extends Node>(nodes: T[]): T[] {
  if (typeof Node === "undefined" || !nodes[0]?.compareDocumentPosition) return nodes;
  return nodes.sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

export type TranslateFn = (texts: string[], to: string) => Promise<string[]>;

export interface PageTranslatorOptions {
  translate: TranslateFn;
  /** Where to translate. Default `document.body`. */
  root?: () => Node | null;
  cache?: TranslationCache;
  limits?: TranslationLimits;
  /** Mutations are gathered for this long before a pass. */
  debounceMs?: number;
  /** Nodes handled per idle slot. */
  chunkSize?: number;
  /** Runs a slice of work when the browser is idle. */
  schedule?: (cb: () => void) => void;
  /** Backoff after a 429, doubling up to `maxBackoffMs`. */
  backoffMs?: number;
  maxBackoffMs?: number;
  /** The school switched translation off (403 FEATURE_DISABLED); the page is restored. */
  onDisabled?: () => void;
  /** A request failed for another reason (the caller shows at most one notice). */
  onError?: (err: unknown) => void;
  /** Requests started (true) or all finished (false): the picker shows a spinner. */
  onBusy?: (busy: boolean) => void;
  /** Texts in the first request after a switch, so what is on screen changes quickly. */
  firstBatchSize?: number;
  /** Requests in flight at once. */
  concurrency?: number;
  /**
   * Whether the current page must not be translated at all. Checked before
   * every pass and every request. Default: `BLOCKED_ROUTES` against
   * `location.pathname`.
   */
  isBlocked?: () => boolean;
}

type Target = Text | Element;

function defaultSchedule(cb: () => void) {
  const w = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(cb, { timeout: 300 });
  else setTimeout(cb, 0);
}

function inflightKey(lang: string, text: string): string {
  return `${lang}\u0000${text}`;
}

function isRateLimited(err: unknown): boolean {
  return err instanceof ApiError && err.status === 429;
}

export class PageTranslator {
  private lang: string = DEFAULT_LANGUAGE;
  private readonly cache: TranslationCache;
  private readonly limits: TranslationLimits;
  private readonly debounceMs: number;
  private readonly chunkSize: number;
  private readonly schedule: (cb: () => void) => void;
  private readonly baseBackoff: number;
  private readonly maxBackoff: number;

  // Text nodes: their original and what was last written into them.
  private readonly originals = new WeakMap<Text, string>();
  private readonly written = new WeakMap<Text, string>();
  private readonly touched = new Set<Text>();
  // Attributes, per element and name.
  private readonly attrOriginals = new WeakMap<Element, Map<string, string>>();
  private readonly attrWritten = new WeakMap<Element, Map<string, string>>();
  private readonly touchedElements = new Set<Element>();

  private observer: MutationObserver | null = null;
  private readonly dirty = new Set<Node>();
  private readonly dirtyAttrs = new Set<Element>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private work: Target[] = [];
  private working = false;
  /** The generation the running work loop belongs to. */
  private workingGen = -1;

  // Fetching, for the current language.
  private readonly missing = new Set<string>();
  private readonly failed = new Set<string>();
  /** Texts being requested, keyed by language and text (a switch must not wait on another language). */
  private readonly inflight = new Set<string>();
  private readonly waiting = new Set<Target>();
  /** Batches waiting for a request slot (current generation only). */
  private queue: string[][] = [];
  private readonly pending = new Set<Promise<void>>();
  /** Requests in flight, all languages (for the busy spinner). */
  private active = 0;
  /** Requests in flight for the current language: only these use up slots. */
  private activeCurrent = 0;
  /** Whether the first, small request of this generation was sent. */
  private sentFirst = false;
  private readonly firstBatchSize: number;
  private readonly concurrency: number;
  private pausedUntil = 0;
  private backoff: number;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disabled = false;
  private generation = 0;
  private previousDocLang: string | null = null;

  constructor(private readonly options: PageTranslatorOptions) {
    this.cache = options.cache ?? new TranslationCache();
    this.limits = options.limits ?? TRANSLATION_LIMITS;
    this.debounceMs = options.debounceMs ?? 150;
    this.chunkSize = options.chunkSize ?? 300;
    this.schedule = options.schedule ?? defaultSchedule;
    this.baseBackoff = options.backoffMs ?? 3_000;
    this.maxBackoff = options.maxBackoffMs ?? 5 * 60_000;
    this.backoff = this.baseBackoff;
    this.firstBatchSize = options.firstBatchSize ?? 40;
    this.concurrency = options.concurrency ?? 3;
  }

  get language(): string {
    return this.lang;
  }

  /** Translate into `lang`, or restore every original for English. */
  setLanguage(lang: string): void {
    if (lang === this.lang || this.disabled) return;
    this.stop();
    this.restoreAll();
    this.lang = lang;
    if (lang === DEFAULT_LANGUAGE) return;
    this.start();
  }

  /** Stops and restores the page (unmount). */
  destroy(): void {
    this.stop();
    this.restoreAll();
    this.lang = DEFAULT_LANGUAGE;
  }

  /** Resolves once queued work and requests are done (tests). */
  async whenIdle(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      if (this.pending.size) await Promise.all([...this.pending]);
      else if (this.work.length || this.working) await new Promise((r) => setTimeout(r, 0));
      else return;
    }
  }

  /**
   * The route changed: on a blocked page, restore everything and drop queued
   * work and requests; otherwise translate the whole page again.
   */
  routeChanged(): void {
    if (this.lang === DEFAULT_LANGUAGE || this.disabled) return;
    if (this.blocked()) {
      this.dropPending();
      this.restoreAll();
      return;
    }
    const root = this.root();
    if (root) this.dirty.add(root);
    this.scan();
  }

  private blocked(): boolean {
    return (this.options.isBlocked ?? currentPathBlocked)();
  }

  /** Forgets collected and queued work (nothing more is requested for it). */
  private dropPending(): void {
    for (const t of this.queue.flat()) this.inflight.delete(inflightKey(this.lang, t));
    this.dirty.clear();
    this.dirtyAttrs.clear();
    this.work = [];
    this.queue = [];
    this.missing.clear();
    this.waiting.clear();
  }

  /** Runs a pass over pending mutations at once instead of after the debounce (tests). */
  flushMutations(): void {
    if (this.observer) this.onMutations(this.observer.takeRecords());
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.scan();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  private root(): Node | null {
    if (this.options.root) return this.options.root();
    return typeof document !== "undefined" ? document.body : null;
  }

  private start(): void {
    const root = this.root();
    if (!root) return;
    this.generation++;
    this.missing.clear();
    this.failed.clear();
    this.waiting.clear();
    this.queue = [];
    this.activeCurrent = 0;
    this.sentFirst = false;
    if (typeof document !== "undefined") {
      this.previousDocLang ??= document.documentElement.getAttribute("lang");
      document.documentElement.lang = this.lang;
    }
    if (typeof MutationObserver !== "undefined") {
      this.observer = new MutationObserver((records) => this.onMutations(records));
      this.observer.observe(root, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: [...TRANSLATED_ATTRIBUTES, "value"],
      });
    }
    this.dirty.add(root);
    this.scan();
  }

  private stop(): void {
    this.generation++;
    this.observer?.disconnect();
    this.observer = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.debounceTimer = null;
    this.retryTimer = null;
    this.dirty.clear();
    this.dirtyAttrs.clear();
    this.work = [];
    this.queue = [];
    this.missing.clear();
    this.waiting.clear();
    if (typeof document !== "undefined" && this.previousDocLang !== null) {
      document.documentElement.lang = this.previousDocLang || DEFAULT_LANGUAGE;
      this.previousDocLang = null;
    }
  }

  /** Puts back every original that still shows a translation of ours. */
  private restoreAll(): void {
    for (const node of this.touched) {
      const mine = this.written.get(node);
      const original = this.originals.get(node);
      if (mine !== undefined && original !== undefined && node.nodeValue === mine) {
        node.nodeValue = original;
      }
      this.written.delete(node);
    }
    this.touched.clear();
    for (const el of this.touchedElements) {
      const mine = this.attrWritten.get(el);
      const originals = this.attrOriginals.get(el);
      if (mine && originals) {
        for (const [name, value] of mine) {
          const original = originals.get(name);
          if (original !== undefined && el.getAttribute(name) === value) el.setAttribute(name, original);
        }
      }
      this.attrWritten.delete(el);
    }
    this.touchedElements.clear();
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  private onMutations(records: MutationRecord[]): void {
    let any = false;
    for (const r of records) {
      if (r.type === "childList") {
        r.addedNodes.forEach((n) => {
          if (n.nodeType === TEXT_NODE && this.written.get(n as Text) === n.nodeValue) return;
          this.dirty.add(n);
          any = true;
        });
      } else if (r.type === "characterData") {
        const t = r.target as Text;
        if (this.written.get(t) === t.nodeValue) continue; // our own write
        this.dirty.add(t);
        any = true;
      } else if (r.type === "attributes" && r.attributeName) {
        const el = r.target as Element;
        const mine = this.attrWritten.get(el)?.get(r.attributeName);
        if (mine !== undefined && el.getAttribute(r.attributeName) === mine) continue;
        this.dirtyAttrs.add(el);
        any = true;
      }
    }
    if (!any) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.scan();
    }, this.debounceMs);
  }

  // ── Passes ─────────────────────────────────────────────────────────────────

  private scan(): void {
    if (this.lang === DEFAULT_LANGUAGE) return;
    if (this.blocked()) {
      // Keep observing (the route may change back), but collect nothing.
      this.dropPending();
      return;
    }
    const targets = new Set<Target>(this.work);
    for (const node of this.dirty) {
      if (!node.isConnected) continue;
      const { texts, elements } = collectTargets(node);
      for (const t of texts) targets.add(t);
      for (const e of elements) targets.add(e);
    }
    for (const el of this.dirtyAttrs) {
      if (el.isConnected && !isSkippedElement(el)) targets.add(el);
    }
    this.dirty.clear();
    this.dirtyAttrs.clear();
    this.work = [...targets];
    this.runWork();
  }

  private runWork(): void {
    // A loop from before a language switch stops by itself; start a fresh one.
    if (this.working && this.workingGen === this.generation) return;
    this.working = true;
    const gen = this.generation;
    this.workingGen = gen;
    const step = () => {
      if (gen !== this.generation) {
        if (this.workingGen === gen) this.working = false;
        return;
      }
      const slice = this.work.splice(0, this.chunkSize);
      for (const target of slice) this.process(target);
      // Ask for what is collected so far: the top of the page (usually what
      // is on screen) is translated while the rest is still being read.
      this.fetchMissing();
      if (this.work.length) {
        this.schedule(step);
      } else {
        this.working = false;
        this.pruneDetached();
      }
    };
    // The first slice runs now, so a switch reacts without waiting for idle time.
    step();
  }

  private process(target: Target): void {
    if (!target.isConnected) return;
    if (target.nodeType === TEXT_NODE) this.processText(target as Text);
    else this.processElement(target as Element);
  }

  /** The original behind a text node: its current value unless that is our write. */
  private originalOf(node: Text): string {
    const current = node.nodeValue ?? "";
    if (this.written.get(node) === current) return this.originals.get(node) ?? current;
    this.originals.set(node, current);
    this.written.delete(node);
    return current;
  }

  private processText(node: Text): void {
    const original = this.originalOf(node);
    const { core } = splitWhitespace(original);
    if (!isTranslatable(core, this.limits)) return;
    const translated = this.lookup(core);
    if (translated === undefined) {
      this.waiting.add(node);
      return;
    }
    const value = withWhitespaceOf(original, translated);
    this.written.set(node, value);
    this.touched.add(node);
    if (node.nodeValue !== value) node.nodeValue = value;
  }

  private processElement(el: Element): void {
    let originals = this.attrOriginals.get(el);
    let mine = this.attrWritten.get(el);
    for (const name of attributesFor(el)) {
      const current = el.getAttribute(name) ?? "";
      let original: string;
      if (mine?.get(name) === current) {
        original = originals?.get(name) ?? current;
      } else {
        if (!originals) this.attrOriginals.set(el, (originals = new Map()));
        originals.set(name, current);
        mine?.delete(name);
        original = current;
      }
      const { core } = splitWhitespace(original);
      if (!isTranslatable(core, this.limits)) continue;
      const translated = this.lookup(core);
      if (translated === undefined) {
        this.waiting.add(el);
        continue;
      }
      const value = withWhitespaceOf(original, translated);
      if (!mine) this.attrWritten.set(el, (mine = new Map()));
      mine.set(name, value);
      this.touchedElements.add(el);
      if (current !== value) el.setAttribute(name, value);
    }
  }

  /** The cached translation, or undefined after queueing the text for a request. */
  private lookup(core: string): string | undefined {
    const hit = this.cache.get(this.lang, core);
    if (hit !== undefined) return hit;
    if (!this.failed.has(core) && !this.inflight.has(inflightKey(this.lang, core))) this.missing.add(core);
    return undefined;
  }

  private pruneDetached(): void {
    for (const n of this.touched) if (!n.isConnected) this.touched.delete(n);
    for (const e of this.touchedElements) if (!e.isConnected) this.touchedElements.delete(e);
  }

  // ── Requests ───────────────────────────────────────────────────────────────

  private fetchMissing(): void {
    if (this.disabled || this.missing.size === 0) return;
    if (this.blocked()) {
      this.dropPending();
      return;
    }
    const wait = this.pausedUntil - Date.now();
    if (wait > 0) {
      if (!this.retryTimer) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.fetchMissing();
        }, wait);
      }
      return;
    }
    const lang = this.lang;
    const texts = [...this.missing].filter((t) => !this.cache.has(lang, t));
    this.missing.clear();
    if (texts.length === 0) return;
    for (const t of texts) this.inflight.add(inflightKey(lang, t));
    let rest = texts;
    if (!this.sentFirst) {
      this.sentFirst = true;
      this.queue.push(...batchTexts(texts.slice(0, this.firstBatchSize), this.limits));
      rest = texts.slice(this.firstBatchSize);
    }
    this.queue.push(...batchTexts(rest, this.limits));
    this.pump();
  }

  /** Starts queued batches while there are free request slots. */
  private pump(): void {
    // Requests for a language switched away from finish in the background
    // but no longer take a slot, so the new language starts at once.
    while (this.activeCurrent < this.concurrency && this.queue.length > 0 && !this.disabled) {
      // Navigated to a blocked page while batches waited for a slot: send none of them.
      if (this.blocked()) {
        this.dropPending();
        return;
      }
      const batch = this.queue.shift()!;
      const lang = this.lang;
      const gen = this.generation;
      if (this.active++ === 0) this.options.onBusy?.(true);
      this.activeCurrent++;
      const run = this.request(batch, lang, gen).finally(() => {
        this.pending.delete(run);
        for (const t of batch) this.inflight.delete(inflightKey(lang, t));
        if (--this.active === 0) this.options.onBusy?.(false);
        if (gen !== this.generation) return;
        this.activeCurrent--;
        this.pump();
        if (this.missing.size > 0) this.fetchMissing();
      });
      this.pending.add(run);
    }
  }

  private async request(batch: string[], lang: string, gen: number): Promise<void> {
    try {
      const out = await this.options.translate(batch, lang);
      if (!Array.isArray(out) || out.length !== batch.length) {
        throw new Error("Translation response did not match the request");
      }
      this.cache.setMany(
        lang,
        batch.map((t, j): [string, string] => [t, typeof out[j] === "string" ? out[j] : t]),
      );
      this.backoff = this.baseBackoff;
      if (gen === this.generation) this.reapplyWaiting();
    } catch (err) {
      if (gen !== this.generation) return;
      if (isFeatureDisabledError(err)) {
        this.disabled = true;
        this.stop();
        this.restoreAll();
        this.options.onDisabled?.();
        return;
      }
      if (isRateLimited(err)) {
        // Try this batch and every queued one again later.
        for (const t of [batch, ...this.queue].flat()) {
          this.inflight.delete(inflightKey(lang, t));
          this.missing.add(t);
        }
        this.queue = [];
        this.pausedUntil = Date.now() + this.backoff;
        this.backoff = Math.min(this.backoff * 2, this.maxBackoff);
        return;
      }
      for (const t of batch) this.failed.add(t);
      this.options.onError?.(err);
    }
  }

  private reapplyWaiting(): void {
    const targets = [...this.waiting];
    this.waiting.clear();
    for (const t of targets) this.process(t);
    // Anything still waiting asked for texts that are queued (or failed).
  }
}
