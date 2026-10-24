/** Course discussions, as `/courses/:id/discussions` and the portal send them. */

export interface DiscussionAuthor {
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  isStaff: boolean;
}

export interface DiscussionTopicSummary {
  id: string;
  courseId: string;
  title: string;
  isPinned: boolean;
  isLocked: boolean;
  isPublished: boolean;
  requireInitialPost: boolean;
  author: DiscussionAuthor | null;
  isMine: boolean;
  canEdit: boolean;
  lastReplyAt: string | null;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  replyCount: number;
  unreadCount: number;
  /** False until the caller first opens it. */
  isRead: boolean;
}

export interface DiscussionList {
  studentsCanCreateTopics: boolean;
  canCreateTopics: boolean;
  topics: DiscussionTopicSummary[];
}

export interface DiscussionReply {
  id: string;
  parentId: string | null;
  body: string;
  /** A removed post kept as a placeholder because others answered it. */
  isDeleted: boolean;
  author: DiscussionAuthor | null;
  isMine: boolean;
  canEdit: boolean;
  /** Posted since the caller last opened the topic. */
  isNew: boolean;
  editedAt: string | null;
  createdAt: string;
  replies: DiscussionReply[];
}

export interface DiscussionTopic
  extends Omit<DiscussionTopicSummary, "unreadCount" | "isRead"> {
  body: string;
  /** The topic asks students to post before they see other replies. */
  mustPostFirst: boolean;
  canReply: boolean;
  replies: DiscussionReply[];
}

export function authorName(a: DiscussionAuthor | null): string {
  if (!a) return "Former member";
  return [a.firstName, a.lastName].filter(Boolean).join(" ") || "Unknown";
}

export function authorInitials(a: DiscussionAuthor | null): string {
  if (!a) return "?";
  return (
    [a.firstName?.[0], a.lastName?.[0]].filter(Boolean).join("").toUpperCase() ||
    "?"
  );
}
