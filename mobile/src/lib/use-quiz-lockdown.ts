import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { sendQuizPresence } from "@/lib/work";

/** Presence heartbeat; the API reads 25s of silence as away. */
const HEARTBEAT_MS = 10_000;
/**
 * "inactive" on iOS also covers a pulled-down notification centre or a
 * system prompt; it must hold this long before it counts. "background" is
 * sent at once, while the app can still make the request.
 */
const INACTIVE_SETTLE_MS = 600;

export interface QuizLockdownState {
  active: boolean;
  away: boolean;
  /** Left the app and has not tapped "Return to quiz" yet. */
  needsReturn: boolean;
}

const INACTIVE: QuizLockdownState = {
  active: false,
  away: false,
  needsReturn: false,
};

/**
 * Lockdown quiz monitoring on the phone: a heartbeat while `enabled`, away
 * (reason app_background) when the app goes to the background, present when
 * it comes back. A phone cannot be locked down either; the teacher is told.
 * Stops on submit/expiry (`enabled` false) and on unmount.
 */
export function useQuizLockdown({
  activityId,
  enabled,
}: {
  activityId: string | undefined;
  enabled: boolean;
}) {
  const [state, setState] = useState<QuizLockdownState>(INACTIVE);
  const acknowledge = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled || !activityId) return;
    let stopped = false;
    let away = AppState.currentState !== "active";
    let needsReturn = away;
    let inFlight = false;
    let resend = false;
    let lastSent: boolean | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;

    const emit = () => {
      if (!stopped) setState({ active: true, away, needsReturn });
    };

    const flush = () => {
      if (stopped) return;
      if (inFlight) {
        resend = true;
        return;
      }
      inFlight = true;
      lastSent = away;
      sendQuizPresence(
        activityId,
        away ? { isAway: true, reason: "app_background" } : { isAway: false },
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

    const onChange = (next: AppStateStatus) => {
      if (settle) {
        clearTimeout(settle);
        settle = null;
      }
      if (next === "active") {
        away = false;
        emit();
        if (lastSent !== false) flush();
        return;
      }
      const commit = () => {
        settle = null;
        away = true;
        needsReturn = true;
        emit();
        if (lastSent !== true) flush();
      };
      if (next === "background") commit();
      else settle = setTimeout(commit, INACTIVE_SETTLE_MS);
    };

    acknowledge.current = () => {
      if (stopped) return;
      needsReturn = away;
      emit();
    };

    const subscription = AppState.addEventListener("change", onChange);
    const heartbeat = setInterval(flush, HEARTBEAT_MS);
    emit();
    flush();

    return () => {
      stopped = true;
      subscription.remove();
      clearInterval(heartbeat);
      if (settle) clearTimeout(settle);
      acknowledge.current = null;
    };
  }, [activityId, enabled]);

  const returnToQuiz = useCallback(() => acknowledge.current?.(), []);

  const current = enabled ? state : INACTIVE;
  return {
    state: current,
    showOverlay: current.active && (current.away || current.needsReturn),
    returnToQuiz,
  };
}
