import { createHash } from 'node:crypto';

/** Words per shingle. */
export const SHINGLE_WORDS = 5;
/** Winnowing window (in shingles). Any shared run of SHINGLE_WORDS + WINDOW - 1 words is caught. */
export const WINNOW_WINDOW = 4;
/** Texts shorter than this (in words) are not checked: too short to mean anything. */
export const MIN_WORDS = 50;
/** Matches below this percent are not stored (the teacher's threshold is at least 10). */
export const STORE_FLOOR = 10;
/** Bumped when the algorithm changes, so stored fingerprints are recomputed. */
export const ALGORITHM_VERSION = 1;

export interface Token {
  /** Where the token starts and ends in the original text. */
  start: number;
  end: number;
  /** The normalised word. */
  word: string;
}

const WORD = /[\p{L}\p{N}\p{M}]+/gu;

/** One word, normalised: decomposed, accents dropped, lower case. */
export function normaliseWord(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** The words of a text with their positions in the original. */
export function tokenise(text: string): Token[] {
  const out: Token[] = [];
  for (const m of (text ?? '').matchAll(WORD)) {
    const word = normaliseWord(m[0]);
    if (word) out.push({ start: m.index, end: m.index + m[0].length, word });
  }
  return out;
}

/** Normalised text: words only, lower case, no accents or punctuation. */
export function normalise(text: string): string {
  return tokenise(text)
    .map((t) => t.word)
    .join(' ');
}

/** FNV-1a, 32 bits, as a signed integer (Postgres `integer`). */
export function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/** The hash of each SHINGLE_WORDS-word window, in order. */
export function shingleHashes(words: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) {
    out.push(fnv1a(words.slice(i, i + SHINGLE_WORDS).join(' ')));
  }
  return out;
}

/**
 * Winnowing (Schleimer, Wilkerson & Aiken): the smallest hash of every
 * window of `w` consecutive hashes (the rightmost on ties), deduplicated and
 * sorted. The same passage in two texts yields the same fingerprints.
 */
export function winnow(hashes: number[], w: number = WINNOW_WINDOW): number[] {
  if (hashes.length === 0) return [];
  if (hashes.length <= w) return [Math.min(...hashes)];
  const picked = new Set<number>();
  for (let i = 0; i + w <= hashes.length; i++) {
    let min = i;
    for (let j = i + 1; j < i + w; j++) if (hashes[j] <= hashes[min]) min = j;
    picked.add(hashes[min]);
  }
  return [...picked].sort((a, b) => a - b);
}

export interface Fingerprint {
  wordCount: number;
  /** Sorted, distinct. */
  hashes: number[];
  /** Changes when the text, the subtracted text or the algorithm changes. */
  textHash: string;
}

/**
 * The fingerprint of a text, with any shingle that also appears in
 * `exclude` (the activity's instructions, an essay question's prompt)
 * left out, so quoting the prompt is never a match. Null for a text under
 * MIN_WORDS words or with nothing of its own left.
 */
export function fingerprint(text: string, exclude: (string | null | undefined)[] = []): Fingerprint | null {
  const words = tokenise(text).map((t) => t.word);
  if (words.length < MIN_WORDS) return null;
  const excluded = excludedShingles(exclude);
  const own = shingleHashes(words).filter((h) => !excluded.has(h));
  const hashes = winnow(own);
  if (hashes.length === 0) return null;
  const textHash = createHash('sha256')
    .update(
      JSON.stringify([
        ALGORITHM_VERSION,
        words.join(' '),
        exclude.map((e) => normalise(e ?? '')),
      ]),
    )
    .digest('hex');
  return { wordCount: words.length, hashes, textHash };
}

function excludedShingles(exclude: (string | null | undefined)[]): Set<number> {
  const out = new Set<number>();
  for (const text of exclude) {
    if (!text) continue;
    for (const h of shingleHashes(tokenise(text).map((t) => t.word))) out.add(h);
  }
  return out;
}

/** How many of `a`'s hashes are in `b` (both sorted, distinct). */
export function sharedCount(a: number[], b: number[]): number {
  let i = 0;
  let j = 0;
  let n = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      n++;
      i++;
      j++;
    } else if (a[i] < b[j]) i++;
    else j++;
  }
  return n;
}

/** The percent of `a` found in `b` (containment), two decimals. */
export function containment(a: number[], b: number[]): number {
  if (a.length === 0) return 0;
  return Math.round((sharedCount(a, b) / a.length) * 10000) / 100;
}

/** Jaccard similarity in percent, two decimals. */
export function jaccard(a: number[], b: number[]): number {
  const shared = sharedCount(a, b);
  const union = a.length + b.length - shared;
  return union === 0 ? 0 : Math.round((shared / union) * 10000) / 100;
}

export interface Segment {
  text: string;
  match: boolean;
}

/**
 * Both texts split into runs that are (or are not) part of a shared
 * passage, for the side-by-side view. A word is "matching" when it is in a
 * SHINGLE_WORDS-word run the other text also has (instructions excluded).
 */
export function highlight(
  a: string,
  b: string,
  exclude: (string | null | undefined)[] = [],
): { left: Segment[]; right: Segment[] } {
  const ta = tokenise(a);
  const tb = tokenise(b);
  const ha = shingleHashes(ta.map((t) => t.word));
  const hb = shingleHashes(tb.map((t) => t.word));
  const excluded = excludedShingles(exclude);
  const inA = new Set(ha);
  const inB = new Set(hb);
  const shared = new Set([...inA].filter((h) => inB.has(h) && !excluded.has(h)));
  return {
    left: segments(a, ta, marked(ha, ta.length, shared)),
    right: segments(b, tb, marked(hb, tb.length, shared)),
  };
}

function marked(hashes: number[], count: number, shared: Set<number>): boolean[] {
  const out = new Array<boolean>(count).fill(false);
  hashes.forEach((h, i) => {
    if (!shared.has(h)) return;
    for (let k = i; k < i + SHINGLE_WORDS && k < count; k++) out[k] = true;
  });
  return out;
}

function segments(text: string, tokens: Token[], flags: boolean[]): Segment[] {
  const out: Segment[] = [];
  const push = (part: string, match: boolean) => {
    if (!part) return;
    const last = out[out.length - 1];
    if (last && last.match === match) last.text += part;
    else out.push({ text: part, match });
  };
  let pos = 0;
  tokens.forEach((t, i) => {
    // Text between two matching words belongs to the match.
    const between = text.slice(pos, t.start);
    push(between, flags[i] && i > 0 && flags[i - 1]);
    push(text.slice(t.start, t.end), flags[i]);
    pos = t.end;
  });
  push(text.slice(pos), false);
  return out;
}
