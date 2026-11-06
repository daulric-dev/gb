import type { EventSubscription } from "expo";
import QuizLockModule from "./src/QuizLockModule";
import type {
  CaptureChangeEvent,
  PinnedChangeEvent,
  QuizLockStatus,
} from "./src/QuizLock.types";

export type { CaptureChangeEvent, PinnedChangeEvent, QuizLockStatus };

/**
 * False on the web and in a native build made before this module existed
 * (rebuild the dev client); every call below is then a safe no-op.
 */
export const isAvailable = QuizLockModule != null;

const NOOP_SUBSCRIPTION: EventSubscription = { remove() {} };

/** Android: screen pinning / lock task. iOS: Guided Access. */
export function isPinned(): boolean {
  return QuizLockModule?.isPinned() ?? false;
}

/** iOS: being recorded or mirrored. Android 15+: being recorded. */
export function isScreenCaptured(): boolean {
  return QuizLockModule?.isScreenCaptured() ?? false;
}

export async function getStatusAsync(): Promise<QuizLockStatus> {
  return (
    (await QuizLockModule?.getStatusAsync()) ?? {
      pinned: false,
      captured: false,
    }
  );
}

/**
 * Pin the app. Android shows the system "Pin this app?" prompt and resolves
 * once the student confirms (false if they decline). iOS resolves true only
 * where an MDM allows Autonomous Single App Mode; otherwise the student turns
 * Guided Access on with a triple-click.
 */
export async function startPinning(): Promise<boolean> {
  return (await QuizLockModule?.startPinning()) ?? false;
}

/** Unpin. Resolves whether the app is unpinned afterwards. */
export async function stopPinning(): Promise<boolean> {
  return (await QuizLockModule?.stopPinning()) ?? true;
}

export function addPinnedChangeListener(
  listener: (event: PinnedChangeEvent) => void,
): EventSubscription {
  return (
    QuizLockModule?.addListener("onPinnedChange", listener) ?? NOOP_SUBSCRIPTION
  );
}

export function addCaptureChangeListener(
  listener: (event: CaptureChangeEvent) => void,
): EventSubscription {
  return (
    QuizLockModule?.addListener("onCaptureChange", listener) ??
    NOOP_SUBSCRIPTION
  );
}
