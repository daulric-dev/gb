/**
 * Who a school-wide announcement is for (`audience` on `/announcements`).
 * `staff` is the staff notice board; `everyone` also reaches the school's
 * students (portal home, push) and parents (parent portal). Mirrors the web.
 */
export const ANNOUNCEMENT_AUDIENCES = ["staff", "everyone"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

/** Segmented-control labels (short: they share one row). */
export const AUDIENCE_OPTIONS: { value: AnnouncementAudience; label: string }[] = [
  { value: "staff", label: "Staff only" },
  { value: "everyone", label: "Everyone" },
];

export const AUDIENCE_BADGES: Record<AnnouncementAudience, string> = {
  staff: "Staff only",
  everyone: "Everyone",
};

/** A missing or unknown value (older server) is the staff-only default. */
export function audienceOf(value: unknown): AnnouncementAudience {
  return value === "everyone" ? "everyone" : "staff";
}

/** GET /portal/me/announcements: the school's posts for everyone. */
export interface SchoolAnnouncement {
  id: string;
  title: string;
  body: string | null;
  created_at: string | null;
  updated_at: string | null;
  author: {
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  } | null;
}
