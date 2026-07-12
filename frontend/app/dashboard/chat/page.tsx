"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useProfile } from "@/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeft, MessageSquarePlus } from "lucide-react";
import {
  activeConversationId,
  selectConversation,
  refreshConversations,
} from "@/lib/chat";
import { ConversationList } from "./_components/ConversationList";
import { MessageThread } from "./_components/MessageThread";
import { NewChatDialog } from "./_components/NewChatDialog";

export default function ChatPage() {
  useSignals();
  const { profile } = useProfile();
  const selfId = profile.value?.id ?? null;
  const newChatOpen = useSignal(false);

  // The provider keeps this fresh live, but refresh on mount for a cold open.
  useEffect(() => {
    void refreshConversations();
  }, []);

  const hasActive = activeConversationId.value !== null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Messages</h1>
          <p className="text-sm text-muted-foreground">
            Chat with anyone at your school in real time.
          </p>
        </div>
        <Button onClick={() => (newChatOpen.value = true)}>
          <MessageSquarePlus className="size-4" />
          New message
        </Button>
      </div>

      <div className="grid h-[calc(100dvh-12rem)] min-h-[28rem] grid-cols-1 overflow-hidden rounded-xl border md:grid-cols-[20rem_1fr]">
        {/* Conversation list: always shown on desktop; on mobile only when no
            thread is open. */}
        <div
          className={cn(
            "min-h-0 border-r md:block",
            hasActive ? "hidden" : "block",
          )}
        >
          <ConversationList
            selfId={selfId}
            onSelect={(id) => selectConversation(id)}
          />
        </div>

        {/* Thread: always shown on desktop; on mobile only when a thread is
            open, with a back button to return to the list. */}
        <div
          className={cn("min-h-0", hasActive ? "block" : "hidden md:block")}
        >
          {hasActive && (
            <div className="border-b p-1 md:hidden">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => (activeConversationId.value = null)}
              >
                <ArrowLeft className="size-4" />
                Back
              </Button>
            </div>
          )}
          <div className="h-full">
            <MessageThread selfId={selfId} />
          </div>
        </div>
      </div>

      <NewChatDialog
        open={newChatOpen.value}
        onOpenChange={(o) => (newChatOpen.value = o)}
      />
    </div>
  );
}
