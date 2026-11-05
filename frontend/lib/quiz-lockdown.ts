import { api } from "@/lib/api";

/**
 * Lockdown quizzes: the student's side of quiz monitoring.
 *
 * A browser cannot really be locked down. What this does is watch for the
 * student leaving the quiz (another tab, another window, out of fullscreen)
 * and tell the API, which shows the teacher who is away and how many times
 * each student left. The API counts a departure once per away-after-present,
 * so repeating "away" on the heartbeat never inflates the count.
 */

export type QuizAwayReason = "tab_hidden" | "window_blur" | "fullscreen_exit";

export interface QuizPresencePayload {
  isAway: boolean;
  reason?: QuizAwayReason;
}

/** POST /portal/me/activities/:activityId/quiz/presence */
export function sendQuizPresence(
  activityId: string,
  payload: QuizPresencePayload,
) {
  return api<{ ok: boolean; expired?: boolean }>(
    `/portal/me/activities/${activityId}/quiz/presence`,
    { method: "POST", body: payload, keepalive: true },
  );
}

/** True when this browser can put the page in fullscreen (not iPhone Safari). */
export function fullscreenAvailable(doc: Document = document): boolean {
  return (
    !!doc.fullscreenEnabled &&
    typeof doc.documentElement?.requestFullscreen === "function"
  );
}

/**
 * Ask for fullscreen. Call it straight from a click handler, before any
 * await, or the browser refuses for want of a user gesture. Resolves false
 * when fullscreen is unavailable or refused; the quiz carries on without it.
 */
export async function enterFullscreen(
  doc: Document = document,
): Promise<boolean> {
  if (!fullscreenAvailable(doc)) return false;
  if (doc.fullscreenElement) return true;
  try {
    await doc.documentElement.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}

export function exitFullscreen(doc: Document = document) {
  if (doc.fullscreenElement && typeof doc.exitFullscreen === "function") {
    doc.exitFullscreen().catch(() => undefined);
  }
}

export interface QuizLockdownState {
  /** Monitoring is running. False once stopped. */
  active: boolean;
  /** The student is away right now, by the reason below. */
  away: boolean;
  reason: QuizAwayReason | null;
  /**
   * The student left (for longer than a flicker) and has not pressed
   * "Return to quiz". Keeps the overlay up after they come back, so they
   * know the departure was noticed.
   */
  needsReturn: boolean;
  /** Fullscreen is part of the rules on this browser. */
  fullscreenSupported: boolean;
  inFullscreen: boolean;
}

export const INACTIVE_LOCKDOWN_STATE: QuizLockdownState = {
  active: false,
  away: false,
  reason: null,
  needsReturn: false,
  fullscreenSupported: false,
  inFullscreen: false,
};

export interface QuizLockdownOptions {
  send: (payload: QuizPresencePayload) => Promise<unknown>;
  onChange?: (state: QuizLockdownState) => void;
  /** Presence heartbeat. The API treats 25s of silence as away. */
  heartbeatMs?: number;
  /**
   * How long a change must hold before it is sent. Coalesces a blur followed
   * by visibilitychange into one request, and drops a blur/focus flicker.
   */
  settleMs?: number;
  doc?: Document;
  win?: Window;
}

export interface QuizLockdownController {
  getState(): QuizLockdownState;
  /** "Return to quiz": re-enters fullscreen. Call from a click handler. */
  returnToQuiz(): Promise<void>;
  /** Stops listeners, timers and requests. Idempotent. */
  stop(): void;
}

export const QUIZ_HEARTBEAT_MS = 10_000;
export const QUIZ_SETTLE_MS = 300;

export function createQuizLockdown(
  options: QuizLockdownOptions,
): QuizLockdownController {
  const doc = options.doc ?? document;
  const win = options.win ?? window;
  const heartbeatMs = options.heartbeatMs ?? QUIZ_HEARTBEAT_MS;
  const settleMs = options.settleMs ?? QUIZ_SETTLE_MS;

  let active = true;
  let hidden = doc.visibilityState === "hidden";
  let blurred = false;
  let fullscreenSupported = fullscreenAvailable(doc);
  let inFullscreen = !!doc.fullscreenElement;
  let needsReturn = false;

  let inFlight = false;
  let resendAfterFlight = false;
  /** The last payload put on the wire, as "away:reason" or "present". */
  let lastSent: string | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  function reason(): QuizAwayReason | null {
    if (hidden) return "tab_hidden";
    if (fullscreenSupported && !inFullscreen) return "fullscreen_exit";
    if (blurred) return "window_blur";
    return null;
  }

  function payload(): QuizPresencePayload {
    const r = reason();
    return r ? { isAway: true, reason: r } : { isAway: false };
  }

  function key(p: QuizPresencePayload) {
    return p.isAway ? `away:${p.reason}` : "present";
  }

  function getState(): QuizLockdownState {
    const r = reason();
    return {
      active,
      away: r !== null,
      reason: r,
      needsReturn: active && needsReturn,
      fullscreenSupported,
      inFullscreen,
    };
  }

  function emit() {
    options.onChange?.(getState());
  }

  /** Sends the current state; at most one request on the wire at a time. */
  function flush() {
    if (!active) return;
    if (inFlight) {
      resendAfterFlight = true;
      return;
    }
    const p = payload();
    lastSent = key(p);
    inFlight = true;
    let request: Promise<unknown>;
    try {
      request = options.send(p);
    } catch (err) {
      request = Promise.reject(err);
    }
    request
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
        if (resendAfterFlight && active) {
          resendAfterFlight = false;
          flush();
        }
      });
  }

  function changed() {
    if (!active) return;
    emit();
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      // Only a departure that held counts; a blur/focus flicker does not.
      if (reason() !== null && !needsReturn) {
        needsReturn = true;
        emit();
      }
      if (key(payload()) !== lastSent) flush();
    }, settleMs);
  }

  const onVisibility = () => {
    hidden = doc.visibilityState === "hidden";
    changed();
  };
  const onBlur = () => {
    blurred = true;
    changed();
  };
  const onFocus = () => {
    blurred = false;
    changed();
  };
  const onFullscreen = () => {
    inFullscreen = !!doc.fullscreenElement;
    changed();
  };

  doc.addEventListener("visibilitychange", onVisibility);
  doc.addEventListener("fullscreenchange", onFullscreen);
  win.addEventListener("blur", onBlur);
  win.addEventListener("focus", onFocus);

  const heartbeat = setInterval(flush, heartbeatMs);

  // Starting already away (a reload outside fullscreen) still needs a return.
  if (reason() !== null) needsReturn = true;
  emit();
  flush();

  return {
    getState,
    async returnToQuiz() {
      if (!active) return;
      if (fullscreenSupported && !doc.fullscreenElement) {
        const entered = await enterFullscreen(doc);
        if (!active) return;
        // Refused (an embedded frame, a policy): carry on without it rather
        // than locking the student out of their own quiz.
        if (!entered) fullscreenSupported = false;
        inFullscreen = !!doc.fullscreenElement;
      }
      // Pressing the button means the window has focus again.
      blurred = false;
      hidden = doc.visibilityState === "hidden";
      needsReturn = reason() !== null;
      changed();
    },
    stop() {
      if (!active) return;
      active = false;
      clearInterval(heartbeat);
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = null;
      resendAfterFlight = false;
      doc.removeEventListener("visibilitychange", onVisibility);
      doc.removeEventListener("fullscreenchange", onFullscreen);
      win.removeEventListener("blur", onBlur);
      win.removeEventListener("focus", onFocus);
      emit();
    },
  };
}

/** Teacher-facing wording for an away reason from the roster. */
export function awayReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case "tab_hidden":
      return "Switched tab or minimised";
    case "window_blur":
      return "Left the window";
    case "fullscreen_exit":
      return "Left fullscreen";
    case "app_background":
      return "Left the app";
    case "no_heartbeat":
      return "Not responding";
    case null:
    case undefined:
    case "":
      return "Away";
    default:
      return reason.replace(/_/g, " ");
  }
}
