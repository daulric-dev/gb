import { api } from "@/lib/api";

/**
 * The signed-in account's own notification preferences (backend
 * src/notifications): each category on/off per channel. Parents' notices
 * about their children have their own settings in the parent portal.
 */

export const NOTIFICATION_CATEGORIES = [
  "announcements",
  "coursework",
  "grades",
  "discussions",
  "attendance",
  "chat",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationChannel = "push" | "email";
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ["push", "email"];

/** Used when an older server leaves `categories` out. */
export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  announcements: "Announcements",
  coursework: "New work and peer reviews",
  grades: "Grades and feedback",
  discussions: "Discussions",
  attendance: "Attendance",
  chat: "Messages",
};

export const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  push: "Push (mobile app)",
  email: "Email",
};

/** GET/PUT /notifications/preferences */
export interface NotificationPreferences {
  push: Record<string, boolean>;
  email: Record<string, boolean>;
  categories?: { key: string; label: string }[];
}

export const getNotificationPreferences = () =>
  api<NotificationPreferences>("/notifications/preferences");

export const updateNotificationPreferences = (patch: Partial<Record<NotificationChannel, Record<string, boolean>>>) =>
  api<NotificationPreferences>("/notifications/preferences", { method: "PUT", body: patch });

/** The rows to show: the server's list (with its labels), else the known categories. */
export function preferenceRows(prefs: NotificationPreferences): { key: string; label: string }[] {
  if (Array.isArray(prefs.categories) && prefs.categories.length > 0) return prefs.categories;
  return NOTIFICATION_CATEGORIES.map((key) => ({ key, label: NOTIFICATION_CATEGORY_LABELS[key] }));
}

/** Whether a category is on for a channel (missing = on: everything starts on). */
export function isOn(prefs: NotificationPreferences, channel: NotificationChannel, key: string): boolean {
  return prefs[channel]?.[key] !== false;
}

/** The optimistic state after switching one category on a channel. */
export function withPreference(
  prefs: NotificationPreferences,
  channel: NotificationChannel,
  key: string,
  on: boolean,
): NotificationPreferences {
  return { ...prefs, [channel]: { ...prefs[channel], [key]: on } };
}
