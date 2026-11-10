import { describe, expect, test } from 'bun:test';
import {
  MIN_WORDS,
  containment,
  fingerprint,
  fnv1a,
  highlight,
  jaccard,
  normalise,
  sharedCount,
  shingleHashes,
  tokenise,
  winnow,
} from './fingerprint';

const ESSAY =
  'Rivers shape the land they cross. Over thousands of years a river cuts a valley, carries sediment downstream and builds ' +
  'wide plains where it slows near the sea. Floods bring fresh soil to farms but also destroy homes, which is why people ' +
  'have built levees, dams and channels to control the water. These changes help towns grow yet they can starve the delta ' +
  'of the mud it needs, so the coast slowly sinks and salt water creeps inland over the fields.';

const OTHER =
  'Volcanoes form where molten rock reaches the surface through cracks in the crust. Some erupt explosively, throwing ash ' +
  'high into the sky, while others pour out slow rivers of lava that harden into new ground. People live near volcanoes ' +
  'because the soil is rich, and scientists watch for small earthquakes and gas that warn of an eruption before it comes.';

describe('normalisation', () => {
  test('case, accents and punctuation do not matter', () => {
    expect(normalise('Café, CAFÉ! cafe…')).toBe('cafe cafe cafe');
    expect(normalise('  The  river’s\nbank—wide.  ')).toBe('the river s bank wide');
    expect(normalise('ﬁsh')).toBe('fish');
  });

  test('tokens keep their place in the original text', () => {
    const text = 'Hello, wörld';
    const tokens = tokenise(text);
    expect(tokens.map((t) => text.slice(t.start, t.end))).toEqual(['Hello', 'wörld']);
    expect(tokens.map((t) => t.word)).toEqual(['hello', 'world']);
  });
});

describe('fingerprints', () => {
  test('hashes are stable 32-bit integers', () => {
    expect(fnv1a('the quick brown fox jumps')).toBe(fnv1a('the quick brown fox jumps'));
    const h = fnv1a('a b c d e');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(-(2 ** 31));
    expect(h).toBeLessThan(2 ** 31);
  });

  test('the same text gives the same fingerprint, whatever the formatting', () => {
    const a = fingerprint(ESSAY)!;
    const b = fingerprint(ESSAY.toUpperCase().replaceAll(' ', '  \n'))!;
    expect(a.hashes).toEqual(b.hashes);
    expect(a.textHash).toBe(b.textHash);
    expect(a.hashes).toEqual([...a.hashes].sort((x, y) => x - y));
    expect(new Set(a.hashes).size).toBe(a.hashes.length);
  });

  test('winnowing keeps the minimum of each window and dedupes', () => {
    expect(winnow([5, 3, 8, 3, 9, 1], 3)).toEqual([1, 3]);
    expect(winnow([4, 2], 4)).toEqual([2]);
    expect(winnow([])).toEqual([]);
    expect(shingleHashes(['a', 'b', 'c', 'd'])).toEqual([]);
    expect(shingleHashes(['a', 'b', 'c', 'd', 'e', 'f'])).toHaveLength(2);
  });

  test('texts under the minimum are skipped', () => {
    const short = Array.from({ length: MIN_WORDS - 1 }, (_, i) => `word${i}`).join(' ');
    expect(fingerprint(short)).toBeNull();
    const long = Array.from({ length: MIN_WORDS }, (_, i) => `word${i}`).join(' ');
    expect(fingerprint(long)).not.toBeNull();
  });

  test('text from the instructions is subtracted', () => {
    const prompt = 'Explain in your own words how rivers shape the land they cross and what people do about floods.';
    const quoted = `${prompt} ${OTHER}`;
    const withPrompt = fingerprint(quoted)!;
    const without = fingerprint(quoted, [prompt])!;
    const promptOnly = winnow(shingleHashes(tokenise(prompt).map((t) => t.word)));
    expect(sharedCount(promptOnly, withPrompt.hashes)).toBeGreaterThan(0);
    expect(without.hashes.length).toBeLessThan(withPrompt.hashes.length);
    // Two students quoting the same prompt and nothing else in common.
    const a = fingerprint(`${prompt} ${ESSAY}`, [prompt])!;
    const b = fingerprint(`${prompt} ${OTHER}`, [prompt])!;
    expect(containment(a.hashes, b.hashes)).toBe(0);
    // Changing the instructions changes the stored hash (so it recomputes).
    expect(fingerprint(quoted, ['other']))!.not.toEqual(expect.objectContaining({ textHash: without.textHash }));
  });

  test('a text with nothing but the instructions has no fingerprint', () => {
    expect(fingerprint(ESSAY, [ESSAY])).toBeNull();
  });
});

describe('scores', () => {
  test('identical texts are 100%, unrelated ones 0%', () => {
    const a = fingerprint(ESSAY)!;
    const b = fingerprint(OTHER)!;
    expect(containment(a.hashes, a.hashes)).toBe(100);
    expect(containment(a.hashes, b.hashes)).toBe(0);
    expect(jaccard(a.hashes, a.hashes)).toBe(100);
  });

  test('half a copied essay inside a longer one scores high for the copy', () => {
    const copied = ESSAY.split(' ').slice(0, 45).join(' ');
    const mixed = `${copied} ${OTHER}`;
    const a = fingerprint(ESSAY)!;
    const m = fingerprint(mixed)!;
    const ofMixed = containment(m.hashes, a.hashes);
    expect(ofMixed).toBeGreaterThan(20);
    expect(ofMixed).toBeLessThan(80);
  });
});

describe('highlight', () => {
  test('marks the shared passage in both texts', () => {
    const shared = 'the delta needs fresh mud from upstream every single year';
    const a = `My opinion is simple. ${shared}. That is all I think.`;
    const b = `Other words come first here, ${shared}, and then more.`;
    const { left, right } = highlight(a, b);
    const marked = (s: { text: string; match: boolean }[]) =>
      s.filter((x) => x.match).map((x) => x.text).join('');
    expect(normalise(marked(left))).toBe(normalise(shared));
    expect(normalise(marked(right))).toBe(normalise(shared));
    expect(left.map((s) => s.text).join('')).toBe(a);
    expect(right.map((s) => s.text).join('')).toBe(b);
  });

  test('shared instructions are not highlighted', () => {
    const prompt = 'describe how rivers shape the land around them';
    const { left } = highlight(`${prompt} mine first`, `${prompt} yours instead`, [prompt]);
    expect(left.some((s) => s.match)).toBe(false);
  });
});
