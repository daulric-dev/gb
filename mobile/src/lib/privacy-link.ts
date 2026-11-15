import { Linking } from "react-native";
import { apiServerOrigin } from "@/lib/api";

/** The web app's origin, when the build knows it (no trailing slash). */
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL?.trim().replace(/\/$/, "") || null;

/**
 * A page of the web app for the server this app is connected to: the API's
 * origin (the web app is served from the same address, as `/privacy`
 * relies on), else the build's web URL.
 */
export function webPageUrl(path: string): string | null {
  const api = apiServerOrigin();
  if (api) return `${api.replace(/\/api$/, "")}${path}`;
  return WEB_URL ? `${WEB_URL}${path}` : null;
}

/**
 * The privacy notice of the server this app is connected to. The app knows
 * the API's address; the API answers `/privacy` with a redirect to its web
 * app's notice, which is filled in from that organisation's settings.
 */
export function privacyNoticeUrl(): string | null {
  return webPageUrl("/privacy");
}

export function openPrivacyNotice(): void {
  const url = privacyNoticeUrl();
  if (url) void Linking.openURL(url);
}

/**
 * Where each kind of account asks for and downloads its data on the web
 * (the "data download" card; the ready email links to the same pages). The
 * download needs "Confirm it's you", which the app does not have, so it is
 * done in the browser.
 */
export const DATA_DOWNLOAD_PATHS = {
  staff: "/dashboard/settings",
  student: "/portal/settings",
  parent: "/parent/settings",
} as const;

export function openDataDownload(account: keyof typeof DATA_DOWNLOAD_PATHS): void {
  const url = webPageUrl(DATA_DOWNLOAD_PATHS[account]);
  if (url) void Linking.openURL(url);
}

/** The web account settings, where the sign-in email address is changed. */
export function openWebAccountSettings(): void {
  const url = webPageUrl("/dashboard/settings");
  if (url) void Linking.openURL(url);
}
