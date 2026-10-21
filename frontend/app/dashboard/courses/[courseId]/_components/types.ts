/**
 * A course announcement. Course announcements live in the same table as the
 * school-wide ones (with a course id), so the row shape matches
 * `/announcements`.
 */
export interface CourseAnnouncement {
  id: string;
  school_id: string;
  course_id?: string | null;
  author_user_profile_id: string | null;
  title: string;
  body: string | null;
  created_at: string | null;
  updated_at: string | null;
  author?: {
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  } | null;
}

export function announcementAuthor(a: CourseAnnouncement): string {
  const name =
    `${a.author?.first_name ?? ""} ${a.author?.last_name ?? ""}`.trim();
  return name || "Staff";
}
