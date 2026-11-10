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

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
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

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redact(
  text: string,
  people: { student?: PersonNames | null; others?: PersonNames[] } = {},
): string {
  let out = text.replace(EMAIL, EMAIL_PLACEHOLDER).replace(PHONE, '[number]');
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
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
}
