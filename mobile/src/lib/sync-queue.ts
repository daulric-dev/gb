/**
 * Drafts made without a signal, and the queue that sends them when the app is
 * back online. Pure logic, no React Native: the app persists the queue as a
 * file (`offline-store.ts`) and sends through the API (`offline-sync.ts`).
 *
 * Two kinds of draft:
 *
 * - `quiz_answers`: the answers of a running quiz attempt. They are queued and
 *   sent with the existing save endpoint (POST .../quiz/answers), which
 *   replaces the attempt's saved answers as a whole. One item per quiz: a
 *   newer snapshot replaces the queued one (new idempotency key, same place
 *   in the queue, same base version). Retries of one snapshot reuse its key.
 * - `assignment_text`: the text of an assignment. The API has no "save draft"
 *   endpoint for assignments, only the final hand-in, so this draft stays on
 *   the device until the student hands in online. The queue never sends it;
 *   it only watches its deadline.
 *
 * Rules (see `run`):
 * - Strict order: items go oldest first; one that must wait (no network,
 *   server error) holds back the ones behind it.
 * - A draft whose deadline passed (the attempt's quiz_expires_at, else the
 *   work's close date: extension, else late-until, else due date) is never
 *   sent. It "needs attention" with reason `expired` / `closed`, and stays on
 *   the device for the student to view and copy.
 * - Conflict: before sending, the server copy is read again. If it is no
 *   longer the version the draft started from (changed on another device), the
 *   draft is not sent; it needs attention with reason `conflict` and both
 *   copies are kept until the student chooses.
 * - Final hand-ins (submit quiz, hand in assignment) are never queued: they
 *   use up an attempt and are not idempotent, so they need a connection.
 */

export type DraftKind = "quiz_answers" | "assignment_text";

export type DraftState =
  /** Saved on this device, waiting to be sent (or, for text, to be handed in). */
  | "saved_offline"
  | "syncing"
  | "synced"
  | "needs_attention";

export type AttentionReason =
  /** The quiz attempt's time ran out before the draft could be sent. */
  | "expired"
  /** The work closed (due / late-until / extension) before it could be sent. */
  | "closed"
  /** The server copy changed since the draft was based on it. */
  | "conflict"
  /** The server refused the save for another reason. */
  | "rejected";

export interface QueuedDraft {
  id: string;
  /** The account (scope key) the draft belongs to. */
  scope: string;
  activityId: string;
  kind: DraftKind;
  /** What the save endpoint takes (quiz: `{ answers }`; text: the text). */
  payload: unknown;
  /** The screen's own state, to put the draft back on screen. */
  draft: unknown;
  /** The server version the draft was started from (see `answersVersion`). */
  baseVersion: string | null;
  /** The quiz attempt the answers belong to. */
  attemptStartedAt: string | null;
  quizExpiresAt: string | null;
  /** The student's close date: extension, else late-until, else due date. */
  closesAt: string | null;
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  nextAttemptAt: number;
  state: DraftState;
  reason?: AttentionReason;
  /** The server's message, for `rejected` / `closed`. */
  message?: string;
  /** Version of the server copy after a successful send. */
  syncedVersion?: string | null;
  syncedAt?: number;
}

export interface QueueStore {
  load(): QueuedDraft[];
  save(items: QueuedDraft[]): void;
}

export class MemoryQueueStore implements QueueStore {
  items: QueuedDraft[] = [];
  load() {
    return this.items.map((i) => ({ ...i }));
  }
  save(items: QueuedDraft[]) {
    this.items = items.map((i) => ({ ...i }));
  }
}

// ── deadlines ───────────────────────────────────────────────────────────────

/**
 * When work closes to this student: their extension when they have one (it
 * wins outright), else the late-until date, else the due date. Mirrors the
 * API's `effectiveCloseAt`.
 */
export function closesAtFor(work: {
  dueAt: string | null;
  effectiveDueAt?: string | null;
  hasExtension?: boolean;
  lateUntil?: string | null;
}): string | null {
  const due =
    work.effectiveDueAt !== undefined ? work.effectiveDueAt : work.dueAt;
  if (work.hasExtension) return due;
  return work.lateUntil ?? due;
}

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * Why this draft can no longer be sent, or null while it still can. A quiz
 * attempt runs to its own expiry (a timed attempt may run past the due date);
 * one without an expiry ends at the close date. Text closes at the close date.
 */
export function deadlineReason(
  item: Pick<QueuedDraft, "kind" | "quizExpiresAt" | "closesAt">,
  now: number,
): "expired" | "closed" | null {
  if (item.kind === "quiz_answers") {
    const expires = time(item.quizExpiresAt);
    if (expires !== null) return expires <= now ? "expired" : null;
  }
  const closes = time(item.closesAt);
  return closes !== null && closes <= now ? "closed" : null;
}

// ── versions ────────────────────────────────────────────────────────────────

export interface AnswerLike {
  questionId: string;
  optionId?: string | null;
  optionIds?: string[] | null;
  matches?:
    | Record<string, string>
    | { optionId: string; label: string }[]
    | null;
  text?: string | null;
  numeric?: number | null;
  fileId?: string | null;
}

/** One answer in a fixed shape, so the server's copy and ours compare equal. */
function normalAnswer(a: AnswerLike) {
  const matches = Array.isArray(a.matches)
    ? Object.fromEntries(a.matches.map((m) => [m.optionId, m.label.trim()]))
    : a.matches && typeof a.matches === "object"
      ? Object.fromEntries(
          Object.entries(a.matches).map(([k, v]) => [k, String(v).trim()]),
        )
      : null;
  const sortedMatches = matches
    ? Object.keys(matches)
        .sort()
        .filter((k) => matches[k])
        .map((k) => [k, matches[k]])
    : null;
  return [
    a.questionId,
    a.optionId ?? null,
    a.optionIds && a.optionIds.length ? a.optionIds : null,
    sortedMatches && sortedMatches.length ? sortedMatches : null,
    typeof a.text === "string" && a.text.trim() ? a.text.trim() : null,
    typeof a.numeric === "number" ? a.numeric : null,
    a.fileId ?? null,
  ];
}

/**
 * The version of a quiz attempt's saved answers: the attempt it belongs to
 * plus its content, in a fixed order. The portal does not send the
 * submission's updated_at, and comparing content gives the same answer for
 * "did someone change it" without counting this device's own saves as a
 * change.
 */
export function answersVersion(
  attemptStartedAt: string | null,
  answers: AnswerLike[],
): string {
  const rows = answers
    .map(normalAnswer)
    .filter((row) => row.slice(1).some((v) => v !== null))
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return `quiz:${attemptStartedAt ?? "-"}:${JSON.stringify(rows)}`;
}

/** The version of an assignment's server copy: its status and text. */
export function textVersion(
  submission: { status: string; textBody: string | null } | null,
): string {
  if (!submission) return "text:none";
  return `text:${submission.status}:${JSON.stringify(submission.textBody ?? "")}`;
}

/** True when the server copy moved on since the draft was based on it. */
export function hasConflict(
  item: Pick<QueuedDraft, "baseVersion">,
  serverVersion: string | null,
): boolean {
  if (item.baseVersion === null || serverVersion === null) return false;
  return item.baseVersion !== serverVersion;
}

// ── retry ───────────────────────────────────────────────────────────────────

/** 2s, 4s, 8s ... capped at 5 minutes. */
export function backoffMs(attempts: number): number {
  const n = Math.max(0, attempts - 1);
  return Math.min(2_000 * 2 ** Math.min(n, 20), 5 * 60_000);
}

export type FailureKind =
  /** No answer, a server error or rate limit: try again later. */
  | "retry"
  /** Signed out: stop and wait for the student to sign in. */
  | "signed_out"
  /** 409: past the deadline, time up, or the attempt is gone. */
  | "closed"
  /** Any other refusal: needs the student. */
  | "rejected";

export function classifyFailure(error: unknown): FailureKind {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number" || status === 0) return "retry";
  if (status === 401) return "signed_out";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  if (status === 409) return "closed";
  return "rejected";
}

// ── the queue ───────────────────────────────────────────────────────────────

export interface EnqueueInput {
  scope: string;
  activityId: string;
  kind: DraftKind;
  payload: unknown;
  draft: unknown;
  baseVersion: string | null;
  attemptStartedAt?: string | null;
  quizExpiresAt?: string | null;
  closesAt?: string | null;
}

/** What the server says about a quiz before a queued save is sent. */
export interface ServerState {
  version: string | null;
  /** The running attempt's start, or null when no attempt is running. */
  attemptStartedAt: string | null;
  quizExpiresAt: string | null;
  closesAt: string | null;
}

export interface RunDeps {
  /** Read the server copy (for conflicts and changed deadlines). */
  current(item: QueuedDraft): Promise<ServerState>;
  /** Send the save with the item's idempotency key; resolves the new version. */
  send(item: QueuedDraft): Promise<{ version: string | null }>;
}

export interface RunResult {
  synced: string[];
  attention: string[];
  /** Still waiting (offline / server error). */
  waiting: number;
  /** When to try again, if anything is waiting. */
  retryAt: number | null;
  /** The session ended; nothing more was tried. */
  signedOut: boolean;
}

/** Synced items are kept briefly so screens can say "Synced". */
const SYNCED_TTL_MS = 60 * 60_000;

export interface SyncQueueOptions {
  now?: () => number;
  newId?: () => string;
}

export function randomId(): string {
  const bytes = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class SyncQueue {
  private items: QueuedDraft[] | null = null;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly listeners = new Set<() => void>();
  private running: Promise<RunResult> | null = null;

  constructor(
    private readonly store: QueueStore,
    options: SyncQueueOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? randomId;
  }

  private all(): QueuedDraft[] {
    if (!this.items) {
      try {
        this.items = this.store.load();
      } catch {
        this.items = [];
      }
      // An app killed mid-send left items "syncing": they go again.
      for (const item of this.items) {
        if (item.state === "syncing") item.state = "saved_offline";
      }
    }
    return this.items;
  }

  private persist() {
    this.store.save(this.all());
    for (const listener of this.listeners) listener();
  }

  /** Called whenever the queue changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(scope: string): QueuedDraft[] {
    return this.all()
      .filter((i) => i.scope === scope)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  get(
    scope: string,
    activityId: string,
    kind?: DraftKind,
  ): QueuedDraft | null {
    return (
      this.all().find(
        (i) =>
          i.scope === scope &&
          i.activityId === activityId &&
          (kind === undefined || i.kind === kind),
      ) ?? null
    );
  }

  /** Items not yet on the server (or not yet handed in), for warnings. */
  unsent(scope?: string): QueuedDraft[] {
    return this.all().filter(
      (i) =>
        (scope === undefined || i.scope === scope) && i.state !== "synced",
    );
  }

  /**
   * Save a draft. Replaces the queued draft for the same work (keeping its
   * place and its base version) with a fresh idempotency key: a new snapshot
   * is a new save. Deadlines are re-checked when the queue runs.
   */
  enqueue(input: EnqueueInput): QueuedDraft {
    const now = this.now();
    const items = this.all();
    const existing = items.find(
      (i) =>
        i.scope === input.scope &&
        i.activityId === input.activityId &&
        i.kind === input.kind,
    );
    if (existing && existing.state !== "synced") {
      // Another attempt's leftover: this is a fresh draft in its place.
      const newAttempt =
        existing.kind === "quiz_answers" &&
        existing.attemptStartedAt !== (input.attemptStartedAt ?? null);
      if (newAttempt) {
        existing.baseVersion = input.baseVersion;
        existing.state = "saved_offline";
        existing.reason = undefined;
      }
      existing.payload = input.payload;
      existing.draft = input.draft;
      existing.idempotencyKey = this.newId();
      existing.updatedAt = now;
      existing.quizExpiresAt = input.quizExpiresAt ?? existing.quizExpiresAt;
      existing.closesAt = input.closesAt ?? existing.closesAt;
      existing.attemptStartedAt =
        input.attemptStartedAt ?? existing.attemptStartedAt;
      // A conflict stays a conflict until the student picks a copy.
      if (existing.state !== "needs_attention" || existing.reason !== "conflict") {
        existing.state = "saved_offline";
        existing.reason = undefined;
        existing.message = undefined;
        existing.attempts = 0;
        existing.nextAttemptAt = now;
      }
      this.persist();
      return existing;
    }
    const item: QueuedDraft = {
      id: this.newId(),
      scope: input.scope,
      activityId: input.activityId,
      kind: input.kind,
      payload: input.payload,
      draft: input.draft,
      // The caller's base is the freshest (it tracks its own online saves);
      // without one, the next draft starts from what the queue last sent.
      baseVersion: input.baseVersion ?? existing?.syncedVersion ?? null,
      attemptStartedAt: input.attemptStartedAt ?? null,
      quizExpiresAt: input.quizExpiresAt ?? null,
      closesAt: input.closesAt ?? null,
      idempotencyKey: this.newId(),
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      nextAttemptAt: now,
      state: "saved_offline",
    };
    this.items = items.filter((i) => i !== existing).concat(item);
    this.persist();
    return item;
  }

  remove(scope: string, activityId: string, kind?: DraftKind): void {
    const before = this.all().length;
    this.items = this.all().filter(
      (i) =>
        !(
          i.scope === scope &&
          i.activityId === activityId &&
          (kind === undefined || i.kind === kind)
        ),
    );
    if (this.items.length !== before) this.persist();
  }

  /**
   * The student kept this device's copy after a conflict: it is now based on
   * the server's current version and goes again.
   */
  keepDeviceCopy(
    scope: string,
    activityId: string,
    kind: DraftKind,
    serverVersion: string | null,
  ): void {
    const item = this.get(scope, activityId, kind);
    if (!item) return;
    item.baseVersion = serverVersion;
    item.state = "saved_offline";
    item.reason = undefined;
    item.message = undefined;
    item.attempts = 0;
    item.nextAttemptAt = this.now();
    item.idempotencyKey = this.newId();
    this.persist();
  }

  /** Mark a draft as needing the student (used by screens, e.g. text conflicts). */
  flag(
    scope: string,
    activityId: string,
    kind: DraftKind,
    reason: AttentionReason,
    message?: string,
  ): void {
    const item = this.get(scope, activityId, kind);
    if (!item) return;
    if (item.state === "needs_attention" && item.reason === reason) return;
    item.state = "needs_attention";
    item.reason = reason;
    item.message = message;
    this.persist();
  }

  clearScope(scope: string): void {
    this.items = this.all().filter((i) => i.scope !== scope);
    this.persist();
  }

  clearAll(): void {
    this.items = [];
    this.persist();
  }

  /** Forget the in-memory copy (after the backing store was wiped). */
  reset(): void {
    this.items = null;
    for (const listener of this.listeners) listener();
  }

  /** Run the queue for one account; concurrent calls share one run. */
  run(scope: string, deps: RunDeps): Promise<RunResult> {
    if (!this.running) {
      this.running = this.runOnce(scope, deps).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async runOnce(scope: string, deps: RunDeps): Promise<RunResult> {
    const result: RunResult = {
      synced: [],
      attention: [],
      waiting: 0,
      retryAt: null,
      signedOut: false,
    };
    const now = this.now();
    // Old "synced" markers go.
    const fresh = this.all().filter(
      (i) => !(i.state === "synced" && now - (i.syncedAt ?? 0) > SYNCED_TTL_MS),
    );
    if (fresh.length !== this.all().length) {
      this.items = fresh;
      this.persist();
    }

    let blocked = false;
    for (const item of this.list(scope)) {
      if (item.state === "synced" || item.state === "needs_attention") continue;

      const late = deadlineReason(item, this.now());
      if (late) {
        this.markAttention(item, late);
        result.attention.push(item.id);
        continue;
      }
      // Text drafts wait on the device for an online hand-in.
      if (item.kind !== "quiz_answers") continue;

      if (blocked || item.nextAttemptAt > this.now()) {
        blocked = true;
        result.waiting += 1;
        result.retryAt = minTime(result.retryAt, item.nextAttemptAt);
        continue;
      }

      const sentKey = item.idempotencyKey;
      item.state = "syncing";
      this.persist();
      try {
        const server = await deps.current(item);
        item.quizExpiresAt = server.quizExpiresAt ?? item.quizExpiresAt;
        item.closesAt = server.closesAt ?? item.closesAt;
        if (
          !server.attemptStartedAt ||
          (item.attemptStartedAt &&
            server.attemptStartedAt !== item.attemptStartedAt)
        ) {
          // Submitted (by time running out or on another device).
          const reason = deadlineReason(item, this.now()) ?? "closed";
          this.markAttention(item, reason);
          result.attention.push(item.id);
          continue;
        }
        const lateNow = deadlineReason(item, this.now());
        if (lateNow) {
          this.markAttention(item, lateNow);
          result.attention.push(item.id);
          continue;
        }
        if (hasConflict(item, server.version)) {
          this.markAttention(item, "conflict");
          result.attention.push(item.id);
          continue;
        }
        const sent = await deps.send(item);
        if (item.idempotencyKey !== sentKey) {
          // Edited while sending: the newer snapshot goes next run, based on
          // what just reached the server.
          item.baseVersion = sent.version ?? item.baseVersion;
          item.state = "saved_offline";
          item.attempts = 0;
          item.nextAttemptAt = this.now();
          this.persist();
          result.waiting += 1;
          result.retryAt = minTime(result.retryAt, this.now());
          continue;
        }
        item.state = "synced";
        item.syncedVersion = sent.version;
        item.syncedAt = this.now();
        item.reason = undefined;
        item.message = undefined;
        this.persist();
        result.synced.push(item.id);
      } catch (error) {
        const kind = classifyFailure(error);
        if (kind === "signed_out") {
          item.state = "saved_offline";
          this.persist();
          result.signedOut = true;
          result.waiting += 1;
          break;
        }
        if (kind === "retry") {
          item.state = "saved_offline";
          item.attempts += 1;
          item.nextAttemptAt = this.now() + backoffMs(item.attempts);
          this.persist();
          blocked = true;
          result.waiting += 1;
          result.retryAt = minTime(result.retryAt, item.nextAttemptAt);
          continue;
        }
        const message = (error as { message?: unknown })?.message;
        this.markAttention(
          item,
          kind === "closed"
            ? (deadlineReason(item, this.now()) ?? "closed")
            : "rejected",
          typeof message === "string" ? message : undefined,
        );
        result.attention.push(item.id);
      }
    }
    return result;
  }

  private markAttention(
    item: QueuedDraft,
    reason: AttentionReason,
    message?: string,
  ) {
    item.state = "needs_attention";
    item.reason = reason;
    item.message = message;
    this.persist();
  }
}

function minTime(a: number | null, b: number): number {
  return a === null ? b : Math.min(a, b);
}

/** Short status text for a draft, shared by the work screen and lists. */
export function draftStatusLabel(item: QueuedDraft | null): string | null {
  if (!item) return null;
  switch (item.state) {
    case "saved_offline":
      return item.kind === "assignment_text"
        ? "Draft saved on this device"
        : "Saved offline";
    case "syncing":
      return "Syncing";
    case "synced":
      return "Synced";
    case "needs_attention":
      return "Needs attention";
  }
}
