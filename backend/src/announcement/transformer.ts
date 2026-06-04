export interface AnnouncementAuthor {
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
}

export interface MessageResponse {
  message: string;
}

export function v1AnnouncementList(data: Announcement[]): Announcement[] {
  return data;
}

export function v1AnnouncementDetail(raw: Announcement): Announcement {
  return raw;
}

export function v1AnnouncementCreated(raw: Announcement): Announcement {
  return raw;
}

export function v1AnnouncementUpdated(raw: Announcement): Announcement {
  return raw;
}

export function v1AnnouncementDeleted(raw: MessageResponse): MessageResponse {
  return raw;
}

export interface UnreadCount {
  count: number;
}

export function v1AnnouncementUnreadCount(raw: UnreadCount): UnreadCount {
  return raw;
}

export function v1AnnouncementMarkRead(raw: UnreadCount): UnreadCount {
  return raw;
}
