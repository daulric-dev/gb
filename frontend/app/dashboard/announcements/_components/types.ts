export interface AnnouncementAuthor {
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

export interface AnnouncementReader {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

export interface Announcement {
  id: string;
  school_id: string;
  author_user_profile_id: string | null;
  title: string;
  body: string | null;
  created_at: string | null;
  updated_at: string | null;
  author?: AnnouncementAuthor | null;
  readers?: AnnouncementReader[];
}
