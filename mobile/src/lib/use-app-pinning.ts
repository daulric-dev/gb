import { useCallback, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import * as QuizLock from "../../modules/quiz-lock";

/**
 * Pinning and capture state only exist in the native app, and only in a
 * build that includes the quiz-lock module.
 */
export const PINNING_PLATFORM: "ios" | "android" | null =
  QuizLock.isAvailable && (Platform.OS === "ios" || Platform.OS === "android")
    ? Platform.OS
    : null;

export interface AppPinningState {
  /** Android: screen pinning / lock task. iOS: Guided Access. */
  pinned: boolean;
  /** Being screen-recorded or mirrored (iOS; Android 15+). */
  captured: boolean;
}

function read(): AppPinningState {
  if (!PINNING_PLATFORM) return { pinned: false, captured: false };
  try {
    return {
      pinned: QuizLock.isPinned(),
      captured: QuizLock.isScreenCaptured(),
    };
  } catch {
    return { pinned: false, captured: false };
  }
}

/**
 * Live pinned / captured state while `enabled`, from the quiz-lock native
 * module: its change events, a fresh read on subscribe, and another whenever
 * the app comes back to the foreground.
 */
export function useAppPinning(enabled: boolean) {
  const [state, setState] = useState<AppPinningState>(read);

  useEffect(() => {
    if (!enabled || !PINNING_PLATFORM) return;
    let stopped = false;
    const merge = (next: Partial<AppPinningState>) => {
      if (stopped) return;
      setState((prev) => {
        const pinned = next.pinned ?? prev.pinned;
        const captured = next.captured ?? prev.captured;
        return pinned === prev.pinned && captured === prev.captured
          ? prev
          : { pinned, captured };
      });
    };
    const refresh = () => {
      QuizLock.getStatusAsync()
        .then(merge)
        .catch(() => undefined);
    };
    const pinnedSub = QuizLock.addPinnedChangeListener(({ pinned }) =>
      merge({ pinned }),
    );
    const captureSub = QuizLock.addCaptureChangeListener(({ captured }) =>
      merge({ captured }),
    );
    const appSub = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    refresh();
    return () => {
      stopped = true;
      pinnedSub.remove();
      captureSub.remove();
      appSub.remove();
    };
  }, [enabled]);

  const startPinning = useCallback(async () => {
    if (!PINNING_PLATFORM) return false;
    try {
      const pinned = await QuizLock.startPinning();
      setState((prev) => (prev.pinned === pinned ? prev : { ...prev, pinned }));
      return pinned;
    } catch {
      return false;
    }
  }, []);

  const stopPinning = useCallback(async () => {
    if (!PINNING_PLATFORM) return true;
    try {
      const unpinned = await QuizLock.stopPinning();
      setState((prev) =>
        prev.pinned === !unpinned ? prev : { ...prev, pinned: !unpinned },
      );
      return unpinned;
    } catch {
      return false;
    }
  }, []);

  return { ...state, startPinning, stopPinning };
}
