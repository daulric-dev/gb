export type PinnedChangeEvent = { pinned: boolean };
export type CaptureChangeEvent = { captured: boolean };

export type QuizLockModuleEvents = {
  onPinnedChange: (event: PinnedChangeEvent) => void;
  onCaptureChange: (event: CaptureChangeEvent) => void;
};

export type QuizLockStatus = { pinned: boolean; captured: boolean };
