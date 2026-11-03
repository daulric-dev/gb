import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { api } from "@/lib/api";
import { pushState } from "@/lib/push-state";

/** Android channel the backend's attendance pushes are delivered on. */
export const ATTENDANCE_CHANNEL = "attendance";

/** Android channel for new work and course announcements. */
export const COURSE_CHANNEL = "coursework";

function projectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId
  );
}

/**
 * Ask for notification permission, fetch this device's Expo push token and
 * register it with the API. Never throws: push is a convenience, so any
 * failure (simulator, denied permission, no EAS project) just returns null.
 *
 * Concurrent calls share one registration, and unregisterPush waits for it,
 * so a logout can never race ahead of the POST and leave the token bound.
 */
export function registerForPush(): Promise<string | null> {
  if (pushState.pending) return pushState.pending;
  const run = register(pushState.generation).finally(() => {
    if (pushState.pending === run) pushState.pending = null;
  });
  pushState.pending = run;
  return run;
}

async function register(generation: number): Promise<string | null> {
  try {
    // Simulators and emulators cannot receive remote pushes, and web push is
    // not wired up.
    if (Platform.OS === "web" || !Device.isDevice) return null;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(ATTENDANCE_CHANNEL, {
        name: "Attendance",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        sound: "default",
      });
      await Notifications.setNotificationChannelAsync(COURSE_CHANNEL, {
        name: "New work and announcements",
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: "default",
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.granted;
    }
    if (!granted) return null;

    const id = projectId();
    if (!id) {
      console.warn(
        "Push disabled: run `eas init` to set extra.eas.projectId",
      );
      return null;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: id,
    });

    // Logged out (or push switched off) while we were asking: don't bind.
    if (generation !== pushState.generation) return null;

    await api("/notifications/devices", {
      method: "POST",
      body: { token, platform: Platform.OS === "ios" ? "ios" : "android" },
      skipAuthRedirect: true,
    });
    // Recorded even if withdrawn mid-POST: unregisterPush is waiting on this
    // and deletes it next.
    pushState.token = token;
    return generation === pushState.generation ? token : null;
  } catch (err) {
    console.warn("Push registration failed", err);
    return null;
  }
}

/**
 * Detach this device from the signed-in account. Call before the session is
 * ended - the API only deletes the caller's own token.
 */
export async function unregisterPush(): Promise<void> {
  // Stop a registration that hasn't posted yet, and wait out one that has.
  pushState.bump();
  const inFlight = pushState.pending;
  if (inFlight) await inFlight.catch(() => null);
  const token = pushState.token;
  if (!token) return;
  pushState.token = null;
  try {
    await api(`/notifications/devices/${encodeURIComponent(token)}`, {
      method: "DELETE",
      skipAuthRedirect: true,
    });
  } catch {
    /* the token is moved to whoever signs in next anyway */
  }
}
