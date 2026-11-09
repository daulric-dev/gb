"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Markdown } from "@/components/markdown";
import { formatDateTime, type PortalAnnouncement } from "./types";

/**
 * One school announcement as students see it (GET /portal/me/announcements):
 * posts the school made for everyone, never staff-only notices.
 */
export function SchoolAnnouncementItem({
  announcement: a,
  compact = false,
}: {
  announcement: PortalAnnouncement;
  /** Home card: a short preview instead of the full body. */
  compact?: boolean;
}) {
  const first = a.author?.first_name ?? null;
  const last = a.author?.last_name ?? null;
  const name = [first, last].filter(Boolean).join(" ") || "School";
  const initials =
    [first?.[0], last?.[0]].filter(Boolean).join("").toUpperCase() || "?";
  return (
    <article className="flex gap-3 rounded-lg border p-3">
      <Avatar className="size-8">
        {a.author?.avatar_url && <AvatarImage src={a.author.avatar_url} alt="" />}
        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="font-medium leading-snug">{a.title}</h3>
        <p className="text-xs text-muted-foreground">
          {name} · {formatDateTime(a.created_at)}
        </p>
        {a.body &&
          (compact ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">{a.body}</p>
          ) : (
            <Markdown className="text-sm text-muted-foreground">{a.body}</Markdown>
          ))}
      </div>
    </article>
  );
}
