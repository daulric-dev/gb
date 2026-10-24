import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useRouter, useSegments, type Href } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/providers/AuthProvider";
import { isStudentProfile } from "@/lib/routing";
import { noticeHref } from "@/lib/calendar";

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

interface PendingTap {
  student: string | null;
  staff: string | null;
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
  /** What a tapped push points at, opened once routing settles. */
  const [pending, setPending] = useState<PendingTap | null>(null);

  useEffect(() => {
    if (!response) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const data = response.notification.request.content.data as
      | {
          type?: string;
          sessionId?: string;
          courseId?: string;
          activityId?: string;
          topicId?: string;
        }
      | undefined;
    if (data?.type === "attendance.opened" && data.sessionId) {
      setPending({ student: `/attendance/${data.sessionId}`, staff: null });
    } else if (data?.type === "course.discussion") {
      // A new topic or reply opens the topic, on whichever side of the app
      // the signed-in user belongs to.
      setPending({
        student: noticeHref(data, "student"),
        staff: noticeHref(data, "staff"),
      });
    } else if (
      data?.type === "course.activity_published" ||
      data?.type === "course.announcement"
    ) {
      // New work opens its work screen; an announcement opens the course on
      // its Announcements section.
      setPending({ student: noticeHref(data), staff: null });
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
    // Each push names its student and staff screen; one with no screen for
    // the signed-in side (a stale tap after switching accounts) is dropped.
    const target = isStudentProfile(profile) ? pending.student : pending.staff;
    if (target) router.push(target as Href);
  }, [pending, settled, profile, router]);

  return null;
}
