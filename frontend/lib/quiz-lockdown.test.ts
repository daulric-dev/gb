import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
  awayReasonLabel,
  createQuizLockdown,
  type QuizLockdownState,
  type QuizPresencePayload,
} from "@/lib/quiz-lockdown";

/** A document/window pair we can drive: visibility, focus and fullscreen. */
function fakeBrowser({ fullscreen = true } = {}) {
  const doc = new EventTarget() as EventTarget & {
    visibilityState: DocumentVisibilityState;
    fullscreenEnabled: boolean;
    fullscreenElement: Element | null;
    documentElement: { requestFullscreen?: () => Promise<void> };
    exitFullscreen: () => Promise<void>;
  };
  const root = {} as Element;
  doc.visibilityState = "visible";
  doc.fullscreenEnabled = fullscreen;
  doc.fullscreenElement = fullscreen ? root : null;
  let refuse = false;
  doc.documentElement = fullscreen
    ? {
        requestFullscreen: async () => {
          if (refuse) throw new Error("denied");
          doc.fullscreenElement = root;
          doc.dispatchEvent(new Event("fullscreenchange"));
        },
      }
    : {};
  doc.exitFullscreen = async () => {
    doc.fullscreenElement = null;
    doc.dispatchEvent(new Event("fullscreenchange"));
  };
  const win = new EventTarget();
  return {
    doc: doc as unknown as Document,
    win: win as unknown as Window,
    hide() {
      doc.visibilityState = "hidden";
      doc.dispatchEvent(new Event("visibilitychange"));
    },
    show() {
      doc.visibilityState = "visible";
      doc.dispatchEvent(new Event("visibilitychange"));
    },
    blur: () => win.dispatchEvent(new Event("blur")),
    focus: () => win.dispatchEvent(new Event("focus")),
    leaveFullscreen: () => void doc.exitFullscreen(),
    refuseFullscreen: () => (refuse = true),
  };
}

/** Resolves pending promise callbacks (requests settling, finally()). */
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function setup(options: { fullscreen?: boolean; slow?: boolean } = {}) {
  const browser = fakeBrowser(options);
  const sent: QuizPresencePayload[] = [];
  const pending: (() => void)[] = [];
  const states: QuizLockdownState[] = [];
  const lockdown = createQuizLockdown({
    doc: browser.doc,
    win: browser.win,
    heartbeatMs: 10_000,
    settleMs: 300,
    onChange: (s) => states.push(s),
    send: (payload) => {
      sent.push(payload);
      if (!options.slow) return Promise.resolve();
      return new Promise<void>((resolve) => pending.push(resolve));
    },
  });
  return { browser, sent, pending, states, lockdown };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("createQuizLockdown", () => {
  test("reports present straight away, then on every heartbeat", async () => {
    const { sent, lockdown } = setup();
    expect(sent).toEqual([{ isAway: false }]);
    await settle();
    jest.advanceTimersByTime(10_000);
    await settle();
    jest.advanceTimersByTime(10_000);
    expect(sent).toEqual([
      { isAway: false },
      { isAway: false },
      { isAway: false },
    ]);
    lockdown.stop();
  });

  test("leaving the tab sends away once (blur + hidden coalesce), return sends present", async () => {
    const { browser, sent, lockdown } = setup();
    await settle();
    browser.blur();
    browser.hide();
    // The overlay shows at once; the request waits out the settle window.
    expect(lockdown.getState()).toMatchObject({
      away: true,
      reason: "tab_hidden",
    });
    jest.advanceTimersByTime(300);
    expect(sent.slice(1)).toEqual([{ isAway: true, reason: "tab_hidden" }]);
    expect(lockdown.getState().needsReturn).toBe(true);

    await settle();
    browser.show();
    browser.focus();
    jest.advanceTimersByTime(300);
    expect(sent.slice(1)).toEqual([
      { isAway: true, reason: "tab_hidden" },
      { isAway: false },
    ]);
    // Back, but the overlay waits for "Return to quiz".
    expect(lockdown.getState()).toMatchObject({ away: false, needsReturn: true });
    await lockdown.returnToQuiz();
    expect(lockdown.getState().needsReturn).toBe(false);
    lockdown.stop();
  });

  test("a blur/focus flicker inside the settle window sends nothing", async () => {
    const { browser, sent, lockdown } = setup();
    await settle();
    browser.blur();
    jest.advanceTimersByTime(100);
    browser.focus();
    jest.advanceTimersByTime(1_000);
    expect(sent).toEqual([{ isAway: false }]);
    expect(lockdown.getState()).toMatchObject({ away: false, needsReturn: false });
    lockdown.stop();
  });

  test("reports window_blur and fullscreen_exit", async () => {
    const { browser, sent, lockdown } = setup();
    await settle();
    browser.blur();
    jest.advanceTimersByTime(300);
    await settle();
    browser.focus();
    browser.leaveFullscreen();
    jest.advanceTimersByTime(300);
    expect(sent.slice(1)).toEqual([
      { isAway: true, reason: "window_blur" },
      { isAway: true, reason: "fullscreen_exit" },
    ]);
    // Stays away until fullscreen is back.
    await settle();
    await lockdown.returnToQuiz();
    jest.advanceTimersByTime(300);
    expect(lockdown.getState()).toMatchObject({
      away: false,
      inFullscreen: true,
      needsReturn: false,
    });
    expect(sent.at(-1)).toEqual({ isAway: false });
    lockdown.stop();
  });

  test("without the Fullscreen API (iPhone Safari) only tab and window count", async () => {
    const { browser, sent, lockdown } = setup({ fullscreen: false });
    expect(lockdown.getState()).toMatchObject({
      fullscreenSupported: false,
      away: false,
      needsReturn: false,
    });
    await settle();
    browser.hide();
    jest.advanceTimersByTime(300);
    expect(sent.at(-1)).toEqual({ isAway: true, reason: "tab_hidden" });
    lockdown.stop();
  });

  test("fullscreen refused on return: carries on without it", async () => {
    const { browser, lockdown } = setup();
    await settle();
    browser.refuseFullscreen();
    browser.leaveFullscreen();
    jest.advanceTimersByTime(300);
    expect(lockdown.getState().reason).toBe("fullscreen_exit");
    await lockdown.returnToQuiz();
    expect(lockdown.getState()).toMatchObject({
      fullscreenSupported: false,
      away: false,
      needsReturn: false,
    });
    lockdown.stop();
  });

  test("keeps at most one request in flight and sends the latest state after", async () => {
    const { browser, sent, pending, lockdown } = setup({ slow: true });
    expect(sent).toHaveLength(1);
    browser.hide();
    jest.advanceTimersByTime(300);
    jest.advanceTimersByTime(10_000);
    // Still waiting on the first request: nothing else went out.
    expect(sent).toHaveLength(1);
    pending.shift()!();
    await settle();
    expect(sent).toEqual([
      { isAway: false },
      { isAway: true, reason: "tab_hidden" },
    ]);
    lockdown.stop();
  });

  test("stop (submit, expiry, unmount) ends listeners, timers and requests", async () => {
    const { browser, sent, states, lockdown } = setup();
    await settle();
    lockdown.stop();
    expect(states.at(-1)).toMatchObject({ active: false, needsReturn: false });
    browser.hide();
    browser.blur();
    jest.advanceTimersByTime(60_000);
    await settle();
    expect(sent).toEqual([{ isAway: false }]);
    // Idempotent.
    lockdown.stop();
  });

  test("a request in flight when stopped does not trigger another", async () => {
    const { browser, sent, pending, lockdown } = setup({ slow: true });
    browser.hide();
    jest.advanceTimersByTime(300);
    lockdown.stop();
    pending.shift()!();
    await settle();
    expect(sent).toHaveLength(1);
  });

  test("starting outside fullscreen (a reload) needs a return", () => {
    const browser = fakeBrowser();
    void browser.doc.exitFullscreen();
    const sent: QuizPresencePayload[] = [];
    const lockdown = createQuizLockdown({
      doc: browser.doc,
      win: browser.win,
      send: async (p) => void sent.push(p),
    });
    expect(lockdown.getState()).toMatchObject({
      away: true,
      reason: "fullscreen_exit",
      needsReturn: true,
    });
    expect(sent).toEqual([{ isAway: true, reason: "fullscreen_exit" }]);
    lockdown.stop();
  });
});

describe("awayReasonLabel", () => {
  test("readable reasons for the teacher", () => {
    expect(awayReasonLabel("tab_hidden")).toBe("Switched tab or minimised");
    expect(awayReasonLabel("no_heartbeat")).toBe("Not responding");
    expect(awayReasonLabel("app_background")).toBe("Left the app");
    expect(awayReasonLabel(null)).toBe("Away");
    expect(awayReasonLabel("something_new")).toBe("something new");
  });
});
