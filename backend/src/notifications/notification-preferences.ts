import type { PrismaService } from '@/prisma/prisma.service';

/**
 * What a notification is about. Every account (staff, student, parent) can
 * turn a category off per channel in account settings; parents' own notices
 * about their children keep their separate settings in the parent portal
 * (student.parent_notification_pref).
 */
export const NOTIFICATION_CATEGORIES = [
  'announcements',
  'coursework',
  'grades',
  'discussions',
  'attendance',
  'chat',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationChannel = 'push' | 'email';

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  announcements: 'Announcements',
  coursework: 'New work and peer reviews',
  grades: 'Grades and feedback',
  discussions: 'Discussions',
  attendance: 'Attendance',
  chat: 'Messages',
};

export type ChannelPrefs = Record<NotificationCategory, boolean>;

export interface NotificationPreferences {
  push: ChannelPrefs;
  email: ChannelPrefs;
}

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

/** Stored "off" lists to the on/off map clients show (unknown entries ignored). */
export function prefsFromRow(
  row: { push_off: string[]; email_off: string[] } | null | undefined,
): NotificationPreferences {
  const map = (off: string[] | undefined): ChannelPrefs =>
    Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, !(off ?? []).includes(c)])) as ChannelPrefs;
  return { push: map(row?.push_off), email: map(row?.email_off) };
}

export interface NotificationOptOutRow {
  channel: string;
  category: string;
}

/** Reconstruct the API's channel lists from portable opt-out rows. */
export function offListsFromRows(rows: readonly NotificationOptOutRow[]): {
  push_off: string[];
  email_off: string[];
} {
  const push = new Set(rows.filter((row) => row.channel === 'push' && isNotificationCategory(row.category)).map((row) => row.category));
  const email = new Set(rows.filter((row) => row.channel === 'email' && isNotificationCategory(row.category)).map((row) => row.category));
  return {
    push_off: NOTIFICATION_CATEGORIES.filter((category) => push.has(category)),
    email_off: NOTIFICATION_CATEGORIES.filter((category) => email.has(category)),
  };
}

export function optOutRowsFromLists(push: readonly string[], email: readonly string[]) {
  return [
    ...push.filter(isNotificationCategory).map((category) => ({ channel: 'push', category })),
    ...email.filter(isNotificationCategory).map((category) => ({ channel: 'email', category })),
  ];
}

/** Apply a partial on/off change to stored "off" lists. */
export function mergeOff(
  current: string[] | undefined,
  patch: Partial<Record<string, boolean>> | undefined,
): string[] {
  const off = new Set((current ?? []).filter(isNotificationCategory));
  for (const [key, on] of Object.entries(patch ?? {})) {
    if (!isNotificationCategory(key) || typeof on !== 'boolean') continue;
    if (on) off.delete(key);
    else off.add(key);
  }
  return NOTIFICATION_CATEGORIES.filter((c) => off.has(c));
}

/**
 * The accounts among `userIds` who turned `category` off for `channel`.
 * One query; no row means everything on.
 */
export async function optedOut(
  prisma: PrismaService,
  userIds: string[],
  category: NotificationCategory,
  channel: NotificationChannel,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await prisma.notification_preference_opt_out.findMany({
    where: { user_profile_id: { in: userIds }, channel, category },
    select: { user_profile_id: true },
  });
  return new Set(rows.map((r) => r.user_profile_id));
}

/** `userIds` without those who turned `category` off for `channel`. */
export async function allowedRecipients(
  prisma: PrismaService,
  userIds: string[],
  category: NotificationCategory,
  channel: NotificationChannel,
): Promise<string[]> {
  const out = await optedOut(prisma, userIds, category, channel);
  return out.size === 0 ? userIds : userIds.filter((id) => !out.has(id));
}
