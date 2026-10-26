import { Platform } from "react-native";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";

/**
 * The app's session token, kept in the device keychain / keystore.
 *
 * The web app signs in with an HttpOnly cookie. Native cookie storage is not
 * dependable for that: it drops `Secure` cookies from an http server (a local
 * API) and doesn't always replay cookies across LAN addresses, which showed up
 * as "Session expired" right after signing in. So the app asks the API for the
 * token itself (`X-GradeBook-Client: native` - the API answers sign-in with an
 * `X-Session-Token` header) and sends it as `Authorization: Bearer` on every
 * request. The token is the same server-issued session the cookie would hold.
 *
 * The API replaces the token about once a day (rotation) and sends the new one
 * in `X-Session-Token` on that response, whatever its status. Every response
 * goes through `rememberSessionToken`, so a rotated token is never dropped: the
 * old one only works for a couple of minutes, and after that the API treats it
 * as copied and signs the device out.
 */
const KEY = "gb_session_token";

/**
 * This device for Signed-in devices and new sign-in alerts, e.g.
 * "iPhone 15 Pro · iOS 19.0" (the API shows "GradeBook app on iPhone 15 Pro
 * (iOS 19.0)").
 */
function deviceDescription(): string {
  const model = Device.modelName ?? Device.deviceName ?? null;
  const os = Device.osName ?? Platform.OS;
  const version = Device.osVersion ?? String(Platform.Version ?? "");
  const system = `${os} ${version}`.trim();
  return (model ? `${model} · ${system}` : system).slice(0, 80);
}

const DEVICE = deviceDescription();

const NATIVE_HEADERS = {
  "X-GradeBook-Client": "native",
  // Percent-encoded: header values must be ASCII, model names may not be.
  "X-GradeBook-Device": encodeURIComponent(DEVICE),
} as const;

let cached: string | null | undefined;

export async function getSessionToken(): Promise<string | null> {
  if (cached === undefined) {
    try {
      cached = await SecureStore.getItemAsync(KEY);
    } catch {
      cached = null;
    }
  }
  return cached ?? null;
}

export async function setSessionToken(token: string | null): Promise<void> {
  cached = token;
  try {
    if (token) await SecureStore.setItemAsync(KEY, token);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* web / no keychain: the in-memory copy still works for this run */
  }
}

/** Headers that identify the app and carry its session, for any API request. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  return token
    ? { ...NATIVE_HEADERS, Authorization: `Bearer ${token}` }
    : { ...NATIVE_HEADERS };
}

/**
 * Keep a token the API issued on this response: sign-in, the SSO hand-off, or
 * a daily rotation. Call it for every response, successful or not.
 */
export async function rememberSessionToken(res: Response): Promise<void> {
  const token = res.headers.get("x-session-token");
  if (token) await setSessionToken(token);
}
