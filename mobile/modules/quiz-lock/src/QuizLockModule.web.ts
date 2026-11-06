import { NativeModule, registerWebModule } from "expo";
import type { QuizLockModuleEvents, QuizLockStatus } from "./QuizLock.types";

/** No pinning or capture state on the web; the web app has its own lockdown. */
class QuizLockModule extends NativeModule<QuizLockModuleEvents> {
  isPinned() {
    return false;
  }
  isScreenCaptured() {
    return false;
  }
  async getStatusAsync(): Promise<QuizLockStatus> {
    return { pinned: false, captured: false };
  }
  async startPinning() {
    return false;
  }
  async stopPinning() {
    return true;
  }
}

export default registerWebModule(QuizLockModule, "QuizLockModule");
