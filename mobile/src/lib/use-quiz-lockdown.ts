import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as ScreenCapture from "expo-screen-capture";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { sendQuizPresence, type QuizAwayReason } from "@/lib/work";

/** Presence heartbeat; the API reads 25s of silence as away. */
const HEARTBEAT_MS = 10_000;
/**
 * "inactive" on iOS also covers a pulled-down notification centre or a
 * system prompt; it must hold this long before it counts. "background" is
 * sent at once, while the app can still make the request.
 */
const INACTIVE_SETTLE_MS = 600;
/**
 * A screenshot reads as away this long: one departure on the teacher's count
 * and long enough for the live roster to show why.
 */
const SCREENSHOT_AWAY_MS = 5_000;
/** Tag for screen-capture blocking and keep-awake, so release is exact. */
const LOCK_TAG = "quiz-lockdown";

export interface QuizLockdownState {
  active: boolean;
  away: boolean;
  /** Why the attempt reads as away right now (null when present). */
  reason: QuizAwayReason | null;
  /** Left the app and has not tapped "Return to quiz" yet. */
  needsReturn: boolean;
}

const INACTIVE: QuizLockdownState = {
  active: false,
  away: false,
  reason: null,
  needsReturn: false,
};

/** Reasons that cover the quiz until they clear (or are acknowledged). */
const BLOCKING: ReadonlySet<QuizAwayReason> = new Set([
  "app_background",
  "screen_recording",
  "unpinned",
]);

/**
 * Lockdown quiz monitoring on the phone while `enabled`: a presence
 * heartbeat; away when the app goes to the background (app_background), is
 * being recorded (screen_recording), is not pinned (unpinned, or not_pinned
 * when the student started without pinning because it was unavailable), and
 * briefly after a screenshot (screenshot). Screen capture is blocked and the
 * screen kept awake for the attempt. Everything is released on submit/expiry
 * (`enabled` false) and on unmount.
 */
export function useQuizLockdown({
  activityId,
  enabled,
  pinned,
  captured,
  pinningRequired,
  pinningWaived,
  onScreenshot,
}: {
  activityId: string | undefined;
  enabled: boolean;
  /** Android screen pinning / iOS Guided Access is on. */
  pinned: boolean;
  /** Being screen-recorded or mirrored. */
  captured: boolean;
  /** This device can pin (native build with the quiz-lock module). */
  pinningRequired: boolean;
  /** The student started without pinning because it was unavailable. */
  pinningWaived: boolean;
  onScreenshot?: () => void;
}) {
  const [state, setState] = useState<QuizLockdownState>(INACTIVE);
  const acknowledge = useRef<(() => void) | null>(null);
  const refresh = useRef<(() => void) | null>(null);
  const conditions = useRef({ pinned, captured, pinningRequired, pinningWaived });
  conditions.current = { pinned, captured, pinningRequired, pinningWaived };
  const screenshotCallback = useRef(onScreenshot);
  screenshotCallback.current = onScreenshot;

  useEffect(() => {
    refresh.current?.();
  }, [pinned, captured, pinningRequired, pinningWaived]);

  useEffect(() => {
    if (!enabled || !activityId) return;
    let stopped = false;
    let background = AppState.currentState !== "active";
    let needsReturn = background;
    let screenshotUntil = 0;
    let inFlight = false;
    let resend = false;
    /** What the API last heard: a reason, or "present". */
    let lastSent: QuizAwayReason | "present" | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;
    let screenshotTimer: ReturnType<typeof setTimeout> | null = null;

    const reasonNow = (): QuizAwayReason | null => {
      const { pinned, captured, pinningRequired, pinningWaived } =
        conditions.current;
      if (background) return "app_background";
      if (captured) return "screen_recording";
      if (!pinned) {
        if (pinningWaived) return "not_pinned";
        if (pinningRequired) return "unpinned";
      }
      if (Date.now() < screenshotUntil) return "screenshot";
      return null;
    };

    const flush = () => {
      if (stopped) return;
      if (inFlight) {
        resend = true;
        return;
      }
      const reason = reasonNow();
      inFlight = true;
      lastSent = reason ?? "present";
      sendQuizPresence(
        activityId,
        reason ? { isAway: true, reason } : { isAway: false },
      )
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
          if (resend && !stopped) {
            resend = false;
            flush();
          }
        });
    };

    /** Re-render and tell the API at once if the away reason changed. */
    const update = () => {
      if (stopped) return;
      const reason = reasonNow();
      setState({ active: true, away: reason !== null, reason, needsReturn });
      if ((reason ?? "present") !== lastSent) flush();
    };

    const onChange = (next: AppStateStatus) => {
      if (settle) {
        clearTimeout(settle);
        settle = null;
      }
      if (next === "active") {
        background = false;
        update();
        return;
      }
      const commit = () => {
        settle = null;
        background = true;
        needsReturn = true;
        update();
      };
      if (next === "background") commit();
      else settle = setTimeout(commit, INACTIVE_SETTLE_MS);
    };

    acknowledge.current = () => {
      if (stopped) return;
      needsReturn = background;
      update();
    };
    refresh.current = update;

    // Capture blocking: FLAG_SECURE on Android; on iOS screenshots and
    // recordings of the quiz come out blank where the OS allows it.
    ScreenCapture.preventScreenCaptureAsync(LOCK_TAG).catch(() => undefined);
    ScreenCapture.enableAppSwitcherProtectionAsync(0.9).catch(
      () => undefined,
    );
    activateKeepAwakeAsync(LOCK_TAG).catch(() => undefined);
    const onScreenshotTaken = () => {
      if (stopped) return;
      screenshotUntil = Date.now() + SCREENSHOT_AWAY_MS;
      if (screenshotTimer) clearTimeout(screenshotTimer);
      screenshotTimer = setTimeout(update, SCREENSHOT_AWAY_MS + 50);
      update();
      screenshotCallback.current?.();
    };
    // iOS always; Android 14+ (DETECT_SCREEN_CAPTURE). Older Android would
    // need a photos permission, which is not asked for: FLAG_SECURE already
    // blocks the screenshot there.
    let screenshotSub: { remove(): void } | null = null;
    try {
      screenshotSub = ScreenCapture.addScreenshotListener(onScreenshotTaken);
    } catch {
      screenshotSub = null;
    }

    const subscription = AppState.addEventListener("change", onChange);
    const heartbeat = setInterval(flush, HEARTBEAT_MS);
    update();

    return () => {
      stopped = true;
      subscription.remove();
      screenshotSub?.remove();
      clearInterval(heartbeat);
      if (settle) clearTimeout(settle);
      if (screenshotTimer) clearTimeout(screenshotTimer);
      acknowledge.current = null;
      refresh.current = null;
      ScreenCapture.allowScreenCaptureAsync(LOCK_TAG).catch(() => undefined);
      ScreenCapture.disableAppSwitcherProtectionAsync().catch(
        () => undefined,
      );
      deactivateKeepAwake(LOCK_TAG).catch(() => undefined);
    };
  }, [activityId, enabled]);

  const returnToQuiz = useCallback(() => acknowledge.current?.(), []);

  const current = enabled ? state : INACTIVE;
  const blocked =
    current.active &&
    (current.needsReturn ||
      (current.reason !== null && BLOCKING.has(current.reason)));
  return {
    state: current,
    showOverlay: blocked,
    returnToQuiz,
  };
}
