import { signal } from "@preact/signals-react";
import { api } from "@/lib/api";

export const unreadFiles = signal(0);

export async function refreshFileUnread() {
  try {
    const { count } = await api<{ count: number }>(
      "/files/notifications/unread-count",
    );
    unreadFiles.value = count;
  } catch {
    // Non-fatal: leave the badge as-is if the count can't be fetched.
  }
}

export async function markFilesRead() {
  try {
    await api("/files/notifications/mark-read", { method: "POST" });
    unreadFiles.value = 0;
  } catch {
    // Non-fatal.
  }
}
