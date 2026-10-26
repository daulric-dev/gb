import { Linking } from "react-native";
import * as SecureStore from "expo-secure-store";
import { api } from "@/lib/api";
import { isOlder } from "@/lib/version";
import {
  APP_PLATFORM,
  INSTALLED_VERSION,
  clearUpdateRequired,
  setUpdateRequired,
  storeUrlFrom,
} from "@/lib/update-required";

/**
 * Asks the API (GET /app/version) whether this build is still current.
 *
 * - below the platform minimum: the blocking "Update required" screen
 *   (UpdateGate), the same one a 426 from any call opens;
 * - below the latest: an "Update available" prompt, which "Later" silences
 *   until a newer release;
 * - anything else, including no network: carry on. A failed check never
 *   blocks the app.
 */

interface PlatformVersions {
  minimum: string | null;
  latest: string | null;
  storeUrl: string | null;
}

type VersionsResponse = Partial<Record<"ios" | "android", PlatformVersions>>;

export type UpdateStatus =
  | { kind: "required"; storeUrl: string | null }
  | { kind: "available"; latest: string; storeUrl: string | null }
  | { kind: "current" }
  /** Web, an unreadable build version, or the check failed. */
  | { kind: "unknown" };

/** The most recent store URL the API gave, for screens that offer "Update". */
let knownStoreUrl: string | null = null;

export function lastKnownStoreUrl(): string | null {
  return knownStoreUrl;
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!APP_PLATFORM || !INSTALLED_VERSION) return { kind: "unknown" };
  let info: PlatformVersions | undefined;
  try {
    const data = await api<VersionsResponse>("/app/version", {
      skipAuthRedirect: true,
    });
    info = data?.[APP_PLATFORM];
  } catch {
    return { kind: "unknown" };
  }
  if (!info) return { kind: "unknown" };

  const storeUrl = storeUrlFrom(info);
  knownStoreUrl = storeUrl;
  if (isOlder(INSTALLED_VERSION, info.minimum)) {
    setUpdateRequired(storeUrl);
    return { kind: "required", storeUrl };
  }
  clearUpdateRequired();
  if (info.latest && isOlder(INSTALLED_VERSION, info.latest)) {
    return { kind: "available", latest: info.latest, storeUrl };
  }
  return { kind: "current" };
}

/** Opens the store page; false when there is none or it won't open. */
export async function openStore(storeUrl: string | null): Promise<boolean> {
  if (!storeUrl) return false;
  try {
    await Linking.openURL(storeUrl);
    return true;
  } catch {
    return false;
  }
}

// ── "Later" ─────────────────────────────────────────────────────────────────

const DISMISSED_KEY = "gb_update_dismissed";
let dismissedMemory: string | null | undefined;

/** The latest version the user said "Later" to, if any. */
async function dismissedVersion(): Promise<string | null> {
  if (dismissedMemory === undefined) {
    try {
      dismissedMemory = await SecureStore.getItemAsync(DISMISSED_KEY);
    } catch {
      dismissedMemory = null;
    }
  }
  return dismissedMemory ?? null;
}

export async function dismissUpdate(latest: string): Promise<void> {
  dismissedMemory = latest;
  try {
    await SecureStore.setItemAsync(DISMISSED_KEY, latest);
  } catch {
    /* web / no keychain: remembered for this run */
  }
}

/** Whether the "Update available" prompt should show for this release. */
export async function shouldPromptFor(latest: string): Promise<boolean> {
  return (await dismissedVersion()) !== latest;
}
