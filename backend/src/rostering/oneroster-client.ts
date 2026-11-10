/**
 * OneRoster 1.2 REST (rostering service) with OAuth2 client credentials.
 *
 * Every request goes through the webhook sender's `safeWebhookFetch`: the
 * host is resolved per request and private, loopback and reserved addresses
 * are refused (unless WEBHOOK_ALLOW_PRIVATE=true, the same self-hosting
 * switch as webhooks), the checked IP is pinned to the connection, and
 * redirects are never followed. https is required unless that switch is on.
 * Collections are paged with limit/offset; 429 and 5xx are retried with
 * backoff (Retry-After honoured, capped); bodies are size-capped.
 */
import { safeWebhookFetch, type FetchLike } from '@/integrations/delivery/webhook-sender';
import { cleanDate, cleanEmail, enrolmentRole, sessionType, userKind } from './roster-csv';
import { emptySnapshot, type RosterSnapshot } from './roster-types';
import { trimTrailingSlashes } from '@/common/trim-slashes';

export const ONEROSTER_PAGE_SIZE = 100;
/** Most pages read per collection (a runaway server cannot loop forever). */
export const ONEROSTER_MAX_PAGES = 2000;
export const ONEROSTER_TIMEOUT_MS = 30_000;
export const ONEROSTER_MAX_BODY_BYTES = 20 * 1024 * 1024;
export const ONEROSTER_MAX_RETRIES = 5;
export const ONEROSTER_DEFAULT_SCOPE =
  'https://purl.imsglobal.org/spec/or/v1p2/scope/roster-core.readonly';

export interface OneRosterConfig {
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string | null;
}

export class OneRosterError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    /** False for refusals a retry cannot fix (a private destination, a bad URL). */
    readonly retryable = true,
  ) {
    super(message);
  }
}

/** Refuses non-http(s) URLs, credentials in URLs, and plain http unless private destinations are allowed. */
export function checkEndpointUrl(raw: string, what = 'URL'): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OneRosterError(`The ${what} is not a valid URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new OneRosterError(`The ${what} must use https`);
  }
  if (url.protocol === 'http:' && process.env.WEBHOOK_ALLOW_PRIVATE !== 'true') {
    throw new OneRosterError(`The ${what} must use https`);
  }
  if (url.username || url.password) {
    throw new OneRosterError(`The ${what} must not contain a user name or password`);
  }
  return url;
}

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export interface ClientDeps {
  fetch?: FetchLike;
  sleep?: Sleep;
  /** Minimum gap between requests (gentle on the SIS). */
  minIntervalMs?: number;
}

export class OneRosterClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: Sleep;
  private readonly minInterval: number;
  private lastRequest = 0;
  /** Requests made (tests, logs). */
  requests = 0;

  constructor(
    private readonly config: OneRosterConfig,
    deps: ClientDeps = {},
  ) {
    this.fetchImpl = deps.fetch ?? safeWebhookFetch;
    this.sleep = deps.sleep ?? realSleep;
    this.minInterval = deps.minIntervalMs ?? 100;
    checkEndpointUrl(config.baseUrl, 'endpoint URL');
    checkEndpointUrl(config.tokenUrl, 'token URL');
  }

  private async send(url: string, init: RequestInit): Promise<{ status: number; headers: Headers; body: string }> {
    const wait = this.lastRequest + this.minInterval - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequest = Date.now();
    this.requests++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ONEROSTER_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(url, { ...init, redirect: 'manual', signal: controller.signal });
      const body = await readCapped(res, ONEROSTER_MAX_BODY_BYTES);
      return { status: res.status, headers: res.headers, body };
    } catch (err) {
      if (controller.signal.aborted) throw new OneRosterError(`Timed out after ${ONEROSTER_TIMEOUT_MS / 1000} s`);
      const message = (err as Error).message;
      // The SSRF guard's refusal: retrying cannot change where the host points to.
      const refused = /private or reserved address|must use HTTP|did not resolve/.test(message);
      throw new OneRosterError(message, null, !refused);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Retries 429 / 5xx / network errors with backoff; other statuses return. */
  private async withRetry(url: string, init: () => RequestInit) {
    let attempt = 0;
    for (;;) {
      let res: Awaited<ReturnType<OneRosterClient['send']>> | null = null;
      let error: Error | null = null;
      try {
        res = await this.send(url, init());
      } catch (err) {
        error = err as Error;
      }
      if (error instanceof OneRosterError && !error.retryable) throw error;
      const retryable = error !== null || res!.status === 429 || res!.status >= 500;
      if (!retryable) return res!;
      if (attempt >= ONEROSTER_MAX_RETRIES) {
        if (error) throw error;
        throw new OneRosterError(`HTTP ${res!.status} from the OneRoster server`, res!.status);
      }
      const retryAfter = Number(res?.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 60_000)
        : Math.min(1000 * 2 ** attempt, 30_000);
      attempt++;
      await this.sleep(delay);
    }
  }

  async accessToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const form = new URLSearchParams({ grant_type: 'client_credentials' });
    form.set('scope', this.config.scope || ONEROSTER_DEFAULT_SCOPE);
    const basic = Buffer.from(
      `${encodeURIComponent(this.config.clientId)}:${encodeURIComponent(this.config.clientSecret)}`,
    ).toString('base64');
    const res = await this.withRetry(this.config.tokenUrl, () => ({
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
    }));
    if (res.status >= 300 && res.status < 400) {
      throw new OneRosterError('The token URL redirects; use the final URL', res.status);
    }
    if (res.status !== 200) {
      throw new OneRosterError(
        res.status === 400 || res.status === 401
          ? 'The OneRoster server refused the client ID or secret'
          : `Token request failed (HTTP ${res.status})`,
        res.status,
      );
    }
    let json: { access_token?: unknown; expires_in?: unknown };
    try {
      json = JSON.parse(res.body);
    } catch {
      throw new OneRosterError('The token response is not JSON');
    }
    if (typeof json.access_token !== 'string' || !json.access_token) {
      throw new OneRosterError('The token response has no access_token');
    }
    const ttl = typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 3600;
    this.token = { value: json.access_token, expiresAt: Date.now() + ttl * 1000 };
    return json.access_token;
  }

  private collectionUrl(path: string, offset: number): string {
    const base = trimTrailingSlashes(this.config.baseUrl);
    const url = new URL(`${base}/${path}`);
    url.searchParams.set('limit', String(ONEROSTER_PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    return url.toString();
  }

  /** Every record of a collection, page by page. */
  async collection(path: string, key: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    let refreshed = false;
    for (let page = 0; page < ONEROSTER_MAX_PAGES; page++) {
      const url = this.collectionUrl(path, page * ONEROSTER_PAGE_SIZE);
      let token = await this.accessToken();
      let res = await this.withRetry(url, () => ({
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      }));
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        token = await this.accessToken(true);
        res = await this.withRetry(url, () => ({
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }));
      }
      if (res.status >= 300 && res.status < 400) {
        throw new OneRosterError(`${path}: the server redirects; use the final endpoint URL`, res.status);
      }
      if (res.status !== 200) throw new OneRosterError(`${path}: HTTP ${res.status}`, res.status);
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(res.body);
      } catch {
        throw new OneRosterError(`${path}: the response is not JSON`);
      }
      const items = json[key];
      if (!Array.isArray(items)) throw new OneRosterError(`${path}: the response has no "${key}" list`);
      out.push(...(items as Record<string, unknown>[]));
      const total = Number(res.headers.get('x-total-count'));
      if (items.length < ONEROSTER_PAGE_SIZE) return out;
      if (Number.isFinite(total) && total > 0 && out.length >= total) return out;
    }
    throw new OneRosterError(`${path}: more than ${ONEROSTER_MAX_PAGES} pages`);
  }

  /** "Test connection": a token and one page of orgs. */
  async test(): Promise<{ orgs: number }> {
    await this.accessToken(true);
    const base = trimTrailingSlashes(this.config.baseUrl);
    const url = new URL(`${base}/orgs`);
    url.searchParams.set('limit', '1');
    const token = await this.accessToken();
    const res = await this.withRetry(url.toString(), () => ({
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }));
    if (res.status !== 200) throw new OneRosterError(`orgs: HTTP ${res.status}`, res.status);
    try {
      const json = JSON.parse(res.body) as { orgs?: unknown[] };
      return { orgs: Array.isArray(json.orgs) ? json.orgs.length : 0 };
    } catch {
      throw new OneRosterError('orgs: the response is not JSON');
    }
  }

  async snapshot(): Promise<RosterSnapshot> {
    const [orgs, sessions, users, classes, enrollments] = [
      await this.collection('orgs', 'orgs'),
      await this.collection('academicSessions', 'academicSessions'),
      await this.collection('users', 'users'),
      await this.collection('classes', 'classes'),
      await this.collection('enrollments', 'enrollments'),
    ];
    return fromJson({ orgs, sessions, users, classes, enrollments });
  }
}

async function readCapped(res: Response, limit: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    size += value.byteLength;
    if (size > limit) {
      void reader.cancel().catch(() => undefined);
      throw new OneRosterError('The OneRoster response is too large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const ref = (v: unknown) => (v && typeof v === 'object' ? str((v as { sourcedId?: unknown }).sourcedId) : '');
const refs = (v: unknown) => (Array.isArray(v) ? v.map(ref).filter(Boolean) : []);
const isDeleted = (r: Record<string, unknown>) => str(r.status).toLowerCase() === 'tobedeleted';

/** OneRoster JSON (1.1 or 1.2 shapes) -> snapshot. */
export function fromJson(input: {
  orgs: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  users: Record<string, unknown>[];
  classes: Record<string, unknown>[];
  enrollments: Record<string, unknown>[];
}): RosterSnapshot {
  const snap = emptySnapshot();
  snap.present = ['orgs', 'sessions', 'students', 'staff', 'classes', 'enrollments'];
  const err = (file: string, id: string, message: string) =>
    snap.errors.push({ file, line: null, sourcedId: id || null, message });

  for (const o of input.orgs) {
    const id = str(o.sourcedId);
    if (!id || isDeleted(o)) continue;
    snap.orgs.push({ sourcedId: id, name: str(o.name) || id, type: str(o.type) || null, identifier: str(o.identifier) || null });
  }
  for (const s of input.sessions) {
    const id = str(s.sourcedId);
    if (!id || isDeleted(s)) continue;
    const type = sessionType(str(s.type));
    const start = cleanDate(str(s.startDate));
    const end = cleanDate(str(s.endDate));
    if (!type || start === undefined || end === undefined || !str(s.title)) {
      err('academicSessions', id, 'Session has no title, an unknown type or a bad date');
      continue;
    }
    snap.sessions.push({
      sourcedId: id,
      title: str(s.title),
      type,
      startDate: start,
      endDate: end,
      parentSourcedId: ref(s.parent) || null,
      schoolYear: str(s.schoolYear) || null,
    });
  }
  for (const u of input.users) {
    const id = str(u.sourcedId);
    if (!id || isDeleted(u)) continue;
    if (u.enabledUser === false || str(u.enabledUser).toLowerCase() === 'false') continue;
    // 1.2: roles[{ role, org }]; 1.1: role + orgs[].
    let kind = userKind(str(u.role));
    let orgIds = refs(u.orgs);
    if (Array.isArray(u.roles)) {
      for (const r of u.roles as Record<string, unknown>[]) {
        const k = userKind(str(r.role));
        if (k && (kind === null || k === 'student')) kind = k;
        const org = ref(r.org);
        if (org && !orgIds.includes(org)) orgIds.push(org);
      }
    }
    if (!kind) continue;
    if (orgIds.length === 0 && ref(u.primaryOrg)) orgIds = [ref(u.primaryOrg)];
    const email = cleanEmail(str(u.email));
    const dob = cleanDate(str(u.birthDate));
    if (email === undefined || orgIds.length === 0 || (!str(u.givenName) && !str(u.familyName))) {
      err('users', id, email === undefined ? `email "${str(u.email)}" is not an email address` : 'The person has no name or no org');
      continue;
    }
    snap.users.push({
      sourcedId: id,
      kind,
      givenName: str(u.preferredFirstName) || str(u.givenName),
      familyName: str(u.preferredLastName) || str(u.familyName),
      email,
      identifier: str(u.identifier) || null,
      dateOfBirth: dob ?? null,
      orgSourcedIds: orgIds,
    });
  }
  for (const c of input.classes) {
    const id = str(c.sourcedId);
    if (!id || isDeleted(c)) continue;
    const school = ref(c.school);
    if (!str(c.title) || !school) {
      err('classes', id, 'Class has no title or school');
      continue;
    }
    snap.classes.push({
      sourcedId: id,
      title: str(c.title).slice(0, 200),
      classCode: str(c.classCode) || null,
      schoolSourcedId: school,
      termSourcedIds: refs(c.terms),
    });
  }
  for (const e of input.enrollments) {
    const id = str(e.sourcedId);
    if (!id || isDeleted(e)) continue;
    const role = enrolmentRole(str(e.role));
    const cls = ref(e.class);
    const user = ref(e.user);
    if (!cls || !user) {
      err('enrollments', id, 'Enrolment has no class or user');
      continue;
    }
    if (!role) continue;
    snap.enrollments.push({ sourcedId: id, classSourcedId: cls, userSourcedId: user, role });
  }
  return snap;
}
