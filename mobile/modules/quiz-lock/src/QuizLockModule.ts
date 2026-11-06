import { NativeModule, requireOptionalNativeModule } from "expo";
import type { QuizLockModuleEvents, QuizLockStatus } from "./QuizLock.types";

declare class QuizLockModule extends NativeModule<QuizLockModuleEvents> {
  /** Android: lock task / screen pinning. iOS: Guided Access. Cached on iOS. */
  isPinned(): boolean;
  /** iOS: recording or mirroring. Android 15+: screen recording. */
  isScreenCaptured(): boolean;
  /** Fresh read of both, from the main thread. */
  getStatusAsync(): Promise<QuizLockStatus>;
  /**
   * Android: startLockTask (the system pin prompt), true once pinned.
   * iOS: requestGuidedAccessSession; true only on supervised devices allowed
   * for Autonomous Single App Mode.
   */
  startPinning(): Promise<boolean>;
  /** True when the app is no longer pinned afterwards. */
  stopPinning(): Promise<boolean>;
}

/** Null in a dev client / build made before this module was added. */
export default requireOptionalNativeModule<QuizLockModule>("QuizLock");
