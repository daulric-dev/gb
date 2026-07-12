"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  FileText,
  GraduationCap,
  Eye,
  Download,
  Check,
  X,
} from "lucide-react";
import {
  conversations,
  messagesByConversation,
  activeConversationId,
  sendChatMessage,
  actOnMessage,
  conversationTitle,
  otherParticipant,
  isOnline,
  type ChatMessage,
} from "@/lib/chat";
import { PresenceDot } from "./PresenceDot";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function fileContentUrl(fileId: string) {
  return `${API_BASE}/api/files/${fileId}/content`;
}

function messageTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MessageThread({ selfId }: { selfId: string | null }) {
  useSignals();
  const router = useRouter();
  const draft = useSignal("");
  const sending = useSignal(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const conversationId = activeConversationId.value;
  const conversation = conversations.value.find((c) => c.id === conversationId);
  const messages = conversationId
    ? messagesByConversation.value[conversationId] ?? []
    : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, conversationId]);

  if (!conversationId || !conversation) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a conversation to start chatting.
      </div>
    );
  }

  async function send() {
    const body = draft.value.trim();
    if (!body || sending.value || !conversationId) return;
    sending.value = true;
    draft.value = "";
    try {
      await sendChatMessage(conversationId, body);
    } catch {
      toast.error("Failed to send");
      draft.value = body;
    } finally {
      sending.value = false;
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="truncate font-medium">
            {conversationTitle(conversation, selfId)}
          </div>
          {conversation.type === "direct" &&
            (() => {
              const other = otherParticipant(conversation, selfId);
              const online = isOnline(other?.userId);
              return (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <PresenceDot online={online} />
                  {online ? "Online" : "Offline"}
                </div>
              );
            })()}
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.map((m) =>
          m.type === "text" ? (
            <TextBubble key={m.id} message={m} mine={m.senderId === selfId} />
          ) : (
            <SystemCard
              key={m.id}
              message={m}
              mine={m.senderId === selfId}
              onView={async () => {
                if (m.actionState === "pending") {
                  await actOnMessage(m.id, "accept");
                }
                if (m.type === "file_share") {
                  window.open(
                    fileContentUrl(String(m.metadata.fileId)),
                    "_blank",
                    "noopener",
                  );
                } else if (m.type === "class_invite") {
                  router.push(`/dashboard/classes/${m.metadata.classId}`);
                }
              }}
              onDismiss={() => actOnMessage(m.id, "dismiss")}
            />
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-2 border-t p-3">
        <Textarea
          value={draft.value}
          onChange={(e) => (draft.value = e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Type a message…  (Enter to send, Shift+Enter for a new line)"
          rows={1}
          className="max-h-40 min-h-10 resize-none"
        />
        <Button onClick={send} disabled={sending.value || !draft.value.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}

function TextBubble({
  message,
  mine,
}: {
  message: ChatMessage;
  mine: boolean;
}) {
  const deleted = !!message.deletedAt;
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3 py-2 text-sm",
          mine
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        <p className={cn("whitespace-pre-wrap break-words", deleted && "italic opacity-70")}>
          {deleted ? "Message deleted" : message.body}
        </p>
        <span
          className={cn(
            "mt-0.5 block text-right text-[10px]",
            mine ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {message.editedAt && !deleted ? "edited · " : ""}
          {messageTime(message.createdAt)}
        </span>
      </div>
    </div>
  );
}

function SystemCard({
  message,
  mine,
  onView,
  onDismiss,
}: {
  message: ChatMessage;
  mine: boolean;
  onView: () => void;
  onDismiss: () => void;
}) {
  const isFile = message.type === "file_share";
  const Icon = isFile ? FileText : GraduationCap;
  const canDownload = isFile && message.metadata.canDownload === true;
  const dismissed = message.actionState === "dismissed";
  const accepted = message.actionState === "accepted";

  const title = isFile
    ? String(message.metadata.fileName ?? "a file")
    : String(message.metadata.className ?? "a class");

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-md rounded-xl border bg-card p-3 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
            <Icon className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className="font-medium">{mine ? "You" : "They"}</span>{" "}
              {message.body}
            </p>
            <p className="truncate text-xs text-muted-foreground">{title}</p>

            {/* The recipient gets the action; the sender sees a status. */}
            {mine ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {accepted
                  ? isFile
                    ? "Opened"
                    : "Viewed"
                  : dismissed
                    ? "Dismissed"
                    : "Waiting for a response"}
              </p>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" onClick={onView}>
                  {isFile ? (
                    <>
                      {canDownload ? (
                        <Download className="size-3.5" />
                      ) : (
                        <Eye className="size-3.5" />
                      )}
                      {message.actionState === "pending"
                        ? "Accept & view file"
                        : "View file"}
                    </>
                  ) : (
                    <>
                      <Eye className="size-3.5" />
                      {message.actionState === "pending"
                        ? "Accept & view class"
                        : "View class"}
                    </>
                  )}
                </Button>
                {message.actionState === "pending" && (
                  <Button size="sm" variant="ghost" onClick={onDismiss}>
                    <X className="size-3.5" />
                    Dismiss
                  </Button>
                )}
                {accepted && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Check className="size-3.5" /> Accepted
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
