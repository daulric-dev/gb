"use client";

import { useSignals } from "@preact/signals-react/runtime";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  conversations,
  activeConversationId,
  conversationTitle,
  otherParticipant,
  type ChatConversation,
} from "@/lib/chat";

function previewText(conv: ChatConversation): string {
  const m = conv.lastMessage;
  if (!m) return "No messages yet";
  if (m.deletedAt) return "Message deleted";
  if (m.type === "file_share") return "📎 Shared a file";
  if (m.type === "class_invite") return "🎓 Class invitation";
  return m.body ?? "";
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ConversationList({
  selfId,
  onSelect,
}: {
  selfId: string | null;
  onSelect: (id: string) => void;
}) {
  useSignals();

  if (conversations.value.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No conversations yet. Start one with “New message”.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <ul>
        {conversations.value.map((conv) => {
          const other = otherParticipant(conv, selfId);
          const active = activeConversationId.value === conv.id;
          const title = conversationTitle(conv, selfId);
          return (
            <li key={conv.id}>
              <button
                onClick={() => onSelect(conv.id)}
                className={cn(
                  "flex w-full items-center gap-3 border-b px-3 py-3 text-left transition-colors hover:bg-accent/60",
                  active && "bg-accent",
                )}
              >
                <Avatar className="size-9 shrink-0">
                  {other?.avatarUrl && <AvatarImage src={other.avatarUrl} alt="" />}
                  <AvatarFallback className="text-xs">
                    {(title[0] ?? "?").toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{title}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {timeLabel(conv.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">
                      {previewText(conv)}
                    </span>
                    {conv.unreadCount > 0 && (
                      <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}
