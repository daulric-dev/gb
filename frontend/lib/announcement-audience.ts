/**
 * Who a school-wide announcement is for (`audience` on `/announcements`).
 * `staff` is the staff notice board; `everyone` also reaches the school's
 * students (portal home, push) and parents (parent portal).
 */
export const ANNOUNCEMENT_AUDIENCES = ["staff", "everyone"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  staff: "Staff only",
  everyone: "Everyone — staff, students and parents",
};

/** Short badge text for lists. */
export const AUDIENCE_BADGES: Record<AnnouncementAudience, string> = {
  staff: "Staff only",
  everyone: "Everyone",
};

/** A missing or unknown value (older server) is the staff-only default. */
export function audienceOf(value: unknown): AnnouncementAudience {
  return value === "everyone" ? "everyone" : "staff";
}
