/**
 * Removes student-identifying text before anything is sent to an AI
 * provider: email addresses always, and the names given (the student whose
 * work it is becomes `[Student]`, anyone else listed `[Classmate]`).
 * Matching is case-insensitive on whole words, longest names first, so
 * "Ann Lee" is replaced before "Ann". Single letters are ignored.
 */
export const STUDENT_PLACEHOLDER = '[Student]';
export const CLASSMATE_PLACEHOLDER = '[Classmate]';
export const EMAIL_PLACEHOLDER = '[email]';

// Phone-like runs of 9+ digits (with spaces, dots, dashes or a leading +).
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;

export interface PersonNames {
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
}

/** Every way a person's name might appear: full, first, last, preferred. */
export function nameVariants(p: PersonNames): string[] {
  const first = p.first_name?.trim() ?? '';
  const last = p.last_name?.trim() ?? '';
  const preferred = p.preferred_name?.trim() ?? '';
  return [
    [first, last].filter(Boolean).join(' '),
    [preferred, last].filter(Boolean).join(' '),
    first,
    last,
    preferred,
  ].filter((n) => n.length >= 2);
}

const LOCAL_CHAR = /[A-Za-z0-9._%+-]/;
const DOMAIN_CHAR = /[A-Za-z0-9.-]/;

/**
 * Replaces email addresses with EMAIL_PLACEHOLDER in linear time. Scans out
 * from each '@' (instead of a backtracking regex, which CodeQL flags as
 * polynomial on runs like '%%%%'): the local part and domain stop at the
 * next '@', so every character is visited a bounded number of times.
 */
export function redactEmails(text: string): string {
  let out = '';
  let copied = 0;
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    let start = at;
    while (start > copied && LOCAL_CHAR.test(text[start - 1])) start--;
    let end = at + 1;
    while (end < text.length && DOMAIN_CHAR.test(text[end])) end++;
    // Domain must end in ".<2+ letters>"; trim a trailing dot/hyphen run.
    let domainEnd = end;
    while (domainEnd > at + 1 && (text[domainEnd - 1] === '.' || text[domainEnd - 1] === '-')) domainEnd--;
    const domain = text.slice(at + 1, domainEnd);
    const dot = domain.lastIndexOf('.');
    const tld = dot === -1 ? '' : domain.slice(dot + 1);
    if (start === at || dot <= 0 || tld.length < 2 || !/^[A-Za-z]+$/.test(tld)) continue;
    out += text.slice(copied, start) + EMAIL_PLACEHOLDER;
    copied = at + 1 + domain.length;
    at = copied - 1;
  }
  return out + text.slice(copied);
}

/** `value` without trailing characters from `chars`, in linear time. */
export function trimTrailing(value: string, chars: string): string {
  let end = value.length;
  while (end > 0 && chars.includes(value[end - 1])) end--;
  return value.slice(0, end);
}

/**
 * Removes HTML-like tags without a regex: a '<' followed by a letter, '/',
 * '!' or '?' starts a tag that runs to the next '>' (or the end). Repeated
 * until nothing changes, so pieces left around a removed tag cannot join into
 * a new one ('<<script>script>' -> '<script>' -> ''). Each pass is linear
 * and strictly shortens the text.
 */
export function stripTags(text: string): string {
  let current = text;
  for (;;) {
    let out = '';
    let i = 0;
    while (i < current.length) {
      const ch = current[i];
      const next = current[i + 1];
      if (ch === '<' && next !== undefined && /[A-Za-z/!?]/.test(next)) {
        const close = current.indexOf('>', i + 1);
        i = close === -1 ? current.length : close + 1;
        continue;
      }
      out += ch;
      i++;
    }
    if (out === current) return out;
    current = out;
  }
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redact(
  text: string,
  people: { student?: PersonNames | null; others?: PersonNames[] } = {},
): string {
  let out = redactEmails(text).replace(PHONE, '[number]');
  const pairs: [string, string][] = [];
  if (people.student) for (const n of nameVariants(people.student)) pairs.push([n, STUDENT_PLACEHOLDER]);
  for (const o of people.others ?? []) for (const n of nameVariants(o)) pairs.push([n, CLASSMATE_PLACEHOLDER]);
  // Longest first; the student's own names win over a classmate sharing them.
  const seen = new Set<string>();
  const ordered = pairs
    .sort((a, b) => b[0].length - a[0].length)
    .filter(([n]) => {
      const k = n.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  for (const [name, placeholder] of ordered) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'giu');
    out = out.replace(re, placeholder);
  }
  return out;
}

/**
 * Model text made safe to show and to insert into Markdown: no HTML tags,
 * images become their alt text and links their label (an inserted page must
 * never load or point at something the model chose), control characters go.
 */
export function plainText(text: string): string {
  return stripTags(text)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
}

const URL_IN_TEXT = /https?:\/\/[^\s<>()[\]"']+/gi;
const TRAILING_PUNCTUATION = '.,;:!?';

/** The http(s) URLs a teacher typed or pasted, so a draft may keep links to them (and only them). */
export function suppliedUrls(...texts: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const m of (t ?? '').matchAll(URL_IN_TEXT)) out.add(trimTrailing(m[0], TRAILING_PUNCTUATION));
  return out;
}

/**
 * Model Markdown made safe to insert into a page, instructions or an
 * announcement: no HTML (tags removed), no images and no links unless the
 * teacher supplied that exact URL (otherwise an image becomes its alt text,
 * a link its label, a bare URL is dropped), no control characters. Markdown
 * structure (headings, lists, emphasis, tables, line breaks) is kept.
 */
export function safeMarkdown(text: string, allowed: Set<string> = new Set()): string {
  const ok = (url: string) => allowed.has(trimTrailing(url.trim(), TRAILING_PUNCTUATION));
  return (
    stripTags(text.replace(/\r\n?/g, '\n'))
      .replace(/!\[([^\]]*)\]\(([^)\s]*)(?:\s[^)]*)?\)/g, (all, alt: string, url: string) => (ok(url) ? all : alt))
      .replace(/\[([^\]]*)\]\(([^)\s]*)(?:\s[^)]*)?\)/g, (all, label: string, url: string) => (ok(url) ? all : label))
      // Reference-style link definitions: dropped unless supplied.
      .replace(/^\s*\[[^\]]+\]:\s*(\S+).*$/gm, (all, url: string) => (ok(url) ? all : ''))
      // Bare URLs (autolinked by the renderer) the teacher did not give.
      .replace(URL_IN_TEXT, (url, offset: number, whole: string) => {
        // Part of a kept [label](url): leave it.
        if (whole[offset - 1] === '(' && whole[offset - 2] === ']') return url;
        return ok(url) ? url : '';
      })
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
