import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/**
 * Custom headers: extra `name: value` pairs a webhook sends with every
 * delivery, for receivers that expect a key of theirs
 * (`Authorization: Bearer ...`, `X-API-Key: ...`). Set like environment
 * variables: the values are write-only (stored encrypted, never returned,
 * never audited). The same rules are in frontend/lib/webhooks.ts.
 */

export const MAX_HEADERS = 20;
export const MAX_HEADER_NAME = 100;
export const MAX_HEADER_VALUE = 4096;

/** Letters, digits and `-` (a subset of the HTTP token characters). */
const NAME = /^[A-Za-z0-9-]+$/;
/** Printable ASCII and tabs: no CR/LF (header injection) or other control characters. */
const VALUE = /^[\t\x20-\x7e]+$/;

/** Headers GradeBook sets itself, or that the HTTP client owns. Compared lower-cased. */
const RESERVED = new Set(['content-type', 'content-length', 'host', 'user-agent', 'transfer-encoding', 'connection']);
const RESERVED_PREFIX = 'x-gradebook-';

/** Shown in place of a header value anywhere it could otherwise appear. */
export const REDACTED = '[redacted]';

/** One header in a create / update body: the full desired list. */
export interface WebhookHeaderInput {
  /** An existing header's id: keep (no value) or replace (value) it; may be renamed. */
  id?: string;
  name: string;
  /** Required for a new header; blank or missing keeps a saved one's value. */
  value?: string;
}

/** A stored header (the value is ciphertext). */
export interface StoredHeader {
  id: string;
  name: string;
  value_enc: string;
}

/** Why a header name can't be used, or null. */
export function headerNameProblem(raw: string): string | null {
  const name = raw.trim();
  if (!name) return 'Enter a header name';
  if (name.length > MAX_HEADER_NAME) return `A header name can be at most ${MAX_HEADER_NAME} characters`;
  if (!NAME.test(name)) return `"${name}" is not a valid header name: use letters, digits and -`;
  const lower = name.toLowerCase();
  if (RESERVED.has(lower) || lower.startsWith(RESERVED_PREFIX)) {
    return `${name} is set by GradeBook and can't be replaced`;
  }
  return null;
}

/** Why a header value can't be used, or null. */
export function headerValueProblem(name: string, value: string): string | null {
  if (!value) return `Enter a value for ${name}`;
  if (value.length > MAX_HEADER_VALUE) return `The value of ${name} can be at most ${MAX_HEADER_VALUE} characters`;
  if (!VALUE.test(value)) {
    return `The value of ${name} can only use printable ASCII characters (no line breaks)`;
  }
  return null;
}

/** What changed, by name only: never a value. Empty lists are left out. */
export interface HeaderAuditChanges {
  added?: string[];
  removed?: string[];
  renamed?: { before: string; after: string }[];
  valueChanged?: string[];
}

export interface HeaderPlan {
  /** New headers, with a fresh id (the value's AAD is bound to it). */
  create: { id: string; name: string; value: string }[];
  /** Existing headers renamed and/or given a new value. */
  update: { id: string; name?: string; value?: string }[];
  /** Ids of existing headers missing from the list. */
  remove: string[];
  changes: HeaderAuditChanges;
}

/**
 * The full desired list against what is stored: which headers to create,
 * change and delete. Throws 400 for a bad name or value, a duplicate name
 * (ignoring case), an unknown id, a new header without a value or more than
 * MAX_HEADERS.
 */
export function planHeaders(existing: StoredHeader[], input: WebhookHeaderInput[]): HeaderPlan {
  if (input.length > MAX_HEADERS) {
    throw new BadRequestException(`A webhook can have at most ${MAX_HEADERS} headers`);
  }
  const byId = new Map(existing.map((h) => [h.id, h]));
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  const plan: HeaderPlan = { create: [], update: [], remove: [], changes: {} };
  const added: string[] = [];
  const renamed: { before: string; after: string }[] = [];
  const valueChanged: string[] = [];

  for (const h of input) {
    const name = (h.name ?? '').trim();
    const nameProblem = headerNameProblem(name);
    if (nameProblem) throw new BadRequestException(nameProblem);
    const lower = name.toLowerCase();
    if (seenNames.has(lower)) throw new BadRequestException(`${name} is listed twice`);
    seenNames.add(lower);
    const value = h.value ?? '';
    if (value) {
      const valueProblem = headerValueProblem(name, value);
      if (valueProblem) throw new BadRequestException(valueProblem);
    }

    if (h.id === undefined || h.id === null) {
      if (!value) throw new BadRequestException(`Enter a value for ${name}`);
      plan.create.push({ id: randomUUID(), name, value });
      added.push(name);
      continue;
    }
    const before = byId.get(h.id);
    if (!before) throw new BadRequestException(`Unknown header for ${name}: reload and try again`);
    if (seenIds.has(h.id)) throw new BadRequestException(`${name} is listed twice`);
    seenIds.add(h.id);
    const change: HeaderPlan['update'][number] = { id: h.id };
    if (name !== before.name) {
      change.name = name;
      renamed.push({ before: before.name, after: name });
    }
    if (value) {
      change.value = value;
      valueChanged.push(name);
    }
    if (change.name !== undefined || change.value !== undefined) plan.update.push(change);
  }

  const removed = existing.filter((h) => !seenIds.has(h.id));
  plan.remove = removed.map((h) => h.id);
  if (added.length) plan.changes.added = added;
  if (removed.length) plan.changes.removed = removed.map((h) => h.name);
  if (renamed.length) plan.changes.renamed = renamed;
  if (valueChanged.length) plan.changes.valueChanged = valueChanged;
  return plan;
}

export const headerPlanIsEmpty = (p: HeaderPlan) =>
  p.create.length === 0 && p.update.length === 0 && p.remove.length === 0;

/**
 * `text` with every header value of 4 or more characters replaced by
 * `[redacted]` (shorter ones would mangle unrelated text): for what the
 * receiver answered and error messages, which are stored and shown to admins
 * (a receiver that echoes its request headers back would otherwise leak them).
 */
export function redactValues(text: string | null, values: readonly string[]): string | null {
  if (!text) return text;
  let out = text;
  // Longest first, so a value containing another is replaced whole.
  for (const v of [...values].filter((x) => x.length >= 4).sort((a, b) => b.length - a.length)) {
    out = out.split(v).join(REDACTED);
  }
  return out;
}
