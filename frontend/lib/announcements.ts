import { signal } from "@preact/signals-react";
import { api } from "@/lib/api";

/** Global unread-announcement count, shared between the sidebar badge and the
 * announcements page. Components that read it must call `useSignals()`. */
export const unreadAnnouncements = signal(0);

export async function refreshAnnouncementUnread() {
  try {
    const { count } = await api<{ count: number }>(
      "/announcements/unread-count",
    );
    unreadAnnouncements.value = count;
  } catch {
    // Non-fatal: leave the badge as-is if the count can't be fetched.
  }
}

export async function markAnnouncementsRead() {
  try {
    await api("/announcements/mark-read", { method: "POST" });
    unreadAnnouncements.value = 0;
  } catch {
    // Non-fatal.
  }
}
