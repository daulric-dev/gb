import { describe, expect, test } from "bun:test";
import {
  MemoryQueueStore,
  SyncQueue,
  answersVersion,
  backoffMs,
  classifyFailure,
  closesAtFor,
  deadlineReason,
  draftStatusLabel,
  hasConflict,
  textVersion,
  type QueuedDraft,
  type RunDeps,
  type ServerState,
} from "./sync-queue";

const SCOPE = "https://school.example.com/api\nstudent-1";
const STARTED = "2026-11-10T09:00:00.000Z";
const T0 = Date.parse("2026-11-10T09:10:00.000Z");

function setup() {
  let t = T0;
  let n = 0;
  const store = new MemoryQueueStore();
  const queue = new SyncQueue(store, {
    now: () => t,
    newId: () => `id-${++n}`,
  });
  return {
    queue,
    store,
    now: () => t,
    advance: (ms: number) => (t += ms),
  };
}

function quiz(
  activityId: string,
  answers: unknown[],
  extra: Partial<{
    baseVersion: string | null;
    quizExpiresAt: string | null;
    closesAt: string | null;
  }> = {},
) {
  return {
    scope: SCOPE,
    activityId,
    kind: "quiz_answers" as const,
    payload: { answers },
    draft: { answers },
    baseVersion: extra.baseVersion ?? answersVersion(STARTED, []),
    attemptStartedAt: STARTED,
    quizExpiresAt: extra.quizExpiresAt ?? null,
    closesAt: extra.closesAt ?? null,
  };
}

/** A fake server: one attempt per quiz, answers replaced on save. */
function fakeServer(options: {
  fail?: (item: QueuedDraft, call: number) => unknown;
  state?: (item: QueuedDraft) => Partial<ServerState>;
} = {}) {
  const sent: { activityId: string; key: string; payload: unknown }[] = [];
  const saved = new Map<string, unknown[]>();
  let calls = 0;
  const deps: RunDeps = {
    async current(item) {
      return {
        version: answersVersion(STARTED, (saved.get(item.activityId) ?? []) as never[]),
        attemptStartedAt: STARTED,
        quizExpiresAt: null,
        closesAt: null,
        ...options.state?.(item),
      };
    },
    async send(item) {
      calls += 1;
      const failure = options.fail?.(item, calls);
      if (failure) throw failure;
      sent.push({ activityId: item.activityId, key: item.idempotencyKey, payload: item.payload });
      const answers = (item.payload as { answers: unknown[] }).answers;
      saved.set(item.activityId, answers);
      return { version: answersVersion(STARTED, answers as never[]) };
    },
  };
  return { deps, sent, saved };
}

const offline = Object.assign(new Error("Can't reach the server"), { status: 0 });

describe("sync queue: ordering", () => {
  test("sends in the order the drafts were made", async () => {
    const { queue, advance } = setup();
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "x" }]));
    advance(10);
    queue.enqueue(quiz("q2", [{ questionId: "b", optionId: "y" }]));
    advance(10);
    queue.enqueue(quiz("q3", [{ questionId: "c", optionId: "z" }]));
    const server = fakeServer();
    const result = await queue.run(SCOPE, server.deps);
    expect(server.sent.map((s) => s.activityId)).toEqual(["q1", "q2", "q3"]);
    expect(result.synced).toHaveLength(3);
    expect(queue.get(SCOPE, "q2")?.state).toBe("synced");
  });

  test("a newer snapshot replaces the queued one and keeps its place", async () => {
    const { queue, advance } = setup();
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "x" }]));
    advance(10);
    queue.enqueue(quiz("q2", [{ questionId: "b", optionId: "y" }]));
    advance(10);
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "changed" }]));
    expect(queue.list(SCOPE).map((i) => i.activityId)).toEqual(["q1", "q2"]);
    const server = fakeServer();
    await queue.run(SCOPE, server.deps);
    expect(server.sent[0]).toMatchObject({
      activityId: "q1",
      payload: { answers: [{ questionId: "a", optionId: "changed" }] },
    });
    expect(server.sent).toHaveLength(2);
  });

  test("a waiting item holds back the ones behind it", async () => {
    const { queue, advance } = setup();
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "x" }]));
    advance(10);
    queue.enqueue(quiz("q2", [{ questionId: "b", optionId: "y" }]));
    const server = fakeServer({ fail: (item) => (item.activityId === "q1" ? offline : null) });
    const result = await queue.run(SCOPE, server.deps);
    expect(server.sent).toHaveLength(0);
    expect(result.waiting).toBe(2);
    expect(queue.get(SCOPE, "q2")?.state).toBe("saved_offline");
  });

  test("only runs the signed-in account's drafts", async () => {
    const { queue } = setup();
    queue.enqueue({ ...quiz("q1", [{ questionId: "a", optionId: "x" }]), scope: "other\nuser" });
    const server = fakeServer();
    await queue.run(SCOPE, server.deps);
    expect(server.sent).toHaveLength(0);
    expect(queue.get("other\nuser", "q1")?.state).toBe("saved_offline");
  });
});

describe("sync queue: retry and idempotency", () => {
  test("backs off and retries with the same idempotency key", async () => {
    const { queue, advance } = setup();
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "x" }]));
    const keys: string[] = [];
    let failing = true;
    const server = fakeServer({
      fail: (item) => {
        keys.push(item.idempotencyKey);
        return failing ? offline : null;
      },
    });
    const first = await queue.run(SCOPE, server.deps);
    expect(first.retryAt).toBe(T0 + backoffMs(1));
    expect(queue.get(SCOPE, "q1")?.attempts).toBe(1);

    // Too early: not tried again.
    await queue.run(SCOPE, server.deps);
    expect(keys).toHaveLength(1);

    advance(backoffMs(1));
    const second = await queue.run(SCOPE, server.deps);
    expect(keys).toHaveLength(2);
    expect(second.retryAt).toBe(T0 + backoffMs(1) + backoffMs(2));

    failing = false;
    advance(backoffMs(2));
    await queue.run(SCOPE, server.deps);
    expect(new Set(keys).size).toBe(1);
    expect(server.sent[0].key).toBe(keys[0]);
    expect(queue.get(SCOPE, "q1")?.state).toBe("synced");
  });

  test("a draft for a new attempt replaces an old attempt's leftover with a fresh base", () => {
    const { queue } = setup();
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "x" }], { baseVersion: "old" }));
    const next = queue.enqueue({
      ...quiz("q1", [{ questionId: "a", optionId: "y" }], { baseVersion: "fresh" }),
      attemptStartedAt: "2026-11-10T10:00:00.000Z",
    });
    expect(next.baseVersion).toBe("fresh");
    expect(next.attemptStartedAt).toBe("2026-11-10T10:00:00.000Z");
  });

  test("a new snapshot gets a new key; retries of it keep that key", () => {
    const { queue } = setup();
    const first = queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "x" }]));
    const key1 = first.idempotencyKey;
    const second = queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "y" }]));
    expect(second.idempotencyKey).not.toBe(key1);
    expect(second.id).toBe(first.id);
  });

  test("server errors and rate limits retry; 4xx needs attention", async () => {
    expect(classifyFailure({ status: 0 })).toBe("retry");
    expect(classifyFailure(new TypeError("Network request failed"))).toBe("retry");
    expect(classifyFailure({ status: 503 })).toBe("retry");
    expect(classifyFailure({ status: 429 })).toBe("retry");
    expect(classifyFailure({ status: 401 })).toBe("signed_out");
    expect(classifyFailure({ status: 409 })).toBe("closed");
    expect(classifyFailure({ status: 400 })).toBe("rejected");

    const { queue } = setup();
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "x" }]));
    const server = fakeServer({
      fail: () => Object.assign(new Error("That option is not part of this question"), { status: 400 }),
    });
    const result = await queue.run(SCOPE, server.deps);
    expect(result.attention).toHaveLength(1);
    expect(queue.get(SCOPE, "q1")).toMatchObject({
      state: "needs_attention",
      reason: "rejected",
      message: "That option is not part of this question",
    });
  });

  test("a 401 stops the run and keeps the draft", async () => {
    const { queue } = setup();
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "x" }]));
    const server = fakeServer({ fail: () => ({ status: 401, message: "Session expired" }) });
    const result = await queue.run(SCOPE, server.deps);
    expect(result.signedOut).toBe(true);
    expect(queue.get(SCOPE, "q1")?.state).toBe("saved_offline");
  });

  test("an item left syncing by a killed app goes again", () => {
    const store = new MemoryQueueStore();
    const q = new SyncQueue(store, { now: () => T0 });
    q.enqueue(quiz("q1", []));
    store.items[0].state = "syncing";
    const reopened = new SyncQueue(store, { now: () => T0 });
    expect(reopened.get(SCOPE, "q1")?.state).toBe("saved_offline");
  });

  test("concurrent runs share one run (no double send)", async () => {
    const { queue } = setup();
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "x" }]));
    const server = fakeServer();
    await Promise.all([queue.run(SCOPE, server.deps), queue.run(SCOPE, server.deps)]);
    expect(server.sent).toHaveLength(1);
  });
});

describe("sync queue: expired and closed work", () => {
  test("never sends answers after the attempt expired", async () => {
    const { queue } = setup();
    queue.enqueue(
      quiz("q1", [{ questionId: "a", optionId: "x" }], {
        quizExpiresAt: new Date(T0 - 1_000).toISOString(),
      }),
    );
    const server = fakeServer();
    const result = await queue.run(SCOPE, server.deps);
    expect(server.sent).toHaveLength(0);
    expect(result.attention).toHaveLength(1);
    const item = queue.get(SCOPE, "q1")!;
    expect(item).toMatchObject({ state: "needs_attention", reason: "expired" });
    // The draft is still on the device.
    expect(item.draft).toEqual({ answers: [{ questionId: "a", optionId: "x" }] });
  });

  test("never sends after the close date (no expiry on the attempt)", async () => {
    const { queue } = setup();
    queue.enqueue(
      quiz("q1", [{ questionId: "a", optionId: "x" }], {
        closesAt: new Date(T0 - 1).toISOString(),
      }),
    );
    const server = fakeServer();
    await queue.run(SCOPE, server.deps);
    expect(server.sent).toHaveLength(0);
    expect(queue.get(SCOPE, "q1")?.reason).toBe("closed");
  });

  test("a timed attempt may run past the close date until it expires", () => {
    expect(
      deadlineReason(
        {
          kind: "quiz_answers",
          quizExpiresAt: new Date(T0 + 60_000).toISOString(),
          closesAt: new Date(T0 - 60_000).toISOString(),
        },
        T0,
      ),
    ).toBeNull();
  });

  test("uses the server's newer deadline (e.g. it passed while offline)", async () => {
    const { queue } = setup();
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "x" }]));
    const server = fakeServer({
      state: () => ({ quizExpiresAt: new Date(T0 - 5).toISOString() }),
    });
    await queue.run(SCOPE, server.deps);
    expect(server.sent).toHaveLength(0);
    expect(queue.get(SCOPE, "q1")?.reason).toBe("expired");
  });

  test("an attempt that ended (auto-submitted or submitted elsewhere) is not overwritten", async () => {
    const { queue } = setup();
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "x" }]));
    const server = fakeServer({ state: () => ({ attemptStartedAt: null }) });
    await queue.run(SCOPE, server.deps);
    expect(server.sent).toHaveLength(0);
    expect(queue.get(SCOPE, "q1")?.reason).toBe("closed");

    const other = setup();
    other.queue.enqueue(quiz("q2", [{ questionId: "a", optionId: "x" }]));
    const newer = fakeServer({ state: () => ({ attemptStartedAt: "2026-11-10T09:30:00.000Z" }) });
    await other.queue.run(SCOPE, newer.deps);
    expect(newer.sent).toHaveLength(0);
    expect(other.queue.get(SCOPE, "q2")?.state).toBe("needs_attention");
  });

  test("a 409 from the save is closed, not retried", async () => {
    const { queue } = setup();
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "x" }]));
    const server = fakeServer({
      fail: () => ({ status: 409, message: "Time is up; your saved answers were submitted" }),
    });
    await queue.run(SCOPE, server.deps);
    expect(queue.get(SCOPE, "q1")).toMatchObject({ state: "needs_attention", reason: "closed" });
  });

  test("text drafts are never sent, but are flagged once the work closes", async () => {
    const { queue, advance } = setup();
    queue.enqueue({
      scope: SCOPE,
      activityId: "a1",
      kind: "assignment_text",
      payload: "my essay",
      draft: { text: "my essay" },
      baseVersion: textVersion(null),
      closesAt: new Date(T0 + 1_000).toISOString(),
    });
    const server = fakeServer();
    await queue.run(SCOPE, server.deps);
    expect(server.sent).toHaveLength(0);
    expect(queue.get(SCOPE, "a1")?.state).toBe("saved_offline");
    advance(2_000);
    await queue.run(SCOPE, server.deps);
    expect(queue.get(SCOPE, "a1")).toMatchObject({ state: "needs_attention", reason: "closed" });
  });

  test("closesAtFor: extension wins, else late-until, else due", () => {
    expect(closesAtFor({ dueAt: "D", effectiveDueAt: "E", hasExtension: true, lateUntil: null })).toBe("E");
    expect(closesAtFor({ dueAt: "D", effectiveDueAt: "D", hasExtension: false, lateUntil: "L" })).toBe("L");
    expect(closesAtFor({ dueAt: "D", effectiveDueAt: "D", lateUntil: null })).toBe("D");
    expect(closesAtFor({ dueAt: "D" })).toBe("D");
    expect(closesAtFor({ dueAt: null })).toBeNull();
  });
});

describe("sync queue: conflicts", () => {
  test("detects a server copy changed elsewhere and keeps both", async () => {
    const { queue } = setup();
    const base = answersVersion(STARTED, [{ questionId: "a", optionId: "x" }]);
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "mine" }], { baseVersion: base }));
    const server = fakeServer();
    server.saved.set("q1", [{ questionId: "a", optionId: "web" }]);
    const result = await queue.run(SCOPE, server.deps);
    expect(result.attention).toHaveLength(1);
    expect(server.sent).toHaveLength(0);
    expect(server.saved.get("q1")).toEqual([{ questionId: "a", optionId: "web" }]);
    expect(queue.get(SCOPE, "q1")).toMatchObject({ state: "needs_attention", reason: "conflict" });

    // Further edits keep it a conflict until the student chooses.
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "mine2" }]));
    expect(queue.get(SCOPE, "q1")?.reason).toBe("conflict");

    // Keep this device's copy: re-based on the server's version, then sent.
    const serverVersion = answersVersion(STARTED, [{ questionId: "a", optionId: "web" }]);
    queue.keepDeviceCopy(SCOPE, "q1", "quiz_answers", serverVersion);
    await queue.run(SCOPE, server.deps);
    expect(server.saved.get("q1")).toEqual([{ questionId: "a", optionId: "mine2" }]);
    expect(queue.get(SCOPE, "q1")?.state).toBe("synced");
  });

  test("this device's own earlier saves are not a conflict", async () => {
    const { queue } = setup();
    const server = fakeServer();
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "x" }]));
    await queue.run(SCOPE, server.deps);
    // The screen moves its base to what was synced; the next offline edit
    // starts from there.
    const synced = queue.get(SCOPE, "q1")!.syncedVersion!;
    expect(synced).toBe(answersVersion(STARTED, [{ questionId: "a", optionId: "x" }]));
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "y" }], { baseVersion: synced }));
    await queue.run(SCOPE, server.deps);
    expect(server.sent.map((s) => (s.payload as { answers: { optionId: string }[] }).answers[0].optionId)).toEqual(["x", "y"]);
  });

  test("answersVersion ignores order, blanks and the matches format", () => {
    const a = answersVersion(STARTED, [
      { questionId: "2", text: " hello " },
      { questionId: "1", matches: [{ optionId: "o1", label: "A" }] },
      { questionId: "3", text: "   " },
    ]);
    const b = answersVersion(STARTED, [
      { questionId: "1", matches: { o1: "A" } },
      { questionId: "2", text: "hello" },
    ]);
    expect(a).toBe(b);
    expect(answersVersion("other", [])).not.toBe(answersVersion(STARTED, []));
  });

  test("hasConflict and textVersion", () => {
    expect(hasConflict({ baseVersion: null }, "x")).toBe(false);
    expect(hasConflict({ baseVersion: "x" }, "x")).toBe(false);
    expect(hasConflict({ baseVersion: "x" }, "y")).toBe(true);
    expect(textVersion({ status: "draft", textBody: "a" })).not.toBe(
      textVersion({ status: "submitted", textBody: "a" }),
    );
  });
});

describe("sync queue: housekeeping", () => {
  test("survives a restart", () => {
    const { queue, store } = setup();
    queue.enqueue(quiz("q1", [{ questionId: "a", optionId: "x" }]));
    const reopened = new SyncQueue(store);
    expect(reopened.get(SCOPE, "q1")?.payload).toEqual({
      answers: [{ questionId: "a", optionId: "x" }],
    });
  });

  test("clearAll and clearScope", () => {
    const { queue } = setup();
    queue.enqueue(quiz("q1", []));
    queue.enqueue({ ...quiz("q2", []), scope: "other\nuser" });
    queue.clearScope(SCOPE);
    expect(queue.get(SCOPE, "q1")).toBeNull();
    expect(queue.get("other\nuser", "q2")).not.toBeNull();
    queue.clearAll();
    expect(queue.unsent()).toHaveLength(0);
  });

  test("notifies subscribers", () => {
    const { queue } = setup();
    let calls = 0;
    const off = queue.subscribe(() => calls++);
    queue.enqueue(quiz("q1", []));
    queue.remove(SCOPE, "q1");
    off();
    queue.enqueue(quiz("q1", []));
    expect(calls).toBe(2);
  });

  test("labels", () => {
    expect(draftStatusLabel(null)).toBeNull();
    const { queue } = setup();
    expect(draftStatusLabel(queue.enqueue(quiz("q1", [])))).toBe("Saved offline");
  });
});
