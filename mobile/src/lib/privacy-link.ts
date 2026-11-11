import { Linking } from "react-native";
import { apiServerOrigin } from "@/lib/api";

/** The web app's origin, when the build knows it (no trailing slash). */
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL?.trim().replace(/\/$/, "") || null;

/**
 * The privacy notice of the server this app is connected to. The app knows
 * the API's address; the API answers `/privacy` with a redirect to its web
 * app's notice, which is filled in from that organisation's settings.
 */
export function privacyNoticeUrl(): string | null {
  const api = apiServerOrigin();
  if (api) return `${api.replace(/\/api$/, "")}/privacy`;
  return WEB_URL ? `${WEB_URL}/privacy` : null;
}

export function openPrivacyNotice(): void {
  const url = privacyNoticeUrl();
  if (url) void Linking.openURL(url);
}
