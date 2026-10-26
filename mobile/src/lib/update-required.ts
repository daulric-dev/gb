import { Platform } from "react-native";
import * as Application from "expo-application";

/**
 * This build's version, and the app-wide "update required" state.
 *
 * Kept apart from app-update.ts (which calls the API) so the API client can
 * import it: every request carries the version, and any response can be the
 * API's 426 `update_required` for a build below the minimum.
 */

export type MobilePlatform = "ios" | "android";

export const APP_PLATFORM: MobilePlatform | null =
  Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : null;

/** The store version (CFBundleShortVersionString / versionName); null on web. */
export const INSTALLED_VERSION: string | null = APP_PLATFORM
  ? Application.nativeApplicationVersion
  : null;

/** `X-GradeBook-App-Version`, e.g. "ios/1.4.0"; null on web. */
export const APP_VERSION_HEADER: string | null =
  APP_PLATFORM && INSTALLED_VERSION
    ? `${APP_PLATFORM}/${INSTALLED_VERSION}`
    : null;

export interface UpdateRequiredState {
  required: boolean;
  /** Where "Update" goes; null when the API doesn't know the store. */
  storeUrl: string | null;
}

let state: UpdateRequiredState = { required: false, storeUrl: null };
const listeners = new Set<() => void>();

export function getUpdateRequired(): UpdateRequiredState {
  return state;
}

export function subscribeUpdateRequired(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(next: UpdateRequiredState) {
  state = next;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Never let a listener swallow the caller's error.
    }
  }
}

/** Flips the app into the blocking "Update required" screen. */
export function setUpdateRequired(storeUrl: string | null): void {
  // Keep a URL we already know when a later 426 doesn't carry one.
  const url = storeUrl ?? state.storeUrl;
  if (state.required && state.storeUrl === url) return;
  emit({ required: true, storeUrl: url });
}

/** A fresh check found this build is allowed after all (minimum lowered). */
export function clearUpdateRequired(): void {
  if (state.required) emit({ required: false, storeUrl: state.storeUrl });
}

/** The API's 426 for a build below the minimum. */
export function isUpdateRequiredResponse(status: number, body: unknown): boolean {
  return (
    status === 426 &&
    typeof body === "object" &&
    body !== null &&
    (body as { code?: unknown }).code === "update_required"
  );
}

export function storeUrlFrom(body: unknown): string | null {
  const url = (body as { storeUrl?: unknown } | null)?.storeUrl;
  return typeof url === "string" && /^https:\/\//i.test(url) ? url : null;
}
