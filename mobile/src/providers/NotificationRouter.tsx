import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useRouter, useSegments, type Href } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/providers/AuthProvider";
import { isStudentProfile } from "@/lib/routing";

// Show pushes that arrive while the app is open, rather than swallowing them.
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Opens the screen a tapped notification points at. Covers a cold start too:
 * `useLastNotificationResponse` reports the tap that launched the app.
 * Navigation waits until the session has loaded and the index redirect has
 * landed somewhere, so it does not race the app's own routing.
 */
export function NotificationRouter() {
  const response = Notifications.useLastNotificationResponse();
  const { profile, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const handled = useRef<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!response) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const data = response.notification.request.content.data as
      | { type?: string; sessionId?: string }
      | undefined;
    if (data?.type === "attendance.opened" && data.sessionId) {
      setPending(String(data.sessionId));
    }
    void Notifications.clearLastNotificationResponseAsync().catch(() => {});
  }, [response]);

  const settled =
    !loading &&
    segments.length > 0 &&
    (segments[0] as string) !== "(auth)";

  useEffect(() => {
    if (!pending || !settled) return;
    setPending(null);
    // Only students check in; a stale tap after switching accounts is dropped.
    if (!isStudentProfile(profile)) return;
    router.push(`/attendance/${pending}` as Href);
  }, [pending, settled, profile, router]);

  return null;
}
